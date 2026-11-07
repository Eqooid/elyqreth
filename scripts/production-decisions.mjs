import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {jsonFile} from './release/contracts.mjs';
import {newOutsideOutput} from './rehearsal-output.mjs';
import {assessDecisions} from './production-decision-contracts.mjs';
const root=resolve(import.meta.dirname,'..');
try{
 const args=process.argv.slice(2),flags={};
 for(let i=0;i<args.length;i+=2){if(!['--config','--output','--manifest'].includes(args[i])||!args[i+1]||Object.hasOwn(flags,args[i]))throw Error();flags[args[i]]=args[i+1];}
 if(!flags['--config']||!flags['--output'])throw Error();
 const output=newOutsideOutput(root,flags['--output']);
 const report=assessDecisions(jsonFile(resolve(flags['--config']),65536),flags['--manifest']?jsonFile(resolve(flags['--manifest'])):undefined);
 mkdirSync(output,{mode:0o700});writeFileSync(join(output,'decisions.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});
 console.log(JSON.stringify({status:report.status,promotion:report.promotion,missing:report.missing.length,invalid:report.invalid.length,conflicts:report.conflicts.length,report:join(output,'decisions.json')}));
 // Even a complete worksheet is not authorization, authenticated evidence or promotion readiness.
 process.exitCode=report.status==='INVALID'?1:2;
}catch{console.error('Offline decision check failed. Use --config <JSON> --output <new directory outside checkout> [--manifest <local release.json>]. Values are not printed; no production access or operation is performed.');process.exitCode=1;}
