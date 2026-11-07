const {test}=require('node:test');const assert=require('node:assert/strict');const {randomUUID}=require('node:crypto');
const {of,firstValueFrom}=require('rxjs');
const {validateEnvironment}=require('../dist/config/configuration');
const {requestContext}=require('../dist/common/request-context');
const {establishInteraction,interactionPrincipal}=require('../dist/interaction/interaction.context');
const {InteractionGuard}=require('../dist/interaction/interaction.guard');
const {InteractionInterceptor}=require('../dist/interaction/interaction.interceptor');
const {historyCursor,historyQuery}=require('../dist/interaction/interaction.contract');
const {authorizeInteractionMutation}=require('../dist/interaction/interaction.authorization');
const {environment}=require('./provider-fixtures.cjs');
const agentId=randomUUID(),otherId=randomUUID(),base={...environment(),CITY_READ_ENABLED:'true',CITY_READ_TOKEN:'c'.repeat(40),
 CITY_INTERACTION_ENABLED:'true',CITY_INTERACTION_TOKEN:'i'.repeat(40),CITY_INTERACTION_AGENT_IDS:JSON.stringify([agentId])};
const scope=operation=>({ownerId:base.AGENT_REGISTRY_OWNER_ID,agentId,operation});
test('P4 T02 interaction configuration is optional, frozen, bounded and separated from all other audiences',()=>{
 assert.equal(validateEnvironment({...base,CITY_INTERACTION_ENABLED:'false'}).interaction,undefined);
 assert.ok(Object.isFrozen(validateEnvironment(base).interaction.agentIds));
 for(const patch of [{NODE_ENV:'production'},{API_HOST:'0.0.0.0'},{CITY_INTERACTION_TOKEN:base.AGENT_REGISTRY_TOKEN},
  {CITY_INTERACTION_TOKEN:base.CITY_READ_TOKEN},{CITY_INTERACTION_AGENT_IDS:'[]'},{CITY_INTERACTION_AGENT_IDS:JSON.stringify([agentId,agentId.toUpperCase()])},
  {CITY_INTERACTION_AGENT_IDS:JSON.stringify(Array.from({length:21},()=>randomUUID()))},{CITY_INTERACTION_TEXT_AGENT_IDS:JSON.stringify([otherId])}])assert.throws(()=>validateEnvironment({...base,...patch}));
 assert.equal(validateEnvironment({...base,CITY_INTERACTION_TEXT_AGENT_IDS:JSON.stringify([agentId])}).interaction.textAgentIds[0],agentId);
});
test('P4 T02 history cursors retain microseconds, are scope bound and reject malformed or unsupported query data',()=>{
 const stamp='2026-10-25T01:02:03.123456Z',id=randomUUID(),cursor=historyCursor(agentId,stamp,id);
 assert.deepEqual(historyQuery({limit:'20',before:cursor},agentId),{limit:20,boundary:{stamp,id}});
 for(const q of [{limit:'0'},{limit:'21'},{offset:'0'},{before:cursor+'='},{before:historyCursor(otherId,stamp,id)},
  {before:historyCursor(agentId,'2026-02-31T01:02:03.123456Z',id)},{before:historyCursor(agentId,'0000-01-01T01:02:03.123456Z',id)}])assert.throws(()=>historyQuery(q,agentId),{status:400});
});
test('P4 T02 principals are immutable and isolated per asynchronous request, never serialized as log context',async()=>{
 await Promise.all(Array.from({length:20},(_,i)=>requestContext.run(Object.freeze({requestId:String(i)}),async()=>{
  establishInteraction({...scope('read'),agentId:String(i)});await Promise.resolve();assert.equal(interactionPrincipal().agentId,String(i));
  assert.ok(Object.isFrozen(interactionPrincipal()));assert.deepEqual(Object.keys(requestContext.getStore()),['requestId']);
 })));
 assert.equal(interactionPrincipal(),undefined);assert.throws(()=>establishInteraction(scope('read')));
});
test('P4 T02 exact route delegation cannot reach administrative, audit, activity or unscoped listing routes',async()=>{
 const config={value:validateEnvironment(base)},guard=new InteractionGuard(config,{agent:async()=>({id:agentId,type:'RULE_BASED'}),task:async()=>({id:randomUUID(),agentId})},{info:()=>{}});
 for(const [method,path] of [['POST','/api/v1/agents'],['GET','/api/v1/agents'],['GET',`/api/v1/agents/${agentId}/events`],['GET','/api/v1/tasks'],['GET','/api/v1/cities/elyqreth/agents'],['DELETE',`/api/v1/tasks/${agentId}`]]){
  await requestContext.run(Object.freeze({requestId:randomUUID()}),async()=>{
   const req={method,path,headers:{authorization:`Bearer ${base.CITY_INTERACTION_TOKEN}`,host:'127.0.0.1'},socket:{remoteAddress:'127.0.0.1'}};
   await assert.rejects(guard.canActivate({switchToHttp:()=>({getRequest:()=>req})}),{status:403});
  });
 }
});
test('P4 T02 transaction authorization locks the existing binding protocol and rejects missing or mismatched grants',async()=>{
 let locks=0;const tx={execute:async()=>{locks++;},select:()=>({from:()=>({where:()=>({for:async()=>[]})})})};
 await authorizeInteractionMutation(tx,validateEnvironment(base),agentId,'create');assert.equal(locks,0);
 await requestContext.run(Object.freeze({requestId:'transaction'}),async()=>{
  establishInteraction(scope('create'));await assert.rejects(authorizeInteractionMutation(tx,validateEnvironment(base),agentId,'create'),{status:403});assert.equal(locks,1);
  await assert.rejects(authorizeInteractionMutation(tx,validateEnvironment(base),otherId,'create'),{status:403});
 });
});
test('P4 T02 text disclosure is equally restricted on execute and result reads, with provider profiles always omitted',async()=>{
 for(const operation of ['execute','read'])for(const allow of [false,true])await requestContext.run(Object.freeze({requestId:randomUUID()}),async()=>{
  establishInteraction(scope(operation));const config=validateEnvironment({...base,...(allow?{CITY_INTERACTION_TEXT_AGENT_IDS:JSON.stringify([agentId])}:{})});
  const interceptor=new InteractionInterceptor({}, {value:config}),path=operation==='execute'?`/api/v1/tasks/${otherId}/execute`:`/api/v1/tasks/${otherId}/executions/${agentId}/result`;
  const result={schemaVersion:1,executionId:agentId,output:{type:'text',text:'Private provider text'},provider:{id:'hidden-profile'},usage:{totalTokens:3}};
  const response=await firstValueFrom(interceptor.intercept({switchToHttp:()=>({getRequest:()=>({path})})},{handle:()=>of({availability:'AVAILABLE',result})}));
  assert.equal(response.result?.output.text,allow?'Private provider text':undefined);assert.ok(!JSON.stringify(response).includes('hidden-profile'));
  if(!allow)assert.equal(response.displayReason,'DISCLOSURE_RESTRICTED');
 });
});
