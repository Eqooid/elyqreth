import { constants, openSync, fstatSync, readSync, closeSync } from 'node:fs';
import { isAbsolute, dirname, resolve } from 'node:path';

export class FileInputError extends Error {
  constructor(readonly field:string){super(`Invalid configuration file: ${field}`);}
}
/** Exact backend-only file inputs. Resolve into a copy, never process.env or public DTOs. */
export const SECRET_FIELDS=Object.freeze(['DATABASE_URL','AGENT_REGISTRY_TOKEN','CITY_READ_TOKEN','CITY_INTERACTION_TOKEN',
 'COLLABORATION_READ_TOKEN']);
export function readConfigurationFile(path:string,field:string,production:boolean,secret:boolean,limit=65536):string{
 let fd:number|undefined;
 try{
  if(!isAbsolute(path)||production&&secret&&dirname(resolve(path))!=='/run/secrets')throw 0;
  fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  const stat=fstatSync(fd);if(!stat.isFile()||stat.size<1||stat.size>limit)throw 0;
  if(production&&process.platform!=='win32'){
   if(stat.mode&0o022||secret&&stat.mode&0o004)throw 0;
   if(secret&&stat.uid!==0&&stat.uid!==process.getuid?.())throw 0;
  }
  const buffer=Buffer.alloc(limit+1);let size=0;
  while(size<buffer.length){const read=readSync(fd,buffer,size,buffer.length-size,null);if(!read)break;size+=read;}
  if(size>limit)throw 0;const bytes=buffer.subarray(0,size);
  const value=new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/\r?\n$/,'');
  if(!value||value.includes('\0'))throw 0;return value;
 }catch{throw new FileInputError(field);}finally{if(fd!==undefined)closeSync(fd);}
}
export function resolveFileInputs(environment:Readonly<Record<string,string|undefined>>):Record<string,string|undefined>{
 const env={...environment};
 const fields=new Set<string>(SECRET_FIELDS);
 for(const field of Object.keys(env))if(/^(?:[A-Z][A-Z0-9_]{0,47}_API_KEY|EXTERNAL_SECRET_[A-Z0-9_]{1,80})_FILE$/.test(field))fields.add(field.slice(0,-5));
 for(const key of fields){const field=key+'_FILE',path=env[field];if(path===undefined)continue;
  if(env[key]!==undefined)throw new FileInputError(field);
  env[key]=readConfigurationFile(path,field,env.NODE_ENV==='production',true);
 }
 return env;
}
