const {test}=require('node:test');const assert=require('node:assert/strict');
const {mkdtempSync,mkdirSync,rmSync,writeFileSync,readFileSync,statSync,appendFileSync,existsSync,linkSync,symlinkSync}=require('node:fs');
const {join,dirname,basename,resolve}=require('node:path');const {tmpdir}=require('node:os');const {randomBytes}=require('node:crypto');const {Readable}=require('node:stream');
const files=require('../dist/database/backup-files');const {restoreTarget}=require('../dist/database/backup');
async function fixture(fn){const dir=mkdtempSync(join(tmpdir(),'elyqreth-backup-unit-')),key=randomBytes(32);try{await fn(dir,key);}finally{key.fill(0);assert.equal(dirname(resolve(dir)),resolve(tmpdir()));assert.ok(basename(dir).startsWith('elyqreth-backup-unit-'));rmSync(dir,{recursive:true,force:true});}}
async function artifact(directory,key,index=0){
  const id=files.newBackupId(),path=join(directory,id+'.backup');
  await files.encryptArchive(Readable.from([Buffer.from('PGDMPsynthetic archive unit fixture')]),path,key);
  const m={version:1,id,createdAt:new Date(1700000000000+index*1000).toISOString(),database:'synthetic',serverVersion:170011,toolVersion:'17.11',format:'pg-custom-aes256gcm-v1',size:statSync(path).size,sha256:await files.checksum(path),schema:[],counts:{}};
  files.writeAuthenticated(join(directory,id+'.json'),m,key);return m;
}
test('encrypted artifacts and authenticated metadata reject changed bytes, wrong keys, missing files and unsupported formats',()=>fixture(async(dir,key)=>{
  const m=await artifact(dir,key);assert.equal((await files.decryptArchive(dir,m.id,key)).id,m.id);
  assert.ok(!readFileSync(join(dir,m.id+'.backup')).includes(Buffer.from('synthetic archive')));
  await assert.rejects(files.decryptArchive(dir,m.id,randomBytes(32)));
  const value=readFileSync(join(dir,m.id+'.json'),'utf8');writeFileSync(join(dir,m.id+'.json'),value.replace('synthetic','forged'));
  await assert.rejects(files.decryptArchive(dir,m.id,key));writeFileSync(join(dir,m.id+'.json'),value);
  appendFileSync(join(dir,m.id+'.backup'),'corrupt');await assert.rejects(files.decryptArchive(dir,m.id,key),/checksum/);
  await assert.rejects(files.decryptArchive(dir,files.newBackupId(),key));
  const invalid=await artifact(dir,key,1);const path=join(dir,invalid.id+'.json');rmSync(path);
  files.writeAuthenticated(path,{...invalid,format:'sql'},key);await assert.rejects(files.decryptArchive(dir,invalid.id,key),/format/);
}));
test('artifact writes never overwrite existing files; directory locking is exclusive',()=>fixture(async(dir,key)=>{
  const path=join(dir,files.newBackupId()+'.backup');writeFileSync(path,'preserve',{mode:0o600});
  await assert.rejects(files.encryptArchive(Readable.from(['PGDMP']),path,key));assert.equal(readFileSync(path,'utf8'),'preserve');
  await files.directoryLock(dir,async()=>{await assert.rejects(files.directoryLock(dir,async()=>{}),/busy/);});
}));
test('retention defaults to dry-run, preserves latest points and last restore-tested point, and ignores unrelated files',()=>fixture(async(dir,key)=>{
  const points=[];for(let i=0;i<4;i++)points.push(await artifact(dir,key,i));
  files.writeAuthenticated(join(dir,points[0].id+'.restored.json'),{id:points[0].id},key);
  files.recordAttempt(dir,key,points[3].id,'COMPLETE');writeFileSync(join(dir,'unrelated.txt'),'preserve');
  const dry=await files.retainBackups(dir,key,points[3].id,2);assert.deepEqual(dry.deleted,[points[1].id]);assert.ok(existsSync(join(dir,points[1].id+'.backup')));
  const result=await files.retainBackups(dir,key,points[3].id,2,false);assert.equal(result.retained.length,3);
  assert.equal(existsSync(join(dir,points[1].id+'.backup')),false);assert.ok(existsSync(join(dir,points[0].id+'.backup')));assert.ok(existsSync(join(dir,'unrelated.txt')));
  files.recordAttempt(dir,key,files.newBackupId(),'FAILED');await assert.rejects(files.retainBackups(dir,key,points[3].id,2,false),/failed/);
}));
test('retention refuses untested recovery points, unsafe keep values and stale anchors',()=>fixture(async(dir,key)=>{
  const point=await artifact(dir,key);files.recordAttempt(dir,key,point.id,'COMPLETE');
  await assert.rejects(files.retainBackups(dir,key,point.id,2),/restored/);
  for(const keep of [0,1,366,-1,NaN])await assert.rejects(files.retainBackups(dir,key,point.id,keep));
  await assert.rejects(files.retainBackups(dir,key,'../../elsewhere',2));
}));
test('encrypted copy validates destination, refuses replacement and rejects hard-linked artifacts',()=>fixture(async(dir,key)=>{
  const store=join(dir,'store');mkdirSync(store,{mode:0o700});const point=await artifact(dir,key);
  await files.copyBackup(dir,store,point.id,key);assert.equal((await files.decryptArchive(store,point.id,key)).id,point.id);
  await assert.rejects(files.copyBackup(dir,store,point.id,key));
  const link=join(dir,'hardlink');linkSync(join(dir,point.id+'.backup'),link);
  await assert.rejects(files.decryptArchive(dir,point.id,key),/protected/);
}));
test('restore rejects production, remote, ambiguous, unconfirmed and arbitrary targets before database access',()=>{
  const id=files.newBackupId(),database='elyqreth_restore_'+'a'.repeat(24),config={host:'127.0.0.1',database,production:false};
  const req={directory:'/unused',expectedDatabase:database,expectedHost:config.host,id,environment:'isolated',confirmation:'RESTORE ISOLATED '+database};
  restoreTarget(config,req);
  for(const patch of [{environment:'production'},{confirmation:''},{expectedDatabase:'postgres'},{expectedHost:'remote'},{id:'../backup'}])assert.throws(()=>restoreTarget(config,{...req,...patch}));
  assert.throws(()=>restoreTarget({...config,production:true},req));
  assert.throws(()=>restoreTarget({...config,host:'db.internal'},{...req,expectedHost:'db.internal'}));
});
test('GCM authentication rejects changed ciphertext even with a newly signed matching checksum',()=>fixture(async(dir,key)=>{
  const m=await artifact(dir,key),path=join(dir,m.id+'.backup'),meta=join(dir,m.id+'.json'),data=readFileSync(path);
  data[24]^=1;writeFileSync(path,data);rmSync(meta);files.writeAuthenticated(meta,{...m,sha256:await files.checksum(path)},key);
  await assert.rejects(files.decryptArchive(dir,m.id,key));
}));
test('recovery directories reject source/web locations and symbolic directory aliases',t=>fixture(async(dir)=>{
  assert.throws(()=>files.protectedDirectory(process.cwd()));
  const actual=join(dir,'actual'),alias=join(dir,'alias');mkdirSync(actual,{mode:0o700});
  try{symlinkSync(actual,alias,process.platform==='win32'?'junction':'dir');}
  catch(error){if(error.code==='EPERM'){t.skip('OS does not permit this symbolic-link fixture');return;}throw error;}
  assert.throws(()=>files.protectedDirectory(alias));
}));
test('operator CLI rejects invalid artifacts with nonzero status and never prints recovery keys or request secrets',()=>fixture(async(dir,key)=>{
  const keyFile=join(dir,'key');writeFileSync(keyFile,key.toString('hex'),{mode:0o600});
  const {execFile}=require('node:child_process');
  const result=await new Promise(resolve=>{const child=execFile(process.execPath,[join(__dirname,'../dist/database/backup-command.js'),'verify'],
    {env:{...process.env,NODE_ENV:'test'},timeout:10000},(error,stdout,stderr)=>resolve({code:error?.code??0,stdout,stderr}));
    child.stdin.end(JSON.stringify({directory:dir,id:files.newBackupId(),keyFile}));});
  assert.equal(result.code,1);assert.equal(result.stdout,'');assert.ok(!result.stderr.includes(key.toString('hex')));
}));
test('retention preserves foreign files even when they use a valid backup receipt filename',()=>fixture(async(dir,key)=>{
  const points=[];for(let i=0;i<5;i++)points.push(await artifact(dir,key,i));
  files.writeAuthenticated(join(dir,points[0].id+'.restored.json'),{id:points[0].id},key);
  const foreign=join(dir,points[1].id+'.restored.json');writeFileSync(foreign,'foreign content',{mode:0o600});
  files.recordAttempt(dir,key,points[4].id,'COMPLETE');
  const result=await files.retainBackups(dir,key,points[4].id,2,false);
  assert.deepEqual(result.deleted,[points[2].id]);assert.equal(readFileSync(foreign,'utf8'),'foreign content');
}));
test('ciphertext cannot be substituted between backup identities even with a newly signed checksum',()=>fixture(async(dir,key)=>{
  const a=await artifact(dir,key),b=await artifact(dir,key,1),path=join(dir,a.id+'.backup'),meta=join(dir,a.id+'.json');
  writeFileSync(path,readFileSync(join(dir,b.id+'.backup')));rmSync(meta);
  files.writeAuthenticated(meta,{...a,size:statSync(path).size,sha256:await files.checksum(path)},key);
  await assert.rejects(files.decryptArchive(dir,a.id,key));
}));
