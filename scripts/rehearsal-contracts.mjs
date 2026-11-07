import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,lstatSync} from 'node:fs';
import {join,relative} from 'node:path';

const fail=()=>{throw Error('Invalid local rehearsal contract. Only isolated local simulation is supported.');};
export const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function validateImageLock(value){
 if(!value||value.version!==1||value.mode!=='LOCAL_SIMULATION'||Object.keys(value).sort().join(',')!=='images,mode,version')fail();
 if(!value.images||Object.keys(value.images).sort().join(',')!=='api,edge,web')fail();
 for(const id of Object.values(value.images))if(typeof id!=='string'||!/^sha256:[a-f0-9]{64}$/.test(id))fail();
 return value;
}
export function readImageLock(path){const s=lstatSync(path);if(!s.isFile()||s.isSymbolicLink()||s.size>4096)fail();return validateImageLock(JSON.parse(readFileSync(path,'utf8')));}
// A content snapshot, never a fabricated Git commit or release provenance claim.
export function rehearsalSource(root){
 const files=[];
 function walk(path){for(const name of readdirSync(path).sort()){const full=join(path,name),s=lstatSync(full);if(s.isSymbolicLink())fail();if(s.isDirectory())walk(full);else files.push({name:relative(root,full).replaceAll('\\','/'),sha256:hash(readFileSync(full))});}}
 for(const path of ['apps/api/src','apps/api/migrations','dist','scripts','apps/api/test','tests'])walk(join(root,path));
 for(const name of ['Dockerfile','.dockerignore','.node-version','package.json','package-lock.json','apps/api/package.json','docker-compose.production.yml','docker-compose.edge.yml'])files.push({name,sha256:hash(readFileSync(join(root,name)))});
 walk(join(root,'docker'));
 files.sort((a,b)=>a.name.localeCompare(b.name));return {kind:'WORKSPACE_CONTENT_SNAPSHOT_NOT_COMMIT',sha256:hash(JSON.stringify(files)),files};
}
export function safeEnvironment(env){
 const out={};for(const key of ['PATH','Path','SystemRoot','SYSTEMROOT','WINDIR','TEMP','TMP','TMPDIR','HOME','USERPROFILE','LOCALAPPDATA','APPDATA','ProgramFiles','ProgramFiles(x86)','COMSPEC','PATHEXT','BROWSER_PATH'])if(typeof env[key]==='string')out[key]=env[key];
 // Never inherit DATABASE_URL, deployment/provider/SMTP tokens, custom Docker targets,
 // NODE_OPTIONS/preloads, live-test flags or external browser-debug endpoints.
 return out;
}
