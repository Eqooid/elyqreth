import {readFileSync,writeFileSync,mkdirSync,lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {newOutsideOutput} from './rehearsal-output.mjs';
import {assessReadiness} from './production-readiness-contracts.mjs';
const root=resolve(import.meta.dirname,'..');
try{
 const args=process.argv.slice(2);if(args.length!==2||args[0]!=='--output')throw Error();
 const output=newOutsideOutput(root,args[1]);
 const files=['staging-uat-verification.json','security-capacity-recovery-verification.json'].map(name=>join(root,'docs/ai-agent-platform/phase-6/verification-evidence',name));
 const inputs=files.map(path=>{const s=lstatSync(path);if(!s.isFile()||s.isSymbolicLink()||s.size>1024*1024)throw Error();const bytes=readFileSync(path);if(bytes.length>1024*1024)throw Error();return {path,bytes,value:JSON.parse(bytes.toString('utf8'))};});
 const report=assessReadiness(...inputs.map(input=>input.value));
 report.assessedAt=new Date().toISOString();report.inputEvidence=inputs.map(({path,bytes})=>({file:path.slice(root.length+1).replaceAll('\\','/'),sha256:createHash('sha256').update(bytes).digest('hex'),trust:'Local file integrity reference only; not authenticated approval'}));
 mkdirSync(output,{mode:0o700});writeFileSync(join(output,'readiness.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify({goNoGo:report.goNoGo,authorizationStatus:report.authorizationStatus,promotionExecutionStatus:report.promotionExecutionStatus,report:join(output,'readiness.json')}));process.exitCode=2;
}catch{console.error('Offline readiness review failed. Use --output <new directory outside checkout> and valid fixed repository evidence. No production access or operation was performed.');process.exitCode=1;}
