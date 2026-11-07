import {openSync,closeSync,fstatSync,readFileSync,lstatSync,realpathSync,constants} from 'node:fs';
import {isAbsolute,resolve} from 'node:path';
import {isIP} from 'node:net';

export const monitorConditions=Object.freeze(['database_readiness_unavailable','http_server_errors','runtime_drain_deadline','runtime_finalization_or_context_failure','shutdown_failure',
 'external_authentication_failures','external_provider_unavailable','ingestion_authorization_denied','ingestion_requires_reconciliation',
 'api_readiness_unavailable','monitor_source_unavailable','monitor_input_incomplete']);

export const fail=()=>{throw new Error('Invalid private monitor configuration or state. Review the email monitoring guide.');};
export function exact(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))fail();}
export function integer(value,min,max){if(!Number.isInteger(value)||value<min||value>max)fail();return value;}
export function absolute(value){if(typeof value!=='string'||!isAbsolute(value)||/[\r\n\0]/.test(value))fail();return resolve(value);}
export function privateFile(file,max=65536,privateMode=true){
 file=absolute(file);if(lstatSync(file).isSymbolicLink()||realpathSync(file)!==file)fail();
 const fd=openSync(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
 try{const stat=fstatSync(fd);if(!stat.isFile()||stat.nlink!==1||stat.size>max||stat.size<1)fail();
  if(process.platform!=='win32'&&(privateMode?((stat.mode&0o077)!==0||stat.uid!==process.getuid()):((stat.mode&0o022)!==0||![0,process.getuid()].includes(stat.uid))))fail();
  return readFileSync(fd,'utf8');}finally{closeSync(fd);}
}
function email(value){if(typeof value!=='string'||value.length>254||!/^[-a-zA-Z0-9_+.]+@(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/.test(value)||value.startsWith('.')||value.includes('..')||value.split('@')[0].endsWith('.'))fail();return value;}
export function validateConfig(value){
 exact(value,['enabled','intervalSeconds','windowSeconds','repeatSeconds','healthyChecks','stateDirectory','composeFiles','composeEnvFile','email']);
 if(typeof value.enabled!=='boolean')fail();
 const c={...value,intervalSeconds:integer(value.intervalSeconds??60,30,3600),windowSeconds:integer(value.windowSeconds??300,60,3600),repeatSeconds:integer(value.repeatSeconds??3600,300,86400),healthyChecks:integer(value.healthyChecks??2,2,10)};
 if(c.windowSeconds<c.intervalSeconds||c.repeatSeconds<c.windowSeconds)fail();
 c.stateDirectory=absolute(c.stateDirectory);
 if(!Array.isArray(c.composeFiles)||c.composeFiles.length<1||c.composeFiles.length>3)fail();c.composeFiles=c.composeFiles.map(absolute);
 if(c.composeEnvFile!==undefined)c.composeEnvFile=absolute(c.composeEnvFile);
 exact(c.email,['enabled','host','port','username','passwordFile','from','to','caFile','timeoutMs']);
 if(typeof c.email.enabled!=='boolean')fail();
 if(c.email.enabled){
  const e={...c.email};
  if(typeof e.host!=='string'||e.host.length>253||!isIP(e.host)&&!e.host.split('.').every(label=>/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label)))fail();
  e.port=integer(e.port??465,1,65535);e.timeoutMs=integer(e.timeoutMs??10000,1000,15000);
  if(typeof e.username!=='string'||!/^[\x21-\x7e]{1,160}$/.test(e.username))fail();
  e.passwordFile=absolute(e.passwordFile);if(e.caFile!==undefined)e.caFile=absolute(e.caFile);
  e.from=email(e.from);if(!Array.isArray(e.to)||e.to.length<1||e.to.length>5)fail();e.to=e.to.map(email);if(new Set(e.to.map(v=>v.toLowerCase())).size!==e.to.length)fail();c.email=e;
 }
 return c;
}
export function loadConfig(file){return validateConfig(JSON.parse(privateFile(file)));}
