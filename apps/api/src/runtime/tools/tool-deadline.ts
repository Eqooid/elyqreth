import { ToolExecutionContext } from '../contracts/tool.contract';
import { RuntimeError } from '../contracts/runtime-error.contract';
import { performance } from 'node:perf_hooks';

const elapsedDeadlines=new WeakMap<object,{started:number;remaining:number}>();

export function assertToolActive(context:Pick<ToolExecutionContext,'signal'|'deadlineAt'>):void {
  if(context.signal.aborted)throw new RuntimeError(context.signal.reason instanceof RuntimeError&&
    ['DEADLINE_EXCEEDED','LEASE_LOST'].includes(context.signal.reason.code)?context.signal.reason.code:'CANCELLED','tool');
  if(Date.now()>=Date.parse(context.deadlineAt))throw new RuntimeError('DEADLINE_EXCEEDED','tool');
  const elapsed=elapsedDeadlines.get(context);
  if(elapsed&&performance.now()-elapsed.started>=elapsed.remaining)throw new RuntimeError('DEADLINE_EXCEEDED','tool');
}
// Deadline applies to authorization I/O and the handler, with no open transaction.
// This bounds waiting; it cannot preempt blocking synchronous JavaScript.
export async function withToolDeadline<T>(context:ToolExecutionContext,timeoutMs:number,
  operation:(scoped:ToolExecutionContext)=>Promise<T>,setCancel?:(cancel:()=>void)=>void):Promise<T> {
  assertToolActive(context);
  const deadline=Math.min(Date.parse(context.deadlineAt),Date.now()+timeoutMs),controller=new AbortController();
  const started=performance.now(),remaining=deadline-Date.now();
  const parentAbort=()=>{try{assertToolActive(context);}catch(error){controller.abort(error);}};
  context.signal.addEventListener('abort',parentAbort,{once:true});
  let timer:NodeJS.Timeout|undefined,remove=()=>{};
  try {
    const scoped={ids:context.ids,deadlineAt:new Date(deadline).toISOString(),signal:controller.signal,authorizedCapabilities:context.authorizedCapabilities};
    Object.defineProperty(scoped,'signal',{enumerable:false});Object.defineProperty(scoped,'authorizedCapabilities',{enumerable:false});Object.freeze(scoped);
    elapsedDeadlines.set(scoped,{started,remaining});
    setCancel?.(()=>controller.abort(new RuntimeError('CANCELLED','tool')));
    timer=setTimeout(()=>controller.abort(new RuntimeError('DEADLINE_EXCEEDED','tool')),Math.max(0,deadline-Date.now()));
    const cancelled=new Promise<never>((_,reject)=>{
      const onAbort=()=>reject(controller.signal.reason);controller.signal.addEventListener('abort',onAbort,{once:true});
      remove=()=>controller.signal.removeEventListener('abort',onAbort);
      if(controller.signal.aborted)onAbort();
    });
    const result=await Promise.race([cancelled,Promise.resolve().then(()=>{assertToolActive(scoped);return operation(scoped);})]);
    assertToolActive(scoped);
    if(performance.now()-started>=remaining)throw new RuntimeError('DEADLINE_EXCEEDED','tool');
    return result;
  }finally{clearTimeout(timer);remove();context.signal.removeEventListener('abort',parentAbort);}
}
