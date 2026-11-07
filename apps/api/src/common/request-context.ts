import { AsyncLocalStorage } from 'node:async_hooks';

// Per asynchronous request chain; no mutable singleton request identity.
export const requestContext = new AsyncLocalStorage<Readonly<{ requestId: string }>>();
const sensitive=new WeakMap<object,readonly string[]>();
/** Non-enumerable side channel: credentials never become correlation/context fields. */
export function bindRequestSecrets(context:object,authorization:unknown,cookie:unknown):void {
 const values:string[]=[];
 if(typeof authorization==='string'&&authorization.length<=20000){values.push(authorization);if(authorization.startsWith('Bearer '))values.push(authorization.slice(7));}
 if(typeof cookie==='string'&&cookie.length<=24000){values.push(cookie);for(const item of cookie.split(';')){const index=item.indexOf('=');if(index>=0)values.push(item.slice(index+1).trim());}}
 sensitive.set(context,Object.freeze(values.filter(Boolean)));
}
export function requestSecrets():readonly string[]{const context=requestContext.getStore();return context?sensitive.get(context)??[]:[];}
