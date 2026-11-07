import { operationalMode } from '../auth/principal';
import { Injectable } from '@nestjs/common';
import { ApiConfig } from '../config/config.module';
import { ApiConfiguration } from '../config/configuration';
import { isLoopback } from '../agents/registry-configuration';
import { BindingError, createCommand, listQuery, npcId, reassignCommand, removeCommand, uuid } from './binding.contract';
import { AgentNpcBindingRepository, BindingTransaction } from './binding.repository';

export function assertLocalBindings(c:ApiConfiguration):string {
  if(!operationalMode(c)||!c.database||!c.registry)throw new BindingError('ACCESS_DENIED');
  return uuid(c.registry.ownerId);
}

@Injectable()
export class AgentNpcBindingService {
  constructor(private readonly config:ApiConfig,private readonly repository:AgentNpcBindingRepository) {}
  private scope():string {
    return assertLocalBindings(this.config.value);
  }
  private async createIn(tx:BindingTransaction,agentId:string,npc:string) {
    const agent=await tx.agent(agentId),existing=await tx.find('agentId',agentId,true);
    if(existing){if(existing.npcId===npc&&existing.visualizationMode==='PASSIVE')return existing;throw new BindingError('CONFLICT');}
    if(agent.status==='ARCHIVED')throw new BindingError('AGENT_UNAVAILABLE');
    if(await tx.find('npcId',npc,true))throw new BindingError('CONFLICT');
    return tx.insert(agentId,npc);
  }
  async create(value:unknown) {
    const owner=this.scope(),command=createCommand(value);
    return this.repository.run(owner,true,tx=>this.createIn(tx,command.agentId,command.npcId));
  }
  async remove(value:unknown) {
    const owner=this.scope(),command=removeCommand(value);
    return this.repository.run(owner,true,async tx=>{
      const row=await tx.find('id',command.bindingId);if(!row)throw new BindingError('NOT_FOUND');
      if(!row.enabled)return row; // Exact binding-ID retries cannot affect a replacement row.
      if(row.revision!==command.revision)throw new BindingError('CONFLICT');
      return tx.disable(row.id);
    });
  }
  async reassign(value:unknown) {
    const owner=this.scope(),command=reassignCommand(value);
    return this.repository.run(owner,true,async tx=>{
      const row=await tx.find('id',command.bindingId);if(!row)throw new BindingError('NOT_FOUND');
      if(!row.enabled||row.revision!==command.revision)throw new BindingError('CONFLICT');
      if(row.agentId===command.agentId&&row.npcId===command.npcId)return row;
      const agentBinding=await tx.find('agentId',command.agentId,true),npcBinding=await tx.find('npcId',command.npcId,true);
      if((agentBinding&&agentBinding.id!==row.id)||(npcBinding&&npcBinding.id!==row.id))throw new BindingError('CONFLICT');
      await tx.disable(row.id);
      return this.createIn(tx,command.agentId,command.npcId); // Conflict rolls back disable + audit.
    });
  }
  async byAgent(value:unknown) {
    const owner=this.scope(),id=uuid(value);
    return this.repository.run(owner,false,async tx=>{await tx.agent(id);return tx.find('agentId',id,true);});
  }
  async byNpc(value:unknown) {
    const owner=this.scope(),id=npcId(value);return this.repository.run(owner,false,tx=>tx.find('npcId',id,true));
  }
  async list(value:unknown={}) {
    const owner=this.scope(),q=listQuery(value);return this.repository.run(owner,false,tx=>tx.list(q.limit,q.after,q.includeDisabled));
  }
  async exists(value:unknown) {return (await this.byAgent(value))!==null;}
}
