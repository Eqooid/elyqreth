require('reflect-metadata');
const {test}=require('node:test');const assert=require('node:assert/strict');const {randomUUID}=require('node:crypto');
const {plainToInstance}=require('class-transformer');const {validate}=require('class-validator');
const dto=require('../dist/collaboration/collaboration.dto');const policy=require('../dist/collaboration/collaboration.policy');
const {CollaborationError}=require('../dist/collaboration/collaboration.domain');const {collaborationError}=require('../dist/collaboration/collaboration-api.filter');
const check=async(Type,value)=>validate(plainToInstance(Type,value),{whitelist:true,forbidNonWhitelisted:true,forbidUnknownValues:true});
test('native delegation DTOs normalize IDs and accept only the persisted reference contract',async()=>{
 const a=randomUUID(),b=randomUUID(),root=randomUUID();
 const create={rootTaskId:root,participantAgentIds:[a.toUpperCase(),b],idempotencyKey:'logical-request-1'};
 assert.deepEqual(await check(dto.CreateCollaborationDto,create),[]);
 assert.equal(plainToInstance(dto.CreateCollaborationDto,create).participantAgentIds[0],a);
 const request={sourceAgentId:a,targetAgentId:b,parentTaskId:root,sourceExecutionId:randomUUID(),idempotencyKey:'handoff:1'};
 assert.deepEqual(await check(dto.RequestDelegationDto,request),[]);
 for(const patch of [{ownerId:a},{status:'COMPLETED'},{instructions:'do not copy this'},{result:'secret'},{idempotencyKey:'x'.repeat(129)},{sourceExecutionId:'npc-1'},{sourceExecutionId:null}])assert.ok((await check(dto.RequestDelegationDto,{...request,...patch})).length);
 assert.ok((await check(dto.CreateCollaborationDto,{...create,participantAgentIds:[a,a.toUpperCase()]})).length);
});
test('delegation pages and recovery DTOs reject unbounded, malformed and unsupported queries',async()=>{
 assert.deepEqual(await check(dto.CollaborationPageDto,{limit:'20',after:randomUUID()}),[]);
 for(const value of [{limit:'21'},{limit:'1e1'},{limit:['1','2']},{offset:'1'},{after:'not-uuid'}])assert.ok((await check(dto.CollaborationPageDto,value)).length);
 assert.deepEqual(await check(dto.CollaborationLookupDto,{idempotencyKey:'same:key'}),[]);
 assert.ok((await check(dto.CollaborationLookupDto,{ownerId:randomUUID(),idempotencyKey:'same:key'})).length);
});
test('native Agent eligibility uses existing lifecycle and route semantics',()=>{
 for(const type of ['RULE_BASED','LLM'])policy.eligibleAgent({type,lifecycleStatus:'ACTIVE'},true);
 for(const [type,status,route] of [['EXTERNAL','ACTIVE',true],['RULE_BASED','DISABLED',true],['RULE_BASED','ARCHIVED',true],['RULE_BASED','ACTIVE',false]])assert.throws(()=>policy.eligibleAgent({type,lifecycleStatus:status},route),{code:'INELIGIBLE_AGENT'});
});
test('delegation requires exact successful native parent attempt and source identity',()=>{
 const task={id:randomUUID(),agentId:randomUUID(),orchestratorId:randomUUID(),status:'COMPLETED'},source={id:task.agentId,orchestratorId:task.orchestratorId};
 const execution={id:randomUUID(),taskId:task.id,agentId:task.agentId,status:'SUCCEEDED',authority:'NATIVE'};
 policy.successfulSource(task,execution,source,execution.id);
 for(const status of ['CREATED','QUEUED','RUNNING','FAILED','CANCELLED'])assert.throws(()=>policy.successfulSource({...task,status},execution,source,execution.id),{code:'INELIGIBLE_TASK'});
 for(const patch of [{status:'FAILED'},{authority:'EXTERNAL'},{taskId:randomUUID()},{agentId:randomUUID()}])assert.throws(()=>policy.successfulSource(task,{...execution,...patch},source,execution.id),{code:'INELIGIBLE_TASK'});
 assert.throws(()=>policy.successfulSource(task,undefined,source,execution.id),{code:'INELIGIBLE_TASK'});
 assert.throws(()=>policy.successfulSource(task,execution,{...source,id:randomUUID()},execution.id),{code:'INVALID_RELATION'});
 assert.throws(()=>policy.successfulSource(task,execution,source,randomUUID()),{code:'INELIGIBLE_TASK'});
});
test('native session and participant policy never derives permission from role or history alone',()=>{
 policy.nativeSession('NATIVE');assert.throws(()=>policy.nativeSession('EXTERNAL'),{code:'NOT_FOUND'});
 for(const status of ['CREATED','ACTIVE','WAITING'])policy.openSession(status);
 for(const status of ['COMPLETED','FAILED','CANCELLED'])assert.throws(()=>policy.openSession(status),{code:'INELIGIBLE_COLLABORATION'});
 const a=randomUUID(),b=randomUUID(),members=[{agentId:a,role:'COORDINATOR',leftAt:null},{agentId:b,role:'DELEGATE',leftAt:null}];policy.activeMembers(members,a,b);
 assert.throws(()=>policy.activeMembers(members,a,a),{code:'INVALID_RELATION'});
 assert.throws(()=>policy.activeMembers([members[0]],a,b),{code:'ACCESS_DENIED'});
 assert.throws(()=>policy.activeMembers([members[0],{...members[1],leftAt:new Date()}],a,b),{code:'ACCESS_DENIED'});
 assert.throws(()=>policy.activeMembers([members[0],{...members[1],role:'ADMIN'}],a,b),{code:'ACCESS_DENIED'});
});
test('native parent context is bounded and rejects fanout, foreign ancestry and excessive depth',()=>{
 const root=randomUUID(),child=randomUUID(),next=randomUUID();policy.parentContext(root,[],root);
 const relation={parentTaskId:root,childTaskId:child,continuationTaskId:null,status:'COMPLETED'};policy.parentContext(root,[relation],child);
 assert.throws(()=>policy.parentContext(root,[relation],root),{code:'CONFLICT'});
 assert.throws(()=>policy.parentContext(root,[relation],randomUUID()),{code:'INVALID_RELATION'});
 assert.throws(()=>policy.parentContext(root,[{...relation,continuationTaskId:next}],next),{code:'LIMIT_EXCEEDED'});
 assert.throws(()=>policy.parentContext(null,[],root),{code:'INELIGIBLE_COLLABORATION'});
});
test('collaboration HTTP errors preserve safe stable categories instead of driver diagnostics',()=>{
 for(const [code,status] of [['NOT_FOUND',404],['ACCESS_DENIED',403],['IDEMPOTENCY_CONFLICT',409],['INVALID_INPUT',400],['PERSISTENCE_UNAVAILABLE',503]])assert.deepEqual(collaborationError(new CollaborationError(code)),{status,code});
 assert.deepEqual(collaborationError(Error('raw SQL provider credential stack')),{status:500,code:'INTERNAL_ERROR'});
});
