export const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const token='C'.repeat(40),otherToken='D'.repeat(40);
export const stamp='2026-10-24T12:00:00.000Z';
export const activity=(n=1,patch={})=>({schemaVersion:1,agentId:id(n),name:'Agent '+n,agentType:'RULE_BASED',availability:'ACTIVE',agentVersion:1,
 npcId:null,bindingId:null,activityStatus:'IDLE',currentTask:null,currentExecution:null,activeExecutionCount:0,queuedTaskCount:0,createdTaskCount:0,
 recentOutcome:null,lastExecution:null,lastActivityAt:stamp,observedAt:stamp,requiresAttention:false,statusReason:'NO_ACTIVE_WORK',...patch});
export const page=(items=[],nextCursor=null)=>({schemaVersion:1,observedAt:stamp,items,nextCursor});
export const response=(value,status=200,headers={})=>new Response(typeof value==='string'?value:JSON.stringify(value),{status,headers:{'content-type':'application/json',...headers}});
export const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
export async function flush(){for(let i=0;i<80;i++)await Promise.resolve();}
export class FakeClock {
 time=0;next=1;timers=new Map();
 now=()=>this.time;wallNow=()=>Date.parse(stamp)+this.time;
 setTimeout=(fn,ms)=>{const id=this.next++;this.timers.set(id,{at:this.time+ms,fn});return id;};
 clearTimeout=id=>{this.timers.delete(id);};
 async advance(ms){const target=this.time+ms;let steps=0;
  while(true){const pending=[...this.timers.entries()].filter(([,t])=>t.at<=target).sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];
   if(!pending)break;if(++steps>10000)throw Error('Unbounded timer loop');this.time=pending[1].at;this.timers.delete(pending[0]);pending[1].fn();await flush();}
  this.time=target;await flush();
 }
}
export function browserEvents(){const visibility=new Set(),online=new Set();let hidden=false;
 return {visibility:{isHidden:()=>hidden,listen:fn=>{visibility.add(fn);return ()=>visibility.delete(fn);}},
  online:{listen:fn=>{online.add(fn);return ()=>online.delete(fn);}},
  hide(value){hidden=value;for(const fn of [...visibility])fn();},networkOnline(){for(const fn of [...online])fn();},
  listeners:()=>visibility.size+online.size};
}
