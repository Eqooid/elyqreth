const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {BindingError,NPC_IDS,createCommand,removeCommand,listQuery,encodeRevision,revision}=require('../dist/city/binding.contract');
const {AgentNpcBindingService,assertLocalBindings}=require('../dist/city/binding.service');
const {AgentNpcBindingRepository}=require('../dist/city/binding.repository');
const {bindingOptions}=require('../dist/city/local-command');
const stamp='2026-10-24T00:00:00.123456Z',rev=encodeRevision(stamp),agentId=randomUUID();
const config={value:{nodeEnv:'test',host:'127.0.0.1',database:{},registry:{ownerId:randomUUID()}}};
function fixture(){
 let rows=[],status='DISABLED',calls=0;
 const tx={async agent(id){if(id!==agentId)throw new BindingError('NOT_FOUND');return {id,status};},
   async find(key,v,active=false){return rows.find(r=>r[key]===v&&(!active||r.enabled))??null;},
   async insert(id,npcId){const r={id:randomUUID(),agentId:id,npcId,enabled:true,revision:rev,visualizationMode:'PASSIVE'};rows.push(r);return r;},
   async disable(id){rows=rows.map(r=>r.id===id?{...r,enabled:false,revision:encodeRevision('2026-10-24T00:00:00.123457Z')}:r);return rows.find(r=>r.id===id);},
   async list(limit){return {items:rows.filter(r=>r.enabled).slice(0,limit),nextCursor:null};}};
 const repo={async run(owner,write,fn){calls++;assert.equal(owner,config.value.registry.ownerId);return fn(tx);}};
 return {service:new AgentNpcBindingService(config,repo),repo,tx,get calls(){return calls;},setStatus:s=>status=s};
}
test('city contracts validate strict identifiers, bounded pages and precision-safe revision without credentials',()=>{
 assert.equal(NPC_IDS.length,20);assert.ok(Object.isFrozen(NPC_IDS));
 assert.deepEqual(createCommand({agentId,npcId:NPC_IDS[0]}),{agentId,npcId:NPC_IDS[0]});
 assert.equal(Buffer.from(revision(rev).slice(3),'base64url').toString(),stamp);
 for(const v of [null,[],{agentId,npcId:'Ada'},{agentId,npcId:'1'},{agentId:'bad',npcId:NPC_IDS[0]},
   {agentId,npcId:NPC_IDS[0],ownerId:randomUUID()},{agentId,npcId:NPC_IDS[0],provider:'openai'}])assert.throws(()=>createCommand(v),BindingError);
 for(const v of [{limit:0},{limit:21},{limit:'1'},{after:'bad'},{includeDisabled:'true'},{ownerId:agentId}])assert.throws(()=>listQuery(v),BindingError);
 assert.throws(()=>removeCommand({bindingId:agentId,revision:stamp}),BindingError);
});
test('city service creates, retrieves, checks existence and lists an identical request without a second insert',async()=>{
 const f=fixture(),a=await f.service.create({agentId,npcId:NPC_IDS[0]});
 assert.deepEqual(await f.service.create({agentId,npcId:NPC_IDS[0]}),a);
 assert.deepEqual(await f.service.byAgent(agentId),a);assert.deepEqual(await f.service.byNpc(NPC_IDS[0]),a);
 assert.equal(await f.service.exists(agentId),true);assert.equal((await f.service.list()).items.length,1);
});
test('city service rejects missing Agent, conflicting Agent/NPC and new archived binding',async()=>{
 const f=fixture();await assert.rejects(f.service.create({agentId:randomUUID(),npcId:NPC_IDS[0]}),{code:'NOT_FOUND'});
 await f.service.create({agentId,npcId:NPC_IDS[0]});
 await assert.rejects(f.service.create({agentId,npcId:NPC_IDS[1]}),{code:'CONFLICT'});
 const g=fixture();g.tx.find=async key=>key==='npcId'?{id:randomUUID()}:null;
 await assert.rejects(g.service.create({agentId,npcId:NPC_IDS[0]}),{code:'CONFLICT'});
 const h=fixture();h.setStatus('ARCHIVED');await assert.rejects(h.service.create({agentId,npcId:NPC_IDS[0]}),{code:'AGENT_UNAVAILABLE'});
});
test('city service removal is revision-checked, idempotent and cannot remove another binding',async()=>{
 const f=fixture(),a=await f.service.create({agentId,npcId:NPC_IDS[0]});
 await assert.rejects(f.service.remove({bindingId:a.id,revision:encodeRevision('2026-10-24T00:00:00.123455Z')}),{code:'CONFLICT'});
 const removed=await f.service.remove({bindingId:a.id,revision:a.revision});assert.equal(removed.enabled,false);
 assert.deepEqual(await f.service.remove({bindingId:a.id,revision:a.revision}),removed);
 assert.equal(await f.service.byAgent(agentId),null);
 await assert.rejects(f.service.remove({bindingId:randomUUID(),revision:a.revision}),{code:'NOT_FOUND'});
});
test('city service fails closed before repository access for every operation',async()=>{
 for(const patch of [{nodeEnv:'production'},{host:'0.0.0.0'},{registry:undefined},{database:undefined}]){
  let calls=0;const c={value:{...config.value,...patch}},s=new AgentNpcBindingService(c,{run(){calls++;throw Error('must not reach');}});
  assert.throws(()=>assertLocalBindings(c.value),{code:'ACCESS_DENIED'});
  for(const op of [()=>s.create({}),()=>s.remove({}),()=>s.reassign({}),()=>s.byAgent(agentId),()=>s.byNpc(NPC_IDS[0]),()=>s.list(),()=>s.exists(agentId)])
   await assert.rejects(op(),{code:'ACCESS_DENIED'});
  assert.equal(calls,0);
 }
});
test('city repository normalizes wrapped database failures and serializes only safe stable errors',async()=>{
 for(const [error,code] of [[{cause:{code:'23505',message:'secret query'}},'CONFLICT'],[Error('password/private query'),'PERSISTENCE_UNAVAILABLE']]){
  const r=new AgentNpcBindingRepository({db:{transaction:async()=>{throw error;}}});
  await assert.rejects(r.run(agentId,true,()=>{}),e=>{assert.equal(e.code,code);assert.ok(!JSON.stringify(e.toJSON()).includes('secret'));assert.ok(!JSON.stringify(e.toJSON()).includes('password'));return true;});
 }
});
test('city CLI accepts only exact internal commands, never credentials, scope or arbitrary identities',()=>{
 assert.equal(bindingOptions(['create','--agent-id',agentId,'--npc-id',NPC_IDS[0]]).action,'create');
 assert.equal(bindingOptions(['list','--limit','2','--include-disabled','true']).value.limit,2);
 assert.equal(bindingOptions(['remove','--binding-id',agentId,'--revision',rev]).action,'remove');
 for(const args of [[],['create','--owner-id',agentId],['list','--limit','21'],['list','--limit','1','--limit','2'],['by-agent','--npc-id',agentId],['create','--agent-id',agentId,'--npc-id','Ada']])
  assert.throws(()=>bindingOptions(args),BindingError);
});
test('compiled backend catalog equals the actual frontend manifest',async()=>{
 const frontend=await import('../../../dist/js/npc-identity.js');
 assert.deepEqual(NPC_IDS,frontend.NPC_IDS);assert.equal(frontend.NPC_MANIFEST_VERSION,1);
});
