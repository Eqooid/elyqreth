import { isUUID } from 'class-validator';
import { requestContext } from '../common/request-context';
import { OnModuleInit,Injectable,ForbiddenException,NotFoundException,UnauthorizedException,HttpException } from '@nestjs/common';
import { createHash,randomBytes,randomUUID } from 'node:crypto';
import { and,eq,gt,isNull,sql } from 'drizzle-orm';
import { createLocalJWKSet,jwtVerify } from 'jose';
import { ApiConfig } from '../config/config.module';
import { DatabaseService } from '../database/database.module';
import { authSessions,localAccounts,authLoginLimits,commandAudit } from '../database/schema';
import { hashPassword,verifyPassword,validUsername,validPassword } from './password';
import type { AccountPrincipal } from './principal';
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const correlation=()=>{const id=requestContext.getStore()?.requestId;return id&&isUUID(id)?id:randomUUID();};
const dummy='scrypt-v1$'+'00'.repeat(16)+'$'+'00'.repeat(64);
@Injectable()
export class AuthenticationService implements OnModuleInit {
 private hashing=0;
 private readonly oidcKeys:ReturnType<typeof createLocalJWKSet>|undefined;
 constructor(private readonly config:ApiConfig,private readonly database:DatabaseService){
  if(config.value.authentication?.mode==='oidc')this.oidcKeys=createLocalJWKSet(config.value.authentication.jwks);
 }
 async onModuleInit():Promise<void>{
  if(this.config.value.authentication?.mode!=='local')return;
  // An enabled local installation must not serve traffic against a missing auth schema.
  await this.database.db.select({id:localAccounts.id}).from(localAccounts).limit(0);
  await this.database.db.select({id:authSessions.id}).from(authSessions).limit(0);
  await this.database.db.select({ownerId:authLoginLimits.ownerId}).from(authLoginLimits).limit(0);
 }
 private settings(){const c=this.config.value;if(!c.authentication||!c.registry||!c.database)throw new NotFoundException();return {auth:c.authentication,ownerId:c.registry.ownerId};}
 async login(input:unknown){
  const {auth,ownerId}=this.settings();if(auth.mode!=='local')throw new NotFoundException();
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['username','password'].includes(k)))throw new UnauthorizedException();
  const {username,password}=input as Record<string,unknown>;
  if(!validUsername(username)||!validPassword(password))throw new UnauthorizedException();
  if(this.hashing>=2)throw new HttpException('Login capacity exceeded',429);
  this.hashing++;
  try{
   // Durable installation-wide budget, shared by every instance; unknown users cannot create rows.
   const admitted=await this.database.db.transaction(async tx=>{
    await tx.insert(authLoginLimits).values({ownerId}).onConflictDoNothing();
    const [limit]=await tx.select().from(authLoginLimits).where(eq(authLoginLimits.ownerId,ownerId)).for('update');
    if(!limit)throw new UnauthorizedException();
    const expired=Date.now()-limit.windowStartedAt.getTime()>=60000;
    if(!expired&&limit.attempts>=20)return false;
    await tx.update(authLoginLimits).set({attempts:expired?1:limit.attempts+1,windowStartedAt:expired?new Date():limit.windowStartedAt}).where(eq(authLoginLimits.ownerId,ownerId));return true;
   });
   if(!admitted)throw new HttpException('Login limit exceeded',429);
   const [account]=await this.database.db.select().from(localAccounts).where(and(eq(localAccounts.ownerId,ownerId),eq(localAccounts.username,username))).limit(1);
   const valid=await verifyPassword(password,account?.passwordHash??dummy);
   if(!account||!account.enabled||!valid)throw new UnauthorizedException();
   const token=randomBytes(32).toString('base64url'),expiresAt=new Date(Date.now()+auth.sessionSeconds*1000);
   await this.database.db.transaction(async tx=>{
    const [current]=await tx.select().from(localAccounts).where(and(eq(localAccounts.id,account.id),eq(localAccounts.ownerId,ownerId))).for('update');
    if(!current?.enabled||current.credentialVersion!==account.credentialVersion||current.passwordHash!==account.passwordHash)throw new UnauthorizedException();
    // Bounded cleanup; no unbounded deletion or expiry scans on ordinary protected reads.
    await tx.execute(sql`delete from auth_sessions where id in (select id from auth_sessions where owner_id=${ownerId} and expires_at<now() order by expires_at,id limit 100)`);
    const active=await tx.execute(sql`select count(*)::int n from auth_sessions where owner_id=${ownerId} and account_id=${account.id} and expires_at>now() and revoked_at is null`);
    if(Number(active.rows[0]?.n)>=20)throw new HttpException('Session limit exceeded',429);
    await tx.insert(authSessions).values({ownerId,accountId:account.id,tokenHash:digest(token),credentialVersion:account.credentialVersion,expiresAt});
    await tx.insert(commandAudit).values({ownerId,actorReference:'local-user:'+account.id,commandType:'auth.login',resourceType:'authentication',resourceId:account.id,correlationId:correlation(),outcome:'ACCEPTED',details:{}});
   });
   return {accessToken:token,tokenType:'Bearer',expiresAt:expiresAt.toISOString()};
  }finally{this.hashing--;}
 }
 async authenticate(token:string):Promise<AccountPrincipal>{
  const {auth,ownerId}=this.settings();
  if(typeof token!=='string'||token.length>16384)throw new UnauthorizedException();
  if(auth.mode==='local'){
   if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw new UnauthorizedException();
   const hash=digest(token);
   const [row]=await this.database.db.select({session:authSessions,account:localAccounts}).from(authSessions)
    .innerJoin(localAccounts,and(eq(localAccounts.id,authSessions.accountId),eq(localAccounts.ownerId,authSessions.ownerId)))
    .where(and(eq(authSessions.tokenHash,hash),eq(authSessions.ownerId,ownerId),gt(authSessions.expiresAt,new Date()),isNull(authSessions.revokedAt))).limit(1);
   if(!row?.account.enabled||row.account.credentialVersion!==row.session.credentialVersion)throw new UnauthorizedException();
   return Object.freeze({kind:'LOCAL_ACCOUNT',audience:row.account.role,ownerId,actorReference:'local-user:'+row.account.id,sessionHash:hash});
  }
  let subject:string;
  try{
   const result=await jwtVerify(token,this.oidcKeys!,{issuer:auth.issuer,audience:auth.audience,algorithms:['RS256'],
    requiredClaims:['iss','aud','sub','iat','exp'],clockTolerance:30,maxTokenAge:'1 hour'});
   const accessToken=result.protectedHeader.typ==='at+jwt'||result.protectedHeader.typ==='JWT'&&
    (result.payload.typ==='Bearer'||result.payload.token_use==='access');
   if(!accessToken||!result.protectedHeader.kid||result.payload.typ!==undefined&&result.payload.typ!=='Bearer'||
    typeof result.payload.sub!=='string'||result.payload.sub.length>200||
    result.payload.token_use!==undefined&&result.payload.token_use!=='access')throw Error();
   subject=result.payload.sub;
  }catch{throw new UnauthorizedException();}
  const granted=auth.subjects.find(s=>s.subject===subject);if(!granted)throw new ForbiddenException();
  return Object.freeze({kind:'OIDC',audience:granted.role,ownerId,actorReference:'oidc:'+digest(auth.issuer+'\0'+subject)});
 }
 async logout(principal:AccountPrincipal){
  if(this.settings().auth.mode!=='local'||principal.kind!=='LOCAL_ACCOUNT'||!principal.sessionHash)throw new NotFoundException();
  const sessionHash=principal.sessionHash;
  await this.database.db.transaction(async tx=>{
   await tx.update(authSessions).set({revokedAt:new Date()}).where(and(eq(authSessions.ownerId,principal.ownerId),eq(authSessions.tokenHash,sessionHash),isNull(authSessions.revokedAt)));
   await tx.insert(commandAudit).values({ownerId:principal.ownerId,actorReference:principal.actorReference,commandType:'auth.logout',resourceType:'authentication',correlationId:correlation(),outcome:'ACCEPTED',details:{}});
  });return {revoked:true};
 }
 async provision(input:unknown,action:'create'|'disable'|'password'|'role'){
  const {auth,ownerId}=this.settings();if(auth.mode!=='local')throw new NotFoundException();
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['username','password','role'].includes(k)))throw Error('Invalid local account input');
  const v=input as Record<string,unknown>;if(!validUsername(v.username))throw Error('Invalid username');
  if(['create','role'].includes(action)&&!['viewer','operator'].includes(String(v.role)))throw Error('Role must be viewer or operator');
  const passwordHash=['create','password'].includes(action)?await hashPassword(v.password as string):undefined;
  return this.database.db.transaction(async tx=>{
   let id:string;
   if(action==='create'){
    const [created]=await tx.insert(localAccounts).values({ownerId,username:v.username as string,passwordHash:passwordHash!,role:v.role as 'viewer'|'operator'}).returning({id:localAccounts.id});id=created!.id;
   }else{
    const [changed]=await tx.update(localAccounts).set({...(action==='disable'?{enabled:false}:{}),...(passwordHash?{passwordHash}:{}),
     ...(action==='role'?{role:v.role as 'viewer'|'operator'}:{}),credentialVersion:sql`${localAccounts.credentialVersion}+1`,updatedAt:new Date()})
     .where(and(eq(localAccounts.ownerId,ownerId),eq(localAccounts.username,v.username as string))).returning({id:localAccounts.id});
    if(!changed)throw new NotFoundException();id=changed.id;
   }
   await tx.insert(commandAudit).values({ownerId,actorReference:'trusted-local-account-command',commandType:'auth.account.'+action,resourceType:'authentication',resourceId:id,correlationId:correlation(),outcome:'ACCEPTED',details:{}});
   return {id};
  });
 }
}
