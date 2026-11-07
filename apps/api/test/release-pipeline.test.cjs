const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),{join,resolve,dirname,basename}=require('node:path'),{tmpdir}=require('node:os'),{createHash}=require('node:crypto');
const {execFile}=require('node:child_process'),{promisify}=require('node:util');const run=promisify(execFile);let folder,C,O,R;
const hash=b=>createHash('sha256').update(b).digest('hex'),copy=x=>structuredClone(x);
before(async()=>{[C,O,R]=await Promise.all([import('../../../scripts/release/contracts.mjs'),import('../../../scripts/release/oci.mjs'),import('../../../scripts/release.mjs')]);folder=fs.mkdtempSync(join(tmpdir(),'elyqreth-t12-'));});
after(()=>{assert.equal(dirname(resolve(folder)),resolve(tmpdir()));assert.ok(basename(folder).startsWith('elyqreth-t12-'));fs.rmSync(folder,{recursive:true,force:true});});
function tar(entries){const parts=[];for(const [name,data,type='0']of entries){const b=Buffer.from(data),h=Buffer.alloc(512);h.write(name);h.write('0000600\0',100);h.write('0000000\0',108);h.write('0000000\0',116);h.write(b.length.toString(8).padStart(11,'0')+'\0',124);h.write('00000000000\0',136);h.fill(32,148,156);h.write(type,156);h.write('ustar\0',257);h.write('00',263);const sum=[...h].reduce((a,v)=>a+v,0);h.write(sum.toString(8).padStart(6,'0')+'\0 ',148);parts.push(h,b,Buffer.alloc((512-b.length%512)%512));}parts.push(Buffer.alloc(1024));return Buffer.concat(parts);}
function image(target,options={}){
 const entries=[],blob=(value,mediaType)=>{const bytes=Buffer.from(JSON.stringify(value)),digest='sha256:'+hash(bytes);entries.push(['blobs/sha256/'+digest.slice(7),bytes]);return {mediaType,digest,size:bytes.length};};
 const ports=target==='api'?['3001/tcp']:target==='web'?['80/tcp','8080/tcp']:['80/tcp','8080/tcp','8443/tcp'];if(options.extraPort)ports.push('9229/tcp');
 const config=blob({os:'linux',architecture:'amd64',config:{User:options.root?'0':target==='api'?'1000:1000':'101:101',Labels:{'org.opencontainers.image.revision':'a'.repeat(40),'org.opencontainers.image.source':'https://github.com/fixture/elyqreth'},ExposedPorts:Object.fromEntries(ports.map(p=>[p,{}]))}},'application/vnd.oci.image.config.v1+json');
 const runtime=blob({schemaVersion:2,config,layers:[]},'application/vnd.oci.image.manifest.v1+json');
 const layers=['https://spdx.dev/Document',...(options.noProvenance?[]:['https://slsa.dev/provenance/v1'])].map(predicateType=>blob({predicateType,subject:[{digest:{sha256:runtime.digest.slice(7)}}]},'application/vnd.in-toto+json'));
 const empty=blob({},'application/vnd.oci.image.config.v1+json'),attest=blob({schemaVersion:2,config:empty,layers},'application/vnd.oci.image.manifest.v1+json');
 const root=blob({schemaVersion:2,manifests:[{...runtime,platform:{os:'linux',architecture:'amd64'}},attest]},'application/vnd.oci.image.index.v1+json');
 entries.push(['oci-layout',JSON.stringify({imageLayoutVersion:'1.0.0'})],['index.json',JSON.stringify({schemaVersion:2,manifests:[root]})]);return {archive:tar(entries),digest:root.digest,entries};
}
function makeManifest(){
 const files=[...C.releaseFiles,'apps/api/migrations/0000_fixture.sql'].sort().map(name=>({name,sha256:hash('synthetic '+name)}));
 const images=Object.fromEntries(['api','web','edge'].map(name=>{const i=image(name);return [name,{reference:'registry.example.invalid/elyqreth/'+name+'@'+i.digest,archive:name+'.oci.tar',sha256:hash(i.archive),attestations:'STRUCTURALLY_BOUND_NOT_SIGNATURE_VERIFIED'}];}));
 return {version:1,kind:'fixture',releaseId:'rc-'+'a'.repeat(40)+'-123-1',source:{repository:'fixture/elyqreth',commit:'a'.repeat(40),ref:'refs/heads/trunk'},build:{workflow:'.github/workflows/release-candidate.yml',runId:'123',attempt:1,builtAt:'2026-11-06T00:00:00.000Z',inputs:{buildxVersion:'v0.19.2',...Object.fromEntries(['buildkitImage','frontendImage','sbomGenerator','scannerImage'].map(k=>[k,'registry.example.invalid/tool@sha256:'+'c'.repeat(64)]))}},images,files,schema:{migrationInventorySha256:hash(C.canonical(files.filter(f=>f.name.startsWith('apps/api/migrations/')))),compatibility:'EXACT_MIGRATION_INVENTORY_ONLY'},migration:{image:images.api.reference},quality:{workflow:'.github/workflows/verify.yml',runId:'123',status:'PASSED'}};
}
function setup(environment='staging'){
 const m=makeManifest(),sha=hash(C.canonical(m));const policy={version:1,publicationEnabled:false,deploymentEnabled:false,operationsReady:false,repository:'fixture/elyqreth',defaultBranch:'trunk',imagePrefix:'registry.example.invalid/elyqreth',targetIds:{staging:'fixture-stage',production:'fixture-prod'}};
 const req={simulation:true,environment,action:'promote',targetId:policy.targetIds[environment],manifestSha256:sha,approval:{status:'APPROVED',reviewer:'fixture-reviewer',manifestSha256:sha,environment,targetId:policy.targetIds[environment],approvedAt:'2026-11-06T01:00:00.000Z'},backup:{id:'elyqreth-20261106T000000000Z-11111111-1111-4111-8111-111111111111',artifactStatus:'ARTIFACT_VALIDATED',restoreStatus:'RESTORED_VERIFIED_QUARANTINED',verifiedAt:'2026-11-06T00:30:00.000Z',targetId:policy.targetIds[environment]},migrationInventorySha256:m.schema.migrationInventorySha256,staging:null,currentManifestSha256:null};return {m,sha,policy,req};
}
async function bundle(){const {m}=setup(),dir=fs.mkdtempSync(join(folder,'bundle-'));for(const target of ['api','web','edge'])fs.writeFileSync(join(dir,target+'.oci.tar'),image(target).archive);for(const f of m.files){const path=join(dir,'deployment',f.name);fs.mkdirSync(dirname(path),{recursive:true});fs.writeFileSync(path,'synthetic '+f.name);}fs.writeFileSync(join(dir,'release.json'),C.canonical(m));return {dir,m,sha:hash(C.canonical(m))};}
test('T12 manifest rejects tags, missing/extra artifacts, separate migrator substitutions and unknown metadata',()=>{
 const {m}=setup();assert.equal(C.validateManifest(m),m);
 for(const change of [v=>v.images.api.reference='registry.example.invalid/a:latest',v=>delete v.images.edge,v=>v.migration.image=v.images.web.reference,v=>v.secret='never-print',v=>v.schema.migrationInventorySha256='0'.repeat(64),v=>v.source.commit='main']){const bad=copy(m);change(bad);assert.throws(()=>C.validateManifest(bad));}
});
test('T12 streaming OCI verification binds all referenced content, platform, SBOM and provenance without extraction',async()=>{
 const i=image('api'),file=join(folder,'valid.oci.tar');fs.writeFileSync(file,i.archive);const result=await O.inspectOCI(file,i.digest);assert.equal(result.runtime.user,'1000:1000');assert.equal(result.archiveSha256,hash(i.archive));
 const missing=image('api',{noProvenance:true});fs.writeFileSync(file,missing.archive);await assert.rejects(O.inspectOCI(file,missing.digest));
 fs.writeFileSync(file,i.archive.subarray(0,900));await assert.rejects(O.inspectOCI(file,i.digest));
 fs.writeFileSync(file,tar([['../outside','malicious']]));await assert.rejects(O.inspectOCI(file,i.digest));assert.ok(!fs.existsSync(join(folder,'outside')));
 fs.writeFileSync(file,tar([['index.json','target','2']]));await assert.rejects(O.inspectOCI(file,i.digest));
});
test('T12 bundle rejects missing blobs, root users, changed configuration and tampering even with recomputed sidecars',async()=>{
 const b=await bundle();await R.verifyBundle(b.dir,b.sha);
 fs.appendFileSync(join(b.dir,'deployment','Dockerfile'),'modified');await assert.rejects(R.verifyBundle(b.dir,b.sha));
 const next=await bundle();next.m.images.api.reference=next.m.images.web.reference;fs.writeFileSync(join(next.dir,'release.json'),C.canonical(next.m));await assert.rejects(R.verifyBundle(next.dir,next.sha));
 const root=await bundle(),bad=image('api',{root:true});root.m.images.api.reference='registry.example.invalid/elyqreth/api@'+bad.digest;root.m.images.api.sha256=hash(bad.archive);root.m.migration.image=root.m.images.api.reference;fs.writeFileSync(join(root.dir,'api.oci.tar'),bad.archive);fs.writeFileSync(join(root.dir,'release.json'),C.canonical(root.m));await assert.rejects(R.verifyBundle(root.dir,hash(C.canonical(root.m))));
 const extra=await bundle(),debug=image('api',{extraPort:true});extra.m.images.api.reference='registry.example.invalid/elyqreth/api@'+debug.digest;extra.m.images.api.sha256=hash(debug.archive);extra.m.migration.image=extra.m.images.api.reference;fs.writeFileSync(join(extra.dir,'api.oci.tar'),debug.archive);fs.writeFileSync(join(extra.dir,'release.json'),C.canonical(extra.m));await assert.rejects(R.verifyBundle(extra.dir,hash(C.canonical(extra.m))));
});
test('T12 approval, branch, target, recovery and schema gates fail closed',()=>{
 for(const change of [x=>x.req.approval.status='DENIED',x=>x.req.approval.manifestSha256='0'.repeat(64),x=>x.req.targetId='another-target',x=>x.policy.defaultBranch='unreviewed',x=>x.policy.imagePrefix='other.invalid/prefix',x=>x.req.backup.restoreStatus='BACKED_UP_NOT_RESTORE_VERIFIED',x=>x.req.migrationInventorySha256='0'.repeat(64),x=>x.policy.deploymentEnabled=true,x=>x.req.simulation=false]){const x=setup();change(x);assert.throws(()=>C.promotionPlan(x.m,x.sha,x.req,x.policy));}
 const x=setup();assert.equal(C.promotionPlan(x.m,x.sha,x.req,x.policy).mode,'PLAN_ONLY_NO_DEPLOYMENT');
});
test('T12 production requires operations readiness and exact staged manifest/images, never a new build',()=>{
 const x=setup('production');assert.throws(()=>C.promotionPlan(x.m,x.sha,x.req,x.policy));x.policy.operationsReady=true;
 x.req.staging={mode:'SIMULATION',status:'PASSED',manifestSha256:x.sha,images:x.m.images,targetId:x.policy.targetIds.staging};
 const plan=C.promotionPlan(x.m,x.sha,x.req,x.policy);assert.deepEqual(plan.images,x.m.images);assert.equal(plan.migration.image,x.m.images.api.reference);assert.ok(!plan.steps.some(s=>/build|restore|down-migration/.test(s)&&!s.endsWith('no-build')));
 x.req.staging={...x.req.staging,manifestSha256:'0'.repeat(64)};assert.throws(()=>C.promotionPlan(x.m,x.sha,x.req,x.policy));
});
test('T12 failed backup or migration stops simulated progression and preserves explicit failed outcome',async()=>{
 const x=setup(),plan=C.promotionPlan(x.m,x.sha,x.req,x.policy);
 for(const blocked of ['verify-target-and-recovery-evidence','pull-and-verify-exact-digests','locked-migration-with-separate-role','verify-private-readiness']){const calls=[];const result=await C.simulate(plan,async step=>{calls.push(step);return step!==blocked;});assert.equal(result.status,'FAILED');assert.equal(calls.at(-1),blocked);assert.equal(result.mode,'SIMULATION');}
 const result=await C.simulate(plan,async()=>true);assert.equal(result.manifestSha256,x.sha);assert.deepEqual(result.images,x.m.images);
});
test('T12 rollback approval binds the selected known-good target and refuses incompatible current schema',()=>{
 const x=setup(),current=copy(x.m);current.source.commit='b'.repeat(40);current.releaseId='rc-'+'b'.repeat(40)+'-123-1';x.req.action='rollback';x.req.currentManifestSha256=hash(C.canonical(current));
 const plan=C.promotionPlan(x.m,x.sha,x.req,x.policy,current);assert.deepEqual(plan.images,x.m.images);assert.ok(!plan.steps.includes('locked-migration-with-separate-role'));
 current.files.find(f=>f.name.startsWith('apps/api/migrations/')).sha256='f'.repeat(64);current.schema.migrationInventorySha256=hash(C.canonical(current.files.filter(f=>f.name.startsWith('apps/api/migrations/'))));x.req.currentManifestSha256=hash(C.canonical(current));assert.throws(()=>C.promotionPlan(x.m,x.sha,x.req,x.policy,current));
});
test('T12 trusted source rejects PR events, dirty checkouts, wrong commits and unexpected origins',async()=>{
 const event=join(folder,'event.json');fs.writeFileSync(event,JSON.stringify({repository:{default_branch:'trunk',full_name:'fixture/elyqreth'}}));
 const env={GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1',GITHUB_SHA:'a'.repeat(40),GITHUB_REPOSITORY:'fixture/elyqreth',GITHUB_REF:'refs/heads/trunk',GITHUB_EVENT_PATH:event};
 const execute=async(_file,args)=>args[0]==='rev-parse'?env.GITHUB_SHA:args[0]==='status'?'':'https://github.com/fixture/elyqreth';
 assert.equal((await R.trustedSource(env,execute)).commit,env.GITHUB_SHA);
 for(const patch of [{GITHUB_EVENT_NAME:'pull_request'},{GITHUB_REF:'refs/heads/feature'},{GITHUB_SHA:'bad'}])await assert.rejects(R.trustedSource({...env,...patch},execute));
 await assert.rejects(R.trustedSource(env,async()=> 'dirty private marker'));
 await assert.rejects(R.trustedSource(env,async(file,args)=>args[0]==='status'?' M Dockerfile':execute(file,args)));
 await assert.rejects(R.trustedSource(env,async(file,args)=>args[0]==='config'?'https://github.com/other/repository':execute(file,args)));
});
test('T12 producer metadata is checked against actual repository, branch, workflow, run and attempt',async()=>{
 const m=makeManifest();m.kind='candidate';const event=join(folder,'producer-event.json');fs.writeFileSync(event,JSON.stringify({repository:{default_branch:'trunk',full_name:'fixture/elyqreth'}}));
 const env={GITHUB_REPOSITORY:'fixture/elyqreth',GITHUB_TOKEN:'synthetic-ci-token',GITHUB_EVENT_PATH:event,GITHUB_REF:'refs/heads/trunk'};
 const response={repository:{full_name:env.GITHUB_REPOSITORY},event:'workflow_dispatch',path:m.build.workflow,conclusion:'success',head_sha:m.source.commit,head_branch:'trunk',id:123,run_attempt:1};
 const fetcher=async(url,options)=>{assert.ok(url.startsWith('https://api.github.com/repos/fixture/elyqreth/'));assert.equal(options.redirect,'error');return new Response(JSON.stringify(response));};
 assert.equal(await R.verifyProducer(m,env,fetcher),true);response.event='pull_request';await assert.rejects(R.verifyProducer(m,env,fetcher));
});
test('T12 CLI cannot apply, publish or bypass gates, and missing Git provenance fails without build',async()=>{
 const script=join(__dirname,'../../../scripts/release.mjs');for(const args of [['apply'],['publish'],['build','--bundle',join(folder,'candidate')]])await assert.rejects(run(process.execPath,[script,...args],{env:{...process.env,GITHUB_ACTIONS:'false'},timeout:10000,windowsHide:true}),error=>error.code===1&&!error.stderr.includes('synthetic-ci-token'));
 assert.ok(!fs.existsSync(join(folder,'candidate')));
});
test('T12 real CLI verifies a fixture bundle and plans identical staging/production artifacts without deployment',async()=>{
 const b=await bundle(),x=setup(),script=join(__dirname,'../../../scripts/release.mjs'),policyFile=join(b.dir,'policy.json'),requestFile=join(b.dir,'request.json');
 fs.writeFileSync(policyFile,JSON.stringify(x.policy));fs.writeFileSync(requestFile,JSON.stringify(x.req));
 const args=['plan','--bundle',b.dir,'--expected-sha',b.sha,'--policy',policyFile,'--request',requestFile];
 const stage=JSON.parse((await run(process.execPath,[script,...args],{timeout:10000,windowsHide:true})).stdout);assert.equal(stage.mode,'PLAN_ONLY_NO_DEPLOYMENT');
 x.policy.operationsReady=true;x.req.environment='production';x.req.targetId=x.policy.targetIds.production;x.req.approval.environment='production';x.req.approval.targetId=x.req.targetId;x.req.backup.targetId=x.req.targetId;
 x.req.staging={mode:'SIMULATION',status:'PASSED',manifestSha256:b.sha,images:b.m.images,targetId:x.policy.targetIds.staging};
 fs.writeFileSync(policyFile,JSON.stringify(x.policy));fs.writeFileSync(requestFile,JSON.stringify(x.req));
 const prod=JSON.parse((await run(process.execPath,[script,...args],{timeout:10000,windowsHide:true})).stdout);assert.deepEqual(prod.images,stage.images);assert.deepEqual(prod.runtimeEnvironment,stage.runtimeEnvironment);assert.equal(prod.mode,'PLAN_ONLY_NO_DEPLOYMENT');
});
test('T12 workflows are manual/closed for candidates, read-only, SHA-pinned and never consume PR deployment secrets',()=>{
 const root=join(__dirname,'../../..');for(const name of ['verify.yml','release-candidate.yml','promotion-plan.yml']){const text=fs.readFileSync(join(root,'.github/workflows',name),'utf8');
  assert.ok(!text.includes('pull_request_target'));for(const match of text.matchAll(/uses:\s+([^\s#]+)/g))if(!match[1].startsWith('./'))assert.match(match[1],/@[a-f0-9]{40}$/);
  assert.ok(!/\$\{\{\s*secrets\./.test(text));assert.ok(!/packages:\s*write|contents:\s*write|id-token:\s*write/.test(text));
  if(name!=='verify.yml'){assert.match(text,/workflow_dispatch:/);assert.match(text,/ENABLED == 'true'/);assert.match(text,/cancel-in-progress: false/);assert.ok(!/^\s+(push|pull_request):/m.test(text));assert.ok(!/docker push|buildx.*--push|compose.* up |ssh /.test(text));}
 }
});
