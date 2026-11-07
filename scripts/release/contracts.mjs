import {readFileSync,lstatSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {sha,digest} from './oci.mjs';

export const fail=()=>{throw Error('Release validation failed. Review manifest, trusted source and prerequisite evidence; private values are not printed.');};
export function exact(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k))||keys.some(k=>!Object.hasOwn(value,k)))fail();}
export const canonical=value=>JSON.stringify(value,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v)+'\n';
export function jsonFile(path,max=1024**2){const s=lstatSync(path);if(!s.isFile()||s.isSymbolicLink()||s.size>max)fail();try{return JSON.parse(readFileSync(path,'utf8'));}catch{fail();}}
export function reference(value){if(typeof value!=='string'||value.length>400||!/^([a-z0-9.-]+(?::[0-9]{1,5})?)\/[a-z0-9]+(?:[._/-][a-z0-9]+)*@sha256:[a-f0-9]{64}$/.test(value))fail();const host=value.split('/')[0];if(!host.includes('.')&&!host.includes(':')&&host!=='localhost')fail();return value;}
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const identifier=v=>typeof v==='string'&&/^[a-zA-Z0-9_.-]{1,100}$/.test(v);
export function timestamp(value){if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)||!Number.isFinite(Date.parse(value)))fail();return value;}
export const releaseFiles=['Dockerfile','.dockerignore','.node-version','package.json','package-lock.json','apps/api/package.json','apps/api/tsconfig.json','docker-compose.production.yml','docker-compose.edge.yml','docker/api-start.cjs','docker/api-health.cjs','docker/web-start.sh','docker/web-check.sh','docker/nginx.conf','docker/edge/nginx.conf.template','docker/edge/start.sh',
 'scripts/release.mjs','scripts/release/contracts.mjs','scripts/release/oci.mjs','scripts/production-monitor.mjs','scripts/operational-signals.mjs','scripts/monitor/config.mjs','scripts/monitor/smtp.mjs'];
export function sourceInventory(root){
 const files=[...releaseFiles,...readdirSync(join(root,'apps/api/migrations'),{recursive:true}).filter(n=>typeof n==='string'&&/\.(sql|json)$/.test(n)).map(n=>'apps/api/migrations/'+n.replaceAll('\\','/'))].sort();
 return files.map(name=>{const path=join(root,name),stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink())fail();return {name,sha256:sha(readFileSync(path))};});
}
export function validateManifest(m){
 exact(m,['version','kind','releaseId','source','build','images','files','schema','migration','quality']);if(m.version!==1||!['candidate','fixture'].includes(m.kind)||!identifier(m.releaseId))fail();
 exact(m.source,['repository','commit','ref']);if(!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(m.source.repository)||!/^[a-f0-9]{40}$/.test(m.source.commit)||typeof m.source.ref!=='string'||!/^refs\/heads\/[a-zA-Z0-9_./-]+$/.test(m.source.ref)||m.source.ref.includes('..'))fail();
 exact(m.build,['workflow','runId','attempt','builtAt','inputs']);if(m.build.workflow!=='.github/workflows/release-candidate.yml'||!/^\d{1,20}$/.test(m.build.runId)||!Number.isInteger(m.build.attempt)||m.build.attempt<1||m.build.attempt>100)fail();timestamp(m.build.builtAt);
 exact(m.build.inputs,['buildxVersion','buildkitImage','frontendImage','sbomGenerator','scannerImage']);if(!/^v\d+\.\d+\.\d+$/.test(m.build.inputs.buildxVersion))fail();for(const key of ['buildkitImage','frontendImage','sbomGenerator','scannerImage'])reference(m.build.inputs[key]);
 if(m.releaseId!==`rc-${m.source.commit}-${m.build.runId}-${m.build.attempt}`)fail();
 exact(m.images,['api','web','edge']);for(const [name,image]of Object.entries(m.images)){
  exact(image,['reference','archive','sha256','attestations']);reference(image.reference);if(image.archive!==name+'.oci.tar'||!hex(image.sha256)||image.attestations!=='STRUCTURALLY_BOUND_NOT_SIGNATURE_VERIFIED')fail();
 }
 exact(m.schema,['migrationInventorySha256','compatibility']);if(!hex(m.schema.migrationInventorySha256)||m.schema.compatibility!=='EXACT_MIGRATION_INVENTORY_ONLY')fail();
 exact(m.migration,['image']);if(m.migration.image!==m.images.api.reference)fail();
 exact(m.quality,['workflow','runId','status']);if(m.quality.workflow!=='.github/workflows/verify.yml'||m.quality.runId!==m.build.runId||m.quality.status!=='PASSED')fail();
 if(!Array.isArray(m.files)||m.files.length<releaseFiles.length||m.files.length>500||new Set(m.files.map(f=>f.name)).size!==m.files.length)fail();
 for(const f of m.files){exact(f,['name','sha256']);if(typeof f.name!=='string'||!releaseFiles.includes(f.name)&&!/^apps\/api\/migrations\/(?:meta\/)?[a-zA-Z0-9_.-]+\.(sql|json)$/.test(f.name)||!hex(f.sha256))fail();}
 if(releaseFiles.some(name=>!m.files.some(f=>f.name===name)))fail();
 const migrations=m.files.filter(f=>f.name.startsWith('apps/api/migrations/'));if(!migrations.length||sha(canonical(migrations))!==m.schema.migrationInventorySha256)fail();
 return m;
}
export function validatePlanRequest(manifest,manifestSha,request,policy,previous){
 validateManifest(manifest);if(!hex(manifestSha)||sha(canonical(manifest))!==manifestSha)fail();
 exact(policy,['version','publicationEnabled','deploymentEnabled','operationsReady','repository','defaultBranch','imagePrefix','targetIds']);
 if(policy.version!==1||policy.publicationEnabled!==false||policy.deploymentEnabled!==false||typeof policy.operationsReady!=='boolean')fail();
 exact(policy.targetIds,['staging','production']);if(Object.values(policy.targetIds).some(v=>!identifier(v)))fail();
 exact(request,['simulation','environment','action','targetId','manifestSha256','approval','backup','migrationInventorySha256','staging','currentManifestSha256']);
 if(typeof request.simulation!=='boolean'||request.simulation!==(manifest.kind==='fixture')||!['staging','production'].includes(request.environment)||!['promote','rollback'].includes(request.action)||request.manifestSha256!==manifestSha||request.targetId!==policy.targetIds[request.environment])fail();
 if(manifest.source.repository!==policy.repository||manifest.source.ref!=='refs/heads/'+policy.defaultBranch)fail();
 reference(policy.imagePrefix+'/api@sha256:'+'0'.repeat(64));for(const [name,image]of Object.entries(manifest.images))if(!image.reference.startsWith(policy.imagePrefix+'/'+name+'@'))fail();
 exact(request.approval,['status','reviewer','manifestSha256','environment','targetId','approvedAt']);const a=request.approval;
 if(a.status!=='APPROVED'||!identifier(a.reviewer)||a.manifestSha256!==manifestSha||a.environment!==request.environment||a.targetId!==request.targetId)fail();timestamp(a.approvedAt);
 exact(request.backup,['id','artifactStatus','restoreStatus','verifiedAt','targetId']);const b=request.backup;
 if(!/^elyqreth-\d{8}T\d{9}Z-[a-f0-9-]{36}$/.test(b.id)||b.artifactStatus!=='ARTIFACT_VALIDATED'||b.restoreStatus!=='RESTORED_VERIFIED_QUARANTINED'||b.targetId!==request.targetId)fail();timestamp(b.verifiedAt);
 if(request.migrationInventorySha256!==manifest.schema.migrationInventorySha256)fail();
 if(request.environment==='production'){
  if(!policy.operationsReady)fail();exact(request.staging,['mode','status','manifestSha256','images','targetId']);const s=request.staging;
  if(s.mode!==(request.simulation?'SIMULATION':'DEPLOYED')||s.status!=='PASSED'||s.manifestSha256!==manifestSha||s.targetId!==policy.targetIds.staging||canonical(s.images)!==canonical(manifest.images))fail();
 }else if(request.staging!==null)fail();
 if(request.action==='rollback'){
  validateManifest(previous);if(request.currentManifestSha256!==sha(canonical(previous))||previous.source.repository!==manifest.source.repository||previous.schema.migrationInventorySha256!==manifest.schema.migrationInventorySha256||previous.releaseId===manifest.releaseId)fail();
 }else if(request.currentManifestSha256!==null||previous!==undefined)fail();
 return request;
}
export function promotionPlan(m,sha256,request,policy,previous){
 validatePlanRequest(m,sha256,request,policy,previous);const selected=m;
 return {version:1,mode:'PLAN_ONLY_NO_DEPLOYMENT',action:request.action,targetId:request.targetId,environment:request.environment,manifestSha256:sha256,
  selectedManifestSha256:sha(canonical(selected)),images:selected.images,migration:selected.migration,
  runtimeEnvironment:{API_IMAGE:selected.images.api.reference,WEB_IMAGE:selected.images.web.reference,EDGE_IMAGE:selected.images.edge.reference},
  steps:['verify-artifact-and-approval','verify-target-and-recovery-evidence','pull-and-verify-exact-digests','migration-preflight-only',
   'pause-local-external-observation-commands','native-only-drain','verify-zero-active-or-stop-for-reconciliation','stop-api-with-45s-grace',
   ...(request.action==='promote'?['locked-migration-with-separate-role']:[]),'replace-api-no-build','verify-private-readiness',
   'replace-web-and-edge-no-build','read-only-auth-tls-city-smoke','record-outcome-and-observe'],
  limitations:['No execution/publish transport is configured. This plan and operator-supplied records are not authentication or proof of deployment.',
   'Exact schema journal required: expand/contract rollback needs separately demonstrated compatible readiness; never run down migrations or restore automatically.',
   'Single native writer and maintenance replacement, not zero downtime; unknown effects require reconciliation.']};
}
/** Test-only execution oracle. CLI never supplies a command executor or exposes an apply command. */
export async function simulate(plan,executor){
 if(plan.mode!=='PLAN_ONLY_NO_DEPLOYMENT')fail();const results=[];
 for(const step of plan.steps){try{if(await executor(step)!==true)throw Error();results.push({step,status:'PASSED'});}catch{return {mode:'SIMULATION',status:'FAILED',manifestSha256:plan.selectedManifestSha256,results:[...results,{step,status:'FAILED'}]};}}
 return {mode:'SIMULATION',status:'PASSED',manifestSha256:plan.selectedManifestSha256,images:plan.images,targetId:plan.targetId,results};
}
