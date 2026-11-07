import { isUUID } from 'class-validator';
import { isLoopback, RegistryConfiguration } from '../agents/registry-configuration';
import type { CityReadConfiguration } from '../city/city-read.configuration';

export interface InteractionConfiguration {readonly token:string;readonly agentIds:readonly string[];readonly textAgentIds:readonly string[]}
export function interactionEnvironment(env:Readonly<Record<string,string|undefined>>,nodeEnv:string,host:string,
 registry:RegistryConfiguration|undefined,city:CityReadConfiguration|undefined,errors:string[]):InteractionConfiguration|undefined {
 if(env.CITY_INTERACTION_ENABLED!==undefined&&!['true','false'].includes(env.CITY_INTERACTION_ENABLED))errors.push('CITY_INTERACTION_ENABLED');
 if(env.CITY_INTERACTION_ENABLED!=='true')return undefined;
 if(!registry||!['test','development'].includes(nodeEnv)||!isLoopback(host))errors.push('CITY_INTERACTION_ENABLED');
 const token=env.CITY_INTERACTION_TOKEN??'';
 if(!/^[A-Za-z0-9_-]{32,128}$/.test(token)||token===registry?.token||token===city?.token)errors.push('CITY_INTERACTION_TOKEN');
 const ids=(name:string,optional=false):readonly string[]=>{
  try{const text=env[name]??(optional?'[]':'');if(Buffer.byteLength(text)>1600)throw 0;const value:unknown=JSON.parse(text);
   if(!Array.isArray(value)||value.length>20||!optional&&!value.length||value.some(id=>typeof id!=='string'||!isUUID(id)))throw 0;
   const normalized=(value as string[]).map(id=>id.toLowerCase());if(new Set(normalized).size!==normalized.length)throw 0;return Object.freeze(normalized.sort());
  }catch{errors.push(name);return Object.freeze([]);}
 };
 const agentIds=ids('CITY_INTERACTION_AGENT_IDS'),textAgentIds=ids('CITY_INTERACTION_TEXT_AGENT_IDS',true);
 if(textAgentIds.some(id=>!agentIds.includes(id)))errors.push('CITY_INTERACTION_TEXT_AGENT_IDS');
 return Object.freeze({token,agentIds,textAgentIds});
}
