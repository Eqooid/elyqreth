const {spawnSync}=require('node:child_process');
const result=spawnSync(process.execPath,['--test','--test-name-pattern=authentication','test/database.integration.cjs'],{
 stdio:'inherit',env:{...process.env,ELYQRETH_KEYCLOAK_LIVE:'true'},windowsHide:true});
process.exitCode=result.status??1;
