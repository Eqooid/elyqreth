import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:net';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join,dirname,basename} from 'node:path';
const run=promisify(execFile),project='elyqreth_docker_test_'+randomBytes(8).toString('hex');
const folder=mkdtempSync(join(tmpdir(),'elyqreth-docker-smoke-')),envFile=join(folder,'compose.env');
async function port(){const server=createServer();await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));const p=server.address().port;await new Promise(resolve=>server.close(resolve));return p;}
const webPort=await port(),apiPort=await port(),pgPort=await port();
const env={...process.env,POSTGRES_USER:'elyqreth',POSTGRES_DB:'elyqreth',POSTGRES_PASSWORD:randomBytes(24).toString('hex'),WEB_PORT:String(webPort),API_PORT:String(apiPort),POSTGRES_PORT:String(pgPort)};
writeFileSync(envFile,'# Disposable isolated test; values supplied through child environment.\n',{mode:0o600});
const args=['compose','--project-name',project,'--env-file',envFile,'--file',resolve('docker-compose.yml')];
const compose=async(...extra)=>(await run('docker',[...args,...extra],{env,timeout:240000,maxBuffer:8*1024*1024,windowsHide:true})).stdout.trim();
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function healthy(url){for(let i=0;i<60;i++){try{const response=await fetch(url,{signal:AbortSignal.timeout(2000)});if(response.ok)return;}catch{}await wait(1000);}throw new Error('Container HTTP health check failed');}
try{
 await compose('config','--quiet');await compose('up','--build','--detach');
 const web=`http://127.0.0.1:${webPort}`,api=`http://127.0.0.1:${apiPort}`;
 await Promise.all([healthy(web+'/health'),healthy(api+'/health')]);
 const html=await (await fetch(web)).text();assert.match(html,/ELYQRETH/i);
 for(const path of ['/js/app.js','/js/runtime/index.js','/assets/characters.png'])assert.equal((await fetch(web+path)).status,200);
 assert.equal((await fetch(api+'/api/v1/agents')).status,404,'Protected registry must remain disabled in the bridged container');
 assert.equal((await fetch(web+'/api/v1/agents')).status,404,'No implicit API proxy');
 assert.equal((await fetch(web+'/.env')).status,403);
 assert.notEqual(await compose('exec','-T','web','id','-u'),'0');assert.notEqual(await compose('exec','-T','api','id','-u'),'0');
 await compose('exec','-T','api','node','-e',"const {createRequire}=require('node:module');const r=createRequire(require.resolve('@nestjs/platform-express/package.json'));for(const [name,minor,loader]of[['multer',5,r],['body-parser',4,createRequire(r.resolve('express/package.json'))]]){const [a,b]=loader(name+'/package.json').version.split('.').map(Number);if(!(a>2||a===2&&b>=minor))process.exit(1);}");
 const migrationCount=await compose('exec','-T','postgres','psql','-U','elyqreth','-d','elyqreth','-tAc','SELECT count(*) FROM drizzle.__drizzle_migrations');
 assert.equal(Number(migrationCount),JSON.parse(readFileSync('apps/api/migrations/meta/_journal.json','utf8')).entries.length);
 const browser=await run(process.execPath,['scripts/browser-smoke.mjs'],{env:{...env,BROWSER_BASE_URL:web},timeout:120000,maxBuffer:2*1024*1024,windowsHide:true});
 console.log(browser.stdout.trim());
 console.log(JSON.stringify({status:'PASS',dockerCompose:true,migrations:Number(migrationCount),nonRoot:true,protectedRuntime:'disabled',isolatedProject:project}));
}finally{
 assert.match(project,/^elyqreth_docker_test_[a-f0-9]{16}$/);
 try{await compose('down','--volumes','--remove-orphans');}finally{
  assert.equal(dirname(resolve(folder)),resolve(tmpdir()));assert.ok(basename(folder).startsWith('elyqreth-docker-smoke-'));
  rmSync(folder,{recursive:true,force:true});
 }
}
