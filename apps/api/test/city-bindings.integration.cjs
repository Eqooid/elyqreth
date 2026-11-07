// Registered only by the existing owned-container PostgreSQL harness.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID,randomBytes}=require('node:crypto');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const {join}=require('node:path');
const {createApplication}=require('../dist/application');
const {validateEnvironment}=require('../dist/config/configuration');
const {ApiLogger}=require('../dist/common/api-logger');
const {AgentNpcBindingService}=require('../dist/city/binding.service');
const {AgentsService}=require('../dist/agents/agents.service');
const {TasksService}=require('../dist/tasks/tasks.service');

module.exports=({row,getUrl})=>{
 async function fixture(){
  const owner=await row("INSERT INTO owners(name) VALUES ('city-test') RETURNING id");
  const orchestrator=await row("INSERT INTO orchestrators(owner_id,name,type,registration_status) VALUES ($1,'city-test','native','ENABLED') RETURNING id",[owner.id]);
  const token=randomBytes(32).toString('hex');
  const config=validateEnvironment({NODE_ENV:'test',DATABASE_URL:getUrl(),DATABASE_SSL_MODE:'disable',AGENT_REGISTRY_ENABLED:'true',AGENT_REGISTRY_OWNER_ID:owner.id,AGENT_REGISTRY_TOKEN:token});
  let app;
  async function open(){app=await createApplication(config);app.get(ApiLogger).info=()=>{};app.get(ApiLogger).error=()=>{};await app.listen(0,'127.0.0.1');}
  await open();
  return {owner,orchestrator,config,token,get app(){return app;},get service(){return app.get(AgentNpcBindingService);},
   async agent(){return app.get(AgentsService).create({name:'City Agent',type:'RULE_BASED',orchestratorId:orchestrator.id});},
   async restart(){await app.close();await open();},async close(){await app.close();}};
 }
 test('P3 T02 bindings persist across Nest restart with exact microsecond revisions and safe bounded reads',async()=>{
  const f=await fixture();try{
   const a=await f.agent(),b=await f.agent();
   const first=await f.service.create({agentId:a.id,npcId:'resident-slot-001'});
   const second=await f.service.create({agentId:b.id,npcId:'resident-slot-002'});
   assert.equal(first.ownerId,undefined);assert.equal(first.manifestVersion,1);assert.equal(first.visualizationMode,'PASSIVE');
   assert.deepEqual(await f.service.byNpc('resident-slot-001'),first);assert.equal(await f.service.exists(a.id),true);
   const raw=await row(`SELECT to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS stamp FROM city_agent_bindings WHERE id=$1`,[first.id]);
   assert.equal(Buffer.from(first.revision.slice(3),'base64url').toString(),raw.stamp);
   const page=await f.service.list({limit:1});assert.equal(page.items.length,1);assert.ok(page.nextCursor);
   const next=await f.service.list({limit:1,after:page.nextCursor});assert.equal(next.items.length,1);assert.equal(next.nextCursor,null);
   assert.deepEqual(new Set([...page.items,...next.items].map(r=>r.id)),new Set([first.id,second.id]));
   await f.restart();assert.deepEqual(await f.service.byAgent(a.id),first);
   await assert.rejects(f.service.list({limit:21}),{code:'INVALID_COMMAND'});
  }finally{await f.close();}
 });
 test('P3 T02 concurrent identical requests are idempotent; Agent and NPC conflicts are database enforced',async()=>{
  const f=await fixture();try{
   const a=await f.agent(),b=await f.agent();
   const [x,y]=await Promise.all([f.service.create({agentId:a.id,npcId:'resident-slot-001'}),f.service.create({agentId:a.id,npcId:'resident-slot-001'})]);assert.equal(x.id,y.id);
   const race=await Promise.allSettled([f.service.create({agentId:a.id,npcId:'resident-slot-002'}),f.service.create({agentId:b.id,npcId:'resident-slot-001'})]);
   assert.ok(race.every(r=>r.status==='rejected'&&r.reason.code==='CONFLICT'));
   for(const [id,npc] of [[a.id,'resident-slot-003'],[b.id,'resident-slot-001']])
    await assert.rejects(row('INSERT INTO city_agent_bindings(owner_id,agent_id,npc_id) VALUES ($1,$2,$3)',[f.owner.id,id,npc]),{code:'23505'});
   const slotRace=await Promise.allSettled([f.service.create({agentId:b.id,npcId:'resident-slot-002'}),f.service.create({agentId:b.id,npcId:'resident-slot-003'})]);
   assert.equal(slotRace.filter(r=>r.status==='fulfilled').length,1);assert.equal(slotRace.filter(r=>r.status==='rejected'&&r.reason.code==='CONFLICT').length,1);
   assert.equal((await row('SELECT count(*)::int AS n FROM command_audit WHERE owner_id=$1 AND resource_type=$2',[f.owner.id,'city_binding'])).n,2);
  }finally{await f.close();}
 });
 test('P3 T02 missing or foreign resources and forged NPC/scope input are denied; no mapping HTTP routes exist',async()=>{
  const f=await fixture(),g=await fixture();try{
   const foreign=await g.agent(),bound=await g.service.create({agentId:foreign.id,npcId:'resident-slot-001'});
   for(const id of [randomUUID(),foreign.id]){
    await assert.rejects(f.service.create({agentId:id,npcId:'resident-slot-001'}),{code:'NOT_FOUND'});
    await assert.rejects(f.service.byAgent(id),{code:'NOT_FOUND'});
   }
   await assert.rejects(f.service.remove({bindingId:bound.id,revision:bound.revision}),{code:'NOT_FOUND'});
   assert.equal(await f.service.byNpc('resident-slot-001'),null);assert.deepEqual((await f.service.list()).items,[]);
   await assert.rejects(f.service.create({agentId:foreign.id,npcId:'Ada'}),{code:'INVALID_COMMAND'});
   await assert.rejects(f.service.create({agentId:foreign.id,npcId:'resident-slot-001',ownerId:g.owner.id}),{code:'INVALID_COMMAND'});
   await assert.rejects(row('INSERT INTO city_agent_bindings(owner_id,agent_id,npc_id) VALUES ($1,$2,$3)',[f.owner.id,foreign.id,'resident-slot-001']),{code:'23503'});
   for(const method of ['GET','POST','DELETE'])for(const authorization of [undefined,`Bearer ${f.token}`]){
    const r=await fetch(`${await f.app.getUrl()}/api/v1/agent-npc-bindings`,{method,headers:authorization?{authorization}:{}});assert.equal(r.status,404);
   }
  }finally{await f.close();await g.close();}
 });
 test('P3 T02 removal is idempotent, revisions fence concurrent changes and history remains intact',async()=>{
  const f=await fixture();try{
   let a=await f.agent();a=await f.app.get(AgentsService).lifecycle(a.id,'ACTIVE',a.version);
   const {task}=await f.app.get(TasksService).create({agentId:a.id,input:{instruction:'Identity history fixture'}});
   const execution=await row('INSERT INTO executions(owner_id,task_id,agent_id,orchestrator_id,attempt_number) VALUES ($1,$2,$3,$4,1) RETURNING id',[f.owner.id,task.id,a.id,f.orchestrator.id]);
   const before=await row('SELECT count(*)::int AS n FROM agent_events WHERE agent_id=$1',[a.id]);
   const binding=await f.service.create({agentId:a.id,npcId:'resident-slot-001'});
   await row('UPDATE city_agent_bindings SET visualization_mode=$2 WHERE id=$1 RETURNING id',[binding.id,'PASSIVE']);
   await assert.rejects(f.service.remove({bindingId:binding.id,revision:binding.revision}),{code:'CONFLICT'});
   const current=await f.service.byAgent(a.id),cmd={bindingId:current.id,revision:current.revision};
   const [x,y]=await Promise.all([f.service.remove(cmd),f.service.remove(cmd)]);assert.deepEqual(x,y);assert.equal(x.enabled,false);
   assert.equal(await f.service.byAgent(a.id),null);assert.equal((await f.service.list({includeDisabled:true})).items.length,1);
   assert.ok(await row('SELECT id FROM tasks WHERE id=$1',[task.id]));assert.ok(await row('SELECT id FROM executions WHERE id=$1',[execution.id]));
   assert.equal((await row('SELECT count(*)::int AS n FROM agent_events WHERE agent_id=$1',[a.id])).n,before.n);
   const replacement=await f.service.create({agentId:a.id,npcId:'resident-slot-002'});assert.notEqual(replacement.id,binding.id);
   await f.service.remove(cmd);assert.equal((await f.service.byAgent(a.id)).id,replacement.id);
   assert.equal((await row("SELECT count(*)::int AS n FROM command_audit WHERE resource_id=$1 AND command_type='city.binding.disabled'",[binding.id])).n,1);
  }finally{await f.close();}
 });
 test('P3 T02 reassignment rolls back conflicts and audit atomically; competing revisions cannot both win',async()=>{
  const f=await fixture();try{
   const a=await f.agent(),b=await f.agent(),c=await f.agent();
   const first=await f.service.create({agentId:a.id,npcId:'resident-slot-001'});await f.service.create({agentId:b.id,npcId:'resident-slot-002'});
   const command={bindingId:first.id,revision:first.revision,agentId:c.id,npcId:'resident-slot-002'};
   await assert.rejects(f.service.reassign(command),{code:'CONFLICT'});assert.deepEqual(await f.service.byAgent(a.id),first);
   await assert.rejects(f.service.reassign({...command,agentId:b.id}),{code:'CONFLICT'});
   // A missing target is discovered after disable/audit: both must roll back.
   await assert.rejects(f.service.reassign({...command,agentId:randomUUID(),npcId:'resident-slot-005'}),{code:'NOT_FOUND'});
   assert.deepEqual(await f.service.byAgent(a.id),first);
   assert.equal((await row("SELECT count(*)::int AS n FROM command_audit WHERE resource_id=$1 AND command_type='city.binding.disabled'",[first.id])).n,0);
   const outcomes=await Promise.allSettled([f.service.reassign({...command,npcId:'resident-slot-003'}),f.service.reassign({...command,npcId:'resident-slot-004'})]);
   assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);assert.equal(outcomes.filter(r=>r.status==='rejected'&&r.reason.code==='CONFLICT').length,1);
   assert.equal(await f.service.byAgent(a.id),null);assert.ok(await f.service.byAgent(c.id));
   assert.equal((await row("SELECT count(*)::int AS n FROM command_audit WHERE resource_id=$1 AND command_type='city.binding.disabled'",[first.id])).n,1);
  }finally{await f.close();}
 });
 test('P3 T02 disabled/archived Agents retain bindings; deletion/ownership changes cannot orphan them',async()=>{
  const f=await fixture();try{
   const a=await f.agent(),binding=await f.service.create({agentId:a.id,npcId:'resident-slot-001'});
   await f.app.get(AgentsService).lifecycle(a.id,'ARCHIVED',a.version);
   assert.deepEqual(await f.service.byAgent(a.id),binding);assert.deepEqual(await f.service.create({agentId:a.id,npcId:'resident-slot-001'}),binding);
   await f.service.remove({bindingId:binding.id,revision:binding.revision});
   await assert.rejects(f.service.create({agentId:a.id,npcId:'resident-slot-002'}),{code:'AGENT_UNAVAILABLE'});
   const bare=await row("INSERT INTO agents(owner_id,orchestrator_id,name,type) VALUES ($1,$2,'bare binding FK','RULE_BASED') RETURNING id",[f.owner.id,f.orchestrator.id]);
   const active=await f.service.create({agentId:bare.id,npcId:'resident-slot-003'});
   await assert.rejects(row('DELETE FROM agents WHERE id=$1 RETURNING id',[bare.id]),e=>e.code==='23503'&&e.constraint==='city_agent_bindings_agent_scope_fk');
   await assert.rejects(row('UPDATE agents SET owner_id=$2 WHERE id=$1 RETURNING id',[bare.id,randomUUID()]),{code:'23514'});
   assert.deepEqual(await f.service.byAgent(bare.id),active);
   await f.service.remove({bindingId:active.id,revision:active.revision});
   await assert.rejects(row('DELETE FROM agents WHERE id=$1 RETURNING id',[bare.id]),e=>e.code==='23503'&&e.constraint==='city_agent_bindings_agent_scope_fk');
  }finally{await f.close();}
 });
 test('P3 T02 real trusted CLI creates/reads/removes persisted mapping without runtime or provider configuration',async()=>{
  const f=await fixture();try{
   const a=await f.agent(),run=promisify(execFile),env={...process.env,NODE_ENV:'test',API_HOST:'127.0.0.1',DATABASE_URL:getUrl(),DATABASE_SSL_MODE:'disable',
    AGENT_REGISTRY_ENABLED:'true',AGENT_REGISTRY_OWNER_ID:f.owner.id,AGENT_REGISTRY_TOKEN:f.token,RUNTIME_ENABLED:'false'};
   const call=async args=>{
    const r=await run(process.execPath,['dist/city/local-command.js',...args],{cwd:join(__dirname,'..'),env,timeout:30000});assert.equal(r.stderr,'');assert.ok(!r.stdout.includes(f.token));return JSON.parse(r.stdout);
   };
   const binding=await call(['create','--agent-id',a.id,'--npc-id','resident-slot-001']);
   assert.equal((await call(['by-agent','--agent-id',a.id])).id,binding.id);
   assert.equal((await call(['remove','--binding-id',binding.id,'--revision',binding.revision])).enabled,false);
   assert.equal((await row('SELECT count(*)::int AS n FROM executions WHERE agent_id=$1',[a.id])).n,0);
  }finally{await f.close();}
 });
};
