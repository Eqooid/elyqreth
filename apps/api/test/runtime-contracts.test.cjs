'use strict';
require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { inspect } = require('node:util');
const { NestFactory } = require('@nestjs/core');
const { Module } = require('@nestjs/common');
const { ConfigModule } = require('../dist/config/config.module');
const { validateEnvironment } = require('../dist/config/configuration');
const { ApiLogger } = require('../dist/common/api-logger');
const { RuntimeModule } = require('../dist/runtime/runtime.module');
const { ExecutionContextFactory } = require('../dist/runtime/context/execution-context.factory');
const { createRuntimeDefinition } = require('../dist/runtime/contracts/definition.contract');
const { createRuntimeExecutionRequest } = require('../dist/runtime/contracts/execution-request.contract');
const { createRuntimeExecutionResult } = require('../dist/runtime/contracts/execution-result.contract');
const { assertRuntimeActive } = require('../dist/runtime/contracts/execution-context.contract');
const { RuntimeError, runtimeErrorMessages } = require('../dist/runtime/contracts/runtime-error.contract');
const tokens = require('../dist/runtime/tokens/runtime.tokens');

const code = expected => error => error instanceof RuntimeError && error.code === expected;
const ids = () => Object.fromEntries(['ownerId','taskId','executionId','agentId','orchestratorId','correlationId'].map(key => [key, randomUUID()]));
function definition(llm = false, tools = false) {
  return { schemaVersion: 1, definitionId: 'approved.definition', definitionVersion: 1,
    agentType: llm ? 'LLM' : 'RULE_BASED', strategyType: llm ? 'LLM' : 'RULE_BASED',
    strategyId: llm ? 'llm.text.v1' : 'text.stats.v1', outputType: llm ? 'text' : 'text.statistics.v1',
    budget: { executionTimeoutMs: 120000, providerTimeoutMs: llm ? 60000 : 0, toolTimeoutMs: tools ? 2000 : 0,
      maxOutputTokens: llm ? 512 : 0, maxProviderRounds: tools ? 3 : llm ? 1 : 0, maxToolCalls: tools ? 2 : 0, maxResultBytes: 32768 },
    toolCapabilities: tools ? ['tool.calculator.v1'] : [],
    ...(llm ? { providerProfile: { id: 'local-small', profileVersion: 1, model: 'approved-model:small',
      capabilities: { text: true, transportAbort: true, remoteCancellation: 'unknown', structuredOutput: 'none', toolCalls: tools, streaming: false } } } : {}),
  };
}
const rawRequest = (llm = false, tools = false) => ({ ids: ids(), input: { instruction: 'Private task marker', context: 'Private context marker' }, definition: definition(llm, tools) });
function fixture(llm = false, tools = false) {
  const raw = rawRequest(llm, tools), request = createRuntimeExecutionRequest(raw), controller = new AbortController(), logs = [];
  const logger = { info: (...args) => logs.push(args), error: (...args) => logs.push(args) };
  const factory = new ExecutionContextFactory(logger);
  const args = { request, deadlineAt: new Date(Date.now() + 30000).toISOString(), signal: controller.signal };
  return { raw, request, controller, logs, factory, args, create: extra => factory.create({ ...args, ...extra }) };
}
const candidate = (request, text = 'Safe response') => ({ schemaVersion: 1, executionId: request.ids.executionId,
  output: request.definition.strategyType === 'LLM' ? { type: 'text', text } :
    { type: 'text.statistics.v1', data: { codePointCount: 5, wordCount: 1, nonemptyLineCount: 1 } } });

test('runtime definition discriminates native strategies, freezes copies and retains no provider secret fields', () => {
  for (const llm of [false, true]) {
    const raw = definition(llm), result = createRuntimeDefinition(raw);
    assert.equal(result.strategyType, llm ? 'LLM' : 'RULE_BASED');
    assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.budget)); assert.ok(Object.isFrozen(result.toolCapabilities));
    raw.budget.executionTimeoutMs = 1; assert.equal(result.budget.executionTimeoutMs, 120000);
    if (llm) { assert.ok(Object.isFrozen(result.providerProfile.capabilities)); raw.providerProfile.model = 'changed'; assert.equal(result.providerProfile.model, 'approved-model:small'); }
  }
  for (const alter of [d => d.agentType = 'EXTERNAL', d => d.strategyType = 'LLM', d => d.strategyId = 'arbitrary.script',
    d => d.outputType = 'text', d => d.apiKey = 'secret', d => d.providerProfile = {}, d => d.schemaVersion = 2]) {
    const raw = definition(); alter(raw); assert.throws(() => createRuntimeDefinition(raw), code('INVALID_INPUT'));
  }
});

test('runtime definition enforces budgets, model profile shape and capability differences before future dispatch', () => {
  for (const alter of [d => d.budget.executionTimeoutMs = Infinity, d => d.budget.maxOutputTokens = 0,
    d => d.budget.maxResultBytes = 32769, d => d.budget.providerTimeoutMs = 120001,
    d => d.budget.maxProviderRounds = 4, d => d.providerProfile.capabilities.streaming = true,
    d => d.budget.maxProviderRounds = 1,
    d => d.providerProfile.capabilities.remoteCancellation = 'guaranteed', d => d.providerProfile.capabilities.toolCalls = false,
    d => d.providerProfile.apiKey = 'secret', d => d.providerProfile.model = 'https://user:password@host/model',
    d => d.providerProfile.model = 'sk-very-secret-key']) {
    const raw = definition(true, true); alter(raw); assert.throws(() => createRuntimeDefinition(raw), code('INVALID_INPUT'));
  }
  assert.equal(createRuntimeDefinition(definition(true)).providerProfile.capabilities.toolCalls, false);
});

test('validated execution requests reuse Task input rules, copy identities/input and cannot be forged by JSON', () => {
  const raw = rawRequest(), req = createRuntimeExecutionRequest(raw);
  assert.deepEqual(req.ids, raw.ids); assert.deepEqual(req.input, raw.input);
  raw.input.instruction = 'changed'; raw.ids.agentId = randomUUID();
  assert.equal(req.input.instruction, 'Private task marker'); assert.notEqual(req.ids.agentId, raw.ids.agentId);
  assert.ok(Object.isFrozen(req.ids)); assert.ok(Object.isFrozen(req.input));
  const f = fixture();
  assert.throws(() => f.create({ request: JSON.parse(JSON.stringify(req)) }), code('INVALID_INPUT'));
  assert.throws(() => createRuntimeExecutionRequest({ ...rawRequest(), input: { instruction: 'hello', strategyType: 'LLM' } }), code('INVALID_INPUT'));
  for (const input of [{ instruction: '' }, { instruction: 'x'.repeat(16001) }, { instruction: 'Bearer private-secret-token' },
    { instruction: 'x', context: '界'.repeat(16000) }, { instruction: 'x', provider: 'paid' }]) {
    assert.throws(() => createRuntimeExecutionRequest({ ...rawRequest(), input }), code('INVALID_INPUT'));
  }
});

test('context requires every valid identifier and rejects extra, hidden, accessor and prototype input', () => {
  for (const key of Object.keys(ids())) for (const missing of [true, false]) {
    const raw = rawRequest(); if (missing) delete raw.ids[key]; else raw.ids[key] = 'invalid';
    assert.throws(() => createRuntimeExecutionRequest(raw), code('INVALID_INPUT'));
  }
  const f = fixture();
  for (const input of [{ ...f.args, taskId: randomUUID() }, { ...f.args, apiKey: 'private' }, Object.create(f.args)]) {
    assert.throws(() => f.factory.create(input), code('INVALID_INPUT'));
  }
  const getter = { ...f.args }; Object.defineProperty(getter, 'safeAgentConfiguration', { get() { assert.fail('getter invoked'); }, enumerable: true });
  assert.throws(() => f.factory.create(getter), code('INVALID_INPUT'));
  const hidden = { ...f.args }; Object.defineProperty(hidden, 'password', { value: 'private' });
  assert.throws(() => f.factory.create(hidden), code('INVALID_INPUT'));
  const symbol = { ...f.args, [Symbol('secret')]: 'private' };
  assert.throws(() => f.factory.create(symbol), code('INVALID_INPUT'));
});

test('context factory creates execution-scoped contexts with preserved correlation and safe configuration copies', () => {
  const f = fixture(), safe = { category: 'test', color: '#ABCDEF' }, ctx = f.create({ safeAgentConfiguration: safe });
  assert.deepEqual(ctx.ids, f.request.ids); assert.equal(ctx.ids.correlationId, f.request.ids.correlationId);
  assert.deepEqual(ctx.safeAgentConfiguration, { category: 'test', color: '#abcdef' });
  safe.category = 'changed'; assert.equal(ctx.safeAgentConfiguration.category, 'test');
  assert.ok(Object.isFrozen(ctx)); assert.ok(Object.isFrozen(ctx.safeAgentConfiguration));
  assert.throws(() => { ctx.ids.agentId = randomUUID(); }, TypeError);
  assert.equal(f.logs.length, 0); // Construction is inert.
  const other = fixture(); assert.notEqual(other.create().ids.executionId, ctx.ids.executionId);
});

test('deadline validation rejects malformed, impossible, expired and excessive deadlines without allocating timers', t => {
  const f = fixture();
  for (const deadlineAt of ['not-a-date', '2026-02-30T12:00:00.000Z', '2026-01-01T00:00:00+07:00', new Date(), Infinity,
    new Date(Date.now() + 301000).toISOString()]) assert.throws(() => f.create({ deadlineAt }), code('INVALID_INPUT'));
  assert.throws(() => f.create({ deadlineAt: new Date(Date.now() - 1000).toISOString() }), code('DEADLINE_EXCEEDED'));
  const timer = t.mock.method(globalThis, 'setTimeout', () => { assert.fail('factory created a timer'); });
  try { assertRuntimeActive(f.create()); } finally { timer.mock.restore(); }
});

test('AbortSignal is propagated without controller ownership, reason leakage or automatic execution', () => {
  const f = fixture(), ctx = f.create();
  assert.equal(ctx.signal, f.controller.signal); assertRuntimeActive(ctx);
  f.controller.abort(new Error('secret abort reason'));
  assert.equal(ctx.signal.aborted, true); assert.throws(() => assertRuntimeActive(ctx), code('CANCELLED'));
  assert.doesNotThrow(() => f.create()); // Already cancelled context can be observed, not dispatched.
  for (const signal of [{ aborted: false }, undefined, new AbortController(), Object.create(AbortSignal.prototype)])
    assert.throws(() => f.create({ signal }), code('INVALID_INPUT'));
});

test('cooperative active check distinguishes deadline expiry from cancellation', t => {
  const f = fixture(), ctx = f.create();
  const clock = t.mock.method(Date, 'now', () => Date.parse(ctx.deadlineAt));
  try { assert.throws(() => assertRuntimeActive(ctx), code('DEADLINE_EXCEEDED')); }
  finally { clock.mock.restore(); }
});

test('capabilities default deny, normalize bounded duplicates, require definition grants and are immutable', () => {
  const f = fixture(true, true);
  assert.deepEqual(f.create().authorizedCapabilities, []);
  const grants = [' tool.calculator.v1 ', 'tool.calculator.v1'];
  const ctx = f.create({ authorizedCapabilities: grants });
  grants[0] = 'tool.shell'; assert.deepEqual(ctx.authorizedCapabilities, ['tool.calculator.v1']);
  assert.throws(() => ctx.authorizedCapabilities.push('tool.shell'), TypeError);
  assert.throws(() => f.create({ authorizedCapabilities: ['tool.shell'] }), code('TOOL_DENIED'));
  for (const authorizedCapabilities of [null, Array(33).fill('tool.calculator.v1'), ['shell'], [42], ['*'], ['TOOL.CALCULATOR']])
    assert.throws(() => f.create({ authorizedCapabilities }), code('INVALID_INPUT'));
  const raw = rawRequest(); raw.input.authorizedCapabilities = ['tool.shell'];
  assert.throws(() => createRuntimeExecutionRequest(raw), code('INVALID_INPUT'));
});

test('safe metadata rejects secrets, arbitrary nested configuration and invalid category/color', () => {
  const f = fixture();
  for (const safeAgentConfiguration of [null, { apiKey: 'secret' }, { provider: { token: 'secret' } }, { category: 'arbitrary' },
    { color: 'javascript:secret' }, { color: null }, { category: null }, JSON.parse('{"__proto__":{}}')])
    assert.throws(() => f.create({ safeAgentConfiguration }), code('INVALID_INPUT'));
});

test('context/request serialization, spreads, inspection and scoped logger omit raw inputs/configuration/abort reasons', () => {
  const f = fixture(), ctx = f.create({ safeAgentConfiguration: { category: 'test', color: '#abcdef' } });
  f.controller.abort('secret abort reason');
  for (const text of [JSON.stringify(ctx), JSON.stringify({ ...ctx }), inspect(ctx), JSON.stringify(f.request), JSON.stringify({ ...f.request })]) {
    for (const secret of ['Private task marker','Private context marker','secret abort reason','#abcdef']) assert.ok(!text.includes(secret));
  }
  ctx.logger.info('runtime.diagnostic', { durationMs: 12 }); ctx.logger.error('CANCELLED');
  assert.equal(f.logs[0][1].correlationId, f.request.ids.correlationId);
  assert.ok(!JSON.stringify(f.logs).includes('Private'));
  for (const metrics of [{ prompt: 'private' }, { authorization: 'Bearer secret' }, { durationMs: Infinity },
    { toolInvocationCount: 1 }, { errorCode: 'private provider error' }, { errorCode: 'constructor' }])
    assert.throws(() => ctx.logger.info('runtime.diagnostic', metrics), code('INVALID_INPUT'));
  assert.throws(() => ctx.logger.info('private prompt'), code('INVALID_INPUT'));
  assert.throws(() => ctx.logger.error('private provider body'), code('INVALID_INPUT'));
  assert.equal(f.logs.length, 2);
});

test('result construction validates execution/output identity, copies/freezes data and owns no lifecycle status', () => {
  const f = fixture(), raw = candidate(f.request), result = createRuntimeExecutionResult(raw, f.request);
  raw.output.data.wordCount = 9; assert.equal(result.output.data.wordCount, 1); assert.ok(Object.isFrozen(result.output.data));
  assert.equal(result.schemaVersion, 1); assert.ok(!Object.hasOwn(result, 'status'));
  for (const alter of [r => r.status = 'SUCCEEDED', r => r.executionId = randomUUID(), r => r.schemaVersion = 2,
    r => r.output.data.wordCount = 6, r => r.output.type = 'text', r => r.metadata = { password: 'secret' },
    r => r.provider = {}, r => r.usage = {}, r => r.toolSummary = { invocationCount: 1 }]) {
    const raw = candidate(f.request); alter(raw); assert.throws(() => createRuntimeExecutionResult(raw, f.request), code('INVALID_INPUT'));
  }
  assert.throws(() => createRuntimeExecutionResult(candidate(f.request), {}), code('INVALID_INPUT'));
});

test('LLM success metadata must match approved profile and bounded nullable usage; provider objects and secrets reject', () => {
  const f = fixture(true), raw = { ...candidate(f.request), provider: { id: 'local-small', model: 'approved-model:small', profileVersion: 1 },
    usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 }, toolSummary: { invocationCount: 0 } };
  const result = createRuntimeExecutionResult(raw, f.request); assert.ok(Object.isFrozen(result.usage));
  for (const alter of [r => r.provider.apiKey = 'secret', r => r.provider.model = 'other', r => r.provider.profileVersion = 2,
    r => r.usage.totalTokens = 5, r => r.usage.outputTokens = -1, r => r.usage.totalTokens = Infinity,
    r => r.output.text = 'api_key=secret', r => r.output.text = 'Bearer private-secret-token', r => r.output.headers = {}]) {
    const copy = structuredClone(raw); alter(copy); assert.throws(() => createRuntimeExecutionResult(copy, f.request), code('INVALID_INPUT'));
  }
  assert.deepEqual(createRuntimeExecutionResult({ ...candidate(f.request), usage: { inputTokens: null, outputTokens: null, totalTokens: null } }, f.request).usage,
    { inputTokens: null, outputTokens: null, totalTokens: null });
});

test('result size limits are enforced on full serialized UTF-8 output at the exact boundary', () => {
  const f = fixture(true), base = candidate(f.request, 'x'), overhead = Buffer.byteLength(JSON.stringify(base)) - 1;
  const exact = candidate(f.request, 'x'.repeat(32768 - overhead));
  assert.equal(Buffer.byteLength(JSON.stringify(createRuntimeExecutionResult(exact, f.request))), 32768);
  assert.throws(() => createRuntimeExecutionResult(candidate(f.request, exact.output.text + 'x'), f.request), code('OUTPUT_LIMIT_EXCEEDED'));
  assert.throws(() => createRuntimeExecutionResult(candidate(f.request, '界'.repeat(12000)), f.request), code('OUTPUT_LIMIT_EXCEEDED'));
});

test('runtime errors have stable fixed codes/messages and safe serialization without stacks or vendor diagnostics', () => {
  assert.equal(Object.keys(runtimeErrorMessages).length, 23);
  for (const [name, message] of Object.entries(runtimeErrorMessages)) {
    const error = new RuntimeError(name, 'provider');
    assert.equal(error.message, message); assert.equal(error.stage, 'provider');
    assert.deepEqual(JSON.parse(JSON.stringify(error)), { code: name, message });
    assert.ok(!JSON.stringify(error).includes('stack')); assert.ok(Object.isFrozen(error));
  }
  const unsafe = new RuntimeError('secret raw response', { apiKey: 'secret' });
  assert.equal(unsafe.code, 'INTERNAL_RUNTIME_ERROR'); assert.equal(unsafe.stage, undefined);
  assert.ok(!JSON.stringify(unsafe).includes('secret'));
});

test('runtime module resolves class/token factory without database/network/strategy startup side effects', async t => {
  let calls = 0;
  const network = t.mock.method(globalThis, 'fetch', () => { calls++; throw new Error('unexpected network'); });
  const connect = t.mock.method(require('node:net').Socket.prototype, 'connect', () => { calls++; throw new Error('unexpected socket'); });
  const pg = t.mock.method(require('pg').Pool.prototype, 'connect', () => { calls++; throw new Error('unexpected database'); });
  const strategy = t.mock.method(require('../dist/runtime/strategies/text-statistics.strategy').TextStatisticsStrategy.prototype,
    'execute', () => { calls++; throw new Error('unexpected startup execution'); });
  let app;
  try {
    class ContextTestModule {}
    Module({imports:[ConfigModule.register(validateEnvironment({})),RuntimeModule]})(ContextTestModule);
    app = await NestFactory.createApplicationContext(ContextTestModule, { logger: false, abortOnError: false });
    const factory = app.get(ExecutionContextFactory);
    assert.equal(factory, app.get(tokens.RUNTIME_CONTEXT_FACTORY)); assert.ok(app.get(ApiLogger));
    assert.equal(app.get(tokens.RUNTIME_STRATEGIES).length, 2);
    assert.equal(app.get(tokens.RUNTIME_STRATEGIES)[0].id, 'text.stats.v1');
    assert.deepEqual(app.get(tokens.LLM_PROVIDERS).map(p=>p.id), ['ollama','openai']);
    assert.equal(app.get(require('../dist/runtime/providers/provider-registry').LlmProviderRegistry).resolve('ollama').id,'ollama');
    assert.equal(app.get(tokens.AUTHORIZED_TOOL_INVOKER),app.get(require('../dist/runtime/tools/tool-execution.service').ToolExecutionService));
    assert.deepEqual(app.get(require('../dist/runtime/tools/tool-registry').ToolRegistry).listDefinitions().map(t=>t.id),['calculator','current_datetime']);
    const f = fixture(); assert.equal(factory.create(f.args).ids.executionId, f.request.ids.executionId);
    assert.equal(calls, 0);
  } finally { await app?.close(); network.mock.restore(); connect.mock.restore(); pg.mock.restore(); strategy.mock.restore(); }
});
