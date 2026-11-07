import { ForbiddenException } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { ApiConfiguration } from '../config/configuration';
import type { PersistenceTransaction } from '../common/persistence';
import { cityAgentBindings as bindings } from '../database/schema';
import { CITY_ID, NPC_IDS } from '../city/binding.contract';
import { interactionPrincipal } from './interaction.context';

/** Revalidate and lock the binding within existing creation/admission/cancel
 * transactions, including idempotent creation replay. Finalization is never gated. */
export async function authorizeInteractionMutation(tx:PersistenceTransaction,config:ApiConfiguration,agentId:string,
 operation:'create'|'execute'|'cancel',deny:()=>never=()=>{throw new ForbiddenException();}):Promise<void> {
 const actor=interactionPrincipal();if(!actor)return;
 agentId=agentId.toLowerCase();
 if(actor.agentId!==agentId||actor.operation!==operation||actor.ownerId!==config.registry?.ownerId||!config.interaction?.agentIds.includes(agentId))deny();
 // Same lock/order as existing binding writers, before acquiring Agent locks.
 await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${actor.ownerId+':'+CITY_ID+':bindings'},0))`);
 const [binding]=await tx.select({id:bindings.id}).from(bindings).where(and(eq(bindings.ownerId,actor.ownerId),
  eq(bindings.agentId,agentId),eq(bindings.cityId,CITY_ID),eq(bindings.enabled,true),eq(bindings.visualizationMode,'PASSIVE'),inArray(bindings.npcId,[...NPC_IDS]))).for('share');
 if(!binding)deny();
}
