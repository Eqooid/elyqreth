const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),{join,resolve,dirname,basename}=require('node:path'),{tmpdir}=require('node:os');
const {execFile}=require('node:child_process'),{promisify}=require('node:util');
const run=promisify(execFile),root=resolve(__dirname,'../../..');let D,C,O,folder;
const template=()=>JSON.parse(fs.readFileSync(join(root,'docker/production-prerequisites.example.json'),'utf8'));
before(async()=>{[D,C,O]=await Promise.all([import('../../../scripts/production-decision-contracts.mjs'),import('../../../scripts/release/contracts.mjs'),import('../../../scripts/release/oci.mjs')]);folder=fs.mkdtempSync(join(tmpdir(),'elyqreth-t15-decisions-test-'));});
after(()=>{assert.equal(dirname(folder),resolve(tmpdir()));assert.ok(basename(folder).startsWith('elyqreth-t15-decisions-test-'));fs.rmSync(folder,{recursive:true,force:true});});
function populated(){
 const record=template();
 const sample={ref:'synthetic-private-ref',repository:'fixture/elyqreth',repositoryUrl:'https://github.com/fixture/elyqreth',branch:'trunk',commit:'a'.repeat(40),origin:'https://registry.example.invalid',prefix:'registry.example.invalid/fixture',visibility:'private',hash:'c'.repeat(64),digest:'sha256:'+'b'.repeat(64),id:'fixture-production',auth:'local',transport:'ci-controlled',boolean:true,positiveInteger:1,positive:1,nonnegative:0,ratio:0.01,operation:'promote'};
 function fill(value,schema){for(const [k,type]of Object.entries(schema)){if(typeof type==='object')fill(value[k],type);else value[k]=sample[type];}}
 fill(record,D.decisionSchema);return record;
}
function syntheticManifest(){
 const record=populated(),files=[...C.releaseFiles,'apps/api/migrations/0000_fixture.sql'].sort().map(name=>({name,sha256:O.sha('synthetic '+name)}));
 const m={version:1,kind:'candidate',releaseId:'rc-'+'a'.repeat(40)+'-123-1',source:{repository:'fixture/elyqreth',commit:'a'.repeat(40),ref:'refs/heads/trunk'},build:{workflow:'.github/workflows/release-candidate.yml',runId:'123',attempt:1,builtAt:'2026-11-07T00:00:00.000Z',inputs:{buildxVersion:'v0.19.2',...Object.fromEntries(['buildkitImage','frontendImage','sbomGenerator','scannerImage'].map(k=>[k,'registry.example.invalid/tool@sha256:'+'d'.repeat(64)]))}},images:Object.fromEntries(['api','web','edge'].map(name=>[name,{reference:'registry.example.invalid/fixture/'+name+'@sha256:'+'b'.repeat(64),archive:name+'.oci.tar',sha256:'e'.repeat(64),attestations:'STRUCTURALLY_BOUND_NOT_SIGNATURE_VERIFIED'}])),files,schema:{migrationInventorySha256:O.sha(C.canonical(files.filter(f=>f.name.startsWith('apps/api/migrations/')))),compatibility:'EXACT_MIGRATION_INVENTORY_ONLY'},migration:{image:'registry.example.invalid/fixture/api@sha256:'+'b'.repeat(64)},quality:{workflow:'.github/workflows/verify.yml',runId:'123',status:'PASSED'}};
 record.candidate.expectedManifestSha256=record.authorization.manifestSha256=O.sha(C.canonical(m));return {record,m};
}
test('T15 unpopulated operator configuration lists gaps and cannot authorize promotion',()=>{
 const r=D.assessDecisions(template());assert.equal(r.status,'INCOMPLETE');assert.ok(r.missing.length>100);assert.deepEqual(r.invalid,[]);assert.equal(r.promotion,'CLOSED');assert.equal(r.authorization,'AWAITING PRODUCTION AUTHORIZATION');
});
test('T15 fully populated claims remain unauthenticated and production remains closed',()=>{
 const r=D.assessDecisions(populated());assert.equal(r.status,'COMPLETE_UNAUTHENTICATED_WORKSHEET');assert.equal(r.productionReadiness,'NOT READY');assert.equal(r.promotion,'CLOSED');assert.equal(r.networkAccessPerformed,false);assert.equal(r.manifestStatus,'NOT_PROVIDED');
});
test('T15 unknown keys and private values never enter diagnostics',()=>{
 const x=populated();x.secret='never-output-sensitive-marker';x.registry.origin='https://user:never-output-sensitive-marker@registry.example.invalid';
 const r=D.assessDecisions(x);assert.equal(r.status,'INVALID');assert.ok(!JSON.stringify(r).includes('never-output-sensitive-marker'));assert.ok(!JSON.stringify(r).includes('user:'));assert.ok(r.invalid.some(v=>v.code==='UNKNOWN_FIELDS'));
});
test('T15 registry, target, manifest and host-loss safety contradictions fail closed',()=>{
 for(const change of [x=>x.source.repositoryUrl='https://github.com/other/repo',x=>x.registry.origin='https://another.invalid',x=>x.transport.registryOrigin='https://another.invalid',x=>x.transport.targetEnvironmentId='another',x=>x.authorization.targetEnvironmentId='another',x=>x.authorization.manifestSha256='f'.repeat(64),x=>x.transport.digestPinned=false,x=>x.recovery.backupSurvivesHostLoss=false,x=>x.recovery.keyCustodySurvivesHostLoss=false]){const x=populated();change(x);assert.ok(D.assessDecisions(x).conflicts.length);}
});
test('T15 malformed types, mutable digests, unsafe origins and invalid capacity fail without guessing targets',()=>{
 for(const change of [x=>x.capacity.concurrentUsers=0,x=>x.capacity.maximumErrorRate=2,x=>x.capacity.concurrentExecutions=1.5,x=>x.capacity.taskSubmissionsPerSecond='10',x=>x.registry.imagePrefix='registry.example.invalid/fixture:latest',x=>x.candidate.apiDigest='latest',x=>x.registry.origin='http://registry.example.invalid',x=>x.registry.origin='https://registry.example.invalid?token=private',x=>x.target.authenticationMode='disabled',x=>x.source.sourceCommit='main',x=>x.source.defaultBranch='../main']){const x=populated();change(x);assert.equal(D.assessDecisions(x).status,'INVALID');}
});
test('T15 local candidate schema/identity matches are not registry, artifact or approval verification',()=>{
 const {record,m}=syntheticManifest();assert.equal(D.assessDecisions(record,m).manifestStatus,'SCHEMA_CHECKED_NOT_ARTIFACT_OR_APPROVAL_VERIFIED');
 for(const change of [v=>v.source.commit='f'.repeat(40),v=>v.images.edge.reference='registry.example.invalid/other/edge@sha256:'+'b'.repeat(64),v=>v.migration.image=v.images.web.reference,v=>v.kind='fixture',v=>v.images.api.reference='registry.example.invalid/fixture/api:latest']){const bad=structuredClone(m);change(bad);assert.equal(D.assessDecisions(record,bad).status,'INVALID');}
 assert.equal(D.assessDecisions(record,m).promotion,'CLOSED');
});
test('T15 real CLI preserves complete claims as closed, emits no values and refuses apply or checkout output',async()=>{
 const script=join(root,'scripts/production-decisions.mjs'),input=join(folder,'private.json');fs.writeFileSync(input,JSON.stringify(populated()));
 await assert.rejects(run(process.execPath,[script,'--config',input,'--output',join(folder,'report')],{timeout:10000,windowsHide:true}),e=>{assert.equal(e.code,2);assert.ok(!e.stdout.includes('synthetic-private-ref'));return true;});
 const report=JSON.parse(fs.readFileSync(join(folder,'report/decisions.json')));assert.equal(report.promotion,'CLOSED');
 for(const args of [['--apply','true'],['--config',input,'--output',root]])await assert.rejects(run(process.execPath,[script,...args],{timeout:10000,windowsHide:true}),e=>e.code===1&&!e.stderr.includes('synthetic-private-ref'));
});
