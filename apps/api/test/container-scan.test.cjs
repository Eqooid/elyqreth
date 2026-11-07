const {test}=require('node:test'),assert=require('node:assert/strict');
const load=()=>import('../../../scripts/release/scan.mjs');const id='sha256:'+'a'.repeat(64);
test('container scan identity is bound and HIGH/CRITICAL gate has no implicit unfixed exemption',async()=>{
 const {summarizeScan,scannerImage}=await load();const {reference}=await import('../../../scripts/release/contracts.mjs');assert.equal(reference(scannerImage),scannerImage);const r={SchemaVersion:2,Metadata:{ImageID:id,OS:{Family:'alpine'}},Results:[{Target:'fixture',Class:'os-pkgs',Type:'alpine',Packages:[{Name:'fixture'}],Vulnerabilities:[{VulnerabilityID:'CVE-SYNTHETIC',PkgName:'fixture',Severity:'HIGH',InstalledVersion:'1'}]}]};
 const out=summarizeScan(r,id);assert.equal(out.releaseBlocking,true);assert.equal(out.findings[0].fixVersion,null);assert.deepEqual(out.exceptions,[]);assert.throws(()=>summarizeScan(r,'sha256:'+'b'.repeat(64)));
});
test('container scan redacts secret matches and rejects unknown severity or missing report',async()=>{
 const {summarizeScan}=await load();const r={SchemaVersion:2,Metadata:{ImageID:id,OS:{Family:'alpine'}},Results:[{Target:'fixture',Class:'os-pkgs',Type:'alpine',Packages:[{Name:'fixture'}],Secrets:[{RuleID:'synthetic',Severity:'CRITICAL',Match:'synthetic-private-marker',Code:{Lines:['private']}}]}]};
 assert.ok(!JSON.stringify(summarizeScan(r,id)).includes('private'));r.Results[0].Secrets[0].Severity='unbounded';assert.throws(()=>summarizeScan(r,id));assert.throws(()=>summarizeScan({},id));r.Results=[];assert.throws(()=>summarizeScan(r,id));
});
