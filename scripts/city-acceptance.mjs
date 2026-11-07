import {spawn} from 'node:child_process';
const child=spawn(process.execPath,['--test','--test-name-pattern=P3 T10 real browser','apps/api/test/database.integration.cjs'],{
 env:{...process.env,ELYQRETH_CITY_E2E:'true'},stdio:'inherit',windowsHide:true});
child.once('error',()=>{process.stderr.write('City acceptance runner could not start.\n');process.exitCode=1;});
child.once('exit',code=>{process.exitCode=code??1;});
