import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFileSync,writeFileSync,mkdirSync,appendFileSync,lstatSync,existsSync,createReadStream,unlinkSync} from 'node:fs';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {inspectOCI,sha,digest} from './release/oci.mjs';
import {canonical,fail,jsonFile,reference,sourceInventory,validateManifest,promotionPlan} from './release/contracts.mjs';

const run=promisify(execFile),targets=['api','web','edge'];
const repoRoot=resolve(import.meta.dirname,'..');
async function command(file,args,options={}){return (await run(file,args,{cwd:repoRoot,windowsHide:true,timeout:120000,maxBuffer:1024**2,...options})).stdout.trim();}
function buildFromArchive(args,archive){return new Promise((resolve,reject)=>{
 const child=execFile('docker',args,{cwd:repoRoot,windowsHide:true,timeout:1200000,maxBuffer:4*1024**2},error=>error?reject(error):resolve());
 const input=createReadStream(archive);input.on('error',()=>{child.kill();reject(Error());});child.stdin.on('error',()=>{});input.pipe(child.stdin);child.on('close',()=>input.destroy());
});}
export async function trustedSource(env=process.env,execute=command){
 if(env.GITHUB_ACTIONS!=='true'||env.GITHUB_EVENT_NAME!=='workflow_dispatch'||!/^\d{1,20}$/.test(env.GITHUB_RUN_ID??'')||!/^[1-9][0-9]?$/.test(env.GITHUB_RUN_ATTEMPT??'')||!/^[a-f0-9]{40}$/.test(env.GITHUB_SHA??'')||!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(env.GITHUB_REPOSITORY??''))fail();
 const event=jsonFile(env.GITHUB_EVENT_PATH);const branch=event.repository?.default_branch;
 if(typeof branch!=='string'||env.GITHUB_REF!=='refs/heads/'+branch||event.repository?.full_name!==env.GITHUB_REPOSITORY)fail();
 if(await execute('git',['rev-parse','HEAD'])!==env.GITHUB_SHA||await execute('git',['status','--porcelain','--untracked-files=normal']))fail();
 const origin=await execute('git',['config','--get','remote.origin.url']);if(!['https://github.com/'+env.GITHUB_REPOSITORY,'https://github.com/'+env.GITHUB_REPOSITORY+'.git'].includes(origin))fail();
 return {repository:env.GITHUB_REPOSITORY,commit:env.GITHUB_SHA,ref:env.GITHUB_REF};
}
export async function verifyBundle(directory,expectedSha){
 if(typeof expectedSha!=='string'||!/^[a-f0-9]{64}$/.test(expectedSha))fail();
 const raw=readFileSync(join(directory,'release.json'),'utf8');if(Buffer.byteLength(raw)>1024**2||sha(raw)!==expectedSha)fail();const m=validateManifest(JSON.parse(raw));if(canonical(m)!==raw)fail();
 for(const [name,image]of Object.entries(m.images)){
  const file=join(directory,image.archive);if(!lstatSync(file).isFile()||lstatSync(file).isSymbolicLink())fail();
  const result=await inspectOCI(file,image.reference.split('@')[1]);if(result.archiveSha256!==image.sha256)fail();
  // nginx declares inherited 80/tcp metadata; actual listeners/publication remain T06/Compose-owned.
  const expected={api:{user:'1000:1000',ports:['3001/tcp']},web:{user:'101:101',ports:['80/tcp','8080/tcp']},edge:{user:'101:101',ports:['80/tcp','8080/tcp','8443/tcp']}}[name];
  if(result.runtime.user!==expected.user||canonical(result.runtime.ports)!==canonical(expected.ports))fail();
  if(result.runtime.revision!==m.source.commit||result.runtime.source!=='https://github.com/'+m.source.repository)fail();
 }
 for(const f of m.files){const file=join(directory,'deployment',f.name);if(!lstatSync(file).isFile()||lstatSync(file).isSymbolicLink()||sha(readFileSync(file))!==f.sha256)fail();}
 return m;
}
export async function releasePreflight(env=process.env){
 const source=await trustedSource(env);const prefix=env.ELYQRETH_IMAGE_PREFIX;
 if(typeof prefix!=='string'||/example\.(invalid|com)/.test(prefix))fail();reference(prefix+'/api@sha256:'+'0'.repeat(64));
 for(const key of ['ELYQRETH_SBOM_GENERATOR','ELYQRETH_SCANNER_IMAGE','ELYQRETH_BUILDKIT_IMAGE','ELYQRETH_DOCKERFILE_FRONTEND_IMAGE'])reference(env[key]);
 if(!/^v\d+\.\d+\.\d+$/.test(env.ELYQRETH_BUILDX_VERSION??''))fail();return source;
}
export async function buildCandidate(directory,env=process.env){
 directory=resolve(directory);if(!relative(repoRoot,directory).startsWith('..')&&directory!==repoRoot)fail();if(directory===repoRoot||existsSync(directory))fail();
 const source=await releasePreflight(env);const prefix=env.ELYQRETH_IMAGE_PREFIX;
 const files=sourceInventory(repoRoot);await command('git',['ls-files','--error-unmatch',...files.map(f=>f.name)]);
 mkdirSync(directory,{recursive:true,mode:0o700});
 const context=join(directory,'source.tar');await command('git',['archive','--format=tar','--output='+context,source.commit]);
 const images={};
 try{
 for(const target of targets){
  process.stderr.write(JSON.stringify({event:'release.build',target})+'\n');
  await buildFromArchive(['buildx','build','--platform','linux/amd64','--target',target,'--build-arg','BUILDKIT_SYNTAX='+env.ELYQRETH_DOCKERFILE_FRONTEND_IMAGE,'--provenance=mode=min','--attest','type=sbom,generator='+env.ELYQRETH_SBOM_GENERATOR,
   '--output','type=oci,dest='+join(directory,target+'.oci.tar'),'--metadata-file',join(directory,target+'.metadata.json'),'--label','org.opencontainers.image.revision='+source.commit,
   '--label','org.opencontainers.image.source=https://github.com/'+source.repository,'-'],context);
  const metadata=jsonFile(join(directory,target+'.metadata.json'));const imageDigest=metadata['containerimage.digest'];if(!digest(imageDigest))fail();
  const result=await inspectOCI(join(directory,target+'.oci.tar'),imageDigest);
  images[target]={reference:prefix+'/'+target+'@'+imageDigest,archive:target+'.oci.tar',sha256:result.archiveSha256,attestations:result.attestations};
  process.stderr.write(JSON.stringify({event:'release.scan',target})+'\n');
  // A required scanner with an administrator-approved pinned image; absence or failure blocks the candidate.
  await command('docker',['run','--rm','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges:true','--pids-limit','128','--memory','1g','--cpus','1',
   '--user',`${process.getuid?.()??1000}:${process.getgid?.()??1000}`,'--tmpfs','/tmp:rw,noexec,nosuid,size=512m',
   '-e','TRIVY_CACHE_DIR=/tmp/trivy','-v',directory+':/bundle',env.ELYQRETH_SCANNER_IMAGE,
   'image','--input','/bundle/'+target+'.oci.tar','--scanners','vuln,secret','--severity','HIGH,CRITICAL','--exit-code','1','--format','json','--output','/bundle/'+target+'.scan.json'],{timeout:600000,maxBuffer:1024**2});
 }
 }finally{unlinkSync(context);}
 // Ensure no build/test modified maintained input; the release checkout must still be clean.
 await trustedSource(env);if(canonical(files)!==canonical(sourceInventory(repoRoot)))fail();
 for(const f of files){const dest=join(directory,'deployment',f.name);mkdirSync(resolve(dest,'..'),{recursive:true});writeFileSync(dest,readFileSync(join(repoRoot,f.name)),{flag:'wx',mode:0o600});}
 const manifest={version:1,kind:'candidate',releaseId:`rc-${source.commit}-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`,source,
  build:{workflow:'.github/workflows/release-candidate.yml',runId:env.GITHUB_RUN_ID,attempt:Number(env.GITHUB_RUN_ATTEMPT),builtAt:new Date().toISOString(),inputs:{buildxVersion:env.ELYQRETH_BUILDX_VERSION,buildkitImage:env.ELYQRETH_BUILDKIT_IMAGE,frontendImage:env.ELYQRETH_DOCKERFILE_FRONTEND_IMAGE,sbomGenerator:env.ELYQRETH_SBOM_GENERATOR,scannerImage:env.ELYQRETH_SCANNER_IMAGE}},images,files,
  schema:{migrationInventorySha256:sha(canonical(files.filter(f=>f.name.startsWith('apps/api/migrations/')))),compatibility:'EXACT_MIGRATION_INVENTORY_ONLY'},migration:{image:images.api.reference},
  quality:{workflow:'.github/workflows/verify.yml',runId:env.GITHUB_RUN_ID,status:'PASSED'}};
 validateManifest(manifest);const encoded=canonical(manifest),manifestSha256=sha(encoded);writeFileSync(join(directory,'release.json'),encoded,{flag:'wx',mode:0o600});writeFileSync(join(directory,'release.sha256'),manifestSha256+'\n',{flag:'wx',mode:0o600});
 await verifyBundle(directory,manifestSha256);if(env.GITHUB_OUTPUT)appendFileSync(env.GITHUB_OUTPUT,'manifest_sha256='+manifestSha256+'\n');return {releaseId:manifest.releaseId,manifestSha256,status:'BUILT_NOT_PUBLISHED'};
}
export async function verifyProducer(manifest,env=process.env,fetcher=fetch){
 const repo=env.GITHUB_REPOSITORY;if(repo!==manifest.source.repository||!env.GITHUB_TOKEN||manifest.kind!=='candidate')fail();
 const event=jsonFile(env.GITHUB_EVENT_PATH);if(event.repository?.full_name!==repo||manifest.source.ref!=='refs/heads/'+event.repository.default_branch||env.GITHUB_REF!==manifest.source.ref)fail();
 const url=`https://api.github.com/repos/${repo}/actions/runs/${manifest.build.runId}/attempts/${manifest.build.attempt}`;
 const response=await fetcher(url,{headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+env.GITHUB_TOKEN,'X-GitHub-Api-Version':'2022-11-28'},redirect:'error',signal:AbortSignal.timeout(10000)});
 if(!response.ok)fail();let body='';for await(const chunk of response.body){body+=Buffer.from(chunk).toString('utf8');if(Buffer.byteLength(body)>131072)fail();}
 const run=JSON.parse(body);if(run.repository?.full_name!==repo||run.event!=='workflow_dispatch'||run.path!==manifest.build.workflow||run.conclusion!=='success'||run.head_sha!==manifest.source.commit||run.head_branch!==manifest.source.ref.slice(11)||String(run.id)!==manifest.build.runId||run.run_attempt!==manifest.build.attempt)fail();return true;
}
async function main(){
 const [mode,...args]=process.argv.slice(2),flags={};for(let i=0;i<args.length;i+=2){if(!/^--[a-z-]+$/.test(args[i])||!args[i+1]||Object.hasOwn(flags,args[i]))fail();flags[args[i]]=args[i+1];}
 if(mode==='preflight'){if(args.length)fail();await releasePreflight();console.log('{"status":"CANDIDATE_INPUTS_VALIDATED"}');return;}
 if(mode==='build'){if(Object.keys(flags).join()!=='--bundle')fail();console.log(JSON.stringify(await buildCandidate(flags['--bundle'])));return;}
 if(!['verify','producer','plan'].includes(mode)||!flags['--bundle']||!flags['--expected-sha']||Object.keys(flags).some(k=>!['--bundle','--expected-sha',...(mode==='plan'?['--request','--policy','--current']:[])].includes(k)))fail();
 const m=await verifyBundle(resolve(flags['--bundle']),flags['--expected-sha']);
 if(mode==='verify'){console.log(JSON.stringify({status:'INTEGRITY_VERIFIED_NOT_AUTHENTICATED',releaseId:m.releaseId}));return;}
 if(mode==='producer'){await verifyProducer(m);console.log(JSON.stringify({status:'CI_PRODUCER_METADATA_CHECKED_NOT_SIGNATURE_VERIFIED',releaseId:m.releaseId}));return;}
 if(m.kind==='candidate')await verifyProducer(m);
 const request=jsonFile(flags['--request']),policy=jsonFile(flags['--policy']),current=flags['--current']?jsonFile(flags['--current']):undefined;
 console.log(canonical(promotionPlan(m,flags['--expected-sha'],request,policy,current)).trim());
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{process.stderr.write('Release operation failed. Check trusted source, immutable bundle, evidence and gates; no publication or deployment was performed.\n');process.exitCode=1;});
