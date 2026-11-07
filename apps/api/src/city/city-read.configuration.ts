import { isLoopback, RegistryConfiguration } from '../agents/registry-configuration';
export interface CityReadConfiguration {readonly token:string}
export function cityReadEnvironment(env:Readonly<Record<string,string|undefined>>,nodeEnv:string,host:string,
  registry:RegistryConfiguration|undefined,errors:string[],authenticated=false):CityReadConfiguration|undefined {
  if(env.CITY_READ_ENABLED!==undefined&&!['true','false'].includes(env.CITY_READ_ENABLED))errors.push('CITY_READ_ENABLED');
  if(env.CITY_READ_ENABLED!=='true')return undefined;
  if(!registry||!authenticated&&(!['development','test'].includes(nodeEnv)||!isLoopback(host)))errors.push('CITY_READ_ENABLED');
  const token=env.CITY_READ_TOKEN??'';
  if(!authenticated&&(!/^[A-Za-z0-9_-]{32,128}$/.test(token)||token===registry?.token))errors.push('CITY_READ_TOKEN');
  if(env.CITY_READ_CITY_ID!==undefined&&env.CITY_READ_CITY_ID!=='elyqreth')errors.push('CITY_READ_CITY_ID');
  return Object.freeze({token});
}
