import {connect} from 'node:tls';
import {isIP} from 'node:net';
import {privateFile,monitorConditions} from './config.mjs';

const errorCodes=new Set(['SMTP_CONFIGURATION','SMTP_PROTOCOL','SMTP_TLS','SMTP_UNAVAILABLE','SMTP_AUTHENTICATION','SMTP_REJECTED','SMTP_TLS_OR_CONNECTION']);
export class DeliveryError extends Error{constructor(code,uncertain=false){super('Email delivery failed.');this.code=errorCodes.has(code)?code:'SMTP_UNAVAILABLE';this.uncertain=uncertain===true;}}
function emailInputs(config){try{
 const password=privateFile(config.passwordFile,4096).replace(/\r?\n$/,'');if(!password||/[\0\r\n]/.test(password))throw Error();
 return {password,ca:config.caFile?privateFile(config.caFile,65536,false):undefined};
}catch{throw new DeliveryError('SMTP_CONFIGURATION');}}
export function checkEmailConfiguration(config){emailInputs(config);}
// Deliberately narrow SMTP submission: implicit verified TLS and AUTH PLAIN only.
// Never accept arbitrary headers/content, TLS bypasses, attachments or provider responses in logs.
export async function sendEmail(config,notice){
 if(!notice||!/^[a-f0-9]{64}$/.test(notice.id)||!['ALERT','CLEARED'].includes(notice.kind)||!Array.isArray(notice.conditions)||!notice.conditions.length||notice.conditions.length>monitorConditions.length||notice.conditions.some(v=>!monitorConditions.includes(v))||typeof notice.observedAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(notice.observedAt))throw new DeliveryError('SMTP_CONFIGURATION');
 const {password,ca}=emailInputs(config);
 let socket,dataSent=false,phase='connect',timer;
 try{
  socket=connect({host:config.host,port:config.port,servername:isIP(config.host)?undefined:config.host,minVersion:'TLSv1.2',rejectUnauthorized:true,...(ca?{ca}:{})});
  let pending,buffer='',lines=[],code,queued=[],failure;
  const stop=()=>{failure??=new DeliveryError('SMTP_UNAVAILABLE',dataSent);if(pending){const p=pending;pending=undefined;p.reject(failure);}};
  socket.on('error',error=>{const code=String(error.code??'');failure=new DeliveryError(code.startsWith('ERR_TLS')||['DEPTH_ZERO_SELF_SIGNED_CERT','SELF_SIGNED_CERT_IN_CHAIN','CERT_HAS_EXPIRED','UNABLE_TO_VERIFY_LEAF_SIGNATURE','UNABLE_TO_GET_ISSUER_CERT_LOCALLY'].includes(code)?'SMTP_TLS':'SMTP_UNAVAILABLE',dataSent);stop();});socket.on('close',stop);
  socket.on('data',chunk=>{
   try{
    buffer+=chunk.toString('ascii');if(buffer.length+lines.join('').length>8192)throw Error();
    let end;while((end=buffer.indexOf('\r\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+2);
     const m=/^(\d{3})([ -])([\x20-\x7e]*)$/.exec(line);if(!m||line.length>510||code&&code!==m[1])throw Error();code=m[1];lines.push(m[3]);
     if(lines.length>100)throw Error();if(m[2]===' '){const reply={code:Number(code),lines};code=undefined;lines=[];
      if(pending){const p=pending;pending=undefined;p.resolve(reply);}else{queued.push(reply);if(queued.length>2)throw Error();}
     }
    }
   }catch{failure=new DeliveryError('SMTP_PROTOCOL',dataSent);stop();socket.destroy();}
  });
  timer=setTimeout(()=>socket.destroy(),config.timeoutMs);timer.unref();
  const reply=()=>{if(failure)return Promise.reject(failure);if(queued.length)return Promise.resolve(queued.shift());return new Promise((resolve,reject)=>{pending={resolve,reject};});};
  const expect=async(promise,codes)=>{const r=await promise;if(!codes.includes(r.code)){
   if(r.code>=400&&r.code<=599)dataSent=false;
   throw new DeliveryError(phase==='auth'?'SMTP_AUTHENTICATION':'SMTP_REJECTED',dataSent);
  }return r;};
  const command=(text,codes)=>{const next=reply();socket.write(text+'\r\n');return expect(next,codes);};
  await expect(reply(),[220]);if(!socket.authorized)throw new DeliveryError('SMTP_TLS');
  const hello=await command('EHLO elyqreth.invalid',[250]);
  if(!hello.lines.some(v=>/^AUTH(?:=|\s).*\bPLAIN\b/i.test(v)))throw new DeliveryError('SMTP_AUTHENTICATION');
  phase='auth';const auth=Buffer.from('\0'+config.username+'\0'+password).toString('base64');
  const authReply=await command('AUTH PLAIN '+auth,[235,334]);if(authReply.code===334)await command(auth,[235]);
  phase='envelope';await command('MAIL FROM:<'+config.from+'>',[250]);
  for(const recipient of config.to)await command('RCPT TO:<'+recipient+'>',[250,251]);
  await command('DATA',[354]);phase='data';
  const safeBody={schemaVersion:1,id:notice.id,kind:notice.kind,conditions:notice.conditions,observedAt:notice.observedAt,
   meaning:notice.kind==='ALERT'?'Condition detected; inspect authorized diagnostics.':'Condition no longer observed; this does not prove Execution success.',runbook:'docs/ai-agent-platform/phase-6/observability.md#incident-runbooks'};
  const body=Buffer.from(JSON.stringify(safeBody,null,2)).toString('base64').match(/.{1,76}/g).join('\r\n');
  const message=['From: '+config.from,'To: '+config.to.join(',\r\n '),'Date: '+new Date().toUTCString(),
   'Message-ID: <'+notice.id+'@elyqreth.invalid>','Subject: [Elyqreth] '+(notice.kind==='ALERT'?'ALERT':'CONDITION CLEARED'),
   'MIME-Version: 1.0','Content-Type: text/plain; charset=utf-8','Content-Transfer-Encoding: base64','',body].join('\r\n');
  if(message.length>16384)throw new DeliveryError('SMTP_CONFIGURATION');
  const accepted=reply();dataSent=true;socket.write(message+'\r\n.\r\n');await expect(accepted,[250]);
  // A positive DATA acknowledgement is acceptance by SMTP, not proof of inbox delivery.
  return {accepted:true};
 }catch(error){if(error instanceof DeliveryError)throw error;throw new DeliveryError(phase==='connect'?'SMTP_TLS_OR_CONNECTION':'SMTP_UNAVAILABLE',dataSent);}
 finally{clearTimeout(timer);socket?.destroy();}
}
