import { Inject, Injectable } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { ClientRequest, IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { checkServerIdentity } from 'node:tls';
import { TextDecoder } from 'node:util';
import { ProviderSettings, providerEndpoint } from '../provider-configuration';
import { LlmRequestContext } from '../../contracts/provider.contract';
import { RuntimeError } from '../../contracts/runtime-error.contract';
import { providerError } from '../provider-errors';
import { openaiStatusError } from './openai.mapper';

export const OPENAI_DNS=Symbol('OPENAI_APPROVED_DNS_RESOLVER');
export type OpenaiDns=(host:string)=>Promise<readonly {address:string;family:number}[]>;
export const openaiDns:OpenaiDns=host=>lookup(host,{all:true,verbatim:true});
// Separate from the local Ollama transport: this path can send credentials only
// to the fixed official TLS authority, never to a configured alternate origin.
const RESPONSE_BYTES=65536,REQUEST_BYTES=32768;
function sameAddress(a:string,b:string):boolean {
  if(!isIP(a)||isIP(a)!==isIP(b))return false;
  const list=new BlockList(),family=isIP(a)===4?'ipv4':'ipv6';list.addAddress(a,family);return list.check(b,family);
}
@Injectable()
export class OpenaiHttpTransport {
  constructor(@Inject(OPENAI_DNS) private readonly dns:OpenaiDns) {}
  async postResponses(endpoint:ProviderSettings['endpoint'],body:unknown,context:LlmRequestContext,apiKey:string):Promise<unknown> {
    const policy=providerEndpoint(endpoint),url=new URL(policy.origin),host=url.hostname.replace(/^\[|\]$/g,'');
    if(policy.network!=='public'||policy.origin!=='https://api.openai.com')throw providerError('configuration');
    if(typeof apiKey!=='string'||!/^[\x21-\x7e]{8,4096}$/.test(apiKey))throw providerError('authentication');
    const active=()=>{
      if(context.signal.aborted)throw context.signal.reason instanceof RuntimeError?context.signal.reason:providerError('cancelled');
      if(Date.now()>=Date.parse(context.deadlineAt))throw providerError('timeout');
    };
    active();const payload=Buffer.from(JSON.stringify(body),'utf8');
    if(payload.length>REQUEST_BYTES)throw new RuntimeError('INVALID_INPUT','provider');
    let addresses:readonly {address:string;family:number}[];
    try {addresses=isIP(host)?[{address:host,family:isIP(host)}]:await this.dns(host);}
    catch {active();throw providerError('unavailable');}
    active(); // A DNS result arriving after cancellation must never open a socket.
    if(!addresses.length||addresses.length>16||addresses.some(a=>isIP(a.address)!==a.family||
      !policy.allowedAddresses.some(approved=>sameAddress(approved,a.address))))throw providerError('configuration');
    const pinned=addresses[0]!;
    return new Promise((resolve,reject)=>{
      let request:ClientRequest|undefined,response:IncomingMessage|undefined,settled=false;
      const fail=(error:RuntimeError)=>{
        if(settled)return;settled=true;response?.destroy();request?.destroy();reject(error);
      };
      const transportError=(error:unknown)=>{
        if(context.signal.aborted)return fail(context.signal.reason instanceof RuntimeError?context.signal.reason:providerError('cancelled'));
        const code=(error as {code?:string}|null)?.code;
        if(code?.startsWith('HPE_'))return fail(providerError('invalid_response'));
        if(['ERR_TLS_CERT_ALTNAME_INVALID','DEPTH_ZERO_SELF_SIGNED_CERT','UNABLE_TO_VERIFY_LEAF_SIGNATURE','CERT_HAS_EXPIRED'].includes(code??''))return fail(providerError('configuration'));
        fail(providerError('unavailable'));
      };
      try {
        const secure=url.protocol==='https:';
        request=httpsRequest({protocol:url.protocol,hostname:pinned.address,family:pinned.family,
          port:url.port|| (secure?443:80),path:'/v1/responses',method:'POST',agent:false,signal:context.signal,maxHeaderSize:8192,
          headers:{Authorization:'Bearer '+apiKey,Host:url.host,'Content-Type':'application/json',Accept:'application/json','Accept-Encoding':'identity',
            'Content-Length':payload.length,Connection:'close'},
          ...(secure?{rejectUnauthorized:true,servername:isIP(host)?undefined:host,
            checkServerIdentity:(_name:string,cert:Parameters<typeof checkServerIdentity>[1])=>checkServerIdentity(host,cert)}:{})},res=>{
          response=res;res.on('error',transportError);res.on('aborted',()=>fail(providerError('unavailable')));
          if((res.statusCode??0)>=300&&(res.statusCode??0)<400)return fail(providerError('configuration'));
          const success=res.statusCode===200;
          if(!/^application\/json(?:\s*;|$)/i.test(res.headers['content-type']??'') ||
            res.headers['content-encoding']!==undefined&&res.headers['content-encoding']!=='identity')
            return fail(success?providerError('invalid_response'):openaiStatusError(res.statusCode??0,undefined));
          const length=res.headers['content-length'];
          if(length!==undefined&&(!/^\d+$/.test(length)||Number(length)>RESPONSE_BYTES))return fail(new RuntimeError('OUTPUT_LIMIT_EXCEEDED','provider'));
          let size=0;const chunks:Buffer[]=[];
          res.on('data',(chunk:Buffer)=>{if(settled)return;size+=chunk.length;
            if(size>RESPONSE_BYTES)return fail(new RuntimeError('OUTPUT_LIMIT_EXCEEDED','provider'));chunks.push(chunk);});
          res.on('end',()=>{
            if(settled)return;
            try {active();const parsed:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
              if(!success)return fail(openaiStatusError(res.statusCode??0,parsed));
              settled=true;resolve(parsed);
            }catch(error){fail(error instanceof RuntimeError?error:success?providerError('invalid_response'):openaiStatusError(res.statusCode??0,undefined));}
          });
        });
        request.on('error',transportError);
        request.on('socket',socket=>socket.once(url.protocol==='https:'?'secureConnect':'connect',()=>{
          if(!socket.remoteAddress||!sameAddress(pinned.address,socket.remoteAddress))fail(providerError('configuration'));
        }));
        request.end(payload);
      }catch(error){transportError(error);}
    });
  }
}
