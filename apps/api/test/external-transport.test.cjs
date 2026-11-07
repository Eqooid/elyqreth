require('reflect-metadata');
const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter,getEventListeners}=require('node:events');
const {createServer}=require('node:http');
const {fixture}=require('./external-adapter-fixtures.cjs');
const {ExternalHttpTransport}=require('../dist/external-orchestrators/external-http.transport');
const {connection}=require('../dist/external-orchestrators/external-configuration');
const match=code=>e=>e.code===code;
const dns=async()=>[{address:'8.8.8.8',family:4}];
function native(t,body='{"ok":true}',status=200,headers={},remote='8.8.8.8') {
 const calls=[];let destroyed=0;
 t.mock.method(require('node:https'),'request',(options,callback)=>{
  calls.push(options);const req=new EventEmitter();req.destroy=()=>{destroyed++;};req.end=()=>process.nextTick(()=>{
   const socket=new EventEmitter();socket.remoteAddress=remote;req.emit('socket',socket);socket.emit('secureConnect');
   const res=new EventEmitter();res.statusCode=status;res.headers={'content-type':'application/json',...headers};res.destroy=req.destroy;callback(res);
   res.emit('data',Buffer.isBuffer(body)?body:Buffer.from(body));res.emit('end');
  });return req;
 });return {calls,get destroyed(){return destroyed;}};
}
test('external transport pins DNS and peer IP while preserving TLS verification hostname and credentials at one origin',async t=>{
 const f=fixture(),http=native(t),controller=new AbortController();
 assert.deepEqual(await new ExternalHttpTransport(dns).get(f.c,'/health',controller.signal,Date.now()+5000,'test-bearer-value'),{ok:true});
 const o=http.calls[0];assert.equal(o.hostname,'8.8.8.8');assert.equal(o.servername,'orchestrator.example');assert.equal(o.rejectUnauthorized,true);assert.equal(o.headers.Host,'orchestrator.example');assert.equal(o.method,'GET');assert.equal(o.agent,false);assert.equal(o.headers.Authorization,'Bearer test-bearer-value');assert.ok(o.checkServerIdentity('other',{subjectaltname:'DNS:other'}));assert.equal(getEventListeners(controller.signal,'abort').length,0);
});
test('unsafe endpoint schemes private ranges metadata and IPv6 bypasses fail before transport',()=>{
 const f=fixture();for(const address of ['127.0.0.1','10.0.0.1','172.16.0.1','192.168.0.1','169.254.169.254','100.100.100.200','0.0.0.0','::1','fe80::1','::ffff:127.0.0.1','64:ff9b::7f00:1','2001:db8::1'])assert.throws(()=>connection({...f.c,endpoint:{origin:'https://orchestrator.example',network:'public',allowedAddresses:[address]}}));
 for(const origin of ['file:///tmp/private','ftp://orchestrator.example','http://orchestrator.example','https://user:password@orchestrator.example','https://orchestrator.example/?token=private'])assert.throws(()=>connection({...f.c,endpoint:{...f.c.endpoint,origin}}));
 assert.throws(()=>connection({...f.c,endpoint:{origin:'http://169.254.169.254',network:'local',allowedAddresses:['169.254.169.254']}}));
});
test('DNS rebinding mixed answers and family mismatches never open a request',async t=>{
 const f=fixture();let opened=0;t.mock.method(require('node:https'),'request',()=>{opened++;throw Error('must not connect');});
 for(const answers of [[{address:'10.0.0.1',family:4}],[{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}],[{address:'8.8.8.8',family:6}],[]])await assert.rejects(new ExternalHttpTransport(async()=>answers).get(f.c,'/health',new AbortController().signal,Date.now()+5000),match('INVALID_CONFIGURATION'));
 assert.equal(opened,0);
});
test('peer mismatch blocks a socket even after approved DNS resolution',async t=>{
 const f=fixture(),http=native(t,undefined,200,{},'127.0.0.1');await assert.rejects(new ExternalHttpTransport(dns).get(f.c,'/health',new AbortController().signal,Date.now()+5000),match('INVALID_CONFIGURATION'));assert.ok(http.destroyed);
});
test('redirects never forward authorization and HTTP errors have safe provider-neutral codes',async t=>{
 const f=fixture();for(const [status,code] of [[301,'INVALID_CONFIGURATION'],[307,'INVALID_CONFIGURATION'],[401,'AUTHENTICATION_FAILED'],[403,'AUTHORIZATION_FAILED'],[404,'NOT_FOUND'],[429,'RATE_LIMITED'],[503,'TRANSIENT_FAILURE']]){
  const http=native(t,'{"message":"test-bearer-value"}',status,{location:'https://attacker.invalid'});
  await assert.rejects(new ExternalHttpTransport(dns).get(f.c,'/health',new AbortController().signal,Date.now()+5000,'test-bearer-value'),e=>e.code===code&&!JSON.stringify(e).includes('test-bearer-value'));assert.equal(http.calls.length,1);t.mock.restoreAll();
 }
});
test('JSON response framing bounds bytes compression encoding and parser failure',async t=>{
 const f=fixture();for(const [body,headers,code] of [['invalid',{},'INVALID_PROVIDER_RESPONSE'],[Buffer.from([0xc3,0x28]),{},'INVALID_PROVIDER_RESPONSE'],['x'.repeat(65537),{},'RESPONSE_LIMIT'],['{}',{'content-length':'65537'},'RESPONSE_LIMIT'],['{}',{'content-encoding':'gzip'},'INVALID_PROVIDER_RESPONSE'],['{}',{'content-type':'text/html'},'INVALID_PROVIDER_RESPONSE']]){
  native(t,body,200,headers);await assert.rejects(new ExternalHttpTransport(dns).get(f.c,'/health',new AbortController().signal,Date.now()+5000),match(code));t.mock.restoreAll();
 }
});
test('cancelled and timed out DNS is bounded and late answers cannot open sockets',async t=>{
 const f=fixture();let complete,opened=0;t.mock.method(require('node:https'),'request',()=>{opened++;throw Error();});
 const promise=new ExternalHttpTransport(()=>new Promise(r=>complete=r)).get(f.c,'/health',new AbortController().signal,Date.now()+20);
 await assert.rejects(promise,match('TIMEOUT'));complete([{address:'8.8.8.8',family:4}]);await new Promise(r=>setImmediate(r));assert.equal(opened,0);
});
test('explicit trusted local fixture uses real bounded HTTP without becoming a public proxy',async()=>{
 const requests=[],server=createServer((req,res)=>{requests.push({url:req.url,authorization:req.headers.authorization});if(req.url==='/hang')return;res.setHeader('content-type','application/json');if(req.url==='/redirect'){res.writeHead(302,{Location:'/must-not-follow'});res.end('{}');}else res.end('{"state":"HEALTHY"}');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const f=fixture({endpoint:{origin:`http://127.0.0.1:${server.address().port}`,network:'local',allowedAddresses:['127.0.0.1']}}),transport=new ExternalHttpTransport(dns);
 try{
  assert.deepEqual(await transport.get(f.c,'/health',new AbortController().signal,Date.now()+5000,'local-fixture-credential'),{state:'HEALTHY'});
  await assert.rejects(transport.get(f.c,'/redirect',new AbortController().signal,Date.now()+5000,'local-fixture-credential'),match('INVALID_CONFIGURATION'));
  for(const path of ['//other.invalid','https://other.invalid','/\\other.invalid','/health\r\nHeader: value'])await assert.rejects(transport.get(f.c,path,new AbortController().signal,Date.now()+5000),match('INVALID_CONFIGURATION'));
  const controller=new AbortController(),pending=transport.get(f.c,'/hang',controller.signal,Date.now()+5000);setImmediate(()=>controller.abort());await assert.rejects(pending,match('ABORTED'));
  assert.equal(requests.filter(r=>r.url==='/must-not-follow').length,0);assert.equal(requests[0].authorization,'Bearer local-fixture-credential');
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('outbound fanout and unresolved DNS remain bounded independently of adapter operation slots',async()=>{
 const f=fixture(),waiting=[],transport=new ExternalHttpTransport(()=>new Promise(resolve=>waiting.push(resolve))),controllers=Array.from({length:2},()=>new AbortController());
 const pending=controllers.map(c=>transport.get(f.c,'/health',c.signal,Date.now()+5000).catch(e=>e));
 while(waiting.length<2)await new Promise(r=>setImmediate(r));controllers.forEach(c=>c.abort());assert.ok((await Promise.all(pending)).every(e=>e.code==='ABORTED'));
 await assert.rejects(transport.get(f.c,'/health',new AbortController().signal,Date.now()+5000),match('CAPACITY_EXCEEDED'));
 waiting.forEach(resolve=>resolve([{address:'8.8.8.8',family:4}]));await new Promise(r=>setImmediate(r));
 await assert.rejects(transport.get(f.c,'//forbidden',new AbortController().signal,Date.now()+5000),match('INVALID_CONFIGURATION'));
});
test('connection establishment has its own one-second bound and tears down the request',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let entered=false,destroyed=false;
 t.mock.method(require('node:https'),'request',()=>{const req=new EventEmitter();req.end=()=>{entered=true;};req.destroy=()=>{destroyed=true;};return req;});
 const f=fixture(),pending=new ExternalHttpTransport(dns).get(f.c,'/health',new AbortController().signal,Date.now()+5000);
 const rejected=assert.rejects(pending,match('TIMEOUT'));await new Promise(r=>setImmediate(r));assert.equal(entered,true);t.mock.timers.tick(1000);await rejected;assert.equal(destroyed,true);
});
