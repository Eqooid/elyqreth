import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {mkdirSync,writeFileSync,readFileSync,createReadStream,existsSync,statSync} from 'node:fs';
import {resolve,join} from 'node:path';import {randomUUID,createHash} from 'node:crypto';
import {safeEnvironment} from './rehearsal-contracts.mjs';import {newOutsideOutput} from './rehearsal-output.mjs';
import {scannerImage,scannerVersion,summarizeScan} from './release/scan.mjs';
const run=promisify(execFile),root=resolve(import.meta.dirname,'..'),args=process.argv.slice(2);
const digest=async file=>{const h=createHash('sha256');for await(const b of createReadStream(file))h.update(b);return h.digest('hex');};
async function main(){
 if(args.length!==2||args[0]!=='--output')throw Error();const folder=newOutsideOutput(root,args[1]);mkdirSync(folder,{mode:0o700});
 for(const dir of ['archives','reports','cache'])mkdirSync(join(folder,dir),{mode:0o700});
 const env=safeEnvironment(process.env);env.DOCKER_HOST=process.platform==='win32'?'npipe:////./pipe/dockerDesktopLinuxEngine':'unix:///var/run/docker.sock';
 const id=randomUUID(),names=[],report={version:1,scope:'LOCAL_UNPUBLISHED_VERIFICATION_IMAGES',status:'RUNNING',startedAt:new Date().toISOString(),scanner:{image:scannerImage,expectedVersion:scannerVersion},images:[],commands:[]};
 const save=()=>writeFileSync(join(folder,'scan-evidence.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
 async function docker(argv,timeout=600000){const {stdout}=await run('docker',argv,{cwd:root,env,windowsHide:true,timeout,maxBuffer:4*1024*1024});return stdout.trim();}
 async function scanRun(label,argv,network){const name='elyqreth_scan_'+id.replaceAll('-','')+'_'+label;names.push(name);const command=['run','--rm','--name',name,'--label','elyqreth.scan.run='+id,'--network',network,'--read-only','--cap-drop=ALL','--security-opt=no-new-privileges:true','--user','1000:1000','--pids-limit','128','--memory','1g','--cpus','2','--tmpfs','/tmp:rw,noexec,nosuid,size=512m','--mount',`type=bind,src=${join(folder,'archives')},dst=/input,readonly`,'--mount',`type=bind,src=${join(folder,'reports')},dst=/output`,'--mount',`type=bind,src=${join(folder,'cache')},dst=/cache`,scannerImage,'--cache-dir','/cache',...argv];report.commands.push({operation:label,executable:'docker',argv:command,network});save();return docker(command);}
 try{
  await docker(['image','inspect',scannerImage]);
  const version=await scanRun('version',['--version'],'none');if(!version.includes(scannerVersion))throw Error();report.scanner.actualVersion=version;
  await scanRun('database',['image','--download-db-only','--no-progress','--timeout','5m'],'bridge');
  const metadata=join(folder,'cache/db/metadata.json');if(!existsSync(metadata))throw Error();report.scanner.database=JSON.parse(readFileSync(metadata,'utf8'));report.scanner.databaseMetadataSha256=await digest(metadata);report.scanner.databaseSha256=await digest(join(folder,'cache/db/trivy.db'));
  for(const [target,tag]of Object.entries({api:'elyqreth-t05-api:verification',web:'elyqreth-t05-web:verification',edge:'elyqreth-t06-edge:verification'})){
   console.log('Scanning local '+target);const info=JSON.parse(await docker(['image','inspect',tag]))[0],imageId=info.Id;if(!/^sha256:[a-f0-9]{64}$/.test(imageId))throw Error();
   const archive=join(folder,'archives',target+'.tar');await docker(['image','save','--output',archive,imageId]);
   await scanRun(target,['image','--input','/input/'+target+'.tar','--skip-db-update','--skip-java-db-update','--offline-scan','--scanners','vuln,secret','--format','json','--output','/output/'+target+'.json','--no-progress','--timeout','5m'],'none');
   const raw=join(folder,'reports',target+'.json'),summary=summarizeScan(JSON.parse(readFileSync(raw,'utf8')),imageId);if(target==='api'&&!summary.coverage.some(r=>r.type==='node-pkg'&&r.packages>0))throw Error();report.images.push({target,...summary,archiveSha256:await digest(archive),archiveBytes:statSync(archive).size,rawReportSha256:await digest(raw),scannedAt:new Date().toISOString()});save();
  }
  if(report.scanner.databaseSha256!==await digest(join(folder,'cache/db/trivy.db')))throw Error();
  report.status=report.images.some(image=>image.releaseBlocking)?'FAILED_SECURITY_GATE':'SCANNED_NO_HIGH_CRITICAL';
 }catch{report.status='BLOCKED_TECHNICAL';report.error='Scanner command, database availability or identity validation failed. Partial results are not a clean scan.';}
 finally{
  for(const name of names){try{const state=JSON.parse(await docker(['inspect',name],30000))[0];if(state.Config.Labels['elyqreth.scan.run']!==id)throw Error();await docker(['rm','-f',name],30000);}catch(e){if(!String(e).includes('No such')){report.cleanupWarning=true;report.status='BLOCKED_TECHNICAL';}}}
  report.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({status:report.status,evidence:join(folder,'scan-evidence.json')}));
 }
 process.exitCode=report.status==='SCANNED_NO_HIGH_CRITICAL'?0:report.status==='FAILED_SECURITY_GATE'?2:1;
}
main().catch(()=>{console.error('Local scan requires the pinned scanner image, local Docker and a fresh --output directory outside checkout; no publication/deployment occurs.');process.exitCode=1;});
