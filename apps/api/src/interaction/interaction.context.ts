import { requestContext } from '../common/request-context';

export interface InteractionPrincipal {readonly ownerId:string;readonly agentId:string;readonly operation:'read'|'create'|'execute'|'cancel'}
// The existing ALS request object is the private key. Nothing is placed in log
// context, request bodies, global mutable current-user state or caller metadata.
const principals=new WeakMap<object,InteractionPrincipal>();
const requests=new WeakMap<object,Readonly<{request:object;method:unknown;path:unknown}>>();
export function interactionPrincipal():InteractionPrincipal|undefined {const context=requestContext.getStore();return context?principals.get(context):undefined;}
export function interactionRequest(request:{method?:unknown;path?:unknown}):boolean {
 const context=requestContext.getStore(),binding=context?requests.get(context):undefined;
 return !!binding&&binding.request===request&&binding.method===request.method&&binding.path===request.path;
}
export function establishInteraction(principal:InteractionPrincipal,request?:{method?:unknown;path?:unknown}):void {
 const context=requestContext.getStore();if(!context)throw new Error('Request context unavailable');
 principals.set(context,Object.freeze({...principal}));
 if(request)requests.set(context,Object.freeze({request,method:request.method,path:request.path}));
 else requests.delete(context);
}
