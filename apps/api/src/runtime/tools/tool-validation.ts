import { RuntimeError } from '../contracts/runtime-error.contract';
import { freeze, record, safeText } from '../contracts/validation';

// Bounded copying, before serialization: never invoke getters, toJSON, custom
// prototypes or arbitrary coercion. Schema validators remain mandatory as well.
export function toolValue(value:unknown,maxBytes:number,output=false,protocolLimits?:{readonly maxDepth:8;readonly allowEmpty:true}):unknown {
  const seen=new WeakSet<object>();let nodes=0;
  const copy=(v:unknown,depth:number):unknown=>{
    if(++nodes>256||depth>(protocolLimits?.maxDepth??4))throw new RuntimeError(output?'TOOL_FAILED':'INVALID_INPUT','tool');
    if(v===null||typeof v==='boolean')return v;
    if(typeof v==='number'&&Number.isFinite(v))return Object.is(v,-0)?0:v;
    if(typeof v==='string'){
      if(v.length>maxBytes)throw new RuntimeError(output?'OUTPUT_LIMIT_EXCEEDED':'INVALID_INPUT','tool');
      return protocolLimits?.allowEmpty&&!v.trim()?v:safeText(v,'tool');
    }
    if(!v||typeof v!=='object'||seen.has(v))throw new RuntimeError(output?'TOOL_FAILED':'INVALID_INPUT','tool');
    seen.add(v);
    try {
      if(Array.isArray(v)) {
        if(Object.getPrototypeOf(v)!==Array.prototype||v.length>32||Reflect.ownKeys(v).length!==v.length+1)
          throw new RuntimeError('INVALID_INPUT','tool');
        return freeze(Array.from({length:v.length},(_,i)=>{
          const d=Object.getOwnPropertyDescriptor(v,String(i));
          if(!d||!Object.hasOwn(d,'value')||!d.enumerable)throw new RuntimeError('INVALID_INPUT','tool');
          return copy(d.value,depth+1);
        }));
      }
      const keys=Object.keys(v);
      if(keys.length>32||keys.some(k=>! /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(k)||
        /^(?:constructor|prototype|__proto__|stack|cause|authorization|password|secret|api_?key|access_?token|token|credentials?|env|environment|headers|diagnostics|raw|prompt)$/i.test(k)))
        throw new RuntimeError('INVALID_INPUT','tool');
      const o=record(v,keys,'tool');
      return freeze(Object.fromEntries(keys.map(k=>[k,copy(o[k],depth+1)])));
    }finally{seen.delete(v);}
  };
  try {
    const parsed=copy(value,0);
    if(Buffer.byteLength(JSON.stringify(parsed),'utf8')>maxBytes)throw new RuntimeError(output?'OUTPUT_LIMIT_EXCEEDED':'INVALID_INPUT','tool');
    return parsed;
  }catch(error){
    if(output&&(!(error instanceof RuntimeError)||error.code!=='OUTPUT_LIMIT_EXCEEDED'))throw new RuntimeError('TOOL_FAILED','tool');
    throw error instanceof RuntimeError?error:new RuntimeError('INVALID_INPUT','tool');
  }
}
