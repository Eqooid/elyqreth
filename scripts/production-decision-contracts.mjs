import {reference,validateManifest,canonical} from './release/contracts.mjs';
import {sha} from './release/oci.mjs';

// Administrative worksheet only. Nothing here authenticates an approver or enables a workflow.
export const decisionSchema={
 source:{repository:'repository',repositoryUrl:'repositoryUrl',defaultBranch:'branch',sourceCommit:'commit',branchProtectionEvidenceRef:'ref',approvalEvidenceRef:'ref'},
 registry:{origin:'origin',imagePrefix:'prefix',visibility:'visibility',retentionPolicyRef:'ref',publisherIdentityRef:'ref',productionPullIdentityRef:'ref',digestRetentionEvidenceRef:'ref',approvalEvidenceRef:'ref'},
 candidate:{releaseManifestRef:'ref',expectedManifestSha256:'hash',apiDigest:'digest',webDigest:'digest',edgeDigest:'digest',producerEvidenceRef:'ref',stagingReceiptRef:'ref'},
 target:{environmentId:'id',hostingRef:'ref',deploymentMechanismRef:'ref',privateDatabaseRef:'ref',dnsTlsOwnerRef:'ref',networkApprovalRef:'ref',secretInjectionRef:'ref',backupDestinationRef:'ref',monitoringRef:'ref',authenticationMode:'auth',containerRuntime:'ref',topologyEvidenceRef:'ref',persistentStorageRef:'ref',approvalEvidenceRef:'ref'},
 transport:{kind:'transport',registryOrigin:'origin',targetEnvironmentId:'id',digestPinned:'boolean',hostIdentityEvidenceRef:'ref',leastPrivilegeEvidenceRef:'ref',credentialLifetimePolicyRef:'ref',auditPolicyRef:'ref',approvalIntegrationRef:'ref',concurrencyPolicyRef:'ref',rollbackCompatibilityRef:'ref',approvalEvidenceRef:'ref'},
 roles:Object.fromEntries(['deploymentApprover','deploymentOperator','incidentPrimary','incidentBackup','databaseRecoveryOperator','backupKeyCustodian','securityEscalation','monitoringOwner'].map(role=>[role,{principalRef:'ref',privateContactRef:'ref',assignmentEvidenceRef:'ref',backupPrincipalRef:'ref',escalationProcedureRef:'ref'}])),
 capacity:{concurrentUsers:'positiveInteger',activeAgents:'positiveInteger',concurrentExecutions:'positiveInteger',taskSubmissionsPerSecond:'positive',collaborationWorkloadRef:'ref',externalEventsPerSecond:'nonnegative',latencyRequirementRef:'ref',maximumErrorRate:'ratio',resourceHeadroomRef:'ref',growthAssumptionsRef:'ref',approvalEvidenceRef:'ref'},
 recovery:{maximumDataLossSeconds:'nonnegative',maximumRecoverySeconds:'positive',backupFrequencyRef:'ref',retentionPolicyRef:'ref',restoreVerificationCadenceRef:'ref',keyEscrowRef:'ref',sessionInvalidationProcedureRef:'ref',effectReconciliationProcedureRef:'ref',disasterEscalationRef:'ref',approvalEvidenceRef:'ref',backupSurvivesHostLoss:'boolean',keyCustodySurvivesHostLoss:'boolean',offHostStorageEvidenceRef:'ref',restoreEvidenceRef:'ref'},
 monitoring:{testChannelRef:'ref',deliveryReceiptRef:'ref',operatorAcknowledgementRef:'ref',alertPolicyRef:'ref',senderPolicyRef:'ref',emailTransportEvidenceRef:'ref',deliveryAuthorizationRef:'ref'},
 authorization:{protectedMechanismRef:'ref',manifestSha256:'hash',targetEnvironmentId:'id',operation:'operation',window:'ref',rollbackAuthorityRef:'ref',authenticatedApprovalEvidenceRef:'ref'}
};
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const text=v=>typeof v==='string'&&v.length>0&&v.length<=400&&!/[\x00-\x1f\x7f]/.test(v);
function valid(type,v){
 if(['positive','nonnegative','ratio','positiveInteger'].includes(type))return typeof v==='number'&&Number.isFinite(v)&&(type==='nonnegative'||type==='ratio'?v>=0:v>0)&&(type!=='ratio'||v<=1)&&(type!=='positiveInteger'||Number.isSafeInteger(v));
 if(type==='boolean')return typeof v==='boolean';
 if(!text(v))return false;
 if(type==='ref')return !/-----BEGIN|(?:Bearer\s|password\s*=)/i.test(v);
 if(type==='repository')return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(v);
 if(type==='repositoryUrl')return /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(v);
 if(type==='branch')return /^[A-Za-z0-9_./-]+$/.test(v)&&!v.includes('..')&&!v.startsWith('/')&&!v.endsWith('/');
 if(type==='commit')return /^[a-f0-9]{40}$/.test(v);
 if(type==='hash')return /^[a-f0-9]{64}$/.test(v);
 if(type==='digest')return /^sha256:[a-f0-9]{64}$/.test(v);
 if(type==='id')return /^[A-Za-z0-9_.-]{1,100}$/.test(v);
 if(type==='visibility')return ['private','internal','public'].includes(v);
 if(type==='auth')return ['local','oidc'].includes(v);
 if(type==='transport')return ['ci-controlled','ssh','deployment-agent','other-reviewed'].includes(v);
 if(type==='operation')return v==='promote';
 if(type==='origin'){try{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname==='/'&&v===u.origin;}catch{return false;}}
 if(type==='prefix'){try{reference(v+'/api@sha256:'+'0'.repeat(64));return true;}catch{return false;}}
 return false;
}
export function assessDecisions(record,manifest){
 const missing=[],invalid=[],conflicts=[];
 const add=(list,path,code)=>list.push({path,code});
 function walk(value,schema,path=''){
  if(!object(value)){add(invalid,path||'record','OBJECT_REQUIRED');return;}
  // Unknown input keys are never copied into the report, including suspicious names/values.
  if(Object.keys(value).some(k=>!Object.hasOwn(schema,k)))add(invalid,path||'record','UNKNOWN_FIELDS');
  for(const [key,type]of Object.entries(schema)){
   const loc=path?path+'.'+key:key,v=value[key];
   if(object(type)){walk(v,type,loc);continue;}
   if(v===null||v===undefined){add(missing,loc,'REQUIRED_DECISION');continue;}
   if(!valid(type,v))add(invalid,loc,'INVALID_VALUE');
  }
 }
 if(!object(record))return {version:1,status:'INVALID',invalid:[{path:'record',code:'OBJECT_REQUIRED'}],missing,conflicts,promotion:'CLOSED',authorization:'AWAITING PRODUCTION AUTHORIZATION'};
 const {version,purpose,instructions,...sections}=record;
 if(version!==2)add(invalid,'version','VERSION_2_REQUIRED');
 if(purpose!=='UNAPPROVED_PRIVATE_COPY_TEMPLATE_NOT_AUTHORIZATION')add(invalid,'purpose','WORKSHEET_ONLY_REQUIRED');
 if(!text(instructions))add(invalid,'instructions','INSTRUCTIONS_REQUIRED');
 walk(sections,decisionSchema);
 const get=path=>{let v=record;for(const k of path.split('.'))v=v?.[k];return v;};
 const known=path=>get(path)!==null&&get(path)!==undefined&&!invalid.some(i=>i.path===path);
 const compare=(a,b,fn=(x,y)=>x===y)=>{if(known(a)&&known(b)&&!fn(get(a),get(b)))add(conflicts,a,'INCONSISTENT_WITH_'+b);};
 compare('source.repositoryUrl','source.repository',(url,repo)=>url==='https://github.com/'+repo||url==='https://github.com/'+repo+'.git');
 compare('registry.origin','registry.imagePrefix',(origin,prefix)=>prefix.startsWith(new URL(origin).host+'/'));
 compare('transport.registryOrigin','registry.origin');
 compare('transport.targetEnvironmentId','target.environmentId');
 compare('authorization.targetEnvironmentId','target.environmentId');
 compare('authorization.manifestSha256','candidate.expectedManifestSha256');
 for(const path of ['transport.digestPinned','recovery.backupSurvivesHostLoss','recovery.keyCustodySurvivesHostLoss'])if(get(path)===false)add(conflicts,path,'REQUIRED_SAFETY_PROPERTY_FALSE');
 let manifestStatus='NOT_PROVIDED';
 if(manifest!==undefined){
  try{
   validateManifest(manifest);if(manifest.kind!=='candidate')throw Error();
   const digest=sha(canonical(manifest));
   for(const [path,actual]of [['source.repository',manifest.source.repository],['source.sourceCommit',manifest.source.commit],['source.defaultBranch',manifest.source.ref.slice(11)],['candidate.expectedManifestSha256',digest],...['api','web','edge'].map(n=>['candidate.'+n+'Digest',manifest.images[n].reference.split('@')[1]])])if(known(path)&&get(path)!==actual)add(conflicts,path,'MANIFEST_MISMATCH');
   if(known('registry.imagePrefix'))for(const name of ['api','web','edge'])if(!manifest.images[name].reference.startsWith(get('registry.imagePrefix')+'/'+name+'@'))add(conflicts,'registry.imagePrefix','MANIFEST_COMPONENT_MISMATCH');
   manifestStatus='SCHEMA_CHECKED_NOT_ARTIFACT_OR_APPROVAL_VERIFIED';
  }catch{manifestStatus='INVALID';add(invalid,'manifest','RELEASE_CONTRACT_REJECTED');}
 }
 return {version:1,status:invalid.length||conflicts.length?'INVALID':missing.length?'INCOMPLETE':'COMPLETE_UNAUTHENTICATED_WORKSHEET',missing,invalid,conflicts,manifestStatus,
  trust:'Operator-supplied claims only. References are not dereferenced; no identities, approvals, remote settings, artifacts or infrastructure are authenticated.',
  promotion:'CLOSED',authorization:'AWAITING PRODUCTION AUTHORIZATION',productionReadiness:'NOT READY',publicationPerformed:false,networkAccessPerformed:false};
}
