import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import type { ApiConfiguration } from '../config/configuration';
import { requestContext } from '../common/request-context';
export interface AccountPrincipal {
 readonly kind:'LOCAL_ACCOUNT'|'OIDC';readonly audience:'operator'|'viewer';readonly ownerId:string;
 readonly actorReference:string;readonly sessionHash?:string;
}
type Grant={principal:AccountPrincipal;configuration:ApiConfiguration;method:string;path:string};
const requests=new WeakMap<object,Grant>(),contexts=new WeakMap<object,AccountPrincipal>();
export function establishAccount(req:Request,configuration:ApiConfiguration,principal:AccountPrincipal):void{
 const value=Object.freeze({...principal});requests.set(req,{principal:value,configuration,method:req.method,path:req.path});
 const context=requestContext.getStore();if(context)contexts.set(context,value);
}
export function assertAccount(req:Request,configuration:ApiConfiguration):AccountPrincipal{
 const grant=requests.get(req);
 if(!grant||grant.configuration!==configuration||grant.method!==req.method||grant.path!==req.path)throw new UnauthorizedException();
 if(grant.principal.ownerId!==configuration.registry?.ownerId)throw new ForbiddenException();
 if(!['GET','HEAD','OPTIONS'].includes(req.method)&&grant.principal.audience!=='operator'&&req.path!=='/api/v1/auth/logout')throw new ForbiddenException();
 return grant.principal;
}
export function accountPrincipal():AccountPrincipal|undefined{const c=requestContext.getStore();return c?contexts.get(c):undefined;}
export const actorReference=(fallback:string):string=>accountPrincipal()?.actorReference??fallback;
/** Internal services still derive scope from reviewed configuration and persisted claims. */
export function operationalMode(c:ApiConfiguration):boolean{
 return !!c.registry&&(!!c.authentication||(['development','test'].includes(c.nodeEnv)&&['127.0.0.1','::1','::ffff:127.0.0.1'].includes(c.host)));
}
