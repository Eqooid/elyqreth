// Registered by the existing isolated Docker/PostgreSQL harness; never reads developer DB config.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {drizzle}=require('drizzle-orm/node-postgres');
const {CollaborationRepository}=require('../dist/collaboration/collaboration.repository');
const schema=require('../dist/database/schema');
const {Pool}=require('pg');
const {migrate}=require('drizzle-orm/node-postgres/migrator');
const {migrateDatabase,migrationFolder}=require('../dist/database/migrate');
const {validateEnvironment}=require('../dist/config/configuration');
const {mkdtempSync,mkdirSync,readFileSync,writeFileSync,copyFileSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join,resolve,dirname,basename}=require('node:path');

module.exports=({row,getPool,getUrl})=>{
 const repo=()=>new CollaborationRepository({db:drizzle(getPool(),{schema})});
 async function fixture(){
  const owner=await row("INSERT INTO owners(name) VALUES ('collaboration-scope') RETURNING id");
  const orchestrator=await row("INSERT INTO orchestrators(owner_id,name,type) VALUES ($1,'local','native') RETURNING id",[owner.id]);
  const agent=async name=>(await row("INSERT INTO agents(owner_id,orchestrator_id,name,type) VALUES ($1,$2,$3,'RULE_BASED') RETURNING id",[owner.id,orchestrator.id,name])).id;
  const a=await agent('A'),b=await agent('B');
  const task=async agentId=>(await row("INSERT INTO tasks(owner_id,agent_id,orchestrator_id,input) VALUES ($1,$2,$3,'{}') RETURNING id",[owner.id,agentId,orchestrator.id])).id;
  const parent=await task(a),child=await task(b),continuation=await task(a);
  const execution=async(taskId,agentId)=>(await row('INSERT INTO executions(owner_id,task_id,agent_id,orchestrator_id,attempt_number) VALUES ($1,$2,$3,$4,1) RETURNING id',[owner.id,taskId,agentId,orchestrator.id])).id;
  const context={ownerId:owner.id,actorReference:'local-test-operator',correlationId:randomUUID()};
  const run=fn=>repo().run(context,fn);
  const session=await run(r=>r.createSession({rootTaskId:parent,participantAgentIds:[a,b],idempotencyKey:randomUUID()}));
  const request=(patch={})=>({sessionId:session.id,sourceAgentId:a,targetAgentId:b,parentTaskId:parent,idempotencyKey:randomUUID(),...patch});
  return {owner,orchestrator,a,b,parent,child,continuation,context,run,session,request,task,execution};
 }
 test('P5 T02 persists owned sessions participants delegation and exact Task/Execution correlation with transactional facts',async()=>{
  const f=await fixture(),source=await f.execution(f.parent,f.a),childExecution=await f.execution(f.child,f.b);
  const d=await f.run(r=>r.createDelegation(f.request({sourceExecutionId:source})));
  const attached=await f.run(r=>r.updateDelegation(d.id,d.version,{childTaskId:f.child,childExecutionId:childExecution,status:'ACCEPTED'}));
  const continuationExecution=await f.execution(f.continuation,f.a);
  const linked=await f.run(r=>r.updateDelegation(d.id,attached.version,{continuationTaskId:f.continuation,continuationExecutionId:continuationExecution}));
  assert.equal(linked.sourceExecutionId,source);assert.equal(linked.childExecutionId,childExecution);assert.equal(linked.continuationTaskId,f.continuation);
  const counts=await row('SELECT (SELECT count(*) FROM agent_events WHERE owner_id=$1)::int facts,(SELECT count(*) FROM event_outbox WHERE owner_id=$1)::int outbox,(SELECT count(*) FROM command_audit WHERE owner_id=$1)::int audits',[f.owner.id]);
  assert.deepEqual(counts,{facts:6,outbox:6,audits:6});
  const fact=await row("SELECT payload,correlation_id,collaboration_id,delegation_id,agent_id FROM agent_events WHERE owner_id=$1 AND event_type='delegation.child_associated'",[f.owner.id]);
  assert.equal(fact.correlation_id,f.context.correlationId);assert.equal(fact.collaboration_id,f.session.id);assert.equal(fact.delegation_id,d.id);assert.equal(fact.agent_id,null);
  assert.equal(fact.payload.childExecutionId,childExecution);assert.equal('requestHash' in linked,false);assert.equal('idempotencyKey' in f.session,false);
  assert.equal((await row('SELECT status FROM tasks WHERE id=$1',[f.parent])).status,'CREATED');
  assert.equal((await row('SELECT status FROM executions WHERE id=$1',[source])).status,'PENDING');
 });
 test('P5 T02 concurrent idempotent creation has one identity and rejects incompatible scoped key reuse',async()=>{
  const f=await fixture(),key=randomUUID(),input=f.request({idempotencyKey:key});
  const results=await Promise.all(Array.from({length:6},()=>f.run(r=>r.createDelegation(input))));
  assert.equal(new Set(results.map(d=>d.id)).size,1);
  await assert.rejects(f.run(r=>r.createDelegation({...input,parentTaskId:f.continuation})),{code:'IDEMPOTENCY_CONFLICT'});
  assert.equal((await f.run(r=>r.findDelegationByKey(key))).id,results[0].id);
  const count=await row('SELECT count(*)::int n FROM collaboration_delegations WHERE owner_id=$1',[f.owner.id]);assert.equal(count.n,1);
  const create={rootTaskId:f.parent,participantAgentIds:[f.a,f.b],idempotencyKey:randomUUID()};
  const sessions=await Promise.all([f.run(r=>r.createSession(create)),f.run(r=>r.createSession({...create,participantAgentIds:[f.b,f.a]}))]);
  assert.equal(sessions[0].id,sessions[1].id);
  await assert.rejects(f.run(r=>r.createSession({...create,authority:'EXTERNAL'})),{code:'IDEMPOTENCY_CONFLICT'});
  const otherContext={...f.context,actorReference:'another-authorized-caller'};
  const other=await repo().run(otherContext,r=>r.createDelegation(input));assert.notEqual(other.id,results[0].id);
 });
 test('P5 T02 owner and participant Task/Execution invariants reject manipulated references',async()=>{
  const f=await fixture(),foreign=await fixture();
  await assert.rejects(f.run(r=>r.getSession(foreign.session.id)),{code:'NOT_FOUND'});
  await assert.rejects(f.run(r=>r.addParticipant(f.session.id,foreign.a)),{code:'INVALID_INPUT'});
  await assert.rejects(f.run(r=>r.createSession({rootTaskId:foreign.parent,participantAgentIds:[f.a],idempotencyKey:randomUUID()})),{code:'INVALID_INPUT'});
  await assert.rejects(f.run(r=>r.createDelegation(f.request({parentTaskId:foreign.parent}))),{code:'INVALID_INPUT'});
  await assert.rejects(f.run(r=>r.createDelegation(f.request({parentTaskId:f.child}))),{code:'INVALID_INPUT'});
  const wrongExecution=await f.execution(f.child,f.b);
  await assert.rejects(f.run(r=>r.createDelegation(f.request({sourceExecutionId:wrongExecution}))),{code:'INVALID_INPUT'});
  const d=await f.run(r=>r.createDelegation(f.request()));
  for(const patch of [{childTaskId:f.parent},{childTaskId:foreign.child},{childTaskId:f.continuation},{childExecutionId:wrongExecution}])
   await assert.rejects(f.run(r=>r.updateDelegation(d.id,d.version,patch)),{code:'INVALID_INPUT'});
  await assert.rejects(f.run(r=>r.getDelegation(randomUUID())),{code:'NOT_FOUND'});
 });
 test('P5 T02 concurrent opposite Task edges cannot form a cycle or share child identity',async()=>{
  const f=await fixture();
  const first=await f.run(r=>r.createDelegation(f.request()));
  const second=await f.run(r=>r.createDelegation(f.request({sourceAgentId:f.b,targetAgentId:f.a,parentTaskId:f.child})));
  const results=await Promise.allSettled([f.run(r=>r.updateDelegation(first.id,first.version,{childTaskId:f.child})),f.run(r=>r.updateDelegation(second.id,second.version,{childTaskId:f.parent}))]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
  const rows=(await f.run(r=>r.listDelegations(f.session.id))).items;assert.equal(rows.filter(r=>r.childTaskId).length,1);
  const winner=results[0].status==='fulfilled'?first:second,child=winner===first?f.child:f.parent;
  const duplicate=await f.run(r=>r.createDelegation(winner===first?f.request():f.request({sourceAgentId:f.b,targetAgentId:f.a,parentTaskId:f.child})));
  await assert.rejects(f.run(r=>r.updateDelegation(duplicate.id,duplicate.version,{childTaskId:child})),{code:'CONFLICT'});
 });
 test('P5 T02 optimistic versions, terminal history and write-once correlation prevent lost updates',async()=>{
  const f=await fixture(),d=await f.run(r=>r.createDelegation(f.request()));
  const results=await Promise.allSettled(['REJECTED','CANCELLED'].map(status=>f.run(r=>r.updateDelegation(d.id,d.version,{status}))));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  await assert.rejects(f.run(r=>r.updateDelegation(d.id,d.version,{status:'EXPIRED'})),{code:'CONFLICT'});
  const current=await f.run(r=>r.getDelegation(d.id));assert.ok(current.finishedAt);
  await assert.rejects(f.run(r=>r.updateDelegation(d.id,current.version,{childTaskId:f.child})),{code:'INVALID_INPUT'});
  const another=await f.run(r=>r.createDelegation(f.request()));
  const attached=await f.run(r=>r.updateDelegation(another.id,another.version,{childTaskId:f.child}));
  const replacement=await f.task(f.b);
  await assert.rejects(f.run(r=>r.updateDelegation(another.id,attached.version,{childTaskId:replacement})),{code:'INVALID_INPUT'});
  const cancelled=await f.run(r=>r.updateSession(f.session.id,f.session.version,'CANCELLED'));assert.ok(cancelled.finishedAt);
  await assert.rejects(f.run(r=>r.addParticipant(f.session.id,f.a)),{code:'INVALID_TRANSITION'});
  await assert.rejects(getPool().query("UPDATE collaboration_sessions SET status='ACTIVE',finished_at=NULL WHERE id=$1",[f.session.id]),e=>e.code==='23514');
  await assert.rejects(getPool().query('DELETE FROM collaboration_delegations WHERE id=$1',[d.id]),e=>e.code==='23514');
 });
 test('P5 T02 membership is idempotent while active and withdrawal preserves history and blocks new delegation',async()=>{
  const f=await fixture();const before=(await f.run(r=>r.listParticipants(f.session.id))).items;
  await f.run(r=>r.addParticipant(f.session.id,f.a));assert.equal((await f.run(r=>r.listParticipants(f.session.id))).items.length,2);
  const updated=await f.run(r=>r.leaveParticipant(f.session.id,f.b,f.session.version));assert.equal(updated.version,f.session.version+1);
  const after=(await f.run(r=>r.listParticipants(f.session.id))).items;assert.deepEqual(after.map(p=>p.id),before.map(p=>p.id));assert.ok(after.find(p=>p.agentId===f.b).leftAt);
  await assert.rejects(f.run(r=>r.createDelegation(f.request())),{code:'INVALID_INPUT'});
  await assert.rejects(f.run(r=>r.addParticipant(f.session.id,f.b)),{code:'CONFLICT'});
 });
 test('P5 T02 failed transactions roll back relationships events audit and outbox together',async()=>{
  const f=await fixture();const count=()=>row('SELECT (SELECT count(*) FROM collaboration_delegations WHERE owner_id=$1)::int d,(SELECT count(*) FROM agent_events WHERE owner_id=$1)::int e,(SELECT count(*) FROM command_audit WHERE owner_id=$1)::int a,(SELECT count(*) FROM event_outbox WHERE owner_id=$1)::int o',[f.owner.id]);
  const before=await count();
  await assert.rejects(f.run(async r=>{await r.createDelegation(f.request());throw Error('deliberate-rollback');}));assert.deepEqual(await count(),before);
  const key=randomUUID();await assert.rejects(f.run(r=>r.createSession({participantAgentIds:[f.a,randomUUID()],idempotencyKey:key})),{code:'INVALID_INPUT'});
  assert.equal((await row('SELECT count(*)::int n FROM collaboration_sessions WHERE owner_id=$1 AND idempotency_key=$2',[f.owner.id,key])).n,0);
  assert.deepEqual(await count(),before);
 });
 test('P5 T02 UUID pagination is bounded deterministic owner-scoped and has no repeated edges',async()=>{
  const f=await fixture(),foreign=await fixture();
  for(let i=0;i<12;i++)await f.run(r=>r.createDelegation(f.request()));
  const first=await f.run(r=>r.listDelegations(f.session.id,{limit:10})),last=await f.run(r=>r.listDelegations(f.session.id,{limit:10,after:first.nextCursor}));
  assert.equal(first.items.length,10);assert.equal(last.items.length,2);assert.equal(last.nextCursor,null);assert.equal(new Set([...first.items,...last.items].map(r=>r.id)).size,12);
  await assert.rejects(f.run(r=>r.listDelegations(f.session.id,{limit:21})),{code:'INVALID_INPUT'});
  await assert.rejects(f.run(r=>r.listParticipants(foreign.session.id)),{code:'NOT_FOUND'});
  const one=await f.run(r=>r.listParticipants(f.session.id,{limit:1}));assert.equal(one.items.length,1);assert.ok(one.nextCursor);
  const sessions=await f.run(r=>r.listSessions());assert.deepEqual(sessions.items.map(s=>s.id),[f.session.id]);
  assert.equal(await repo().run(foreign.context,r=>r.findDelegationByKey('not-a-key-present')),null);
 });
 test('P5 T02 direct SQL rejects invalid values and immutable identities independently of repository validation',async()=>{
  const f=await fixture(),d=await f.run(r=>r.createDelegation(f.request()));
  for(const q of ["UPDATE collaboration_sessions SET status='RUNNING' WHERE id=$1","UPDATE collaboration_sessions SET status='COMPLETED',finished_at=clock_timestamp() WHERE id=$1","UPDATE collaboration_sessions SET owner_id='00000000-0000-4000-8000-000000000001' WHERE id=$1"])
   await assert.rejects(getPool().query(q,[f.session.id]),e=>e.code==='23514');
  await assert.rejects(getPool().query("UPDATE collaboration_delegations SET status='ACCEPTED' WHERE id=$1",[d.id]),e=>e.code==='23514');
  await assert.rejects(getPool().query('UPDATE collaboration_delegations SET source_agent_id=target_agent_id WHERE id=$1',[d.id]),e=>e.code==='23514');
  await assert.rejects(getPool().query('DELETE FROM collaboration_participants WHERE session_id=$1',[f.session.id]),e=>e.code==='23514');
 });
 test('P5 T02 direct concurrent SQL cannot bypass cycle and execution correlation guards',async()=>{
  const f=await fixture(),first=await f.run(r=>r.createDelegation(f.request())),second=await f.run(r=>r.createDelegation(f.request({sourceAgentId:f.b,targetAgentId:f.a,parentTaskId:f.child})));
  const outcomes=await Promise.allSettled([
   getPool().query('UPDATE collaboration_delegations SET child_task_id=$1 WHERE id=$2',[f.child,first.id]),
   getPool().query('UPDATE collaboration_delegations SET child_task_id=$1 WHERE id=$2',[f.parent,second.id])]);
  assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);assert.equal(outcomes.filter(r=>r.status==='rejected').length,1);
  assert.equal((await row('SELECT count(*)::int n FROM collaboration_delegations WHERE session_id=$1 AND child_task_id IS NOT NULL',[f.session.id])).n,1);
  const wrong=await f.execution(f.continuation,f.a),third=await f.run(r=>r.createDelegation(f.request())),freshChild=await f.task(f.b);
  await assert.rejects(getPool().query('UPDATE collaboration_delegations SET child_task_id=$1,child_execution_id=$2 WHERE id=$3',[freshChild,wrong,third.id]),e=>e.code==='23514');
  const foreign=await fixture();
  await assert.rejects(getPool().query('UPDATE collaboration_delegations SET child_task_id=$1 WHERE id=$2',[foreign.child,third.id]),e=>['23503','23514'].includes(e.code));
 });
 test('P5 T02 additive migration upgrades populated Phase 4 schema and preserves native history',async()=>{
  const url=new URL(getUrl()),db='elyqreth_p5_upgrade_'+randomUUID().replaceAll('-','');
  const admin=new Pool({connectionString:getUrl(),max:1}),temp=mkdtempSync(join(tmpdir(),'elyqreth-p5-upgrade-'));let pool;
  try{
   await admin.query(`CREATE DATABASE "${db}"`);url.pathname='/'+db;pool=new Pool({connectionString:url.toString(),max:1});
   mkdirSync(join(temp,'meta'));const journal=JSON.parse(readFileSync(join(migrationFolder,'meta/_journal.json'),'utf8'));journal.entries=journal.entries.filter(e=>e.idx<5);
   writeFileSync(join(temp,'meta/_journal.json'),JSON.stringify(journal));for(const entry of journal.entries)copyFileSync(join(migrationFolder,entry.tag+'.sql'),join(temp,entry.tag+'.sql'));
   await migrate(drizzle(pool),{migrationsFolder:temp});
   const q=async(sql,values=[])=> (await pool.query(sql,values)).rows[0];
   const owner=await q("INSERT INTO owners(name) VALUES ('prior-data') RETURNING id"),orch=await q("INSERT INTO orchestrators(owner_id,name,type) VALUES ($1,'prior','native') RETURNING id",[owner.id]);
   const agent=await q("INSERT INTO agents(owner_id,orchestrator_id,name,type) VALUES ($1,$2,'prior','RULE_BASED') RETURNING id",[owner.id,orch.id]);
   const task=await q("INSERT INTO tasks(owner_id,agent_id,orchestrator_id,input) VALUES ($1,$2,$3,'{}') RETURNING *",[owner.id,agent.id,orch.id]);
   const execution=await q('INSERT INTO executions(owner_id,task_id,agent_id,orchestrator_id,attempt_number) VALUES ($1,$2,$3,$4,1) RETURNING *',[owner.id,task.id,agent.id,orch.id]);
   await migrateDatabase(validateEnvironment({NODE_ENV:'test',DATABASE_URL:url.toString(),DATABASE_SSL_MODE:'disable'}).database);
   assert.deepEqual(await q('SELECT * FROM tasks WHERE id=$1',[task.id]),task);assert.deepEqual(await q('SELECT * FROM executions WHERE id=$1',[execution.id]),execution);
   assert.equal((await q('SELECT count(*)::int n FROM drizzle.__drizzle_migrations')).n,JSON.parse(readFileSync(join(migrationFolder,'meta/_journal.json'),'utf8')).entries.length);assert.equal((await q('SELECT count(*)::int n FROM collaboration_sessions')).n,0);
  }finally{
   await pool?.end();assert.match(db,/^elyqreth_p5_upgrade_[a-f0-9]{32}$/);await admin.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);await admin.end();
   assert.equal(dirname(resolve(temp)),resolve(tmpdir()));assert.ok(basename(temp).startsWith('elyqreth-p5-upgrade-'));rmSync(temp,{recursive:true});
  }
 });
};
