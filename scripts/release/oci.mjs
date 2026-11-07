import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';

const fail=()=>{throw Error('Invalid or unsupported OCI archive.');};
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const digest=value=>typeof value==='string'&&/^sha256:[a-f0-9]{64}$/.test(value);
/** Stream and hash a bounded regular-file USTAR OCI layout. Never extract archive paths. */
export async function inspectOCI(file,expectedDigest){
 if(!digest(expectedDigest))fail();
 const hash=createHash('sha256'),entries=new Map();let buffer=Buffer.alloc(0),entry,remaining=0,padding=0,total=0,ended=false,zeros=0;
 const finish=()=>{const actual=entry.hash.digest('hex');if(entry.name.startsWith('blobs/sha256/')&&entry.name.slice(13)!==actual)fail();entries.set(entry.name,{size:entry.size,bytes:entry.parts?Buffer.concat(entry.parts):undefined});entry=undefined;};
 for await(const chunk of createReadStream(file)){
  total+=chunk.length;if(total>2*1024**3)fail();hash.update(chunk);buffer=Buffer.concat([buffer,chunk]);
  while(buffer.length){
   if(remaining){const n=Math.min(remaining,buffer.length),part=buffer.subarray(0,n);entry.hash.update(part);entry.parts?.push(Buffer.from(part));buffer=buffer.subarray(n);remaining-=n;if(!remaining)finish();continue;}
   if(padding){const n=Math.min(padding,buffer.length);if(buffer.subarray(0,n).some(v=>v!==0))fail();buffer=buffer.subarray(n);padding-=n;continue;}
   if(buffer.length<512)break;
   const header=buffer.subarray(0,512);buffer=buffer.subarray(512);
   if(header.every(v=>v===0)){zeros++;ended=true;continue;}if(ended)fail();
   const text=(a,b)=>header.subarray(a,b).toString('utf8').split('\0')[0];
   const octal=(a,b)=>{const s=text(a,b).trim();if(!/^[0-7]+$/.test(s))fail();return parseInt(s,8);};
   const sum=[...header].reduce((n,v,i)=>n+(i>=148&&i<156?32:v),0);if(sum!==octal(148,156))fail();
   const prefix=text(345,500),name=(prefix?prefix+'/':'')+text(0,100),kind=header[156],size=octal(124,136);
   if(entries.has(name)||entries.size>=4096||!Number.isSafeInteger(size)||size>2*1024**3)fail();
   if(kind===53){if(size!==0||!['blobs/','blobs/sha256/'].includes(name))fail();continue;}
   if(![0,48].includes(kind)||!['index.json','oci-layout'].includes(name)&&!/^blobs\/sha256\/[a-f0-9]{64}$/.test(name))fail();
   entry={name,size,hash:createHash('sha256'),parts:size<=2*1024**2?[]:undefined};remaining=size;padding=(512-size%512)%512;if(!remaining)finish();
  }
 }
 if(remaining||padding||buffer.some(v=>v!==0)||zeros<2)fail();
 const json=name=>{const bytes=entries.get(name)?.bytes;if(!bytes)fail();try{return JSON.parse(bytes.toString('utf8'));}catch{fail();}};
 if(json('oci-layout').imageLayoutVersion!=='1.0.0')fail();const layout=json('index.json');
 if(!Array.isArray(layout.manifests)||layout.manifests.length!==1||layout.manifests[0].digest!==expectedDigest)fail();
 const seen=new Set(),predicates=new Set();let runtime;
 const visit=descriptor=>{
  if(!descriptor||!digest(descriptor.digest)||!Number.isSafeInteger(descriptor.size))fail();const name='blobs/sha256/'+descriptor.digest.slice(7),stored=entries.get(name);if(!stored||stored.size!==descriptor.size)fail();
  if(seen.has(name))return;seen.add(name);
  if(/image.index|manifest.list/.test(descriptor.mediaType)){
   const doc=json(name);if(!Array.isArray(doc.manifests)||doc.manifests.length>16)fail();for(const child of doc.manifests)visit(child);
  }else if(/image.manifest|manifest.v2/.test(descriptor.mediaType)){
   const doc=json(name);visit(doc.config);if(!Array.isArray(doc.layers)||doc.layers.length>256)fail();for(const layer of doc.layers)visit(layer);
   const c=json('blobs/sha256/'+doc.config.digest.slice(7));if(c.os==='linux'&&c.architecture==='amd64'){
    if(runtime)fail();runtime={digest:descriptor.digest,user:c.config?.User,ports:Object.keys(c.config?.ExposedPorts??{}).sort(),revision:c.config?.Labels?.['org.opencontainers.image.revision'],source:c.config?.Labels?.['org.opencontainers.image.source']};
   }
  }else if(descriptor.mediaType==='application/vnd.in-toto+json'){
   const doc=json(name);if(typeof doc.predicateType==='string'&&Array.isArray(doc.subject))predicates.add(JSON.stringify({type:doc.predicateType,subjects:doc.subject.map(s=>s.digest?.sha256)}));
  }
 };
 visit(layout.manifests[0]);if(!runtime)fail();
 if([...entries.keys()].some(name=>name.startsWith('blobs/sha256/')&&!seen.has(name)))fail();
 const statements=[...predicates].map(v=>JSON.parse(v));const bound=type=>statements.some(s=>s.type===type&&s.subjects.includes(runtime.digest.slice(7)));
 if(!bound('https://spdx.dev/Document')||!['https://slsa.dev/provenance/v0.2','https://slsa.dev/provenance/v1'].some(bound))fail();
 return {archiveSha256:hash.digest('hex'),digest:expectedDigest,bytes:total,runtime,attestations:'STRUCTURALLY_BOUND_NOT_SIGNATURE_VERIFIED'};
}
