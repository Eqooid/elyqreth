const {test,before}=require('node:test');
const assert=require('node:assert/strict');const {randomUUID,generateKeyPairSync}=require('node:crypto');
const {SignJWT}=require('jose');
const {validateEnvironment}=require('../dist/config/configuration');
const {AuthenticationService}=require('../dist/auth/auth.service');
const {hashPassword,verifyPassword,validUsername,validPassword}=require('../dist/auth/password');
const {establishAccount,assertAccount}=require('../dist/auth/principal');
const pair=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...pair.publicKey.export({format:'jwk'}),kid:'test-key',use:'sig',alg:'RS256'};
const base={NODE_ENV:'test',DATABASE_URL:'postgres://app:synthetic-password@127.0.0.1/app',
 AGENT_REGISTRY_ENABLED:'true',AGENT_REGISTRY_OWNER_ID:randomUUID(),AUTH_MODE:'oidc',
 AUTH_OIDC_ISSUER:'https://identity.example/realm',AUTH_OIDC_AUDIENCE:'elyqreth-api',AUTH_OIDC_JWKS:JSON.stringify({keys:[jwk]}),
 AUTH_OIDC_SUBJECTS:JSON.stringify([{subject:'approved',role:'viewer'}])};
const config=validateEnvironment(base),service=new AuthenticationService({value:config},{});
const token=(payload={},header={},privateKey=pair.privateKey)=>new SignJWT({sub:'approved',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+300,
 iss:base.AUTH_OIDC_ISSUER,aud:base.AUTH_OIDC_AUDIENCE,...payload}).setProtectedHeader({alg:'RS256',typ:'at+jwt',kid:'test-key',...header}).sign(privateKey);

test('authentication modes are exclusive fail-closed and cannot enable development token fallback',()=>{
 assert.equal(validateEnvironment({}).authentication,undefined);
 const local=validateEnvironment({NODE_ENV:'test',DATABASE_URL:base.DATABASE_URL,AGENT_REGISTRY_ENABLED:'true',AGENT_REGISTRY_OWNER_ID:base.AGENT_REGISTRY_OWNER_ID,AUTH_MODE:'local'});
 assert.equal(local.registry.token,'');assert.equal(local.authentication.sessionSeconds,3600);
 for(const patch of [{AUTH_MODE:'both'},{API_HOST:'0.0.0.0'},{AUTH_MODE:'local'},{AUTH_MODE:'disabled'},
  {AUTH_OIDC_JWKS:'{}'},{AUTH_OIDC_AUDIENCE:'*'},{AUTH_OIDC_ISSUER:'http://untrusted.example'},
  {AUTH_OIDC_SUBJECTS:'[]'},{AGENT_REGISTRY_TOKEN:'old-token'},{CITY_INTERACTION_ENABLED:'true'},{EXTERNAL_ORCHESTRATORS_ENABLED:'true'},
  {AUTH_OIDC_JWKS:JSON.stringify({keys:[{...jwk,d:'private-key'}]})},{AUTH_OIDC_JWKS:JSON.stringify({keys:[{...jwk,key_ops:['sign']}]})}])assert.throws(()=>validateEnvironment({...base,...patch}));
 for(const seconds of ['0','Infinity','1','86401'])assert.throws(()=>validateEnvironment({NODE_ENV:'test',DATABASE_URL:base.DATABASE_URL,AGENT_REGISTRY_ENABLED:'true',AGENT_REGISTRY_OWNER_ID:base.AGENT_REGISTRY_OWNER_ID,AUTH_MODE:'local',AUTH_SESSION_SECONDS:seconds}));
 assert.ok(!JSON.stringify(config).includes('approved'));assert.ok(!JSON.stringify(config.authentication).includes(jwk.n));
 const production=validateEnvironment({...base,NODE_ENV:'production',API_HOST:'127.0.0.1',API_PORT:'3001',CORS_ORIGINS:'https://city.example'});
 assert.equal(production.authentication.mode,'oidc');assert.equal(production.database.sslMode,'verify-full');
});

test('scrypt password storage is salted nonplaintext and validates bounded passwords',async()=>{
 const password='Synthetic-password-for-test-123';const a=await hashPassword(password),b=await hashPassword(password);
 assert.notEqual(a,b);assert.ok(!a.includes(password));assert.equal(await verifyPassword(password,a),true);
 assert.equal(await verifyPassword('Another-synthetic-password-123',a),false);
 assert.equal(await verifyPassword(password,'scrypt-v1$malformed'),false);
 for(const p of ['short','x'.repeat(257),'a'.repeat(16)+'\n','\u{1F600}'.repeat(8),'a'.repeat(15)+'\ud800'])assert.equal(validPassword(p),false);
 assert.equal(validUsername('operator.one'),true);assert.equal(validUsername('../administrator'),false);
});

test('OIDC verifier uses signed issuer audience time and server subject mapping, not token roles/owners',async()=>{
 const p=await service.authenticate(await token({roles:['administrator'],ownerId:randomUUID()}));
 assert.equal(p.kind,'OIDC');assert.equal(p.audience,'viewer');assert.equal(p.ownerId,base.AGENT_REGISTRY_OWNER_ID);
 assert.ok(Object.isFrozen(p));assert.match(p.actorReference,/^oidc:[a-f0-9]{64}$/);
 for(const payload of [{iss:'https://forged.example'},{aud:'another-api'},{exp:1},{iat:1},{nbf:Math.floor(Date.now()/1000)+1000},{token_use:'id'},{typ:'ID'}])
  await assert.rejects(service.authenticate(await token(payload)),{status:401});
 await assert.rejects(service.authenticate(await token({sub:'not-approved'})),{status:403});
 for(const header of [{kid:'unknown'},{typ:'invalid'},{typ:'JWT'}])await assert.rejects(service.authenticate(await token({},header)),{status:401});
 const other=generateKeyPairSync('rsa',{modulusLength:2048});await assert.rejects(service.authenticate(await token({}, {},other.privateKey)),{status:401});
 for(const alg of ['none','HS256']){
  const header=Buffer.from(JSON.stringify({alg,typ:'JWT',kid:'test-key'})).toString('base64url');
  const payload=Buffer.from(JSON.stringify({iss:base.AUTH_OIDC_ISSUER,aud:base.AUTH_OIDC_AUDIENCE,sub:'approved',exp:9999999999})).toString('base64url');
  await assert.rejects(service.authenticate(header+'.'+payload+'.'),{status:401});
 }
 await assert.rejects(service.authenticate('forged.shared.development-token'),{status:401});
 await assert.rejects(service.authenticate('x'.repeat(16385)),{status:401});
});

test('authenticated request scope cannot be copied switched across configurations or escalated by a viewer',()=>{
 const req={method:'GET',path:'/api/v1/agents'},p={kind:'OIDC',audience:'viewer',ownerId:base.AGENT_REGISTRY_OWNER_ID,actorReference:'oidc:test'};
 establishAccount(req,config,p);assert.equal(assertAccount(req,config).ownerId,p.ownerId);
 assert.throws(()=>assertAccount({...req},config),{status:401});assert.throws(()=>assertAccount(req,{...config}),{status:401});
 req.method='POST';assert.throws(()=>assertAccount(req,config),{status:401});establishAccount(req,config,p);
 assert.throws(()=>assertAccount(req,config),{status:403});
});
module.exports={pair,jwk,base,token};

test('issuer JWKS may contain encryption keys but only public RS256 signing keys enter the verifier',()=>{
 const mixed={keys:[{...jwk,kid:'encryption',alg:'RSA-OAEP',use:'enc'},jwk]};
 const c=validateEnvironment({...base,AUTH_OIDC_JWKS:JSON.stringify(mixed)});
 assert.deepEqual(c.authentication.jwks.keys.map(k=>k.kid),['test-key']);
 assert.throws(()=>validateEnvironment({...base,AUTH_OIDC_JWKS:JSON.stringify({keys:[mixed.keys[0]]})}));
 assert.throws(()=>validateEnvironment({...base,AUTH_OIDC_JWKS:JSON.stringify({keys:[jwk,{...mixed.keys[0],d:'private'}]})}));
});
