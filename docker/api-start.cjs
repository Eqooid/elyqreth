// Compatibility adapter for development Compose only; production always uses the reviewed DATABASE_URL contract.
function databaseEnvironment(env) {
 if(env.NODE_ENV==='production'||env.DATABASE_URL!==undefined||env.DATABASE_URL_FILE!==undefined||env.POSTGRES_PASSWORD===undefined)return;
 const url=new URL('postgresql://postgres:5432/');url.username=encodeURIComponent(env.POSTGRES_USER??'elyqreth');url.password=encodeURIComponent(env.POSTGRES_PASSWORD);url.pathname='/'+encodeURIComponent(env.POSTGRES_DB??'elyqreth');env.DATABASE_URL=url.href;env.DATABASE_SSL_MODE??='disable';
}
module.exports={databaseEnvironment};
if(require.main===module){
 const mode=process.argv[2]??'serve';
 if(!['serve','migrate','preflight'].includes(mode)){process.stderr.write('Unsupported container command.\n');process.exitCode=1;}
 else{
  try{const env={...process.env};databaseEnvironment(env);const configuration=require('../apps/api/dist/config/configuration.js').loadConfiguration(env);
   if(mode==='serve'){const main=require('../apps/api/dist/main.js');void main.bootstrap(configuration).catch(main.startupFailure);}
   else void require('../apps/api/dist/database/migrate.js').migrateDatabase(configuration.database,mode==='preflight').then(result=>process.stdout.write(mode==='preflight'?JSON.stringify(result)+'\n':'Database migrations applied.\n')).catch(()=>{process.stderr.write('Database migration failed. Check configuration, connectivity and permissions.\n');process.exitCode=1;});
  }catch{process.stderr.write('Container configuration invalid. Check configuration and mounted file permissions.\n');process.exitCode=1;}
 }
}
