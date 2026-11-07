import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
const N=131072,r=8,p=1,maxmem=256*1024*1024;
export const validPassword=(value:unknown):value is string=>typeof value==='string'&&Buffer.byteLength(value)<=256&&[...value].length>=16&&!/[\x00-\x1f\x7f\uD800-\uDFFF]/u.test(value);
export const validUsername=(value:unknown):value is string=>typeof value==='string'&&/^[a-z0-9][a-z0-9_.-]{2,63}$/.test(value);
const derive=(password:string,salt:Buffer):Promise<Buffer>=>new Promise((resolve,reject)=>scrypt(password,salt,64,{N,r,p,maxmem},(error,key)=>error?reject(error):resolve(key)));
export async function hashPassword(password:string):Promise<string>{
 if(!validPassword(password))throw new Error('Password must contain at least 16 characters and at most 256 UTF-8 bytes.');
 const salt=randomBytes(16),key=await derive(password,salt);return 'scrypt-v1$'+salt.toString('hex')+'$'+key.toString('hex');
}
export async function verifyPassword(password:string,encoded:string):Promise<boolean>{
 if(!validPassword(password)||!/^scrypt-v1\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(encoded))return false;
 const [,salt,key]=encoded.split('$');return timingSafeEqual(await derive(password,Buffer.from(salt!,'hex')),Buffer.from(key!,'hex'));
}
