require('reflect-metadata');
const {test}=require('node:test');const assert=require('node:assert/strict');const {randomUUID}=require('node:crypto');
const {plainToInstance}=require('class-transformer');const {validate}=require('class-validator');
const {ActivateDelegationDto}=require('../dist/collaboration/collaboration.dto');
const {activationTaskKey,childOutcome}=require('../dist/collaboration/native-coordination.service');
const {executionCommand}=require('../dist/runtime/runtime-command');
test('native activation validates explicit text with existing Task validation and rejects forged lifecycle data',async()=>{
 const check=v=>validate(plainToInstance(ActivateDelegationDto,v),{whitelist:true,forbidNonWhitelisted:true});
 assert.deepEqual(await check({instruction:'Count these words',idempotencyKey:'activation:one'}),[]);
 for(const patch of [{instruction:''},{instruction:'x'.repeat(16001)},{instruction:'bad\u0000input'},{idempotencyKey:''},{childTaskId:randomUUID()},{status:'COMPLETED'},{provider:'remote'}])assert.ok((await check({instruction:'Count these words',idempotencyKey:'one',...patch})).length);
});
test('native activation key is durable bounded and scoped to owner delegation and logical request',()=>{
 const owner=randomUUID(),d=randomUUID(),key=activationTaskKey(owner,d,'one');assert.ok(key.length<=128);
 assert.equal(key,activationTaskKey(owner.toUpperCase(),d.toUpperCase(),'one'));
 assert.notEqual(key,activationTaskKey(owner,d,'two'));assert.notEqual(key,activationTaskKey(randomUUID(),d,'one'));
 assert.notEqual(key,activationTaskKey(owner,randomUUID(),'one'));
});
test('delegation child outcomes require authoritative paired states and a validated persisted result',()=>{
 assert.equal(childOutcome('SUCCEEDED','COMPLETED',true),'COMPLETED');assert.equal(childOutcome('SUCCEEDED','COMPLETED',false),null);
 assert.equal(childOutcome('FAILED','FAILED',false),'FAILED');assert.equal(childOutcome('TIMED_OUT','FAILED',false),'FAILED');
 assert.equal(childOutcome('CANCELLED','CANCELLED',false),'CANCELLED');
 for(const [e,t] of [['RUNNING','RUNNING'],['SUCCEEDED','RUNNING'],['FAILED','COMPLETED'],['CANCELLED','RUNNING'],['UNKNOWN','FAILED']])assert.equal(childOutcome(e,t,true),null);
});
test('internal native dispatch accepts only a stable delegation reference and rejects invented command fields',()=>{
 const command={taskId:randomUUID(),taskVersion:1,correlationId:randomUUID(),delegationId:randomUUID()};assert.deepEqual(executionCommand(command),command);
 assert.throws(()=>executionCommand({...command,delegationId:'resident-slot-001'}));assert.throws(()=>executionCommand({...command,childExecutionId:randomUUID()}));
});
