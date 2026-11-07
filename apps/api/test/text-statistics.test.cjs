'use strict';
require('reflect-metadata');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {TextStatisticsStrategy,textStatisticsInput}=require('../dist/runtime/strategies/text-statistics.strategy');
const {ExecutionContextFactory}=require('../dist/runtime/context/execution-context.factory');
const {createRuntimeExecutionRequest}=require('../dist/runtime/contracts/execution-request.contract');
const {RuntimeError}=require('../dist/runtime/contracts/runtime-error.contract');
const {localOptions,assertLocalRuntime}=require('../dist/runtime/local-command');
const {validateEnvironment}=require('../dist/config/configuration');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const {join}=require('node:path');
const {definition,ids}=require('./runtime-fixtures.cjs');
const matches=code=>e=>e instanceof RuntimeError&&e.code===code;
const strategy=new TextStatisticsStrategy();
function fixture(instruction,context) {
 const request=createRuntimeExecutionRequest({ids:ids(),definition:definition(),input:{instruction,...(context===undefined?{}:{context})}});
 const controller=new AbortController();
 const executionContext=new ExecutionContextFactory({info(){},error(){}}).create({request,signal:controller.signal,deadlineAt:new Date(Date.now()+100000).toISOString()});
 return {request,context:executionContext,controller};
}
test('real text statistics counts exact words, raw Unicode code points and nonempty lines deterministically',async()=>{
 const samples=[['hello',5,1,1],['Welcome to Elyqreth AI City',27,5,1],['  one  two\t ',12,2,1],
  ['one\ntwo',7,2,2],['one\r\ntwo',8,2,2],['one\rtwo',7,2,2],['\n one\n \t\n two\n',14,2,2],
  ['\u{1f600} caf\u00e9 e\u0301',9,3,1],['a\u2028b\u2029c',5,3,3],['a\u00a0b',3,2,1]];
 for(const [text,codePointCount,wordCount,nonemptyLineCount] of samples){
  const f=fixture(text,'ignored context words\nand lines');
  const result=await strategy.execute(f.request,f.context);
  assert.deepEqual(result.output,{type:'text.statistics.v1',data:{codePointCount,wordCount,nonemptyLineCount}},JSON.stringify(text));
  assert.deepEqual(await strategy.execute(f.request,f.context),result);
  assert.ok(Object.isFrozen(result.output.data));assert.ok(!JSON.stringify(result).includes('ignored'));
 }
});
test('strict input parser rejects empty, missing, malformed, unknown, unsafe, hidden and oversized input',()=>{
 for(const input of [null,[],{},'text',{instruction:''},{instruction:' \r\n '},{instruction:42},{instruction:'a',text:'x'},
  {instruction:'a',context:42},{instruction:'x'.repeat(16001)},{instruction:'\u754c'.repeat(16000)},
  {instruction:'password=do-not-store'},{instruction:'a\u0000'},Object.create({instruction:'a'}),
  Object.defineProperty({},'instruction',{get(){assert.fail('getter evaluated');},enumerable:true})])
  assert.throws(()=>textStatisticsInput(input),matches('INVALID_INPUT'));
 const input={instruction:'x'.repeat(16000)},parsed=textStatisticsInput(input);
 assert.equal(parsed.instruction.length,16000);assert.ok(Object.isFrozen(parsed));assert.notEqual(parsed,input);
});
test('maximum allowed text executes with bounded output and no provider or infrastructure access',async t=>{
 const f=fixture('x'.repeat(16000));
 const network=t.mock.method(globalThis,'fetch',()=>assert.fail('network call'));
 const socket=t.mock.method(require('node:net').Socket.prototype,'connect',()=>assert.fail('socket call'));
 const pg=t.mock.method(require('pg').Pool.prototype,'connect',()=>assert.fail('database call'));
 try{const r=await strategy.execute(f.request,f.context);assert.deepEqual(r.output.data,{codePointCount:16000,wordCount:1,nonemptyLineCount:1});
  assert.ok(Buffer.byteLength(JSON.stringify(r))<300);
 }finally{network.mock.restore();socket.mock.restore();pg.mock.restore();}
});
test('strategy checks cancellation, expired deadlines and request/context association',async()=>{
 const f=fixture('hello');f.controller.abort('private reason');
 await assert.rejects(strategy.execute(f.request,f.context),matches('CANCELLED'));
 const live=fixture('hello');
 await assert.rejects(strategy.execute(live.request,{...live.context,signal:live.context.signal,deadlineAt:'2000-01-01T00:00:00Z'}),matches('DEADLINE_EXCEEDED'));
 const other=fixture('different');await assert.rejects(strategy.execute(live.request,other.context),matches('CONFIGURATION_ERROR'));
 await assert.rejects(strategy.execute({},live.context),matches('INVALID_INPUT'));
});
test('local invocation parses only explicit Task intent and fails closed without runtime authorization',()=>{
 const taskId=ids().taskId;
 assert.deepEqual(localOptions(['--task-id',taskId,'--task-version','1']),{inspect:false,taskId,taskVersion:1});
 assert.deepEqual(localOptions(['--inspect','--task-id',taskId]),{inspect:true,taskId});
 for(const args of [[],['--task-id','bad','--task-version','1'],['--task-id',taskId],
  ['--task-id',taskId,'--task-version','1e0'],['--task-id',taskId,'--task-version','0'],
  ['--inspect','--task-id',taskId,'--task-version','1'],['--inspect','--inspect','--task-id',taskId],
  ['--task-id',taskId,'--task-version','1','--agent-id',ids().agentId]])assert.throws(()=>localOptions(args),matches('INVALID_INPUT'));
 assert.throws(()=>assertLocalRuntime(validateEnvironment({})),matches('ACCESS_DENIED'));
 assert.throws(()=>assertLocalRuntime({nodeEnv:'production',host:'127.0.0.1',registry:{},runtime:{},database:{}}),matches('ACCESS_DENIED'));
});
test('actual local command process fails closed without opt-in and prints only a safe error',async()=>{
 const env={...process.env,NODE_ENV:'development',API_HOST:'127.0.0.1',RUNTIME_ENABLED:'false',AGENT_REGISTRY_ENABLED:'false',
  DATABASE_URL:'postgresql://test:local-placeholder@127.0.0.1:5432/test',DATABASE_SSL_MODE:'disable',CORS_ORIGINS:'http://localhost:5173'};
 delete env.RUNTIME_BINDINGS;
 await assert.rejects(promisify(execFile)(process.execPath,[join(__dirname,'../dist/runtime/local-command.js'),'--task-id',ids().taskId,'--task-version','1'],{env,timeout:10000}),error=>{
  assert.equal(error.code,1);assert.equal(error.stdout,'');
  const safe=JSON.parse(error.stderr);assert.equal(safe.error.code,'ACCESS_DENIED');assert.ok(!error.stderr.includes('stack'));return true;
 });
});
