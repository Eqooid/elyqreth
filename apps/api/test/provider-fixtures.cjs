const {randomUUID}=require('node:crypto');
const capabilities=()=>({text:true,transportAbort:true,remoteCancellation:'unknown',structuredOutput:'none',toolCalls:false,streaming:false,tokenUsage:'optional'});
const settings=()=>({id:'local.small',profileVersion:1,providerId:'fixture.local',model:'fixture:model',capabilities:capabilities(),
 endpoint:{origin:'http://127.0.0.1:11434',network:'local',allowedAddresses:['127.0.0.1']}});
const profile=()=>{const p=settings();return {id:p.id,profileVersion:p.profileVersion,model:p.model,capabilities:p.capabilities,
 bindingDigest:require('../dist/runtime/providers/provider-configuration').providerSettingsDigest(p)};};
const environment=()=>({NODE_ENV:'test',API_HOST:'127.0.0.1',DATABASE_URL:'postgresql://test:fixture-password@127.0.0.1:5432/test',DATABASE_SSL_MODE:'disable',
 AGENT_REGISTRY_ENABLED:'true',AGENT_REGISTRY_OWNER_ID:randomUUID(),AGENT_REGISTRY_TOKEN:'a'.repeat(64),RUNTIME_ENABLED:'true',RUNTIME_BINDINGS:'[]',
 RUNTIME_LLM_ENABLED:'true',LLM_PROFILES:JSON.stringify([settings()])});
const definition=()=>({schemaVersion:1,definitionId:'fixture.llm',definitionVersion:1,agentType:'LLM',strategyType:'LLM',strategyId:'llm.text.v1',outputType:'text',
 providerProfile:profile(),toolCapabilities:[],budget:{executionTimeoutMs:120000,providerTimeoutMs:60000,toolTimeoutMs:0,maxOutputTokens:1024,maxProviderRounds:1,maxToolCalls:0,maxResultBytes:32768}});
module.exports={capabilities,settings,profile,environment,definition};
