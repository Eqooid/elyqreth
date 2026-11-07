const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
const {execFile}=require('node:child_process'),{promisify}=require('node:util'),{once}=require('node:events');
const {mkdtempSync,writeFileSync,readFileSync,rmSync}=require('node:fs'),{join,resolve,dirname,basename}=require('node:path'),{tmpdir}=require('node:os');
const run=promisify(execFile);let folder,cert,key,passwordFile,monitor,smtp,config;
before(async()=>{
 [monitor,smtp,config]=await Promise.all([import('../../../scripts/production-monitor.mjs'),import('../../../scripts/monitor/smtp.mjs'),import('../../../scripts/monitor/config.mjs')]);
 folder=mkdtempSync(join(tmpdir(),'elyqreth-email-test-'));cert=join(folder,'server.crt');key=join(folder,'server.key');passwordFile=join(folder,'smtp.password');
 writeFileSync(passwordFile,'synthetic-smtp-secret\n',{mode:0o600});
 await run(process.platform==='win32'?'C:/Program Files/Git/usr/bin/openssl.exe':'openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1,DNS:localhost'],{timeout:30000,windowsHide:true});
});
after(()=>{if(folder){assert.equal(dirname(resolve(folder)),resolve(tmpdir()));assert.ok(basename(folder).startsWith('elyqreth-email-test-'));rmSync(folder,{recursive:true,force:true});}});
const base=()=>({enabled:true,intervalSeconds:60,windowSeconds:300,repeatSeconds:600,healthyChecks:2,stateDirectory:join(folder,'state'),composeFiles:[join(folder,'compose.yml')],email:{enabled:false}});
const email=port=>({enabled:true,host:'127.0.0.1',port,username:'synthetic-user',passwordFile,from:'alerts@example.invalid',to:['owner@example.invalid'],caFile:cert,timeoutMs:1500});
const notice=()=>({id:'a'.repeat(64),kind:'ALERT',conditions:['api_readiness_unavailable'],observedAt:'2026-11-06T00:00:00.000Z',privatePayload:'never-send-this'});
async function fixture(mode,action){
 const sockets=new Set(),received=[],auth=[];
 const server=require('node:tls').createServer({key:readFileSync(key),cert:readFileSync(cert)},socket=>{
  let buffer='',data=false,body=[];socket.write('220 local fixture\r\n');
  if(mode==='stall')return;
  socket.on('data',chunk=>{buffer+=chunk;let i;while((i=buffer.indexOf('\r\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+2);
   if(data){if(line!=='.'){body.push(line);continue;}data=false;received.push(body.join('\r\n'));body=[];
    if(mode==='drop-data'){socket.destroy();return;}socket.write(mode==='reject-data'?'451 not accepted\r\n':'250 accepted\r\n');continue;}
   if(line.startsWith('EHLO'))socket.write(mode==='malformed'?'250-first\r\n251 invalid\r\n':'250-fixture\r\n250 AUTH PLAIN\r\n');
   else if(line.startsWith('AUTH PLAIN ')){auth.push(socket.encrypted&&Buffer.from(line.slice(11),'base64').toString()==='\0synthetic-user\0synthetic-smtp-secret');socket.write(mode==='reject-auth'?'535 synthetic-private-provider-message\r\n':'235 accepted\r\n');}
   else if(line.startsWith('MAIL FROM:')||line.startsWith('RCPT TO:'))socket.write('250 accepted\r\n');
   else if(line==='DATA'){data=true;socket.write('354 send\r\n');}
   else socket.write('500 unsupported\r\n');
  }});
 });
 server.on('connection',socket=>{sockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));});server.on('tlsClientError',()=>{});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 try{return await action(email(server.address().port),{received,auth});}finally{for(const s of sockets)s.destroy();await new Promise(resolve=>server.close(resolve));}
}
test('email configuration rejects credential embedding, header injection, unlimited polling and TLS bypasses',()=>{
 const c=base();assert.equal(config.validateConfig(c).enabled,true);
 for(const patch of [{intervalSeconds:0},{intervalSeconds:3601},{windowSeconds:10},{repeatSeconds:1},{healthyChecks:1},{stateDirectory:'relative'},{unknown:'private'}])assert.throws(()=>config.validateConfig({...c,...patch}));
 const e=email(465);for(const patch of [{password:'private'},{rejectUnauthorized:false},{username:'name\r\nINJECT'},{from:'x@example.invalid\r\nBcc: other@example.invalid'},{from:'x.@example.invalid'},{to:['bad']},{to:[e.to[0],e.to[0]]},{host:'https://mail.invalid'},{host:'bad..host'},{timeoutMs:0}])assert.throws(()=>config.validateConfig({...c,email:{...e,...patch}}));
 assert.equal(new smtp.DeliveryError('never-log-this-secret').code,'SMTP_UNAVAILABLE');
});
test('real verified SMTPS authenticates only over TLS and sends fixed condition metadata without input payloads',async()=>{
 await fixture('ok',async(e,{received,auth})=>{assert.deepEqual(await smtp.sendEmail(e,notice()),{accepted:true});assert.deepEqual(auth,[true]);assert.equal(received.length,1);
  assert.match(received[0],/Subject: \[Elyqreth\] ALERT/);const decoded=Buffer.from(received[0].split('\r\n\r\n')[1].replaceAll('\r\n',''),'base64').toString();
  assert.ok(decoded.includes('api_readiness_unavailable'));for(const v of ['never-send-this','synthetic-smtp-secret','synthetic-user'])assert.ok(!decoded.includes(v));
 });
});
test('untrusted SMTP certificate is rejected before authentication',async()=>{
 await fixture('ok',async(e,{auth,received})=>{delete e.caFile;await assert.rejects(smtp.sendEmail(e,notice()),error=>error instanceof smtp.DeliveryError&&error.code==='SMTP_TLS'&&!error.uncertain);assert.equal(auth.length,0);assert.equal(received.length,0);});
});
test('SMTP rejects authentication safely and bounds stalls and malformed multiline replies',async()=>{
 for(const mode of ['reject-auth','stall','malformed'])await fixture(mode,async(e,{received})=>{
  await assert.rejects(smtp.sendEmail(e,notice()),error=>error instanceof smtp.DeliveryError&&!error.uncertain&&!error.message.includes('synthetic-private-provider-message'));assert.equal(received.length,0);
 });
});
test('lost DATA acknowledgement is uncertain while explicit negative DATA response is retry-safe',async()=>{
 for(const [mode,uncertain] of [['drop-data',true],['reject-data',false]])await fixture(mode,async(e,{received})=>{
  await assert.rejects(smtp.sendEmail(e,notice()),error=>error instanceof smtp.DeliveryError&&error.uncertain===uncertain);assert.equal(received.length,1);
 });
 await assert.rejects(smtp.sendEmail(email(465),{...notice(),id:'bad\r\nHeader: value'}));
});
function engine(deliver){let state=monitor.emptyState(),now=0;const messages=[];return {
 get state(){return state;},get messages(){return messages;},setTime(value){now=value;},
 async step(values){return monitor.processSample(state,values,base(),{now,save:async s=>{state=structuredClone(s);},deliver:async n=>{messages.push(n);if(deliver)await deliver(n);}});}
};}
test('alerts suppress duplicates, repeat at the configured interval and clear only after consecutive healthy checks',async()=>{
 const e=engine();assert.equal((await e.step(['api_readiness_unavailable'])).delivery,'accepted');
 e.setTime(60000);assert.equal((await e.step(['api_readiness_unavailable'])).delivery,'suppressed');assert.equal(e.messages.length,1);
 e.setTime(600000);assert.equal((await e.step(['api_readiness_unavailable'])).delivery,'accepted');assert.equal(e.messages.length,2);assert.notEqual(e.messages[0].id,e.messages[1].id);
 assert.equal((await e.step([])).delivery,'waiting_for_clear');assert.equal((await e.step([])).delivery,'accepted');assert.equal(e.messages[2].kind,'CLEARED');
 assert.equal((await e.step([])).delivery,'quiet');assert.equal(e.messages.length,3);
});
test('delivery failures have persisted bounded retries and exhaustion without an email storm',async()=>{
 const e=engine(()=>{throw new smtp.DeliveryError('SMTP_UNAVAILABLE');});
 assert.equal((await e.step(['shutdown_failure'])).delivery,'pending');assert.equal(e.state.delivery.attempts,1);
 assert.equal((await e.step(['shutdown_failure'])).delivery,'retry_wait');e.setTime(60000);await e.step(['shutdown_failure']);
 e.setTime(360000);assert.equal((await e.step(['shutdown_failure'])).delivery,'exhausted');e.setTime(86400000);assert.equal((await e.step(['shutdown_failure'])).delivery,'exhausted');assert.equal(e.messages.length,3);
});
test('uncertain delivery and interrupted send intent never automatically resend',async()=>{
 const e=engine(()=>{throw new smtp.DeliveryError('SMTP_UNAVAILABLE',true);});assert.equal((await e.step(['runtime_drain_deadline'])).delivery,'uncertain');
 e.setTime(86400000);assert.equal((await e.step([])).delivery,'uncertain');assert.equal(e.messages.length,1);
 const interrupted=structuredClone(e.state);interrupted.delivery.status='inflight';let saved;
 const r=await monitor.processSample(interrupted,[],base(),{save:async s=>saved=s,deliver:()=>{throw Error('must not send');}});assert.equal(r.delivery,'uncertain');assert.equal(saved.delivery.status,'uncertain');
});
test('failed state persistence after SMTP acceptance preserves inflight intent for conservative restart',async()=>{
 let saved,calls=0;await assert.rejects(monitor.processSample(monitor.emptyState(),['api_readiness_unavailable'],base(),{save:async s=>{if(++calls===2)throw Error('disk unavailable');saved=structuredClone(s);},deliver:async()=>{}}));
 assert.equal(saved.delivery.status,'inflight');const result=await monitor.processSample(saved,[],base(),{save:async()=>{},deliver:()=>{throw Error('must not send');}});assert.equal(result.delivery,'uncertain');
});
test('a condition that clears before safe delivery cancels the obsolete unsent notification',async()=>{
 const e=engine(()=>{throw new smtp.DeliveryError('SMTP_UNAVAILABLE');});await e.step(['shutdown_failure']);await e.step([]);assert.equal((await e.step([])).delivery,'quiet');assert.equal(e.messages.length,1);assert.equal(e.state.delivery,null);
});
test('collection uses read-only fixed Docker commands, drops payloads and detects missing/truncated sources',async()=>{
 const calls=[];const run=async(file,args)=>{calls.push({file,args});if(args.includes('logs'))return {stdout:JSON.stringify({event:'http_request',statusCode:500,body:'private-marker'})+'\n'};return {stdout:'{"status":503,"dependency":"DATABASE_UNAVAILABLE"}'};};
 const values=await monitor.collect(base(),run);assert.deepEqual(values,['api_readiness_unavailable']);assert.equal(calls.length,2);assert.ok(calls.every(c=>c.file==='docker'&&!c.args.includes('restart')));assert.ok(!JSON.stringify(values).includes('private-marker'));
 const failed=await monitor.collect(base(),async()=>{throw Error('private-password');});assert.deepEqual(failed,['api_readiness_unavailable','monitor_source_unavailable']);
 const truncated=await monitor.collect(base(),async(_,args)=>({stdout:args.includes('logs')?'{"event":"http_request","statusCode":200}\n'.repeat(1000):'{"status":200,"dependency":"READY"}'}));assert.deepEqual(truncated,['monitor_input_incomplete']);
 const recovered=await monitor.collect(base(),async(_,args)=>({stdout:args.includes('logs')?'{"event":"readiness.changed","dependency":"DATABASE_UNAVAILABLE"}\n':'{"status":200,"dependency":"READY"}'}));assert.deepEqual(recovered,[]);
});
test('private state enforces exclusive monitor ownership, validates corruption and persists no SMTP credentials',async()=>{
 const dir=join(folder,'store-test');const store=monitor.openStore(dir);
 try{assert.throws(()=>monitor.openStore(dir));await store.save(monitor.emptyState());assert.deepEqual(store.load(),monitor.emptyState());assert.ok(!readFileSync(join(dir,'state.json'),'utf8').includes('smtp'));writeFileSync(join(dir,'state.json'),'{}',{mode:0o600});assert.throws(()=>store.load());}finally{store.close();}
 const reopened=monitor.openStore(dir);reopened.close();
});
test('disabled CLI and configuration checks make no network calls, and failures do not echo inputs',async()=>{
 const file=join(folder,'monitor.json');writeFileSync(file,JSON.stringify({...base(),enabled:false}),{mode:0o600});const script=join(__dirname,'../../../scripts/production-monitor.mjs');
 const disabled=await run(process.execPath,[script,'once','--config',file],{timeout:10000,env:{...process.env,PATH:''},windowsHide:true});assert.equal(JSON.parse(disabled.stdout).event,'monitor.disabled');
 const checked=await run(process.execPath,[script,'check','--config',file],{timeout:10000,windowsHide:true});assert.equal(JSON.parse(checked.stdout).valid,true);
 writeFileSync(file,JSON.stringify({...base(),email:{...email(465),password:'never-print-secret'}}),{mode:0o600});
 await assert.rejects(run(process.execPath,[script,'check','--config',file],{timeout:10000,windowsHide:true}),error=>error.code===1&&!error.stderr.includes('never-print-secret')&&!error.stderr.includes(passwordFile));
});
