import { AdapterError } from './adapter.error';
export const REQUEST_MS=5000, CONNECT_MS=1000, RESPONSE_BYTES=65536, CONCURRENCY=4;
export const CONNECTION_CONCURRENCY=2;
export async function budget<T>(caller:AbortSignal, deadline:number, run:(signal:AbortSignal)=>Promise<T>):Promise<T> {
  if(!(caller instanceof AbortSignal)||!Number.isFinite(deadline))throw new AdapterError('INVALID_CONFIGURATION');
  const controller=new AbortController();
  const abort=()=>controller.abort(caller.reason instanceof AdapterError&&caller.reason.code==='TIMEOUT'?caller.reason:new AdapterError('ABORTED'));
  caller.addEventListener('abort',abort,{once:true});if(caller.aborted)abort();
  const timer=setTimeout(()=>controller.abort(new AdapterError('TIMEOUT')),Math.max(0,Math.min(REQUEST_MS,deadline-Date.now())));
  let remove=()=>{};
  try {
    if(controller.signal.aborted)throw controller.signal.reason;
    if(deadline<=Date.now())throw new AdapterError('TIMEOUT');
    const interrupted=new Promise<never>((_,reject)=>{const fail=()=>reject(controller.signal.reason);controller.signal.addEventListener('abort',fail,{once:true});remove=()=>controller.signal.removeEventListener('abort',fail);});
    return await Promise.race([interrupted,Promise.resolve().then(()=>{if(controller.signal.aborted)throw controller.signal.reason;return run(controller.signal);})]);
  } finally {clearTimeout(timer);remove();caller.removeEventListener('abort',abort);controller.abort(new AdapterError('ABORTED'));}
}
