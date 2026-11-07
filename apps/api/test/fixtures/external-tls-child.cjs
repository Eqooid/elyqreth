require('reflect-metadata');
const assert=require('node:assert/strict'),{createServer}=require('node:https'),{readFileSync}=require('node:fs');
const {ExternalHttpTransport}=require('../../dist/external-orchestrators/external-http.transport');
const {connection}=require('../../dist/external-orchestrators/external-configuration');
const {randomUUID}=require('node:crypto');
async function main(){
 const [cert,key,mode]=process.argv.slice(2),calls=[],secret='synthetic-t10-tls-credential';
 const server=createServer({cert:readFileSync(cert),key:readFileSync(key),minVersion:'TLSv1.2'},(q,r)=>{
  calls.push(q.url);r.setHeader('Content-Type','application/json');
  if(q.headers['x-api-key']!==secret){r.writeHead(401);r.end('{}');return;}
  if(q.url==='/redirect'){r.writeHead(307,{Location:'https://forbidden.invalid/private'});r.end('{}');return;}
  if(q.url==='/rate'){r.writeHead(429);r.end('{}');return;}
  r.end('{"version":"0.16.8"}');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const c=connection({id:randomUUID(),ownerId:randomUUID(),adapterType:'langgraph.v1',name:'TLS fixture',namespace:'tls-fixture',generation:1,
  mode:'OBSERVATION_ONLY',enabled:true,capabilities:['health'],credentialRef:'EXTERNAL_SECRET_TLS',
  endpoint:{origin:`https://orchestrator.test:${server.address().port}`,network:'local',allowedAddresses:['127.0.0.1']}});
 const transport=new ExternalHttpTransport(async()=>[{address:'127.0.0.1',family:4}]);
 const get=(profile,path,credential=secret)=>transport.get(profile,path,new AbortController().signal,Date.now()+5000,credential);
 try{
  if(mode==='untrusted'){
   await assert.rejects(get(c,'/info'),e=>e.code==='INVALID_CONFIGURATION');assert.equal(calls.length,0);
   console.log(JSON.stringify({status:'PASS',mode,certificateRejectedBeforeHttp:true}));return;
  }
  assert.deepEqual(await get(c,'/info'),{version:'0.16.8'});
  await assert.rejects(get({...c,endpoint:{...c.endpoint,origin:c.endpoint.origin.replace('orchestrator.test','wrong-host.test')}},'/info'),e=>e.code==='INVALID_CONFIGURATION');
  await assert.rejects(get(c,'/info','synthetic-wrong-credential'),e=>e.code==='AUTHENTICATION_FAILED');
  await assert.rejects(get(c,'/redirect'),e=>e.code==='INVALID_CONFIGURATION');
  await assert.rejects(get(c,'/rate'),e=>e.code==='RATE_LIMITED');
  assert.deepEqual(calls,['/info','/info','/redirect','/rate']); // One attempt per operation; no redirect or auth retry.
  console.log(JSON.stringify({status:'PASS',mode,verifiedTls:true,hostnameMismatchRejected:true,keyHeaderChecked:true,redirectRejected:true,rateLimitBounded:true}));
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
}
main().catch(()=>{console.error('External TLS fixture verification failed.');process.exitCode=1;});
