const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID,randomBytes}=require('node:crypto');
const {mkdtempSync,mkdirSync,readFileSync,writeFileSync,copyFileSync,rmSync}=require('node:fs');
const {join,dirname,resolve,basename}=require('node:path');
const {tmpdir}=require('node:os');
const {Pool}=require('pg');
const {drizzle}=require('drizzle-orm/node-postgres');
const {migrate}=require('drizzle-orm/node-postgres/migrator');
const {migrateDatabase,migrationFolder}=require('../dist/database/migrate');
const {createApplication}=require('../dist/application');
const {validateEnvironment}=require('../dist/config/configuration');
const {TaskLifecycleService}=require('../dist/lifecycle/task-lifecycle.service');
const {ExecutionsService}=require('../dist/executions/executions.service');
const {DatabaseService}=require('../dist/database/database.module');
const {EventsService}=require('../dist/events/events.service');
const {ApiLogger}=require('../dist/common/api-logger');
const {assertEnvelope,eventTypes}=require('../dist/events/contracts/event-contracts');

module.exports=({row,getUrl,getPool})=>{
  const versions=state=>({taskVersion:state.task.version,executionVersion:state.execution.version});
  async function fixture(){
    const owner=await row("INSERT INTO owners(name) VALUES ('events-scope') RETURNING id");
    const orch=await row("INSERT INTO orchestrators(owner_id,name,type,registration_status) VALUES ($1,'route','native','ENABLED') RETURNING id",[owner.id]);
    const token=randomBytes(32).toString('hex'), logs=[];
    const config=validateEnvironment({NODE_ENV:'test',DATABASE_URL:getUrl(),DATABASE_SSL_MODE:'disable',
      AGENT_REGISTRY_ENABLED:'true',AGENT_REGISTRY_OWNER_ID:owner.id,AGENT_REGISTRY_TOKEN:token});
    let app;
    const open=async()=>{app=await createApplication(config);app.get(ApiLogger).info=(...v)=>logs.push(v);app.get(ApiLogger).error=(...v)=>logs.push(v);await app.listen(0,'127.0.0.1');};
    await open();
    const request=async(path,method='GET',body,headers={})=>{
      const response=await fetch(`${await app.getUrl()}/api/v1/${path}`,{method,
        headers:{authorization:`Bearer ${token}`,'content-type':'application/json',...headers},
        ...(body===undefined?{}:{body:JSON.stringify(body)})});
      return {status:response.status,data:await response.json()};
    };
    let agent=(await request('agents','POST',{name:'Audited agent',type:'RULE_BASED',orchestratorId:orch.id})).data;
    agent=(await request(`agents/${agent.id}/activate`,'POST',{}, {'if-match':`"${agent.version}"`})).data;
    const input=key=>({agentId:agent.id,input:{instruction:'Public audit fixture'},...(key?{idempotencyKey:key}:{})});
    const task=async key=>{const response=await request('tasks','POST',input(key));assert.equal(response.status,201);return response.data;};
    const queue=async()=>{const created=await task();return app.get(TaskLifecycleService).queueTask(created.id,{taskVersion:created.version,authority:'NATIVE'});};
    return {owner,orch,agent,request,task,queue,input,logs,
      life:()=>app.get(TaskLifecycleService),attempts:()=>app.get(ExecutionsService),
      append:event=>app.get(DatabaseService).db.transaction(tx=>app.get(EventsService).appendState(tx,event)),
      async restart(){await app.close();await open();},async close(){await app.close();}};
  }
  const count=async(table,ownerId)=>(await row(`SELECT count(*)::int AS count FROM ${table} WHERE owner_id=$1`,[ownerId])).count;
  async function fault(f,type,operation){
    assert.ok(eventTypes.includes(type));
    await getPool().query(`CREATE FUNCTION t07_event_fault() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.owner_id='${f.owner.id}'::uuid AND NEW.event_type='${type}' THEN RAISE EXCEPTION 'private fault' USING ERRCODE='23514'; END IF; RETURN NEW; END $$`);
    await getPool().query('CREATE TRIGGER t07_event_fault BEFORE INSERT ON agent_events FOR EACH ROW EXECUTE FUNCTION t07_event_fault()');
    try {await operation();} finally {
      await getPool().query('DROP TRIGGER t07_event_fault ON agent_events');await getPool().query('DROP FUNCTION t07_event_fault()');
    }
  }

  test('audit APIs return committed envelopes, correlation groups, ordered pagination/filtering and restart history',async()=>{
    const f=await fixture();
    try{
      const queued=await f.queue();
      const started=await f.life().startTask(queued.task.id,queued.execution.id,versions(queued));
      await f.life().completeTask(started.task.id,started.execution.id,versions(started));
      const path=`tasks/${queued.task.id}/events`, history=await f.request(path);
      assert.equal(history.status,200);
      assert.deepEqual(history.data.items.map(e=>e.eventType),['task.created','execution.created','task.queued','execution.started','task.started','execution.completed','task.completed']);
      const items=history.data.items;
      items.forEach(item=>assertEnvelope(item));
      assert.deepEqual(items.map(e=>BigInt(e.streamPosition)),items.map(e=>BigInt(e.streamPosition)).sort((a,b)=>a<b?-1:a>b?1:0));
      for(const [a,b] of [[1,2],[3,4],[5,6]]) assert.equal(items[a].correlationId,items[b].correlationId);
      assert.equal(items[1].executionId,queued.execution.id);assert.equal(items[2].executionId,queued.execution.id);
      for(const e of items.filter(e=>e.aggregateType==='execution'))assert.equal(e.payload.attemptNumber,1);
      const execution=await f.request(`executions/${queued.execution.id}/events`);
      assert.equal(execution.data.items.length,6);
      const agent=await f.request(`agents/${f.agent.id}/events`);
      assert.equal(agent.data.items.length,9); // registry registration + activation + all task/attempt facts
      assert.equal((await f.request(path+'?eventType=task.started')).data.items.length,1);
      assert.equal((await f.request(path+'?correlationId='+items[3].correlationId)).data.items.length,2);
      const collected=[];let after='0', hasMore=true;
      while(hasMore){const page=(await f.request(path+`?limit=2&after=${after}`)).data;collected.push(...page.items.map(e=>e.eventId));after=page.pagination.nextAfter;hasMore=page.pagination.hasMore;}
      assert.deepEqual(collected,items.map(e=>e.eventId));
      assert.deepEqual((await f.request(path+'?limit=2&offset=2')).data.items.map(e=>e.eventId),items.slice(2,4).map(e=>e.eventId));
      await f.restart();assert.deepEqual((await f.request(path)).data,history.data);
      assert.ok(!JSON.stringify(items).includes('Public audit fixture'));assert.ok(!JSON.stringify(f.logs).includes('Public audit fixture'));
    }finally{await f.close();}
  });

  test('registry events cover real changes and suppress identical metadata and lifecycle no-ops',async()=>{
    const f=await fixture();
    try{
      let agent=(await f.request(`agents/${f.agent.id}`,'PATCH',{description:'Public description'},{'if-match':`"${f.agent.version}"`})).data;
      const same=await f.request(`agents/${agent.id}`,'PATCH',{description:'Public description'},{'if-match':`"${agent.version}"`});
      assert.deepEqual(same.data,agent);
      agent=(await f.request(`agents/${agent.id}/disable`,'POST',{}, {'if-match':`"${agent.version}"`})).data;
      assert.equal((await f.request(`agents/${agent.id}/disable`,'POST',{}, {'if-match':'"1"'})).data.version,agent.version);
      agent=(await f.request(`agents/${agent.id}/archive`,'POST',{}, {'if-match':`"${agent.version}"`})).data;
      assert.equal((await f.request(`agents/${agent.id}/activate`,'POST',{}, {'if-match':`"${agent.version}"`})).status,409);
      const events=(await f.request(`agents/${agent.id}/events`)).data.items;
      assert.deepEqual(events.map(e=>e.eventType),['agent.registered','agent.active','agent.updated','agent.disabled','agent.archived']);
      assert.ok(events.every(e=>e.contractStatus==='VALID'));assert.ok(!JSON.stringify(events).includes('Public description'));
      const taskAgent=await row("INSERT INTO agents(owner_id,orchestrator_id,name,type,lifecycle_status) VALUES ($1,$2,'task-target','RULE_BASED','ACTIVE') RETURNING id",[f.owner.id,f.orch.id]);
      const input={agentId:taskAgent.id,input:{instruction:'Idempotent audit'},idempotencyKey:'audit-replay'};
      const first=await f.request('tasks','POST',input), replay=await f.request('tasks','POST',input);
      assert.equal(first.status,201);assert.equal(replay.status,200);
      assert.equal((await f.request(`tasks/${first.data.id}/events`)).data.items.length,1);
    }finally{await f.close();}
  });

  test('event-insert failures roll back Agent, Task, Execution and paired lifecycle writes without orphan history',async()=>{
    const f=await fixture();
    try{
      const original=await row('SELECT * FROM agents WHERE id=$1',[f.agent.id]);
      const initial=await count('agent_events',f.owner.id);
      await fault(f,'agent.updated',async()=>assert.equal((await f.request(`agents/${f.agent.id}`,'PATCH',{name:'Uncommitted'},{'if-match':`"${f.agent.version}"`})).status,400));
      assert.deepEqual(await row('SELECT * FROM agents WHERE id=$1',[f.agent.id]),original);
      await fault(f,'task.created',async()=>assert.equal((await f.request('tasks','POST',f.input('rollback-key'))).status,400));
      assert.equal(await count('tasks',f.owner.id),0);assert.equal(await count('agent_events',f.owner.id),initial);
      const task=await f.task('rollback-key');
      await fault(f,'execution.created',async()=>assert.rejects(f.attempts().createPending(task.id,'NATIVE'),e=>e.getStatus()===400));
      assert.equal(await count('executions',f.owner.id),0);
      const queued=await f.life().queueTask(task.id,{taskVersion:task.version,authority:'NATIVE'});
      const beforeTask=await row('SELECT * FROM tasks WHERE id=$1',[task.id]), beforeExec=await row('SELECT * FROM executions WHERE id=$1',[queued.execution.id]);
      const eventCount=await count('agent_events',f.owner.id),outboxCount=await count('event_outbox',f.owner.id),auditCount=await count('command_audit',f.owner.id);
      for(const type of ['execution.started','task.started']) await fault(f,type,async()=>{
        await assert.rejects(f.life().startTask(task.id,queued.execution.id,versions(queued)),e=>e.code==='INCONSISTENT_STATE');
        assert.deepEqual(await row('SELECT * FROM tasks WHERE id=$1',[task.id]),beforeTask);
        assert.deepEqual(await row('SELECT * FROM executions WHERE id=$1',[queued.execution.id]),beforeExec);
        assert.equal(await count('agent_events',f.owner.id),eventCount);assert.equal(await count('event_outbox',f.owner.id),outboxCount);assert.equal(await count('command_audit',f.owner.id),auditCount);
      });
      const started=await f.life().startTask(task.id,queued.execution.id,versions(queued));
      assert.equal(started.task.status,'RUNNING');
    }finally{await f.close();}
  });

  test('concurrent state commands produce one event per aggregate version and duplicate writes cannot bypass the DB guard',async()=>{
    const f=await fixture();
    try{
      const queued=await f.queue();
      const starts=await Promise.allSettled(Array.from({length:6},()=>f.life().startTask(queued.task.id,queued.execution.id,versions(queued))));
      assert.equal(starts.filter(r=>r.status==='fulfilled').length,1);
      const running=starts.find(r=>r.status==='fulfilled').value;
      const terminal=await Promise.allSettled([f.life().completeTask(running.task.id,running.execution.id,versions(running)),
        f.life().cancelTask(running.task.id,{...versions(running),executionId:running.execution.id})]);
      assert.equal(terminal.filter(r=>r.status==='fulfilled').length,1);
      const history=(await f.request(`tasks/${queued.task.id}/events`)).data.items;
      assert.equal(history.length,7);assert.equal(new Set(history.map(e=>e.eventId)).size,7);
      assert.equal(new Set(history.map(e=>e.aggregateType+e.aggregateId+e.aggregateVersion)).size,7);
      const latest=history.at(-1);
      await assert.rejects(f.append({ownerId:f.owner.id,eventType:latest.eventType,aggregateId:latest.aggregateId,correlationId:randomUUID(),executionId:queued.execution.id}),
        e=>e.cause?.code==='23505' || e.code==='23505');
      assert.equal((await f.request(`tasks/${queued.task.id}/events`)).data.items.length,7);
      await assert.rejects(f.append({ownerId:f.owner.id,eventType:'task.created',aggregateId:queued.task.id,correlationId:randomUUID(),payload:{token:'private'}}),e=>e.name==='EventContractError');
    }finally{await f.close();}
  });

  test('audit APIs validate bounded filters, enforce ownership/access and provide no public writes',async()=>{
    const f=await fixture(),other=await fixture();
    try{
      const q=await f.queue(),foreign=await other.queue();
      for(const [kind,id,foreignId] of [['agents',f.agent.id,other.agent.id],['tasks',q.task.id,foreign.task.id],['executions',q.execution.id,foreign.execution.id]]){
        const path=`${kind}/${id}/events`;
        assert.equal((await f.request(path,'GET',undefined,{authorization:''})).status,401);
        assert.equal((await f.request(path,'GET',undefined,{origin:'https://evil.example'})).status,403);
        assert.equal((await f.request(`${kind}/${foreignId}/events`)).status,404);
        assert.equal((await f.request(`${kind}/${randomUUID()}/events`)).status,404);
        assert.equal((await f.request(`${kind}/invalid/events`)).status,400);
        for(const method of ['POST','PATCH','DELETE'])assert.equal((await f.request(path,method,{payload:{token:'private'}})).status,404);
        for(const query of ['limit=101','limit=1&limit=2','offset=-1','eventType=agent.handoff','after=9223372036854775808','after=0&offset=2','ownerId='+other.owner.id])
          assert.equal((await f.request(path+'?'+query)).status,400);
      }
    }finally{await f.close();await other.close();}
  });

  test('history preserves legacy rows and stream ordering while safely redacting invalid or unknown contracts',async()=>{
    const f=await fixture();
    try{
      const task=await f.task();
      const insert=async(seq,type,schema,payload)=>row(`INSERT INTO agent_events(owner_id,agent_id,task_id,orchestrator_id,correlation_id,aggregate_type,aggregate_id,aggregate_version,aggregate_sequence,event_type,schema_version,payload,occurred_at)
        VALUES ($1,$2,$3,$4,$5,'task',$3,1,$6,$7,$8,$9,'2020-01-01T00:00:00Z') RETURNING *`,[f.owner.id,f.agent.id,task.id,f.orch.id,randomUUID(),seq,type,schema,payload]);
      const old=await insert(2,'task.created',1,{status:'CREATED',version:1,password:'legacy-private'});
      await insert(3,'task.created',2,{raw:'legacy-private'});
      await insert(4,'task.future',1,{raw:'legacy-private'});
      const history=(await f.request(`tasks/${task.id}/events`)).data.items;
      assert.deepEqual(history.map(e=>e.contractStatus),['VALID','INVALID','UNSUPPORTED','UNSUPPORTED']);
      assert.equal(history[1].eventId,old.id);assert.ok(new Date(history[1].occurredAt)<new Date(history[0].occurredAt));
      assert.ok(BigInt(history[1].streamPosition)>BigInt(history[0].streamPosition));
      assert.ok(!JSON.stringify(history).includes('legacy-private'));
      assert.equal(history[3].eventType,'unsupported');
      assert.deepEqual((await row('SELECT payload FROM agent_events WHERE id=$1',[old.id])).payload,old.payload);
      await assert.rejects(getPool().query('UPDATE agent_events SET payload=$1 WHERE id=$2',[{},old.id]),e=>e.code==='23514');
      await assert.rejects(getPool().query('DELETE FROM agent_events WHERE id=$1',[old.id]),e=>e.code==='23514');
    }finally{await f.close();}
  });

  test('T07 indexes upgrade populated T05 history including repeated legacy aggregate versions without rewriting rows',async()=>{
    const url=new URL(getUrl()),database=url.pathname.slice(1)+'_t07_upgrade';
    assert.match(database,/^elyqreth_test_[a-f0-9]{24}_t07_upgrade$/);
    await getPool().query(`CREATE DATABASE "${database}"`);url.pathname='/'+database;
    const pool=new Pool({connectionString:url.href,max:1}),temp=mkdtempSync(join(tmpdir(),'elyqreth-t07-upgrade-'));
    try{
      mkdirSync(join(temp,'meta'));
      const journal=JSON.parse(readFileSync(join(migrationFolder,'meta/_journal.json'),'utf8')),expectedMigrations=journal.entries.length;journal.entries=journal.entries.slice(0,3);
      writeFileSync(join(temp,'meta/_journal.json'),JSON.stringify(journal));
      for(const e of journal.entries)copyFileSync(join(migrationFolder,e.tag+'.sql'),join(temp,e.tag+'.sql'));
      await migrate(drizzle(pool),{migrationsFolder:temp});
      const owner=(await pool.query("INSERT INTO owners(name) VALUES ('legacy') RETURNING id")).rows[0];
      const orch=(await pool.query("INSERT INTO orchestrators(owner_id,name,type) VALUES ($1,'legacy','native') RETURNING id",[owner.id])).rows[0];
      const agent=(await pool.query("INSERT INTO agents(owner_id,orchestrator_id,name,type) VALUES ($1,$2,'legacy','RULE_BASED') RETURNING id",[owner.id,orch.id])).rows[0];
      for(const seq of [1,2])await pool.query(`INSERT INTO agent_events(owner_id,agent_id,orchestrator_id,correlation_id,aggregate_type,aggregate_id,aggregate_version,aggregate_sequence,event_type,payload)
        VALUES ($1,$2,$3,$4,'agent',$2,1,$5,'agent.updated',$6)`,[owner.id,agent.id,orch.id,randomUUID(),seq,{historical:'retained'}]);
      const before=(await pool.query('SELECT * FROM agent_events ORDER BY stream_position')).rows;
      await migrateDatabase(validateEnvironment({NODE_ENV:'test',DATABASE_URL:url.href,DATABASE_SSL_MODE:'disable'}).database);
      assert.deepEqual((await pool.query('SELECT * FROM agent_events ORDER BY stream_position')).rows,before.map(row=>({...row,collaboration_id:null,delegation_id:null})));
      assert.equal((await pool.query('SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations')).rows[0].count,expectedMigrations);
      assert.ok((await pool.query("SELECT to_regclass('public.agent_events_contract_version_idx') AS name")).rows[0].name);
    }finally{await pool.end();assert.equal(dirname(resolve(temp)),resolve(tmpdir()));assert.ok(basename(temp).startsWith('elyqreth-t07-upgrade-'));rmSync(temp,{recursive:true});}
  });
};
