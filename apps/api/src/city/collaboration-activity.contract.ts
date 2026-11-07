import { BadRequestException,ConflictException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { identifier } from '../collaboration/collaboration.domain';
import { record } from '../runtime/contracts/validation';
export type ExecutionReference={authority:'NATIVE';executionId:string;taskId:string;agentId:string;status:string;version:number}|{authority:'EXTERNAL';mappingId:string;sourceId:string;connectionId:string;namespace:string;generation:number;externalAgentId:string;externalExecutionId:string;sourceStatus:string|null;status:string};
export interface ActivityItem {activityId:string;type:'DELEGATION'|'EXTERNAL_OBSERVATION';collaborationId:string|null;delegationId:string|null;execution:ExecutionReference|null;progress:null;}
export const SESSION_STATES=['CREATED','ACTIVE','WAITING','COMPLETED','FAILED','CANCELLED'];
export function activityReadQuery(value:unknown,keys:readonly string[]){
 try{const q=record(value,keys,'request');for(const v of Object.values(q))if(typeof v!=='string')throw Error();
 const limit=q.limit===undefined?10:Number(q.limit);if(!Number.isInteger(limit)||limit<1||limit>20||q.limit!==undefined&&String(limit)!==q.limit)throw Error();
 const parsed:Record<string,string|number>={limit};for(const [k,v]of Object.entries(q))if(k!=='limit')parsed[k]=v as string;
 for(const k of ['after','agentId','participantsAfter','delegationsAfter','externalAfter'])if(parsed[k]!==undefined)parsed[k]=identifier(parsed[k]);
 if(q.authority!==undefined&&!['NATIVE','EXTERNAL'].includes(q.authority as string)||q.status!==undefined&&!SESSION_STATES.includes(q.status as string))throw Error();
 if(q.afterPosition!==undefined&&(!/^(0|[1-9][0-9]{0,18})$/.test(q.afterPosition as string)||BigInt(q.afterPosition as string)>9223372036854775807n))throw Error();
 return parsed;
 }catch{throw new BadRequestException();}
}
/** Timeline browsing cursor is context-bound; it is not an incremental synchronization token. */
export function timelineCursor(owner:string,session:string,time:string,id:string){return Buffer.from(JSON.stringify([createHash('sha256').update(owner+session).digest('hex'),time,id])).toString('base64url');}
export function parseTimelineCursor(value:unknown,owner:string,session:string):{time:string;id:string}|null{
 if(value===undefined)return null;
 try{if(typeof value!=='string'||value.length>512||!/^[A-Za-z0-9_-]+$/.test(value))throw Error();const a=JSON.parse(Buffer.from(value,'base64url').toString());if(!Array.isArray(a)||a.length!==3||a[0]!==createHash('sha256').update(owner+session).digest('hex')||typeof a[1]!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(a[1])||!Number.isFinite(Date.parse(a[1]))||typeof a[2]!=='string'||!/^(event|audit|inbox):[0-9a-f-]{36}$/.test(a[2]))throw Error();return {time:a[1],id:a[2]};}catch{throw new ConflictException('Refresh snapshot.');}
}
export function observationFreshness(observedAt:Date|null,now:Date,current:boolean){return !current?'RETIRED':!observedAt?'UNKNOWN':now.getTime()-observedAt.getTime()>30000?'STALE':'RECENT_OBSERVATION';}
