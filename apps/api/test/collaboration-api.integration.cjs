const {test}=require('node:test');const assert=require('node:assert/strict');const {randomBytes,randomUUID}=require('node:crypto');
const {createApplication}=require('../dist/application');const {validateEnvironment}=require('../dist/config/configuration');const {ApiLogger}=require('../dist/common/api-logger');
const {CollaborationRepository}=require('../dist/collaboration/collaboration.repository');

module.exports=({row,getPool,getUrl})=>{
 async function fixture(){
  const owner=await row("INSERT INTO owners(name) VALUES ('delegation-api-owner') RETURNING id");
  const route=await row("INSERT INTO orchestrators(owner_id,name,type,registration_status) VALUES ($1,'native-route','native','ENABLED') RETURNING id",[owner.id]);
  const agents=[];for(const type of ['RULE_BASED','LLM','RULE_BASED','EXTERNAL'])agents.push(await row("INSERT INTO agents(owner_id,orchestrator_id,name,type,lifecycle_status) VALUES ($1,$2,'native-participant',$3,'ACTIVE') RETURNING id",[owner.id,route.id,type]));
  const task=async(index=0,status='COMPLETED')=>row(`INSERT INTO tasks(owner_id,agent_id,orchestrator_id,input,status,completed_at) VALUES ($1,$2,$3,$4,$5,CASE WHEN $5::text IN ('COMPLETED','FAILED','CANCELLED') THEN clock_timestamp() ELSE NULL END) RETURNING id`,[owner.id,agents[index].id,route.id,{instruction:'private source instructions'},status]);
  const root=await task();
  const attempt=async(t=root,index=0,status='SUCCEEDED')=>row(`INSERT INTO executions(owner_id,task_id,agent_id,orchestrator_id,attempt_number,status,started_at,finished_at) VALUES ($1,$2,$3,$4,1,$5,CASE WHEN $5::text IN ('RUNNING','SUCCEEDED') THEN clock_timestamp() ELSE NULL END,CASE WHEN $5::text IN ('SUCCEEDED','FAILED','CANCELLED','TIMED_OUT') THEN clock_timestamp() ELSE NULL END) RETURNING id`,[owner.id,t.id,agents[index].id,route.id,status]);
  const source=await attempt(),operator=randomBytes(32).toString('hex'),reader=randomBytes(32).toString('hex'),limited=randomBytes(32).toString('hex');
  const env={NODE_ENV:'test',API_HOST:'127.0.0.1',DATABASE_URL:getUrl(),DATABASE_SSL_MODE:'disable',AGENT_REGISTRY_ENABLED:'true',AGENT_REGISTRY_OWNER_ID:owner.id,AGENT_REGISTRY_TOKEN:operator,
   CITY_READ_ENABLED:'true',CITY_READ_TOKEN:reader,CITY_INTERACTION_ENABLED:'true',CITY_INTERACTION_TOKEN:limited,CITY_INTERACTION_AGENT_IDS:JSON.stringify(agents.slice(0,2).map(a=>a.id))};
  const config=validateEnvironment(env),logs=[];let app;
  const open=async()=>{app=await createApplication(config);app.get(ApiLogger).info=(...args)=>logs.push(args);app.get(ApiLogger).error=(...args)=>logs.push(args);await app.listen(0,'127.0.0.1');};await open();
  const request=async(path='',method='GET',body,token=operator,headers={})=>{
   const response=await fetch(`${await app.getUrl()}/api/v1/collaborations${path?'/'+path:''}`,{method,headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`} :{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
   return {status:response.status,data:await response.json()};
  };
  const createInput=(patch={})=>({rootTaskId:root.id,participantAgentIds:agents.slice(0,2).map(a=>a.id),idempotencyKey:randomUUID(),...patch});
  const saved=await request('','POST',createInput());assert.equal(saved.status,201);
  const session=saved.data;
  const input=(patch={})=>({sourceAgentId:agents[0].id,targetAgentId:agents[1].id,parentTaskId:root.id,sourceExecutionId:source.id,idempotencyKey:randomUUID(),...patch});
  const send=(body=input(),id=session.id)=>request(id+'/delegations','POST',body);
  const scope={ownerId:owner.id,actorReference:'fixture-operator',correlationId:randomUUID()};
  const run=fn=>app.get(CollaborationRepository).run(scope,fn);
  return {owner,route,agents,root,source,operator,reader,limited,config,logs,request,session,createInput,input,send,task,attempt,run,
   restart:async()=>{await app.close();await open();},close:()=>app.close()};
 }
 test('P5 T03 real HTTP requests persist safe references and audit without creating Tasks or Executions',async()=>{
  const f=await fixture();try{
   const correlationId=randomUUID(),before=await row('SELECT (SELECT count(*) FROM tasks WHERE owner_id=$1)::int t,(SELECT count(*) FROM executions WHERE owner_id=$1)::int e',[f.owner.id]);
   const response=await f.request(f.session.id+'/delegations','POST',f.input(),f.operator,{'x-request-id':correlationId});assert.equal(response.status,201);
   const d=response.data;assert.equal(d.status,'REQUESTED');assert.equal(d.sessionId,f.session.id);assert.equal(d.sourceExecutionId,f.source.id);assert.equal(d.childTaskId,null);assert.equal(d.childExecutionId,null);
   assert.deepEqual((await f.request(f.session.id+'/delegations/'+d.id)).data,d);
   const members=await f.request(f.session.id+'/participants?limit=1');assert.equal(members.data.items.length,1);assert.ok(members.data.nextCursor);
   assert.deepEqual((await f.request(f.session.id)).data,f.session);
   assert.deepEqual(await row('SELECT (SELECT count(*) FROM tasks WHERE owner_id=$1)::int t,(SELECT count(*) FROM executions WHERE owner_id=$1)::int e',[f.owner.id]),before);
   const audit=await row("SELECT actor_reference,correlation_id,details,outcome FROM command_audit WHERE owner_id=$1 AND command_type='delegation.recorded'",[f.owner.id]);
   assert.equal(audit.actor_reference,'local-collaboration-operator');assert.equal(audit.correlation_id,correlationId);assert.equal(audit.details.sourceAgentId,f.agents[0].id);assert.equal(audit.details.targetAgentId,f.agents[1].id);assert.equal(audit.details.parentTaskId,f.root.id);assert.equal(audit.outcome,'ACCEPTED');
   assert.ok(!JSON.stringify([d,members.data,f.logs]).includes('private source instructions'));assert.ok(!JSON.stringify(d).includes('requestHash'));
  }finally{await f.close();}
 });
 test('P5 T03 concurrent identical requests and lost-response recovery preserve one intent across API restart',async()=>{
  const f=await fixture();try{
   const input=f.input(),responses=await Promise.all(Array.from({length:6},()=>f.send(input)));
   assert.equal(responses.filter(r=>r.status===201).length,1);assert.ok(responses.every(r=>[200,201].includes(r.status)));assert.equal(new Set(responses.map(r=>r.data.id)).size,1);
   const id=responses[0].data.id;await f.restart();const recovered=await f.request(f.session.id+'/delegations/lookup?idempotencyKey='+input.idempotencyKey);assert.equal(recovered.data.delegation.id,id);
   assert.equal((await f.send({...input,sourceAgentId:input.sourceAgentId.toUpperCase()})).data.id,id);
   const conflict=await f.send({...input,sourceExecutionId:randomUUID()});assert.equal(conflict.status,409);assert.equal(conflict.data.code,'IDEMPOTENCY_CONFLICT');
   assert.equal((await row('SELECT count(*)::int n FROM collaboration_delegations WHERE owner_id=$1',[f.owner.id])).n,1);
   assert.equal((await row("SELECT count(*)::int n FROM agent_events WHERE owner_id=$1 AND event_type='delegation.recorded'",[f.owner.id])).n,1);
   assert.equal((await row("SELECT count(*)::int n FROM command_audit WHERE owner_id=$1 AND command_type='delegation.recorded'",[f.owner.id])).n,1);
   // A disabled participant cannot admit new work; recovering an already accepted intent stays read-only.
   await getPool().query("UPDATE agents SET lifecycle_status='DISABLED' WHERE id=$1",[f.agents[1].id]);assert.equal((await f.send(input)).status,200);assert.equal((await f.send()).status,409);
  }finally{await f.close();}
 });
 test('P5 T03 collaboration creation is idempotent, recoverable and validates native membership and root ownership',async()=>{
  const f=await fixture(),other=await fixture();try{
   const input=f.createInput(),responses=await Promise.all([f.request('','POST',input),f.request('','POST',{...input,participantAgentIds:[...input.participantAgentIds].reverse()})]);
   assert.equal(new Set(responses.map(r=>r.data.id)).size,1);assert.deepEqual(responses.map(r=>r.status).sort(),[200,201]);
   assert.equal((await f.request('lookup?idempotencyKey='+input.idempotencyKey)).data.collaboration.id,responses[0].data.id);
   assert.equal((await other.request('lookup?idempotencyKey='+input.idempotencyKey)).data.collaboration,null);
   assert.equal((await f.request('','POST',{...input,rootTaskId:other.root.id})).status,404);
   assert.equal((await f.request('','POST',f.createInput({participantAgentIds:[f.agents[0].id,f.agents[3].id]}))).status,409);
   assert.equal((await f.request('','POST',f.createInput({participantAgentIds:[f.agents[1].id,f.agents[2].id]}))).status,409);
   const saved=await f.task(0,'CREATED');assert.equal((await f.request('','POST',f.createInput({rootTaskId:saved.id}))).status,201);
  }finally{await f.close();await other.close();}
 });
 test('P5 T03 operator audience, object ownership and nested delegation IDs are enforced by real guards',async()=>{
  const f=await fixture(),other=await fixture();try{
   for(const token of [null,'invalid',f.reader])assert.equal((await f.request(f.session.id,'GET',undefined,token)).status,401);
   assert.equal((await f.request(f.session.id,'GET',undefined,f.limited)).status,403);
   assert.equal((await f.request(f.session.id,'GET',undefined,f.operator,{Origin:'https://untrusted.invalid'})).status,403);
   const saved=await f.send(),foreign=await other.send();assert.equal(saved.status,201);assert.equal(foreign.status,201);
   for(const path of [other.session.id,other.session.id+'/participants',other.session.id+'/delegations',other.session.id+'/delegations/lookup?idempotencyKey=x',f.session.id+'/delegations/'+foreign.data.id,f.session.id+'/delegations/'+randomUUID()])assert.equal((await f.request(path)).status,404);
   for(const patch of [{sourceAgentId:other.agents[0].id},{targetAgentId:other.agents[1].id},{parentTaskId:other.root.id}])assert.equal((await f.send(f.input(patch))).status,404);
   assert.equal((await f.send(f.input(),other.session.id)).status,404);
   const sharedKey=randomUUID();assert.equal((await f.request('','POST',f.createInput({idempotencyKey:sharedKey}))).status,201);assert.equal((await other.request('','POST',other.createInput({idempotencyKey:sharedKey}))).status,201);
   const sessionA=(await f.request('','POST',f.createInput())).data,sessionB=(await other.request('','POST',other.createInput())).data,delegationKey=randomUUID();
   const ownA=await f.send(f.input({idempotencyKey:delegationKey}),sessionA.id),ownB=await other.send(other.input({idempotencyKey:delegationKey}),sessionB.id);
   assert.equal(ownA.status,201);assert.equal(ownB.status,201);assert.notEqual(ownA.data.id,ownB.data.id);
   assert.equal((await f.request(sessionA.id+'/delegations/lookup?idempotencyKey='+delegationKey)).data.delegation.id,ownA.data.id);
   assert.ok(!JSON.stringify(f.logs).includes(f.operator));
  }finally{await f.close();await other.close();}
 });
 test('P5 T03 strict DTOs reject forged ownership status payloads and unsupported lifecycle mutations',async()=>{
  const f=await fixture();try{
   for(const patch of [{ownerId:f.owner.id},{tenantId:randomUUID()},{status:'COMPLETED'},{childTaskId:f.root.id},{result:'secret'},{instructions:'arbitrary tool instruction'},{sourceAgentId:'not-uuid'},{sourceExecutionId:null}])assert.equal((await f.send(f.input(patch))).status,400);
   assert.equal((await f.request(f.session.id+'/delegations','POST',JSON.parse(JSON.stringify(f.input()).replace('{','{"constructor":{},')))).status,400);
   assert.equal((await f.send(f.input({sourceAgentId:f.agents[1].id,targetAgentId:f.agents[1].id}))).status,409);
   const saved=await f.send();assert.equal(saved.status,201);
   assert.equal((await f.request(f.session.id+'/delegations/'+saved.data.id,'PATCH',{status:'COMPLETED'})).status,404);
   for(const path of [f.session.id+'/delegations?limit=21',f.session.id+'/delegations?offset=1',f.session.id+'/participants?limit=1&limit=2','bad-id',f.session.id+'?ownerId='+f.owner.id])assert.equal((await f.request(path)).status,400);
  }finally{await f.close();}
 });
 test('P5 T03 Agent Task Execution membership and collaboration eligibility are revalidated',async()=>{
  const f=await fixture();try{
   assert.equal((await f.send(f.input({targetAgentId:f.agents[2].id}))).status,403);
   assert.equal((await f.send(f.input({sourceAgentId:f.agents[1].id,targetAgentId:f.agents[0].id}))).status,409);
   assert.equal((await f.send(f.input({sourceExecutionId:randomUUID()}))).status,409);
   const outside=await f.task(),outsideExecution=await f.attempt(outside);assert.equal((await f.send(f.input({parentTaskId:outside.id,sourceExecutionId:outsideExecution.id}))).status,409);
   await getPool().query("UPDATE orchestrators SET registration_status='DISABLED' WHERE id=$1",[f.route.id]);assert.equal((await f.send()).status,409);
   await getPool().query("UPDATE orchestrators SET registration_status='ENABLED' WHERE id=$1",[f.route.id]);
   await getPool().query("UPDATE agents SET lifecycle_status='ARCHIVED' WHERE id=$1",[f.agents[1].id]);assert.equal((await f.send()).status,409);
   assert.equal((await row('SELECT count(*)::int n FROM collaboration_delegations WHERE owner_id=$1',[f.owner.id])).n,0);
  }finally{await f.close();}
 });
 test('P5 T03 failed, pending and externally owned source attempts cannot create a native handoff',async()=>{
  const f=await fixture();try{
   for(const [status,attemptStatus] of [['CREATED','PENDING'],['RUNNING','RUNNING'],['FAILED','FAILED'],['CANCELLED','CANCELLED']]){
    const root=await f.task(0,status),source=await f.attempt(root,0,attemptStatus);
    const session=await f.run(r=>r.createSession({rootTaskId:root.id,participantAgentIds:f.agents.slice(0,2).map(a=>a.id),idempotencyKey:randomUUID()}));
    assert.equal((await f.send(f.input({parentTaskId:root.id,sourceExecutionId:source.id}),session.id)).status,409);
   }
   const root=await f.task(),source=await row("INSERT INTO executions(owner_id,task_id,agent_id,orchestrator_id,attempt_number,status,authority,started_at,finished_at) VALUES ($1,$2,$3,$4,1,'SUCCEEDED','EXTERNAL',clock_timestamp(),clock_timestamp()) RETURNING id",[f.owner.id,root.id,f.agents[0].id,f.route.id]);
   const session=await f.run(r=>r.createSession({rootTaskId:root.id,participantAgentIds:f.agents.slice(0,2).map(a=>a.id),idempotencyKey:randomUUID()}));assert.equal((await f.send(f.input({parentTaskId:root.id,sourceExecutionId:source.id}),session.id)).status,409);
   const external=await f.run(r=>r.createSession({authority:'EXTERNAL',participantAgentIds:[f.agents[0].id],idempotencyKey:randomUUID()}));assert.equal((await f.request(external.id)).status,404);
  }finally{await f.close();}
 });
 test('P5 T03 distinct concurrent requests cannot fan out one parent or reuse keys across sessions',async()=>{
  const f=await fixture();try{
   const responses=await Promise.all(Array.from({length:4},()=>f.send()));assert.equal(responses.filter(r=>r.status===201).length,1);assert.ok(responses.every(r=>[201,409].includes(r.status)));
   const original=responses.find(r=>r.status===201).data;
   const key=randomUUID(),create=f.createInput(),other=(await f.request('','POST',create)).data;
   // Exact key recovery is session-filtered; a conflicting session never receives another session's reference.
   const sourceSession=(await f.request('','POST',f.createInput())).data;
   const saved=await f.send(f.input({idempotencyKey:key}),sourceSession.id);assert.equal(saved.status,201);
   assert.equal((await f.request(other.id+'/delegations/lookup?idempotencyKey='+key)).data.delegation,null);
   const conflict=await f.send(f.input({idempotencyKey:key}),other.id);assert.equal(conflict.status,409);assert.equal(conflict.data.code,'IDEMPOTENCY_CONFLICT');
   assert.equal(original.childTaskId,null);
  }finally{await f.close();}
 });
 test('P5 T03 a completed related child can request the bounded next handoff without enabling deeper work',async()=>{
  const f=await fixture();try{
   const first=(await f.send()).data,child=await f.task(1),childExecution=await f.attempt(child,1);
   await f.run(async r=>{
    let d=await r.updateDelegation(first.id,first.version,{childTaskId:child.id,childExecutionId:childExecution.id,status:'ACCEPTED'});
    for(const status of ['EXECUTING','AWAITING_RETURN','COMPLETED'])d=await r.updateDelegation(d.id,d.version,{status});
   });
   const next=await f.send(f.input({sourceAgentId:f.agents[1].id,targetAgentId:f.agents[0].id,parentTaskId:child.id,sourceExecutionId:childExecution.id}));assert.equal(next.status,201);
   const third=await f.task(),thirdExecution=await f.attempt(third);
   await f.run(r=>r.updateDelegation(next.data.id,next.data.version,{childTaskId:third.id,childExecutionId:thirdExecution.id,status:'ACCEPTED'}));
   const excessive=await f.send(f.input({parentTaskId:third.id,sourceExecutionId:thirdExecution.id}));assert.equal(excessive.status,409);assert.equal(excessive.data.code,'LIMIT_EXCEEDED');
   assert.equal((await row('SELECT count(*)::int n FROM collaboration_delegations WHERE session_id=$1',[f.session.id])).n,2);
  }finally{await f.close();}
 });
 test('P5 T03 membership session and Agent changes serialize with request admission',async()=>{
  for(const kind of ['member','session','agent']){
   const f=await fixture(),client=await getPool().connect();try{
    await client.query('BEGIN');await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[f.owner.id+':collaboration']);
    if(kind==='member')await client.query('UPDATE collaboration_participants SET left_at=clock_timestamp() WHERE session_id=$1 AND agent_id=$2',[f.session.id,f.agents[1].id]);
    if(kind==='session')await client.query("UPDATE collaboration_sessions SET status='CANCELLED',finished_at=clock_timestamp() WHERE id=$1",[f.session.id]);
    if(kind==='agent')await client.query("UPDATE agents SET lifecycle_status='DISABLED' WHERE id=$1",[f.agents[1].id]);
    const pending=f.send();await client.query('COMMIT');assert.equal((await pending).status,kind==='member'?403:409);
    assert.equal((await row('SELECT count(*)::int n FROM collaboration_delegations WHERE owner_id=$1',[f.owner.id])).n,0);
   }finally{await client.query('ROLLBACK');client.release();await f.close();}
  }
 });
 test('P5 T03 database failures roll back accepted records audit and outbox with safe errors',async()=>{
  const f=await fixture();try{
   const counts=()=>row('SELECT (SELECT count(*) FROM agent_events WHERE owner_id=$1)::int e,(SELECT count(*) FROM event_outbox WHERE owner_id=$1)::int o,(SELECT count(*) FROM command_audit WHERE owner_id=$1)::int a',[f.owner.id]);const before=await counts();
   await getPool().query(`CREATE FUNCTION p5_t03_event_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.owner_id='${f.owner.id}'::uuid AND NEW.event_type='delegation.recorded' THEN RAISE EXCEPTION 'private driver stack secret' USING ERRCODE='XX000'; END IF; RETURN NEW; END $$`);
   await getPool().query('CREATE TRIGGER p5_t03_event_fault BEFORE INSERT ON agent_events FOR EACH ROW EXECUTE FUNCTION p5_t03_event_fault()');
   try{const failed=await f.send();assert.equal(failed.status,503);assert.ok(!JSON.stringify(failed.data).includes('private'));assert.deepEqual(await counts(),before);assert.equal((await row('SELECT count(*)::int n FROM collaboration_delegations WHERE owner_id=$1',[f.owner.id])).n,0);}
   finally{await getPool().query('DROP TRIGGER p5_t03_event_fault ON agent_events');await getPool().query('DROP FUNCTION p5_t03_event_fault()');}
   assert.equal((await f.send()).status,201);
  }finally{await f.close();}
 });
 test('P5 T03 history uses bounded deterministic T02 pagination and exposes no payloads',async()=>{
  const f=await fixture();try{
   await f.run(async r=>{for(let i=0;i<12;i++)await r.createDelegation({sessionId:f.session.id,sourceAgentId:f.agents[0].id,targetAgentId:f.agents[1].id,parentTaskId:f.root.id,sourceExecutionId:f.source.id,idempotencyKey:randomUUID()});});
   const first=(await f.request(f.session.id+'/delegations?limit=10')).data,last=(await f.request(f.session.id+'/delegations?limit=10&after='+first.nextCursor)).data;
   assert.equal(first.items.length,10);assert.equal(last.items.length,2);assert.equal(last.nextCursor,null);assert.equal(new Set([...first.items,...last.items].map(d=>d.id)).size,12);
   assert.ok(!JSON.stringify(first).includes('idempotencyKey'));assert.ok(!JSON.stringify(first).includes('private source instructions'));
  }finally{await f.close();}
 });
};
