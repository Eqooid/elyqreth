import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdirSync,writeFileSync,readFileSync,existsSync,realpathSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {safeEnvironment,rehearsalSource} from './rehearsal-contracts.mjs';
import {newOutsideOutput} from './rehearsal-output.mjs';
const root=resolve(import.meta.dirname,'..'),args=process.argv.slice(2),run=promisify(execFile);
async function main(){
 if(args.length!==2||args[0]!=='--output')throw Error();
 const output=newOutsideOutput(root,args[1]);
 mkdirSync(output,{mode:0o700});const scratch=join(output,'scratch');mkdirSync(scratch,{mode:0o700});
 const env=safeEnvironment(process.env);env.DOCKER_HOST=process.platform==='win32'?'npipe:////./pipe/dockerDesktopLinuxEngine':'unix:///var/run/docker.sock';env.TEMP=scratch;env.TMP=scratch;env.TMPDIR=scratch;
 const npm=[resolve(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js'),resolve(dirname(process.execPath),'../lib/node_modules/npm/bin/npm-cli.js')].find(existsSync);if(!npm)throw Error();env.npm_execpath=realpathSync(npm);
 const report={task:'T14 local security capacity and disaster verification',status:'RUNNING',startedAt:new Date().toISOString(),environment:'DISPOSABLE_LOCAL_SIMULATION',source:rehearsalSource(root),commands:[],observations:[],productionAccess:false};
 const save=()=>writeFileSync(join(output,'verification.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});save();
 async function command(id,file,argv,extra={}){
  console.log('T14 starting '+id);let stdout='',stderr='',exitCode=0;
  try{({stdout,stderr}=await run(file,argv,{cwd:root,env:{...env,...extra},windowsHide:true,maxBuffer:8*1024*1024}));}catch(e){stdout=e.stdout??'';stderr=e.stderr??'';exitCode=Number.isInteger(e.code)?e.code:null;}
  const parsed=[];for(const line of stdout.split(/\r?\n/)){const m=line.match(/(?:^|# )(CAPACITY_EVIDENCE|RECOVERY_EVIDENCE|DISASTER_EVIDENCE) (\{.*\})$/);if(m)parsed.push({kind:m[1],value:JSON.parse(m[2])});}
  report.observations.push(...parsed);report.commands.push({id,command:[file===process.execPath?'node':file,...argv].join(' '),exitCode,status:exitCode===0?'PASS':'FAIL',outputSha256:createHash('sha256').update(stdout).update(stderr).digest('hex'),failedTests:[...stdout.matchAll(/^not ok \d+ - (.{1,240})$/gm)].map(m=>m[1])});save();console.log('T14 '+id+' '+report.commands.at(-1).status);return {exitCode,stdout};
 }
 try{
  const local=await command('docker-preflight','docker',['info','--format','{{json .ServerVersion}} {{.NCPU}} {{.MemTotal}}']);if(local.exitCode!==0)throw Error();report.docker=local.stdout.trim();
  const quality=await command('security-resilience-restore',process.execPath,['scripts/staging-rehearsal.mjs','--run','--output',join(output,'uat')]);if(quality.exitCode!==0)throw Error();
  report.uat=JSON.parse(readFileSync(join(output,'uat/uat.json'),'utf8'));
  const capacity=await command('capacity',process.execPath,['--test-reporter=tap','--test','--test-name-pattern=T14 bounded isolated','apps/api/test/database.integration.cjs'],{ELYQRETH_CAPACITY:'true'});if(capacity.exitCode!==0)throw Error();
  const disaster=await command('source-loss-restore',process.execPath,['--test-reporter=tap','--test','apps/api/test/backup.integration.cjs'],{ELYQRETH_DISASTER:'true'});if(disaster.exitCode!==0)throw Error();
  const frontend=await command('frontend-profile',process.execPath,['--expose-gc','scripts/phase5-collaboration-profile.mjs']);if(frontend.exitCode!==0)throw Error();report.frontendProfile=JSON.parse(frontend.stdout);
  const audit=await command('production-dependency-audit',process.execPath,[npm,'audit','--omit=dev','--audit-level=high','--json']);try{const a=JSON.parse(audit.stdout);report.dependencyAudit={metadata:a.metadata,errorCode:a.error?.code,vulnerabilities:Object.entries(a.vulnerabilities??{}).map(([name,v])=>({name,severity:v.severity,range:v.range,isDirect:v.isDirect,advisories:(v.via??[]).filter(x=>typeof x==='object').map(x=>({source:x.source,url:x.url,severity:x.severity})),fixAvailable:v.fixAvailable}))};}catch{report.dependencyAudit={status:'BLOCKED',reason:'No parseable audit response; no vulnerability conclusion'};}
  if(report.source.sha256!==rehearsalSource(root).sha256)throw Error();report.status='PARTIAL';report.executedLocalTests='PASS';report.releaseReadiness='NOT READY';
 }catch{report.status='FAIL';report.error='Verification stopped; review fixed command status and safe failure names. No production operation performed.';}
 finally{report.finishedAt=new Date().toISOString();save();console.log('T14 evidence '+join(output,'verification.json'));}
 process.exitCode=report.status==='FAIL'?1:0;
}
main().catch(()=>{console.error('Use --output <new directory outside checkout>. Local Node/npm and Docker are required. No production target is accepted.');process.exitCode=1;});
