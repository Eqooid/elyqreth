const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const d=require('../dist/collaboration/collaboration.domain');

test('collaboration domain validates stable identity and trusted internal context',()=>{
 const id=randomUUID();assert.equal(d.identifier(id.toUpperCase()),id);
 for(const value of ['',null,'resident-slot-001',{},'123'])assert.throws(()=>d.identifier(value),{code:'INVALID_INPUT'});
 assert.deepEqual(d.scope({ownerId:id,actorReference:'local-operator',correlationId:id}),{ownerId:id,actorReference:'local-operator',correlationId:id});
 assert.throws(()=>d.scope({ownerId:id,actorReference:'secret\ninput',correlationId:id}),{code:'INVALID_INPUT'});
});
test('session transitions preserve immutable terminal states and distinct WAITING semantics',()=>{
 for(const [from,targets] of Object.entries(d.sessionTransitions))for(const to of Object.keys(d.sessionTransitions)){
  if(targets.includes(to))assert.doesNotThrow(()=>d.transition('session',from,to));
  else assert.throws(()=>d.transition('session',from,to),{code:'INVALID_TRANSITION'});
 }
 assert.throws(()=>d.transition('session','RUNNING','COMPLETED'),{code:'INVALID_TRANSITION'});
});
test('delegation transitions do not reuse native Execution enums or reopen terminal records',()=>{
 for(const [from,targets] of Object.entries(d.delegationTransitions))for(const to of Object.keys(d.delegationTransitions)){
  if(targets.includes(to))assert.doesNotThrow(()=>d.transition('delegation',from,to));
  else assert.throws(()=>d.transition('delegation',from,to),{code:'INVALID_TRANSITION'});
 }
 assert.throws(()=>d.transition('delegation','REQUESTED','RUNNING'),{code:'INVALID_TRANSITION'});
});
test('collaboration idempotency and versions reject invalid identity and stale-shaped values',()=>{
 for(const key of ['', 'x'.repeat(129), 'key with spaces',null])assert.throws(()=>d.commandKey(key),{code:'INVALID_INPUT'});
 assert.equal(d.commandKey('caller:key-1'), 'caller:key-1');
 assert.equal(d.commandHash(['a','b',null]),d.commandHash(['a','b',null]));
 assert.notEqual(d.commandHash(['a','b',null]),d.commandHash(['b','a',null]));
 for(const value of [0,-1,1.5,'1',null,2147483648])assert.throws(()=>d.version(value),{code:'INVALID_INPUT'});
});
test('collaboration pages are bounded with deterministic UUID cursors',()=>{
 assert.deepEqual(d.page(),{limit:10});assert.deepEqual(d.page({limit:20,after:randomUUID()}).limit,20);
 for(const limit of [0,21,1.1,'10',Infinity])assert.throws(()=>d.page({limit}),{code:'INVALID_INPUT'});
 assert.throws(()=>d.page({after:'other-owner-name'}),{code:'INVALID_INPUT'});
});
