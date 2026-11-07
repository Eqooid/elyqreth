const {test}=require('node:test');
const assert=require('node:assert/strict');
const {fork}=require('node:child_process');
const {join}=require('node:path');
const {createRequire}=require('node:module');
const {gzipSync,deflateSync,brotliCompressSync}=require('node:zlib');
test('production HTTP parsing dependencies include the reviewed DoS fixes',()=>{
 const adapter=createRequire(require.resolve('@nestjs/platform-express/package.json'));
 const express=createRequire(adapter.resolve('express/package.json'));
 for(const [name,minor] of [['body-parser',4],['multer',5]]){
  const [major,installedMinor]=(name==='multer'?adapter:express)(name+'/package.json').version.split('.').map(Number);
  assert.ok(major>2||major===2&&installedMinor>=minor,`${name} must include the reviewed parser security fix`);
 }
});
test('malformed compressed request bodies cannot terminate the API process or expose parser diagnostics',{timeout:15000},async()=>{
 const child=fork(join(__dirname,'fixtures/http-parser-child.cjs'),[],{stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});
 // Isolate the adversarial parser case so a regression fails a test, not the test runner.
 child.stdout.resume();child.stderr.resume();
 const diagnostics=[];child.on('message',v=>{if(v.parser)diagnostics.push(v.parser);});
 try{
  const port=await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('Parser test server startup timed out')),5000);
   child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('exit',()=>{clearTimeout(timer);reject(Error('Parser test server exited during startup'));});
   child.once('message',v=>{clearTimeout(timer);resolve(v.port);});
  });
  for(const [encoding,compress] of [['gzip',gzipSync],['deflate',deflateSync],['br',brotliCompressSync]])for(const type of ['application/json','application/x-www-form-urlencoded']){
   const body=type==='application/json'?'{"value":"private-parser-marker"}':'value=private-parser-marker';
   const valid=await fetch(`http://127.0.0.1:${port}/missing`,{method:'POST',headers:{'content-type':type,'content-encoding':encoding},body:compress(Buffer.from(body)),signal:AbortSignal.timeout(3000)});
   assert.equal(valid.status,404,'Valid compressed requests retain existing parsing behavior');await valid.text();
   const payload=Buffer.concat([compress(Buffer.from(body)),Buffer.from('invalid-trailing-frame')]);
   const response=await fetch(`http://127.0.0.1:${port}/missing`,{method:'POST',headers:{'content-type':type,'content-encoding':encoding},body:payload,signal:AbortSignal.timeout(3000)});
   assert.ok([400,404].includes(response.status),`${encoding} ${type}: ${response.status}; ${JSON.stringify(diagnostics)}`);const text=await response.text();assert.doesNotMatch(text,/private-parser-marker|stack|Z_DATA_ERROR|incorrect header/i);
   assert.equal((await fetch(`http://127.0.0.1:${port}/health`,{signal:AbortSignal.timeout(3000)})).status,200);
   assert.equal(child.exitCode,null,'Malformed compressed request must not terminate the API');
  }
  const unsupported=await fetch(`http://127.0.0.1:${port}/missing`,{method:'POST',headers:{'content-type':'application/json','content-encoding':'unsupported'},body:'{}',signal:AbortSignal.timeout(3000)});
  assert.equal(unsupported.status,415);assert.equal((await unsupported.json()).message,'Unsupported media type.');
  const charset=await fetch(`http://127.0.0.1:${port}/missing`,{method:'POST',headers:{'content-type':'application/json;charset=unsupported'},body:'{}',signal:AbortSignal.timeout(3000)});
  assert.equal(charset.status,415);await charset.text();
  const parameters=await fetch(`http://127.0.0.1:${port}/missing`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(Array.from({length:101},(_,i)=>['p'+i,'bounded'])),signal:AbortSignal.timeout(3000)});
  assert.equal(parameters.status,413);assert.equal((await parameters.json()).message,'Request body is too large.');
 }finally{
  if(child.exitCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.send('stop');
   let timer;await Promise.race([exited,new Promise(resolve=>{timer=setTimeout(()=>{child.kill();resolve();},2000);})]);clearTimeout(timer);
  }
 }
});
