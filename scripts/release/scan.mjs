export const scannerImage='docker.io/aquasec/trivy@sha256:8f6bb947dbc528902e11f2f5be52f7b519f6a39d5d148f41166f2040499768fb';
export const scannerVersion='0.76.2';
export function summarizeScan(report,expectedImageId){
 if(report?.SchemaVersion!==2||!/^sha256:[a-f0-9]{64}$/.test(expectedImageId)||report.Metadata?.ImageID!==expectedImageId||!Array.isArray(report.Results))throw Error('Scan identity or schema mismatch');
 if(!report.Metadata?.OS?.Family||report.Metadata.OS.EOSL===true||!report.Results.some(r=>r.Class==='os-pkgs'&&r.Packages?.length))throw Error('Scan package coverage or OS support is missing');
 const coverage=report.Results.map(r=>({target:r.Target,class:r.Class,type:r.Type,packages:r.Packages?.length??0}));
 const counts={CRITICAL:0,HIGH:0,MEDIUM:0,LOW:0,UNKNOWN:0},findings=[];
 for(const result of report.Results){
  if(!result||typeof result.Target!=='string')throw Error('Invalid scan target');
  for(const item of result.Vulnerabilities??[]){if(!Object.hasOwn(counts,item.Severity)||typeof item.VulnerabilityID!=='string'||typeof item.PkgName!=='string')throw Error('Invalid vulnerability');counts[item.Severity]++;findings.push({kind:'vulnerability',target:result.Target,id:item.VulnerabilityID,package:item.PkgName,installedVersion:item.InstalledVersion,fixVersion:item.FixedVersion??null,severity:item.Severity,status:item.Status??null,primaryUrl:item.PrimaryURL??null});}
  for(const secret of result.Secrets??[]){if(!Object.hasOwn(counts,secret.Severity))throw Error('Invalid secret result');counts[secret.Severity]++;findings.push({kind:'secret',target:result.Target,id:secret.RuleID,severity:secret.Severity});}
 }
 return {imageId:expectedImageId,os:report.Metadata.OS,coverage,counts,findings,exceptions:[],releaseBlocking:counts.CRITICAL>0||counts.HIGH>0,scope:'Local Docker archive/config identity only; not published registry verification. Secret matches/snippets are intentionally omitted.'};
}
