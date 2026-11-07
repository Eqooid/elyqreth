// Disposable test-only Keycloak. No provider credentials or network targets are accepted from users.
const {execFile}=require('node:child_process'),{promisify}=require('node:util');
const {randomBytes,randomUUID}=require('node:crypto'),{mkdtempSync,writeFileSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os'),{join,dirname,basename,resolve}=require('node:path');const assert=require('node:assert/strict');
const run=promisify(execFile);
const image='quay.io/keycloak/keycloak:26.8.1@sha256:a78d6b79572168cb25886b80a8b5b8d4ed4390743e3eecb810538683e209dd6b';
exports.start=async()=>{
 const id=randomBytes(12).toString('hex'),name='elyqreth_keycloak_test_'+id,label='elyqreth.keycloak.test';
 const temp=mkdtempSync(join(tmpdir(),'elyqreth-keycloak-')),subject=randomUUID(),password=randomBytes(32).toString('base64url');let created=false;
 const docker=async(...args)=>(await run('docker',args,{timeout:120000,maxBuffer:1024*1024})).stdout.trim();
 async function close(){
  if(created){const state=JSON.parse(await docker('inspect',name))[0];assert.equal(state.Name,'/'+name);assert.equal(state.Config.Labels[label],id);await docker('rm','--force',name);created=false;}
  assert.equal(dirname(resolve(temp)),resolve(tmpdir()));assert.ok(basename(temp).startsWith('elyqreth-keycloak-'));rmSync(temp,{recursive:true});
 }
 try{
  const realm={realm:'elyqreth-test',enabled:true,sslRequired:'none',registrationAllowed:false,
   clients:[{clientId:'elyqreth-api',enabled:true,publicClient:true,protocol:'openid-connect',standardFlowEnabled:true,directAccessGrantsEnabled:true,
    protocolMappers:[{name:'api-audience',protocol:'openid-connect',protocolMapper:'oidc-audience-mapper',consentRequired:false,config:{'included.client.audience':'elyqreth-api','access.token.claim':'true','id.token.claim':'false'}}]}],
   users:[{id:subject,username:'test-operator',enabled:true,emailVerified:true,email:'operator@example.invalid',firstName:'Test',lastName:'Operator',credentials:[{type:'password',value:password,temporary:false}]}]};
  const file=join(temp,'realm.json');writeFileSync(file,JSON.stringify(realm),{mode:0o600});
  await docker('run','--detach','--name',name,'--label',label+'='+id,'--memory','1g','--cpus','2','-p','127.0.0.1::8080',
   '--mount',`type=bind,source=${file},target=/opt/keycloak/data/import/realm.json,readonly`,image,'start-dev','--import-realm');created=true;
  const state=JSON.parse(await docker('inspect',name))[0],mapping=state.NetworkSettings.Ports['8080/tcp'][0];assert.equal(mapping.HostIp,'127.0.0.1');
  const origin='http://127.0.0.1:'+mapping.HostPort,issuer=origin+'/realms/elyqreth-test';
  const json=async(url,options={})=>{assert.equal(new URL(url).origin,origin);const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(3000),...options});assert.equal(response.status,200,'Disposable Keycloak operation failed');return response.json();};
  let discovery;
  for(let i=0;i<120;i++){
   try{discovery=await json(issuer+'/.well-known/openid-configuration');break;}catch{await new Promise(resolve=>setTimeout(resolve,1000));}
  }
  if(!discovery)throw Error('Disposable Keycloak did not become ready');assert.equal(discovery.issuer,issuer);
  const issue=async()=>{
   // Direct grant only in this disposable fixture; production browser integration uses T04's reviewed flow.
   const result=await json(discovery.token_endpoint,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({scope:'openid',grant_type:'password',client_id:'elyqreth-api',username:'test-operator',password})});
   assert.equal(result.token_type,'Bearer');assert.equal(typeof result.access_token,'string');return result;
  };
  return {issuer,subject,image,close,keys:()=>json(discovery.jwks_uri),token:async()=>(await issue()).access_token,idToken:async()=>{const token=(await issue()).id_token;assert.equal(typeof token,'string');return token;}};
 }catch(error){await close();throw error;}
};
