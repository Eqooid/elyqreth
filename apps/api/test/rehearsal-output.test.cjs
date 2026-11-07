const {test}=require('node:test'),assert=require('node:assert/strict');
const {mkdtempSync,mkdirSync,rmSync,existsSync}=require('node:fs'),{tmpdir}=require('node:os'),{join,resolve,dirname,basename}=require('node:path'),{pathToFileURL}=require('node:url');
const root=resolve(__dirname,'../../..');
test('T14 output boundary rejects checkout children whose names start with two dots',async()=>{
 const {newOutsideOutput}=await import(pathToFileURL(join(root,'scripts/rehearsal-output.mjs')).href);
 const owned=mkdtempSync(join(root,'..t14-output-test-'));
 try{assert.throws(()=>newOutsideOutput(root,join(owned,'report')));assert.equal(existsSync(join(owned,'report')),false);assert.throws(()=>newOutsideOutput(root,join(root,'report')));}
 finally{assert.equal(dirname(resolve(owned)),root);assert.ok(basename(owned).startsWith('..t14-output-test-'));rmSync(owned,{recursive:true});}
});
test('T14 output boundary accepts fresh external paths and refuses existing evidence',async()=>{
 const {newOutsideOutput}=await import(pathToFileURL(join(root,'scripts/rehearsal-output.mjs')).href);
 const owned=mkdtempSync(join(tmpdir(),'elyqreth-t14-output-test-'));
 try{assert.equal(newOutsideOutput(root,join(owned,'new')),join(owned,'new'));mkdirSync(join(owned,'old'));assert.throws(()=>newOutsideOutput(root,join(owned,'old')));}
 finally{assert.equal(dirname(resolve(owned)),resolve(tmpdir()));assert.ok(basename(owned).startsWith('elyqreth-t14-output-test-'));rmSync(owned,{recursive:true});}
});
