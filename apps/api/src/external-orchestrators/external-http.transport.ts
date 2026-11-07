import { Inject, Injectable } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { BlockList,isIP } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest,ClientRequest,IncomingMessage } from 'node:http';
import { checkServerIdentity } from 'node:tls';
import { TextDecoder } from 'node:util';
import { providerEndpoint } from '../runtime/providers/provider-configuration';
import { Connection } from './adapter.contract';
import { AdapterError,statusError } from './adapter.error';
import { budget,CONNECT_MS,RESPONSE_BYTES,CONCURRENCY,CONNECTION_CONCURRENCY } from './adapter-budget';
export const EXTERNAL_DNS=Symbol('EXTERNAL_PINNED_DNS');
export type ExternalDns=(host:string)=>Promise<readonly {address:string;family:number}[]>;
export const externalDns:ExternalDns=host=>lookup(host,{all:true,verbatim:true});
export function sameAddress(a:string,b:string) {if(!isIP(a)||isIP(a)!==isIP(b))return false;const list=new BlockList(),family=isIP(a)===4?'ipv4':'ipv6';list.addAddress(a,family);return list.check(b,family);}
@Injectable()
export class ExternalHttpTransport {
  private active=0;
  private readonly connections=new Map<string,number>();
  constructor(@Inject(EXTERNAL_DNS) private readonly dns:ExternalDns) {}
  async get(c:Connection,path:string,signal:AbortSignal,deadline:number,credential?:string):Promise<unknown> {
    return this.read(c,path,signal,deadline,credential);
  }
  /** Only reviewed read-only LangGraph assistant search; no arbitrary POST transport. */
  async search(c:Connection,path:string,body:Readonly<Record<string,unknown>>,signal:AbortSignal,deadline:number,credential?:string) {
    if(c.adapterType!=='langgraph.v1'||path!=='/assistants/search'||Object.keys(body).sort().join(',')!=='limit,offset'||!Number.isInteger(body.limit)||Number(body.limit)<1||Number(body.limit)>20||!Number.isInteger(body.offset)||Number(body.offset)<0||Number(body.offset)>10000)throw new AdapterError('INVALID_INPUT');
    return this.read(c,path,signal,deadline,credential,JSON.stringify(body));
  }
  private async read(c:Connection,path:string,signal:AbortSignal,deadline:number,credential?:string,body?:string):Promise<unknown> {
    return budget(signal,deadline,async active=>{
      const key=c.id,count=this.connections.get(key)??0;
      if(this.active>=CONCURRENCY||count>=CONNECTION_CONCURRENCY)throw new AdapterError('CAPACITY_EXCEEDED');
      this.active++;this.connections.set(key,count+1);
      try {
      let policy:Connection['endpoint'];try{policy=providerEndpoint(c.endpoint);}catch{throw new AdapterError('INVALID_CONFIGURATION');}
      if(typeof path!=='string'||path.length>1024||!/^\/(?!\/)/.test(path)||/[\\\u0000-\u0020\u007f]/u.test(path))throw new AdapterError('INVALID_CONFIGURATION');
      const origin=new URL(policy.origin),url=new URL(path,origin),host=url.hostname.replace(/^\[|\]$/g,'');
      if(url.origin!==origin.origin||url.username||url.password||url.hash||credential!==undefined&&!/^[\x21-\x7e]{8,4096}$/.test(credential))throw new AdapterError('INVALID_CONFIGURATION');
      let addresses:readonly {address:string;family:number}[];
      try{addresses=isIP(host)?[{address:host,family:isIP(host)}]:await this.dns(host);}catch{throw new AdapterError('CONNECTION_UNAVAILABLE');}
      if(active.aborted)throw active.reason; // Late DNS results can never open a socket.
      if(!addresses.length||addresses.length>16||addresses.some(a=>isIP(a.address)!==a.family||!policy.allowedAddresses.some(pin=>sameAddress(pin,a.address))))throw new AdapterError('INVALID_CONFIGURATION');
      const pin=addresses[0]!;
      return await new Promise((resolve,reject)=>{
        let req:ClientRequest|undefined,res:IncomingMessage|undefined,settled=false,connectTimer:NodeJS.Timeout|undefined;
        const cleanup=()=>{clearTimeout(connectTimer);active.removeEventListener('abort',abort);};
        const fail=(error:AdapterError)=>{if(settled)return;settled=true;cleanup();res?.destroy();req?.destroy();reject(error);};
        const abort=()=>fail(active.reason instanceof AdapterError?active.reason:new AdapterError('ABORTED'));
        const error=(value:unknown)=>{
          if(active.aborted)return abort();const code=(value as {code?:string}|null)?.code;
          fail(new AdapterError(code?.startsWith('HPE_')?'INVALID_PROVIDER_RESPONSE':code?.includes('TLS')||['DEPTH_ZERO_SELF_SIGNED_CERT','UNABLE_TO_VERIFY_LEAF_SIGNATURE','CERT_HAS_EXPIRED'].includes(code??'')?'INVALID_CONFIGURATION':'CONNECTION_UNAVAILABLE'));
        };
        active.addEventListener('abort',abort,{once:true});
        try {
          const secure=url.protocol==='https:';
          req=(secure?httpsRequest:httpRequest)({protocol:url.protocol,hostname:pin.address,family:pin.family,port:url.port||(secure?443:80),
            path:url.pathname+url.search,method:body===undefined?'GET':'POST',agent:false,signal:active,maxHeaderSize:8192,
            headers:{Host:url.host,Accept:'application/json','Accept-Encoding':'identity',Connection:'close',...(body===undefined?{}:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}),...(credential?(c.adapterType==='langgraph.v1'?{'X-Api-Key':credential}:{Authorization:'Bearer '+credential}):{})},
            ...(secure?{rejectUnauthorized:true,servername:isIP(host)?undefined:host,checkServerIdentity:(_name:string,cert:Parameters<typeof checkServerIdentity>[1])=>checkServerIdentity(host,cert)}:{})},incoming=>{
            res=incoming;res.on('error',error);res.on('aborted',()=>fail(new AdapterError('CONNECTION_UNAVAILABLE')));
            if((res.statusCode??0)>=300&&(res.statusCode??0)<400)return fail(new AdapterError('INVALID_CONFIGURATION')); // Never follow redirects with credentials.
            if(res.statusCode!==200)return fail(statusError(res.statusCode??0));
            if(!/^application\/json(?:\s*;|$)/i.test(res.headers['content-type']??'')||res.headers['content-encoding']!==undefined&&res.headers['content-encoding']!=='identity')return fail(new AdapterError('INVALID_PROVIDER_RESPONSE'));
            const length=res.headers['content-length'];if(length!==undefined&&(!/^\d+$/.test(length)||Number(length)>RESPONSE_BYTES))return fail(new AdapterError('RESPONSE_LIMIT'));
            let bytes=0;const chunks:Buffer[]=[];
            res.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>RESPONSE_BYTES)return fail(new AdapterError('RESPONSE_LIMIT'));if(!settled)chunks.push(chunk);});
            res.on('end',()=>{if(settled)return;try{const result:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));settled=true;cleanup();resolve(result);}catch{fail(new AdapterError('INVALID_PROVIDER_RESPONSE'));}});
          });
          req.on('error',error);connectTimer=setTimeout(()=>fail(new AdapterError('TIMEOUT')),CONNECT_MS);
          req.on('socket',socket=>socket.once(secure?'secureConnect':'connect',()=>{clearTimeout(connectTimer);if(!socket.remoteAddress||!sameAddress(pin.address,socket.remoteAddress))fail(new AdapterError('INVALID_CONFIGURATION'));}));
          req.end(body);
        }catch(value){error(value);}
      });
      } finally { this.active--;const count=this.connections.get(key)!-1;if(count)this.connections.set(key,count);else this.connections.delete(key); }
    });
  }
}
