const {test}=require('node:test'),assert=require('node:assert/strict');
const {readFileSync}=require('node:fs'),{resolve}=require('node:path'),{pathToFileURL}=require('node:url');
const root=resolve(__dirname,'../../..'),evidence=name=>JSON.parse(readFileSync(resolve(root,'docs/ai-agent-platform/phase-6/verification-evidence',name),'utf8'));
const pair=()=>[evidence('staging-uat-verification.json'),evidence('security-capacity-recovery-verification.json')];
const load=()=>import(pathToFileURL(resolve(root,'scripts/production-readiness-contracts.mjs')).href);
test('T15 actual partial T13/T14 evidence produces blocking offline review without candidate or approval',async()=>{
 const {assessReadiness}=await load(),r=assessReadiness(...pair());assert.equal(r.goNoGo,'BLOCKED');assert.equal(r.authorizationStatus,'AWAITING PRODUCTION AUTHORIZATION');assert.equal(r.promotionExecutionStatus,'NOT STARTED');assert.equal(r.candidate.verified,false);assert.equal(r.candidate.sourceCommit,null);assert.equal(r.unresolvedHighFindings.length,6);assert.equal(r.matrix.length,20);assert.equal(r.productionAccessPerformed,false);
});
test('T15 fails closed for missing, failed or internally contradictory evidence',async()=>{
 const {assessReadiness}=await load();assert.throws(()=>assessReadiness(null,null));
 for(const change of [(a,b)=>{b.commands[0].exitCode=1;},(a,b)=>{b.capacity.stages[0].completed--;},(a,b)=>{b.disasterRecovery.status='FAILED';},(a,b)=>{b.findings=[];},(a,b)=>{b.qualityRerun.commands.find(c=>c.tests?.tests).tests.fail=1;}]){const [a,b]=pair();change(a,b);assert.throws(()=>assessReadiness(a,b));}
});
test('T15 operator assertions, availability of credentials and successful tests cannot authorize production',async()=>{
 const {assessReadiness}=await load(),[a,b]=pair();b.approval={status:'APPROVED',reviewer:'self',target:'production'};b.credentialsAvailable=true;
 b.findings.push({id:'synthetic-critical',severity:'CRITICAL',releaseBlocking:true,status:'OPEN'});
 const r=assessReadiness(a,b,{authorized:true});assert.equal(r.authorization.authenticated,false);assert.equal(r.goNoGo,'BLOCKED');assert.equal(r.phase6Status,'BLOCKED');assert.deepEqual(r.exceptions,[]);assert.equal(r.unresolvedCriticalFindings[0].id,'synthetic-critical');
});
