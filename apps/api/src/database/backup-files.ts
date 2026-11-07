import { constants, closeSync, createReadStream, createWriteStream, fstatSync, lstatSync, mkdirSync, openSync,
  readFileSync, readdirSync, realpathSync, statSync, unlinkSync, writeFileSync, appendFileSync, renameSync, copyFileSync, fsyncSync } from 'node:fs';
import { isAbsolute, join, resolve, relative, sep, dirname, basename } from 'node:path';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable, Writable, Transform } from 'node:stream';

export class BackupError extends Error {
  constructor(message='Recovery operation failed. Check target, permissions, tooling and artifact integrity; private details are not printed.') { super(message); }
}
export const backupId = (id:string):string => {
  if (!/^elyqreth-\d{8}T\d{9}Z-[a-f0-9-]{36}$/.test(id)) throw new BackupError('Invalid backup identifier.');
  return id;
};
export const newBackupId = ():string => backupId('elyqreth-'+new Date().toISOString().replace(/[-:.]/g,'')+'-'+randomUUID());
export function protectedDirectory(path:string):string {
  if (!isAbsolute(path) || resolve(path)!==resolve(realpathSync(path))) throw new BackupError('Backup directory must be explicit and contain no symbolic links.');
  const s=lstatSync(path);
  if(dirname(resolve(path))===resolve(path))throw new BackupError('Filesystem roots are not recovery directories.');
  const within=relative(resolve(__dirname,'../../../..'),resolve(path));
  if(!within||(!within.startsWith('..'+sep)&&within!=='..'&&!isAbsolute(within)))throw new BackupError('Recovery storage must remain outside application source and web assets.');
  if (!s.isDirectory() || s.isSymbolicLink() || process.platform!=='win32' && (s.mode&0o077)!==0) throw new BackupError('Backup directory must be private (0700 on Unix).');
  return resolve(path);
}
export function protectedFile(path:string):number {
  if(lstatSync(path).isSymbolicLink())throw new BackupError('Symbolic links are not recovery files.');
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  const s=fstatSync(fd);
  if (!s.isFile() || s.nlink!==1 || s.size<1 || process.platform!=='win32' && (s.mode&0o077)!==0) {closeSync(fd);throw new BackupError('Invalid protected recovery file.');}
  return fd;
}
export async function directoryLock<T>(directory:string, action:()=>Promise<T>):Promise<T> {
  const root=protectedDirectory(directory),path=join(root,'.elyqreth-backup.lock');
  let fd:number;
  try {fd=openSync(path,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY,0o600);}
  catch {throw new BackupError('Backup directory busy or unavailable. Review the active operation before removing a stale lock.');}
  try{return await action();}finally{closeSync(fd);unlinkSync(path);}
}
const mac=(key:Buffer,data:string):string => createHmac('sha256',createHmac('sha256',key).update('elyqreth-metadata-v1').digest()).update(data).digest('hex');
function syncDirectory(directory:string):void {
  if(process.platform==='win32')return;
  const fd=openSync(directory,constants.O_RDONLY|constants.O_DIRECTORY);try{fsyncSync(fd);}finally{closeSync(fd);}
}
export function writeAuthenticated(path:string,value:unknown,key:Buffer):void {
  const encoded=JSON.stringify({value,authentication:mac(key,JSON.stringify(value))})+'\n';
  const fd=openSync(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL,0o600);let closed=false;
  try{writeFileSync(fd,encoded);fsyncSync(fd);closeSync(fd);closed=true;syncDirectory(dirname(path));}
  catch(error){if(!closed){closeSync(fd);closed=true;}unlinkSync(path);throw error;}
  finally{if(!closed)closeSync(fd);}
}
export function readAuthenticated<T>(path:string,key:Buffer):T {
  const fd=protectedFile(path);
  try{
    if(fstatSync(fd).size>131072)throw new BackupError();
    const parsed=JSON.parse(readFileSync(fd,'utf8'));
    if(typeof parsed.authentication!=='string'||! /^[a-f0-9]{64}$/.test(parsed.authentication)||
      !timingSafeEqual(Buffer.from(parsed.authentication,'hex'),Buffer.from(mac(key,JSON.stringify(parsed.value)),'hex')))throw new BackupError('Recovery metadata authentication failed.');
    return parsed.value;
  }finally{closeSync(fd);}
}
export async function checksum(path:string):Promise<string>{
  const fd=protectedFile(path),hash=createHash('sha256');
  try{for await(const chunk of createReadStream(path,{fd,autoClose:false}))hash.update(chunk);return hash.digest('hex');}
  finally{closeSync(fd);}
}
export interface BackupMetadata {
  version:1; id:string; createdAt:string; database:string; serverVersion:number; toolVersion:string;
  format:'pg-custom-aes256gcm-v1'; size:number; sha256:string; schema:{hash:string;created_at:string}[];
  counts:Record<string,string>; structureHash:string; applicationVersion:string; snapshotAt:string;
}
const magic=Buffer.from('ELYQBK01');
export async function encryptArchive(input:Readable,path:string,key:Buffer):Promise<void>{
  if(key.length!==32)throw new BackupError('Recovery key must contain exactly 32 random bytes.');
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
  cipher.setAAD(Buffer.from('elyqreth-v1:'+backupId(basename(path,'.backup'))));
  const fd=openSync(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL,0o600);
  let bytes=0;
  const bounded=new Transform({transform(chunk,_encoding,callback){bytes+=chunk.length;callback(bytes>10*1024**3-36?new BackupError('Archive exceeded the 10 GiB operation limit.'):null,chunk);}});
  try{const output=createWriteStream(path,{fd});output.write(Buffer.concat([magic,iv]));
    await pipeline(input,bounded,cipher,output);appendFileSync(path,cipher.getAuthTag(),{flush:true});syncDirectory(dirname(path));
  }catch(error){unlinkSync(path);throw error;}
}
export function recordAttempt(directory:string,key:Buffer,id:string,status:'STARTED'|'COMPLETE'|'FAILED'):void {
  const path=join(directory,'.latest-attempt.json'),temporary=join(directory,'.attempt-'+randomUUID());
  if(readdirSync(directory).includes('.latest-attempt.json'))readAuthenticated(path,key);
  try{writeAuthenticated(temporary,{id,status},key);renameSync(temporary,path);syncDirectory(directory);}
  finally{try{unlinkSync(temporary);}catch{}}
}
/** Authenticate the entire plaintext before any pg_restore process may consume it. */
export async function decryptArchive(directory:string,id:string,key:Buffer,output?:string):Promise<BackupMetadata>{
  const root=protectedDirectory(directory);backupId(id);
  const metadata=readAuthenticated<BackupMetadata>(join(root,id+'.json'),key),path=join(root,id+'.backup');
  if(metadata.version!==1||metadata.id!==id||metadata.format!=='pg-custom-aes256gcm-v1'||
    !Number.isSafeInteger(metadata.size)||metadata.size<42||metadata.size>10*1024**3||
    !/^[a-f0-9]{64}$/.test(metadata.sha256)||await checksum(path)!==metadata.sha256)throw new BackupError('Backup size, format or checksum invalid.');
  const fd=protectedFile(path);
  try{
    if(fstatSync(fd).size!==metadata.size)throw new BackupError('Backup size mismatch.');
    const {readSync}=await import('node:fs');
    const header=Buffer.alloc(20),tag=Buffer.alloc(16);readSync(fd,header,0,20,0);readSync(fd,tag,0,16,metadata.size-16);
    if(!header.subarray(0,8).equals(magic))throw new BackupError('Unsupported backup format.');
    const decipher=createDecipheriv('aes-256-gcm',key,header.subarray(8));decipher.setAuthTag(tag);decipher.setAAD(Buffer.from('elyqreth-v1:'+id));
    let prefix=Buffer.alloc(0),bytes=0;
    const sink=output?createWriteStream(output,{flags:'wx',mode:0o600}):new Writable({write(_chunk,_encoding,cb){cb();}});
    decipher.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(prefix.length<5)prefix=Buffer.concat([prefix,chunk]).subarray(0,5);});
    await pipeline(createReadStream(path,{fd,autoClose:false,start:20,end:metadata.size-17}),decipher,sink);
    if(bytes<5||prefix.toString()!=='PGDMP')throw new BackupError('Backup is not a PostgreSQL custom archive.');
    return metadata;
  }finally{closeSync(fd);}
}

export async function retainBackups(directory:string,key:Buffer,anchor:string,keep:number,dryRun=true):Promise<{deleted:string[];retained:string[];dryRun:boolean}>{
  if(!Number.isInteger(keep)||keep<2||keep>365)throw new BackupError('Retention keep must be between 2 and 365.');
  return directoryLock(directory,async()=>{
    const attempt=readAuthenticated<{id:string;status:string}>(join(directory,'.latest-attempt.json'),key);
    if(attempt.id!==anchor||attempt.status!=='COMPLETE')throw new BackupError('Retention is blocked after an incomplete or failed backup attempt.');
    const names=readdirSync(directory);if(names.length>4000)throw new BackupError('Backup directory exceeds the bounded retention inventory.');
    const valid:BackupMetadata[]=[];
    for(const name of names.filter(n=>/^elyqreth-.*\.json$/.test(n)&&!n.endsWith('.restored.json'))){
      const id=name.slice(0,-5);try{valid.push(await decryptArchive(directory,id,key));}catch{/* Invalid/foreign files are never deleted. */}
    }
    valid.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id));
    if(valid[0]?.id!==backupId(anchor))throw new BackupError('Retention requires the latest successfully completed backup as its anchor.');
    const protectedReceipts=new Set<string>();
    const restored=valid.filter(m=>{
      try{const receipt=readAuthenticated<{id:string}>(join(directory,m.id+'.restored.json'),key);
        if(receipt.id!==m.id)throw new BackupError();return true;
      }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')protectedReceipts.add(m.id);return false;}
    });
    if(!restored.length)throw new BackupError('Retention requires at least one successfully restored recovery point.');
    const preserve=new Set([...valid.slice(0,keep).map(m=>m.id),restored[0]!.id,...protectedReceipts]);
    const deleted=valid.filter(m=>!preserve.has(m.id)).map(m=>m.id);
    if(!dryRun)for(const id of deleted){
      for(const suffix of ['.backup','.json','.restored.json']){
        const path=join(directory,id+suffix);
        try{const fd=protectedFile(path);closeSync(fd);unlinkSync(path);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
      }
    }
    return {deleted,retained:[...preserve],dryRun};
  });
}

/** Copy encrypted artifacts only; callers must independently verify off-host storage/immutability. */
export async function copyBackup(directory:string,destination:string,id:string,key:Buffer):Promise<void>{
  if(protectedDirectory(directory)===protectedDirectory(destination))throw new BackupError('Copy destination must be distinct.');
  await directoryLock(directory,()=>directoryLock(destination,async()=>{
    backupId(id);recordAttempt(destination,key,id,'STARTED');const created:string[]=[];
    try{
      await decryptArchive(directory,id,key);
      for(const suffix of ['.backup','.json']){
        const source=join(directory,id+suffix),target=join(destination,id+suffix),fd=protectedFile(source);closeSync(fd);
        copyFileSync(source,target,constants.COPYFILE_EXCL);created.push(target);
        const checked=protectedFile(target);closeSync(checked);
        const copied=openSync(target,constants.O_RDWR|constants.O_NOFOLLOW);try{fsyncSync(copied);}finally{closeSync(copied);}
      }
      await decryptArchive(destination,id,key);
      syncDirectory(destination);
      recordAttempt(destination,key,id,'COMPLETE');
    }catch(error){for(const path of created)unlinkSync(path);recordAttempt(destination,key,id,'FAILED');throw error;}
  }));
}
