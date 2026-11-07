import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {safeEnvironment} from './rehearsal-contracts.mjs';
const root=resolve(import.meta.dirname,'..'),folder=mkdtempSync(join(tmpdir(),'elyqreth-t15-compose-'));
try{
 const env=safeEnvironment(process.env),fixture=join(folder,'inert-placeholder');writeFileSync(fixture,'INERT CONFIGURATION FIXTURE; NOT A CREDENTIAL OR CERTIFICATE\n',{mode:0o600});
 writeFileSync(join(folder,'compose.env'),'# Explicit empty interpolation fixture\n');
 Object.assign(env,{API_IMAGE:'registry.invalid/fixture/api@sha256:'+'a'.repeat(64),WEB_IMAGE:'registry.invalid/fixture/web@sha256:'+'b'.repeat(64),EDGE_IMAGE:'registry.invalid/fixture/edge@sha256:'+'c'.repeat(64),API_CONFIGURATION_FILE:join(root,'docker/production-api.env.example'),DATABASE_URL_SECRET_FILE:fixture,MIGRATION_DATABASE_URL_SECRET_FILE:fixture,DATABASE_CA_FILE:fixture,EDGE_TLS_CERTIFICATE_FILE:fixture,EDGE_TLS_PRIVATE_KEY_FILE:fixture,PUBLIC_ACCESS_CONFIG_FILE:join(root,'dist/access-config.json'),PUBLIC_ORIGIN:'https://city.example.invalid',EDGE_HOST:'city.example.invalid',DATABASE_MIGRATION_TARGET:'elyqreth',DOCKER_HOST:process.platform==='win32'?'npipe:////./pipe/dockerDesktopLinuxEngine':'unix:///var/run/docker.sock'});
 const args=['compose','--env-file',join(folder,'compose.env'),'-f',join(root,'docker-compose.production.yml'),'-f',join(root,'docker-compose.edge.yml'),'--profile','maintenance','config','--format','json'];
 const {stdout}=await promisify(execFile)('docker',args,{cwd:root,env,timeout:30000,maxBuffer:2*1024*1024,windowsHide:true});const config=JSON.parse(stdout);
 assert.deepEqual(Object.keys(config.services).sort(),['api','edge','migrate','web']);
 for(const [name,service]of Object.entries(config.services)){assert.equal(service.read_only,true);assert.ok(service.cap_drop.includes('ALL'));assert.ok(service.security_opt.includes('no-new-privileges:true'));assert.ok(service.mem_limit>0&&service.pids_limit>0);if(name!=='edge')assert.ok(!service.ports?.length);}
 assert.deepEqual(config.services.edge.ports.map(p=>Number(p.published)).sort((a,b)=>a-b),[80,443]);
 assert.equal(config.services.migrate.image,config.services.api.image);assert.deepEqual(config.services.api.secrets.map(s=>s.source),['database_url']);assert.deepEqual(config.services.migrate.secrets.map(s=>s.source),['migration_database_url']);
 assert.equal(config.networks.presentation.internal,true);assert.equal(config.networks.edge_api.internal,true);
 console.log(JSON.stringify({status:'PASS',scope:'Offline Compose syntax/wiring with inert placeholders. No daemon connection, pull, startup, credential/TLS validation or production preflight.',services:4,publishedServices:['edge'],migrationImageMatchesApi:true}));
}catch{console.error('Offline Compose fixture validation failed; no production access or mutation was performed.');process.exitCode=1;}
finally{assert.equal(dirname(resolve(folder)),resolve(tmpdir()));assert.ok(basename(folder).startsWith('elyqreth-t15-compose-'));rmSync(folder,{recursive:true,force:true});}
