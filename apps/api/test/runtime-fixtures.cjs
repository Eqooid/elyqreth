const { randomUUID } = require('node:crypto');
const definition = (timeout = 120000) => ({schemaVersion:1,definitionId:'test.definition',definitionVersion:1,
  agentType:'RULE_BASED',strategyType:'RULE_BASED',strategyId:'text.stats.v1',outputType:'text.statistics.v1',
  toolCapabilities:[],budget:{executionTimeoutMs:timeout,providerTimeoutMs:0,toolTimeoutMs:0,maxOutputTokens:0,
    maxProviderRounds:0,maxToolCalls:0,maxResultBytes:32768}});
const candidate = request => ({schemaVersion:1,executionId:request.ids.executionId,
  output:{type:'text.statistics.v1',data:{codePointCount:1,wordCount:1,nonemptyLineCount:1}}});
function deferred() { let resolve,reject; const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject}; }
const ids = () => Object.fromEntries(['ownerId','taskId','executionId','agentId','orchestratorId','correlationId'].map(k=>[k,randomUUID()]));
module.exports={definition,candidate,deferred,ids};
