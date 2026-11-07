import type { Request } from 'express';
/** Exact peer only: never forwarded headers, Host assertions or account roles. No public readiness privilege. */
export function internalProbe(req:Request):boolean{
 return ['GET','HEAD'].includes(req.method)&&req.path==='/ready'&&['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress??'');
}
