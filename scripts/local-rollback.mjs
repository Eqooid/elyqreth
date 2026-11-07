import assert from 'node:assert/strict';
import {readFileSync,existsSync,writeFileSync} from 'node:fs';import {join} from 'node:path';
export function validateLocalSelection(value){
 if(value?.version!==1||Object.keys(value).sort().join(',')!=='images,mode,schemaHash,variant,version'||value.mode!=='LOCAL_METADATA_VARIANTS'||!['A','B'].includes(value.variant)||!/^([a-f0-9]{64})$/.test(value.schemaHash??'')||Object.keys(value.images??{}).sort().join(',')!=='api,edge,web'||Object.values(value.images).some(v=>!/^sha256:[a-f0-9]{64}$/.test(v)))throw Error('Invalid local rollback selection');return value;
}
export function compatibleRollback(previous,current,actualSchemaHash){validateLocalSelection(previous);validateLocalSelection(current);if(previous.variant===current.variant||JSON.stringify(previous.images)===JSON.stringify(current.images)||previous.schemaHash!==current.schemaHash||previous.schemaHash!==actualSchemaHash)throw Error('Local rollback compatibility denied');return previous;}
export async function verifyLocalRollback(c){
 const {docker,input,api,apiArgs,apiImage,webImage,edgeImage,folder,network,id,label,restrictions,password,agent,work,evidence,waitFor,sql}=c;
 assert.ok(existsSync(join(folder,'edge.crt')),'Local rollback requires --edge first');
 const {createHash}=await import('node:crypto');const schema=async()=>createHash('sha256').update(await sql('SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at')).digest('hex');
 const fingerprint=await schema(),prefix='elyqreth_rollback_'+id,net=prefix+'_net',tls=prefix+'_tls',web=prefix+'_web',edge=prefix+'_edge';
 const madeImages=[],imageContainers=[],volumes=[],nets=[];let currentApi=api;
 const report={status:'RUNNING',mode:'LOCAL_METADATA_VARIANTS',scope:'Real A-to-B-to-A API/web/edge container replacement using committed metadata-only variants of the same existing base images. No previous published release, code/schema downgrade, registry digest, provenance or production rollback is claimed.',baseImages:{api:apiImage,web:webImage,edge:edgeImage},selections:[],transitions:[],negativeChecks:[]};
 const owned=async name=>{const s=JSON.parse(await docker('inspect',name))[0];assert.equal(s.Config.Labels['elyqreth.t05.run'],id);return s;};
 const remove=async name=>{try{await owned(name);await docker('rm','-f',name);}catch(e){if(!String(e).includes('No such'))throw e;}};
 const drain=async()=>{const state=await owned(api);if(!state.State.Running)return;await docker('kill','--signal','SIGUSR2',api);await waitFor(async()=>{try{await docker('exec',api,'node','docker/api-health.cjs');return false;}catch{return true;}},'Rollback drain did not remove readiness');await docker('stop','--time','45',api);const stopped=await owned(api);assert.ok([0,143].includes(stopped.State.ExitCode));};
 // Resolve mutable discovery names once; all variants and cleanup then use these
 // content identities. The existing fixture API must match that baseline.
 for(const [target,ref]of Object.entries(report.baseImages)){
  const info=JSON.parse(await docker('image','inspect',ref))[0];assert.match(info.Id,/^sha256:[a-f0-9]{64}$/);report.baseImages[target]=info.Id;
 }
 assert.equal((await owned(api)).Image,report.baseImages.api);
 try{
  for(const variant of ['A','B']){
   const images={};for(const [target,base]of Object.entries(report.baseImages)){const name=prefix+'_'+variant+'_'+target;imageContainers.push(name);await docker('create','--name',name,'--label',label,'--network','none',base);const image=await docker('commit','--change','LABEL org.elyqreth.local-rehearsal='+id+'-'+variant,name);assert.match(image,/^sha256:[a-f0-9]{64}$/);images[target]=image;madeImages.push(image);await remove(name);}
   const selection=validateLocalSelection({version:1,mode:report.mode,variant,images,schemaHash:fingerprint});report.selections.push(selection);writeFileSync(join(folder,'rollback-'+variant+'.json'),JSON.stringify(selection),{mode:0o600});
  }
  const [a,b]=report.selections;assert.notDeepEqual(a.images,b.images);
  await assert.rejects(docker('image','inspect','sha256:'+'0'.repeat(64)));report.negativeChecks.push('Unavailable local image fails identity preflight without changing current API');
  assert.throws(()=>compatibleRollback({...a,schemaHash:'f'.repeat(64)},b,fingerprint));report.negativeChecks.push('Mismatched schema fingerprint rejected before replacement');
  await docker('network','create','--internal','--label',label,net);nets.push(net);await docker('volume','create','--label',label,tls);volumes.push(tls);
  await docker('run','--rm','--label',label,'--network','none','--user','0','--mount',`type=bind,src=${folder},dst=/input,readonly`,'--mount',`type=volume,src=${tls},dst=/output`,'--entrypoint','sh',a.images.edge,'-c','cp /input/edge.crt /output/tls_certificate; cp /input/edge.key /output/tls_private_key; chown 0:101 /output/*; chmod 0440 /output/*');
  writeFileSync(join(folder,'rollback-access.json'),JSON.stringify({mode:'local'}));
  for(const selection of [a,b,a]){
   if(report.transitions.length===2)compatibleRollback(a,b,await schema());else assert.equal(await schema(),fingerprint);
   await drain();await remove(api);currentApi=undefined;await remove(web);await remove(edge);
   await docker('run','-d',...apiArgs(api),selection.images.api);currentApi=api;await docker('network','connect','--alias','api',net,api);await waitFor(async()=>docker('exec',api,'node','docker/api-health.cjs').then(()=>true),'Selected API did not become ready');
   await docker('run','-d','--name',web,'--label',label,'--network',net,'--network-alias','web',...restrictions,'--memory','128m','--mount',`type=bind,src=${join(folder,'rollback-access.json')},dst=/run/config/access-config.json,readonly`,selection.images.web);
   await waitFor(async()=>JSON.parse(await docker('inspect',web))[0].State.Health?.Status==='healthy','Selected web not ready');
   await docker('run','-d','--name',edge,'--label',label,'--network',net,'--network-alias','edge',...restrictions,'--memory','128m','--mount',`type=volume,src=${tls},dst=/run/secrets,readonly`,'-e','EDGE_HOST=city.example.invalid','-e','EDGE_HTTPS_PORT=443','-e','EDGE_HSTS=off',selection.images.edge);
   await waitFor(async()=>JSON.parse(await docker('inspect',edge))[0].State.Health?.Status==='healthy','Selected edge not ready');
   for(const [name,target]of [[api,'api'],[web,'web'],[edge,'edge']])assert.equal((await owned(name)).Image,selection.images[target]);
   const probe=`let raw='';process.stdin.on('data',b=>raw+=b);process.stdin.on('end',async()=>{try{const v=JSON.parse(raw),base='http://127.0.0.1:3001/api/v1',r=await fetch(base+'/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'operator',password:v.password})});if(r.status!==200)throw Error();const token=(await r.json()).accessToken;const get=path=>new Promise((resolve,reject)=>{const req=require('https').get({host:'edge',port:8443,servername:'city.example.invalid',ca:v.ca,path,headers:{Host:'city.example.invalid',Authorization:'Bearer '+token},timeout:5000},res=>{let body='';res.on('data',b=>{body+=b;if(body.length>1024*1024)res.destroy(Error());});res.on('end',()=>resolve({status:res.statusCode,body}));});req.on('error',reject);req.on('timeout',()=>req.destroy(Error()));});if((await get('/')).status!==200)throw Error();const me=await get('/api/v1/auth/me');if(me.status!==200||JSON.parse(me.body).role!=='operator')throw Error();if((await get('/ready')).status!==404)throw Error();const task=await fetch(base+'/tasks/'+v.taskId,{headers:{Authorization:'Bearer '+token}});if(task.status!==200)throw Error();await fetch(base+'/auth/logout',{method:'POST',headers:{Authorization:'Bearer '+token}});console.log('safe-authenticated-smoke-pass');}catch{console.error('Local rollback smoke failed');process.exitCode=1;}});`;
   assert.equal(await input(['exec','-i',api,'node','-e',probe],JSON.stringify({password,ca:readFileSync(join(folder,'edge.crt'),'utf8'),taskId:work.taskId})),'safe-authenticated-smoke-pass');
   assert.equal(await sql(`SELECT status FROM executions WHERE id='${work.executionId}'`),'SUCCEEDED');assert.equal(await sql(`SELECT count(*) FROM executions WHERE task_id='${work.taskId}'`),'1');assert.equal(await schema(),fingerprint);
   report.transitions.push({variant:selection.variant,images:selection.images,apiReady:true,webReady:true,edgeReady:true,authenticatedTlsSmoke:true,schemaUnchanged:true,oneDurableExecution:true,observedAt:new Date().toISOString()});
   if(report.transitions.length===1){const bad=prefix+'_bad';imageContainers.push(bad);await docker('run','-d',...apiArgs(bad,{DATABASE_URL_FILE:'/run/secrets/absent'}),b.images.api);assert.equal(await docker('wait',bad),'1');await remove(bad);await docker('exec',api,'node','docker/api-health.cjs');report.negativeChecks.push('Invalid candidate configuration exits before readiness; current A remains healthy');}
  }
  report.status='LOCAL_VARIANT_ROLLBACK_VERIFIED';evidence.checks.push('T15 actual local A/B/A API-web-edge metadata-variant replacement, native drain, private TLS/account smoke and one durable Execution; not a previous published release rollback');evidence.localRollback=report;
 }finally{
  await remove(web);await remove(edge);if(currentApi){await drain();await remove(api);}await docker('run','-d',...apiArgs(api),report.baseImages.api);await waitFor(async()=>docker('exec',api,'node','docker/api-health.cjs').then(()=>true),'Original fixture API did not recover');
  for(const name of imageContainers)await remove(name);
  for(const image of madeImages){const info=JSON.parse(await docker('image','inspect',image))[0];assert.ok(info.Config.Labels['org.elyqreth.local-rehearsal'].startsWith(id+'-'));await docker('image','rm',image);}
  for(const name of nets){const s=JSON.parse(await docker('network','inspect',name))[0];assert.equal(s.Labels['elyqreth.t05.run'],id);await docker('network','rm',name);}
  for(const name of volumes){const s=JSON.parse(await docker('volume','inspect',name))[0];assert.equal(s.Labels['elyqreth.t05.run'],id);await docker('volume','rm',name);}
 }
}
