import {id,stamp} from './runtime-fixtures.js';
export {id,stamp};
export const grant=Object.freeze({canCreateTask:true,canRequestStart:true,canRequestCancel:false,reason:null});
export const agent=(patch={})=>({id:id(1),name:'Interaction Agent',description:null,type:'RULE_BASED',orchestratorId:id(9),lifecycleStatus:'ACTIVE',capabilities:[],version:1,createdAt:stamp,updatedAt:stamp,actionEligibility:grant,...patch});
export const task=(patch={})=>({id:id(2),agentId:id(1),orchestratorId:id(9),status:'CREATED',version:1,createdAt:stamp,updatedAt:stamp,completedAt:null,...patch});
export const taskDetail=(patch={})=>({...task(),actionEligibility:grant,...patch});
export const execution=(patch={})=>({id:id(3),taskId:id(2),agentId:id(1),orchestratorId:id(9),status:'SUCCEEDED',attemptNumber:1,version:3,
 createdAt:stamp,updatedAt:stamp,startedAt:stamp,finishedAt:stamp,durationMs:0,errorCode:null,errorMessage:null,resultAvailability:'AVAILABLE',strategyId:'text.stats.v1',correlationId:id(4),...patch});
export const result=(patch={})=>({schemaVersion:1,executionId:id(3),output:{type:'text.statistics.v1',data:{codePointCount:4,wordCount:1,nonemptyLineCount:1}},...patch});
export const started=(patch={})=>({kind:'finished',task:task({status:'COMPLETED',version:4,completedAt:stamp}),execution:execution(),correlationId:id(4),result:result(),...patch});
export const intent=()=>({agentId:id(1),input:{instruction:'Four'},idempotencyKey:'city.fixed-test-intent'});
export const ref=()=>({agentId:id(1),taskId:id(2)});
export const execRef=()=>({...ref(),executionId:id(3)});
