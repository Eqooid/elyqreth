import {spawn} from 'node:child_process';
import {writeFileSync,mkdirSync,readdirSync,existsSync,realpathSync} from 'node:fs';
import {resolve,join,relative,isAbsolute,dirname} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {validateImageLock,rehearsalSource,safeEnvironment} from './rehearsal-contracts.mjs';

const root=resolve(import.meta.dirname,'..');
export const suites=[
 ['build-api',['node_modules/typescript/bin/tsc','-p','apps/api/tsconfig.json']],
 ['typecheck-web',['node_modules/typescript/bin/tsc','-p','tsconfig.runtime-web.json']],
 ['syntax-web',['scripts/check.mjs']],
 ['build-web',['scripts/build-web.mjs']],
 ['backend-unit',null],
 ['frontend-unit',null],
 ['database-uat',['--test','apps/api/test/database.integration.cjs']],
 ['database-roles',['--test','apps/api/test/database-roles.integration.cjs']],
 ['backup-restore',['--test','apps/api/test/backup.test.cjs','apps/api/test/backup.integration.cjs']],
 ['tls-city-drain',['scripts/container-hardening.mjs','--edge','--runtime-drain']],
];
function execute(file,args,env){return new Promise(resolveResult=>{
 const digest=createHash('sha256');let bytes=0,tail='',code=null;const start=Date.now();
 const child=spawn(file,args,{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 const consume=b=>{digest.update(b);bytes+=b.length;tail=(tail+b.toString()).slice(-2*1024*1024);};
 child.stdout.on('data',consume);child.stderr.on('data',consume);child.on('error',()=>{});
 child.on('close',exit=>{code=exit;const tests={};for(const key of ['tests','pass','fail','skipped']){const matches=[...tail.matchAll(new RegExp('^# '+key+' (\\d+)$','gm'))];if(matches.length)tests[key]=Number(matches.at(-1)[1]);}
 resolveResult({exitCode:code,status:code===0?'PASS':'FAIL',durationMs:Date.now()-start,outputSha256:digest.digest('hex'),outputBytes:bytes,tests,failedTests:[...tail.matchAll(/^not ok \d+ - ([A-Za-z0-9 .,:;()/_+-]{1,240})$/gm)].map(m=>m[1]).slice(0,20),tail});});
 });}
export async function main(args=process.argv.slice(2)){
 if(args.length!==3||args[0]!=='--run'||args[1]!=='--output')throw Error('Usage: node scripts/staging-rehearsal.mjs --run --output <new-local-evidence-directory>');
 const output=resolve(args[2]),parent=realpathSync(dirname(output)),inside=relative(realpathSync(root),parent);if(existsSync(output)||(!inside||(!inside.startsWith('..'+(process.platform==='win32'?'\\':'/'))&&!isAbsolute(inside))))throw Error('Use a new evidence directory outside the checkout. Existing directories are never overwritten.');
 mkdirSync(output,{recursive:false,mode:0o700});
 const report={version:1,runId:randomUUID(),environment:'ISOLATED_LOCAL_UAT',mode:'LOCAL_SIMULATION',status:'RUNNING',startedAt:new Date().toISOString(),productionAccess:false,publication:false,commands:[],scenarios:[],limitations:['No registry promotion or Git provenance verification','No previous deployed release rollback','No external production target, alert delivery or human UAT approval']};
 const save=()=>writeFileSync(join(output,'uat.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
 const env=safeEnvironment(process.env);
 const npmCandidates=[resolve(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js'),resolve(dirname(process.execPath),'../lib/node_modules/npm/bin/npm-cli.js')];
 const npmCli=npmCandidates.find(existsSync);
 if(npmCli)env.npm_execpath=realpathSync(npmCli);
 try{
  if(!npmCli)throw Error('The local Node installation must include npm for CLI acceptance tests.');
  report.source=rehearsalSource(root);save();
  // Windows named pipe or Linux default socket only. No context/remote daemon override.
  const endpoint=process.platform==='win32'?'npipe:////./pipe/dockerDesktopLinuxEngine':'unix:///var/run/docker.sock';env.DOCKER_HOST=endpoint;
  const inspectArgs=['image','inspect','elyqreth-t05-api:verification','elyqreth-t05-web:verification','elyqreth-t06-edge:verification','--format','{{.Id}}'];
  const inspected=await execute('docker',inspectArgs,env);const ids=inspected.tail.trim().split(/\r?\n/);
  if(inspected.exitCode!==0||ids.length!==3){report.commands.push({id:'image-preflight',command:'docker '+inspectArgs.join(' '),exitCode:inspected.exitCode,status:'BLOCKED'});report.status='BLOCKED';return report;}
  const lock=validateImageLock({version:1,mode:'LOCAL_SIMULATION',images:{api:ids[0],web:ids[1],edge:ids[2]}});
  report.artifact={...lock,identityKind:'DOCKER_CONFIG_ID_NOT_REGISTRY_DIGEST',sourceBinding:'NOT_VERIFIED_PREBUILT_LOCAL_IMAGES'};
  const lockPath=join(output,'local-images.json');writeFileSync(lockPath,JSON.stringify(lock,null,2)+'\n',{flag:'wx',mode:0o600});
  for(const [id,definition] of suites){
   const commandArgs=definition??(id==='backend-unit'?['--test','--test-concurrency=1',...readdirSync(join(root,'apps/api/test')).filter(f=>f.endsWith('.test.cjs')).sort().map(f=>'apps/api/test/'+f)]:['--test',...readdirSync(join(root,'tests')).filter(f=>f.endsWith('.test.js')).sort().map(f=>'tests/'+f)]);
   const tested=commandArgs[0]==='--test'?['--test-reporter=tap',...commandArgs]:commandArgs;
   const actual=id==='tls-city-drain'?[...tested,'--image-lock',lockPath]:tested;
   console.log('T13 starting '+id);
   const result=await execute(process.execPath,actual,env);const {tail,...summary}=result;
   report.commands.push({id,command:'node '+tested.join(' ')+(id==='tls-city-drain'?' --image-lock <evidence>/local-images.json':''),...summary});
   if(id==='tls-city-drain'&&result.exitCode===0){try{const evidence=JSON.parse(tail);report.containerChecks=evidence.checks;}catch{throw Error('Container evidence was not complete JSON.');}}
   console.log('T13 '+id+' '+summary.status);save();
   if(result.exitCode!==0){report.status='FAIL';report.failedSuite=id;report.notRun=suites.slice(suites.findIndex(([name])=>name===id)+1).map(([name])=>name);return report;}
  }
  if(report.source.sha256!==rehearsalSource(root).sha256)throw Error('Source inputs changed during rehearsal.');
  report.status='PARTIAL';report.executedChecks='PASS';
  return report;
 }catch{report.status='FAIL';report.error='Rehearsal failed. Inspect prerequisites; sensitive child output is not copied into evidence.';return report;}
 finally{report.finishedAt=new Date().toISOString();save();console.log('T13 evidence: '+join(output,'uat.json'));}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){main().then(r=>{process.exitCode=['FAIL','BLOCKED'].includes(r.status)?1:0;}).catch(()=>{console.error('Invalid rehearsal invocation; no deployment was performed.');process.exitCode=1;});}
