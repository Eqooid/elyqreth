const { closedApplication } = require('./helpers/production-configuration.cjs');
require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { plainToInstance } = require('class-transformer');
const { validate } = require('class-validator');
const { assertEnvelope, eventDefinitions, eventTypes, EventContractError, validPayload, validPosition } = require('../dist/events/contracts/event-contracts');
const { serializeEvent } = require('../dist/events/events.service');
const { ListEventsQueryDto } = require('../dist/events/list-events-query.dto');
const { createApplication } = require('../dist/application');
const { validateEnvironment } = require('../dist/config/configuration');

function envelope(type='task.started') {
  const [kind,status]=eventDefinitions[type];
  const ids={agentId:randomUUID(),taskId:kind === 'agent' ? null : randomUUID(),executionId:kind === 'execution' ? randomUUID() : null};
  return {eventId:randomUUID(),eventType:type,schemaVersion:1,aggregateType:kind,
    aggregateId:ids[kind+'Id'],aggregateVersion:2,aggregateSequence:'2',streamPosition:'100',...ids,orchestratorId:randomUUID(),
    correlationId:randomUUID(),causationId:null,occurredAt:'2026-10-21T10:00:00.000Z',recordedAt:'2026-10-21T10:00:00.010Z',
    payload:{[kind === 'agent' ? 'lifecycleStatus' : 'status']:status === 'ANY' ? 'ACTIVE' : status,version:2,
      ...(kind === 'execution' ? {attemptNumber:1} : {})},contractStatus:'VALID'};
}
test('every supported event has a versioned typed payload and valid envelope for its actual state',()=>{
  assert.equal(eventTypes.length,17);
  for(const type of eventTypes) assert.doesNotThrow(()=>assertEnvelope(envelope(type)));
  assert.ok(!eventTypes.includes('agent.deactivated')); assert.ok(!eventTypes.includes('agent.handoff'));
  assert.ok(!eventTypes.includes('execution.succeeded')); // Existing name is execution.completed.
});
test('envelope validation rejects wrong identity/version/timestamp/status, unknown and sensitive fields',()=>{
  for(const patch of [{schemaVersion:2},{eventType:'agent.chat'},{eventId:'bad'},{correlationId:null},
    {aggregateType:'execution'},{aggregateId:randomUUID()},{streamPosition:'-1'},{aggregateSequence:'0'},
    {aggregateVersion:0},{occurredAt:'2026-10-21'},{recordedAt:'2026-10-21T10:00:00+07:00'},
    {payload:{status:'COMPLETED',version:2}},{payload:{status:'RUNNING',version:2,input:'private'}},
    {payload:{status:'RUNNING',version:1}},{payload:{status:'RUNNING',version:2,token:'private'}},
    {source:'private-environment'},{payload:{status:'RUNNING',version:2,stack:'private'}}])
    assert.throws(()=>assertEnvelope({...envelope(),...patch}),e=>e instanceof EventContractError && !e.message.includes('private'));
  const incomplete=envelope(); delete incomplete.taskId;
  assert.throws(()=>assertEnvelope(incomplete),EventContractError);
});
test('payloads allow historical optional attempt numbers while rejecting arbitrary metadata and oversized JSON',()=>{
  assert.ok(validPayload('execution.started',{status:'RUNNING',version:2}));
  assert.ok(!validPayload('execution.started',{status:'RUNNING',version:2,attemptNumber:0}));
  assert.ok(!validPayload('agent.updated',{lifecycleStatus:'ACTIVE',version:2,configuration:{token:'private'}}));
  assert.ok(!validPayload('task.created',{status:'CREATED',version:1,prompt:'x'.repeat(2000)}));
  assert.ok(!validPayload('task.created',null));
  const cyclic={status:'CREATED',version:1};cyclic.extra=cyclic;
  assert.equal(validPayload('task.created',cyclic),false);
});
test('serialization preserves stable IDs/order/UTC time and redacts unknown or invalid historical payloads',()=>{
  const wire=envelope();
  const row={id:wire.eventId,...wire,occurredAt:new Date(wire.occurredAt),createdAt:new Date(wire.recordedAt),
    aggregateSequence:2n,streamPosition:100n};
  assert.deepEqual(serializeEvent(row),wire);
  for(const patch of [{schemaVersion:2,payload:{password:'private'}},{payload:{status:'RUNNING',version:2,credentials:'private'}},
    {eventType:'external.private',payload:{raw:'private'}}]) {
    const result=serializeEvent({...row,...patch});
    assert.deepEqual(result.payload,{}); assert.notEqual(result.contractStatus,'VALID');
    assert.equal(result.eventId,wire.eventId); assert.equal(result.streamPosition,'100');
    assert.ok(!JSON.stringify(result).includes('private'));
  }
  assert.equal(serializeEvent({...row,occurredAt:Infinity}).occurredAt,null);
  assert.equal(serializeEvent({...row,occurredAt:Infinity}).contractStatus,'INVALID');
});
test('history pagination/type/correlation/cursor filters are validated and precision-safe',async()=>{
  const check=input=>validate(plainToInstance(ListEventsQueryDto,input),{whitelist:true,forbidNonWhitelisted:true,forbidUnknownValues:true});
  assert.deepEqual(await check({eventType:'task.started',limit:'20',after:'9223372036854775807',correlationId:randomUUID()}),[]);
  for(const query of [{eventType:'unknown.secret'},{correlationId:'bad'},{limit:101},{offset:10001},
    {after:'9223372036854775808'},{after:'-1'},{after:'01'},{after:['1','2']},{ownerId:randomUUID()}])
    assert.ok((await check(query)).length);
  assert.ok(validPosition('0')); assert.ok(!validPosition(9007199254740993));
});
test('audit history is disabled by default and in production, with no event-write API',async()=>{
  for(const env of [{NODE_ENV:'test'},{NODE_ENV:'production',CORS_ORIGINS:'https://example.com'}]) {
    const app=await closedApplication(env);
    try {
      await app.listen(0,'127.0.0.1');
      for(const kind of ['agents','tasks','executions']) for(const method of ['GET','POST','PATCH','DELETE'])
        assert.equal((await fetch(`${await app.getUrl()}/api/v1/${kind}/${randomUUID()}/events`,{method})).status,404);
    } finally {await app.close();}
  }
});
