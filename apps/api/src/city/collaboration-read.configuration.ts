import { isLoopback,RegistryConfiguration } from '../agents/registry-configuration';
export interface CollaborationReadConfiguration {readonly token:string}
export function collaborationReadEnvironment(env:Readonly<Record<string,string|undefined>>,nodeEnv:string,host:string,registry:RegistryConfiguration|undefined,otherTokens:readonly (string|undefined)[],errors:string[],authenticated=false):CollaborationReadConfiguration|undefined{
 if(env.COLLABORATION_READ_ENABLED!==undefined&&!['true','false'].includes(env.COLLABORATION_READ_ENABLED))errors.push('COLLABORATION_READ_ENABLED');
 if(env.COLLABORATION_READ_ENABLED!=='true')return undefined;
 if(!registry||!authenticated&&(!['test','development'].includes(nodeEnv)||!isLoopback(host)))errors.push('COLLABORATION_READ_ENABLED');
 const token=env.COLLABORATION_READ_TOKEN??'';
 if(!authenticated&&(!/^[A-Za-z0-9_-]{32,128}$/.test(token)||[registry?.token,...otherTokens].includes(token)))errors.push('COLLABORATION_READ_TOKEN');
 return Object.freeze({token});
}
