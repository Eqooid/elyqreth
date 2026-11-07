import { LlmRequestContext } from '../contracts/provider.contract';
import { llmRequestContext } from '../contracts/provider-validation';
import { integer } from '../contracts/validation';
import { RuntimeError } from '../contracts/runtime-error.contract';
import { normalizeProviderError, providerError } from './provider-errors';
import { performance } from 'node:perf_hooks';

// One bounded operation; no provider, transport, retries or worker is created.
export async function withProviderDeadline<T>(value:LlmRequestContext,timeoutMs:number,operation:(context:LlmRequestContext)=>Promise<T>):Promise<T> {
  const input=llmRequestContext(value),limit=integer(timeoutMs,1,120000,'provider');
  const deadline=Math.min(Date.parse(input.deadlineAt),Date.now()+limit);
  const started=performance.now(),remaining=deadline-Date.now();
  const parentFailure=()=>input.signal.reason instanceof RuntimeError && input.signal.reason.code==='LEASE_LOST'
    ? new RuntimeError('LEASE_LOST','provider')
    : providerError(input.signal.reason instanceof RuntimeError && input.signal.reason.code==='DEADLINE_EXCEEDED'?'timeout':'cancelled');
  if(input.signal.aborted)throw parentFailure();
  if(deadline<=Date.now())throw providerError('timeout');
  const controller=new AbortController();
  const abort=()=>controller.abort(parentFailure());
  input.signal.addEventListener('abort',abort,{once:true});
  let timer:NodeJS.Timeout|undefined,removeAbort=()=>{};
  const context=llmRequestContext({executionId:input.executionId,correlationId:input.correlationId,profile:input.profile,
    deadlineAt:new Date(deadline).toISOString(),signal:controller.signal});
  const active=()=>{
    if(controller.signal.aborted)throw controller.signal.reason instanceof RuntimeError ? controller.signal.reason : providerError('cancelled');
    if(input.signal.aborted)throw parentFailure();
    if(Date.now()>=deadline||performance.now()-started>=remaining)throw providerError('timeout');
  };
  try {
    timer=setTimeout(()=>controller.abort(providerError('timeout')),Math.max(0,deadline-Date.now()));
    const cancelled=new Promise<never>((_,reject)=>{
      const onAbort=()=>reject(controller.signal.reason);controller.signal.addEventListener('abort',onAbort,{once:true});
      removeAbort=()=>controller.signal.removeEventListener('abort',onAbort);
    });
    const result=await Promise.race([cancelled,Promise.resolve().then(()=>{active();return operation(context);})]);
    active();return result;
  }catch(error){throw normalizeProviderError(error);}
  finally {clearTimeout(timer);removeAbort();input.signal.removeEventListener('abort',abort);}
}
