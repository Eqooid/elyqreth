const {test}=require('node:test'),assert=require('node:assert/strict');
const selection=variant=>({version:1,mode:'LOCAL_METADATA_VARIANTS',variant,schemaHash:'d'.repeat(64),images:{api:'sha256:'+(variant==='A'?'a':'d').repeat(64),web:'sha256:'+(variant==='A'?'b':'e').repeat(64),edge:'sha256:'+(variant==='A'?'c':'f').repeat(64)}});
test('local rollback contract rejects mutable or invented registry identities and incompatible schema',async()=>{
 const {validateLocalSelection,compatibleRollback}=await import('../../../scripts/local-rollback.mjs');const a=selection('A'),b=selection('B');assert.equal(compatibleRollback(a,b,a.schemaHash),a);
 for(const value of ['latest','registry.invalid/api@sha256:'+'a'.repeat(64)]){const bad=selection('A');bad.images.api=value;assert.throws(()=>validateLocalSelection(bad));}
 assert.throws(()=>compatibleRollback(a,b,'f'.repeat(64)));assert.throws(()=>compatibleRollback(a,a,a.schemaHash));assert.throws(()=>compatibleRollback(a,{...b,images:a.images},a.schemaHash));assert.throws(()=>validateLocalSelection({...a,approved:true}));
});
test('rollback failure oracle stops at missing artifact, manifest, schema, drain, readiness and smoke gates',async()=>{
 const {simulate}=await import('../../../scripts/release/contracts.mjs');
 const steps=['verify-previous-artifact','validate-manifest','verify-schema','native-drain','verify-private-readiness','web-edge-smoke','observe'];
 for(const failed of steps){const visited=[];const result=await simulate({mode:'PLAN_ONLY_NO_DEPLOYMENT',steps,selectedManifestSha256:'a'.repeat(64)},async s=>{visited.push(s);return s!==failed;});assert.equal(result.status,'FAILED');assert.equal(visited.at(-1),failed);assert.equal(visited.length,steps.indexOf(failed)+1);}
});
