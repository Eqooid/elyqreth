const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
const {execFile}=require('node:child_process'),{promisify}=require('node:util'),{mkdtempSync,rmSync}=require('node:fs');
const {join,resolve,dirname,basename}=require('node:path'),{tmpdir}=require('node:os');
const run=promisify(execFile);let folder,cert,key;
before(async()=>{
 folder=mkdtempSync(join(tmpdir(),'elyqreth-t10-tls-'));cert=join(folder,'server.crt');key=join(folder,'server.key');
 const openssl=process.platform==='win32'?'C:/Program Files/Git/usr/bin/openssl.exe':'openssl';
 await run(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=orchestrator.test',
  '-addext','subjectAltName=DNS:orchestrator.test'],{timeout:30000,windowsHide:true});
});
after(()=>{if(folder){assert.equal(dirname(resolve(folder)),resolve(tmpdir()));assert.ok(basename(folder).startsWith('elyqreth-t10-tls-'));rmSync(folder,{recursive:true,force:true});}});
for(const mode of ['trusted','untrusted'])test('T10 real pinned HTTPS socket '+mode+' certificate and API-key boundary',async()=>{
 const env={...process.env};delete env.NODE_TLS_REJECT_UNAUTHORIZED;delete env.NODE_EXTRA_CA_CERTS;
 if(mode==='trusted')env.NODE_EXTRA_CA_CERTS=cert;
 const output=await run(process.execPath,[join(__dirname,'fixtures/external-tls-child.cjs'),cert,key,mode],{env,timeout:15000,windowsHide:true});
 assert.equal(JSON.parse(output.stdout).status,'PASS');assert.ok(!output.stdout.includes('synthetic-t10-tls-credential'));
});
