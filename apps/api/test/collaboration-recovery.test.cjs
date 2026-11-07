require('reflect-metadata');
const {test}=require('node:test');const assert=require('node:assert/strict');
const {aggregateState}=require('../dist/collaboration/collaboration-aggregation');
const {RECOVERY_LIMIT}=require('../dist/collaboration/collaboration-control');
test('aggregate never infers success from zero work or pending decisions',()=>{
 assert.equal(aggregateState([],false,false),'CREATED');assert.equal(aggregateState([],true,false),'CANCELLED');
 for(const states of [['REQUESTED'],['ACCEPTED'],['COMPLETED','REQUESTED']])assert.equal(aggregateState(states,false,false),'WAITING');
 assert.equal(aggregateState(['EXECUTING'],false,false),'ACTIVE');
});
test('mandatory failures block completion and unrelated active work is preserved',()=>{
 assert.equal(aggregateState(['FAILED'],false,false),'FAILED');assert.equal(aggregateState(['COMPLETED','FAILED'],false,false),'FAILED');
 assert.equal(aggregateState(['FAILED','EXECUTING'],false,false),'WAITING');
 assert.equal(aggregateState(['CANCELLED','EXECUTING'],true,false),'WAITING');
});
test('unknown native outcomes quarantine aggregation and confirmed completion wins late cancellation',()=>{
 for(const s of ['COMPLETED','FAILED','CANCELLED','EXECUTING'])assert.equal(aggregateState([s],true,true),'WAITING');
 assert.equal(aggregateState(['COMPLETED'],true,false),'COMPLETED');assert.equal(aggregateState(['CANCELLED'],true,false),'CANCELLED');
 assert.equal(aggregateState(['REJECTED'],false,false),'FAILED');assert.equal(RECOVERY_LIMIT,3);
});
