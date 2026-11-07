import { loadConfiguration } from '../config/configuration';
import { readConfigurationFile } from '../config/file-inputs';
import { createBackup, provisionBackupRole, restoreBackup, verifyBackup } from './backup';
import { BackupError, copyBackup, retainBackups } from './backup-files';

/** Operator-only CLI; JSON stdin avoids secret argv/history. No HTTP recovery endpoints. */
export async function recoveryCommand():Promise<void>{
  const mode=process.argv[2];
  const allowed:Record<string,string[]>={
    provision:['expectedDatabase','expectedHost','role','password'],
    backup:['directory','expectedDatabase','expectedHost','keyFile'],
    verify:['directory','id','keyFile'], copy:['directory','destination','id','keyFile'],
    retention:['directory','anchor','keep','dryRun','keyFile'],
    restore:['directory','expectedDatabase','expectedHost','id','environment','confirmation','keyFile'],
  };
  if(!mode||!allowed[mode]||process.argv.length!==3)throw new BackupError('Select provision, backup, verify, copy, retention or restore.');
  let body='';for await(const chunk of process.stdin){body+=chunk.toString();if(Buffer.byteLength(body)>8192)throw new BackupError('Recovery request exceeds 8 KiB.');}
  const input=JSON.parse(body);
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!allowed[mode]!.includes(k)))throw new BackupError('Invalid recovery request.');
  for(const field of allowed[mode]!){
    if(['password','dryRun'].includes(field)&&input[field]===undefined)continue;
    if(field==='keep'){if(!Number.isInteger(input.keep))throw new BackupError();}
    else if(field==='dryRun'){if(typeof input[field]!=='boolean')throw new BackupError();}
    else if(typeof input[field]!=='string'||input[field].length>2048)throw new BackupError('Recovery request is missing a valid field.');
  }
  // Artifact-only commands do not load local .env or require database credentials.
  let key:Buffer|undefined;
  try{
    if(mode!=='provision'){
      const encoded=readConfigurationFile(input.keyFile,'RECOVERY_KEY_FILE',process.env.NODE_ENV==='production',true,128);
      if(!/^[a-f0-9]{64}$/.test(encoded))throw new BackupError('Recovery key file must hold a 32-byte random key encoded as 64 lower-case hex characters.');
      key=Buffer.from(encoded,'hex');
    }
    let result:unknown;
    if(mode==='verify'){const metadata=await verifyBackup(input.directory,input.id,key!);result={id:metadata.id,status:'ARTIFACT_VALIDATED'};}
    else if(mode==='copy'){await copyBackup(input.directory,input.destination,input.id,key!);result={id:input.id,status:'ENCRYPTED_COPY_VALIDATED'};}
    else if(mode==='retention')result=await retainBackups(input.directory,key!,input.anchor,input.keep,input.dryRun??true);
    else{
      const config=loadConfiguration().database;if(!config)throw new BackupError('Explicit database configuration is required.');
      if(mode==='provision'){await provisionBackupRole(config,input);result={status:'BACKUP_ROLE_PROVISIONED'};}
      else if(mode==='backup'){const metadata=await createBackup(config,input,key!);result={id:metadata.id,bytes:metadata.size,status:'BACKED_UP_NOT_RESTORE_VERIFIED'};}
      else{const metadata=await restoreBackup(config,input,key!);result={id:metadata.id,status:'RESTORED_VERIFIED_QUARANTINED'};}
    }
    process.stdout.write(JSON.stringify(result)+'\n');
  }finally{key?.fill(0);}
}
if(require.main===module)void recoveryCommand().catch(error=>{
  process.stderr.write((error instanceof BackupError?error.message:'Recovery operation failed. Check private configuration, permissions and artifact integrity.')+'\n');
  process.exitCode=1;
});
