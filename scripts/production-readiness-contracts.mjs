const invalid=()=>{throw Error('Readiness evidence is missing or inconsistent. Review fixed repository evidence; values are not printed.');};
const required=(value)=>{if(!value)invalid();};
const successful=commands=>{required(Array.isArray(commands)&&commands.length>0);for(const c of commands){required(c.exitCode===0&&c.status==='PASS');if(c.tests?.tests!==undefined)required(c.tests.fail===0&&c.tests.pass===c.tests.tests&&c.tests.skipped===0);}};
export function assessReadiness(t13,t14){
 required(t13?.task==='Phase6 T13 Isolated Staging/UAT Rehearsal'&&t13.status==='PARTIAL'&&t13.localExecutedChecks==='PASS'&&t13.rehearsalExitCode===0);
 required(t14?.task==='Phase6 T14 Security, Capacity & Disaster-Recovery Verification'&&t14.status==='PARTIAL'&&t14.releaseReadiness==='NOT READY'&&t14.exitCode===0);
 successful(t13.commands);successful(t14.commands);successful(t14.qualityRerun?.commands);
 required(Array.isArray(t14.capacity?.stages)&&t14.capacity.stages.length>0&&t14.capacity.status==='PASS');
 for(const stage of t14.capacity.stages)required(stage.status==='PASS'&&stage.stopped===false&&stage.completed===stage.requested&&stage.concurrency<=8&&stage.requested<=64);
 required(t14.disasterRecovery?.status==='PASS'&&t14.disasterRecovery.sourceDatabaseDeleted===true&&t14.disasterRecovery.restoredTables===21);
 required(t14.disasterRecovery.approvedRpo===null&&t14.disasterRecovery.approvedRto===null);
 required(Array.isArray(t14.findings)&&t14.findings.filter(f=>f.severity==='HIGH'&&f.releaseBlocking&&f.status==='OPEN / EVIDENCE GAP').length===6);
 const local='PARTIALLY VERIFIED',blocked='BLOCKED';
 const rows=[
 ['APP-01','Application correctness',local,'T13 commands/UAT; T14 qualityRerun','HIGH','Application','Bind the tested code and successful smoke results to the approved candidate'],
 ['AUTH-01','Authentication and sessions',local,'T14 SEC-01; T13 UAT-03','HIGH','Authentication','Select reviewed installation mode and production identity/key/account policy; verify actual target'],
 ['AUTHZ-01','Object authorization',local,'T14 SEC-02; negative owner/viewer tests','CRITICAL','Authorization','Confirm private operator audience and owner policy; public multitenancy is not accepted'],
 ['CTR-01','Container security',local,'T14 SEC-04, local locked-image probes','HIGH','Containers','Scan approved candidate images with reviewed scanner/database and disposition findings'],
 ['NET-01','Network/TLS boundary',local,'T14 SEC-04; actual local edge isolation','CRITICAL','Edge/network','Verify designated host/private DB/DNS/cert renewal and administrative access'],
 ['DB-01','Database/migration safety',local,'T14 role tests; T07 preflight/locking','CRITICAL','Database','Verify target identity, role separation, real journal and dedicated migration preflight under approved access'],
 ['RT-01','Native runtime reliability',local,'T14 RES-01; drain/crash/fencing','CRITICAL','Runtime','Approve single writer, maintenance/drain policy and effect reconciliation on exact target'],
 ['COL-01','Collaboration reliability',local,'T14 CAP-04/RES-01; one effective child','HIGH','Collaboration','Retain two-participant/one-child policy; verify approved candidate smoke without duplicate work'],
 ['EXT-01','External integration security',local,'T14 SEC-05/06; T10 production gate closed','CRITICAL','External integration','Keep production activation disabled; enabled mode needs separately approved target/source policy'],
 ['BAK-01','Backup and restore',local,'T14 DR-01/02; actual source database loss','CRITICAL','Recovery','Verify fresh target-bound backup, off-host storage/key availability and restore evidence'],
 ['DR-01','Operational disaster recovery',blocked,'T14 H-04/H-06; approvedRpo/Rto null','HIGH','Recovery operators','Approve objectives and exercise full hosting/key/session/effect-reconciliation procedure'],
 ['CAP-01','Production capacity',blocked,'T14 H-03; finite burst measurements','HIGH','Capacity owner','Approve workload/resource/cost expectations and compare representative sustained measurements'],
 ['OBS-01','Monitoring/on-call',blocked,'T14 H-05; T11 email fixtures only','HIGH','Operations','Name responder/escalation and verify approved receiver delivery and monitoring access'],
 ['RUN-01','Runbooks/human handoff',local,'T14 OPS-01/M-01; code-driven runbook checks','HIGH','Operations','Assign contacts and complete human UAT/tabletop and target-specific commands'],
 ['ART-01','Immutable candidate',blocked,'T12 contracts; T14 H-01/H-02','HIGH','Release','Supply canonical source commit, candidate bundle/digests, trusted expected SHA and producer/provenance/scans'],
 ['PIPE-01','Controlled deployment pipeline',blocked,'P6-ADR-016; T12 PLAN_ONLY_NO_DEPLOYMENT','HIGH','Release pipeline','Approve and implement deployment mechanism and protected environment; no execution adapter exists'],
 ['ROLL-01','Rollback readiness',blocked,'T14 H-02; synthetic rollback gates only','HIGH','Release/database','Provide compatible previous digest tuple and actual isolated rollback evidence; no down migration'],
 ['CFG-01','Production configuration/secrets',blocked,'T02-T06 contracts; no production inputs','HIGH','Configuration owner','Review target-only configuration/private secret references without exposing values'],
 ['TGT-01','Approved target preflight',blocked,'No designated production target or access','HIGH','Infrastructure owner','Designate environment and authorize read-only access separately; do not connect now'],
 ['APPR-01','Deployment authorization',blocked,'Current prompt explicitly excludes authorization','CRITICAL','Protected approval mechanism','Authorize exact manifest hash, target, operation, approver and window only after blockers close'],
 ];
 return {version:1,mode:'OFFLINE_READINESS_REVIEW_ONLY',goNoGo:'BLOCKED',authorizationStatus:'AWAITING PRODUCTION AUTHORIZATION',promotionExecutionStatus:'NOT STARTED',phase6Status:'BLOCKED',t15Status:'PARTIAL',productionAccessPerformed:false,productionMutationPerformed:false,
  candidate:{releaseId:null,sourceCommit:null,manifest:null,manifestSha256:null,registryImageDigests:null,verified:false},
  authorization:{configuredMechanism:null,approvalEvidence:null,operation:null,window:null,authenticated:false},
  matrix:rows.map(([id,requirement,status,evidence,severity,component,requiredAction])=>({id,requirement,status,evidence,severity,releaseBlocking:true,responsibleComponent:component,requiredAction})),
  unresolvedCriticalFindings:t14.findings.filter(f=>f.severity==='CRITICAL'&&f.releaseBlocking&&f.status!=='RESOLVED'),
  unresolvedHighFindings:t14.findings.filter(f=>f.severity==='HIGH'&&f.releaseBlocking),
  exceptions:[],limitations:['Locally edited JSON/hashes prove neither authenticity nor production approval.','No publisher, deployment/SSH executor, production preflight connector or approval credential consumer exists here.','All successful historical tests retain their original local/fixture scope; no production check or candidate verification is inferred.']};
}
