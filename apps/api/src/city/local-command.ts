import 'reflect-metadata';
import { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { loadConfiguration } from '../config/configuration';
import { BindingError, createCommand, listQuery, npcId, reassignCommand, removeCommand, uuid } from './binding.contract';
import { AgentNpcBindingService, assertLocalBindings } from './binding.service';

export function bindingOptions(args:readonly string[]) {
  const action=args[0],values:Record<string,string>={};
  const keys:Record<string,string>={'--agent-id':'agentId','--npc-id':'npcId','--binding-id':'bindingId','--revision':'revision','--limit':'limit','--after':'after','--include-disabled':'includeDisabled'};
  for(let i=1;i<args.length;i+=2){const key=keys[args[i]!],value=args[i+1];
    if(!key||key in values||value===undefined||value.startsWith('--'))throw new BindingError('INVALID_COMMAND');values[key]=value;}
  if(action==='create')return {action,value:createCommand(values)} as const;
  if(action==='remove')return {action,value:removeCommand(values)} as const;
  if(action==='reassign')return {action,value:reassignCommand(values)} as const;
  if(action==='by-agent'&&Object.keys(values).length===1)return {action,value:uuid(values.agentId)} as const;
  if(action==='by-npc'&&Object.keys(values).length===1)return {action,value:npcId(values.npcId)} as const;
  if(action==='list'){
    if(Object.keys(values).some(k=>!['limit','after','includeDisabled'].includes(k))||
      (values.limit!==undefined&&!/^\d{1,2}$/.test(values.limit))||
      (values.includeDisabled!==undefined&&!['true','false'].includes(values.includeDisabled)))throw new BindingError('INVALID_COMMAND');
    return {action,value:listQuery({...(values.limit===undefined?{}:{limit:Number(values.limit)}),...(values.after===undefined?{}:{after:values.after}),
      ...(values.includeDisabled===undefined?{}:{includeDisabled:values.includeDisabled==='true'})})} as const;
  }
  throw new BindingError('INVALID_COMMAND');
}
export async function bindingMain(args=process.argv.slice(2)):Promise<void> {
  let app:INestApplicationContext|undefined;
  try {
    const options=bindingOptions(args),config=loadConfiguration();assertLocalBindings(config);
    app=await NestFactory.createApplicationContext(AppModule.register(config),{logger:false,abortOnError:false});
    const service=app.get(AgentNpcBindingService);
    const result=options.action==='create'?await service.create(options.value):options.action==='remove'?await service.remove(options.value):
      options.action==='reassign'?await service.reassign(options.value):options.action==='by-agent'?await service.byAgent(options.value):
      options.action==='by-npc'?await service.byNpc(options.value):await service.list(options.value);
    process.stdout.write(JSON.stringify(result)+'\n');
  } catch(error) {
    process.stderr.write(JSON.stringify({error:(error instanceof BindingError?error:new BindingError('PERSISTENCE_UNAVAILABLE')).toJSON()})+'\n');
    process.exitCode=1;
  } finally {
    try {await app?.close();}catch{process.stderr.write(JSON.stringify({error:new BindingError('PERSISTENCE_UNAVAILABLE').toJSON()})+'\n');process.exitCode=1;}
  }
}
if(require.main===module)void bindingMain();
