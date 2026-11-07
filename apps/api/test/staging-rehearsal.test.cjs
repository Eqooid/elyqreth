const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {resolve}=require('node:path');
const {pathToFileURL}=require('node:url');
const root=resolve(__dirname,'../../..');
const load=()=>import(pathToFileURL(resolve(root,'scripts/rehearsal-contracts.mjs')).href);
const lock=()=>({version:1,mode:'LOCAL_SIMULATION',images:{api:'sha256:'+'a'.repeat(64),web:'sha256:'+'b'.repeat(64),edge:'sha256:'+'c'.repeat(64)}});
test('T13 local image lock rejects mutable references, unknown targets and registry-digest substitution',async()=>{
 const {validateImageLock}=await load();assert.deepEqual(validateImageLock(lock()),lock());
 for(const reference of ['latest','repo/api:v1','registry.invalid/api@sha256:'+'a'.repeat(64),'sha256:abc']){const value=lock();value.images.api=reference;assert.throws(()=>validateImageLock(value));}
 for(const value of [{...lock(),mode:'production'},{...lock(),target:'prod'},{...lock(),images:{...lock().images,worker:'sha256:'+'d'.repeat(64)}}])assert.throws(()=>validateImageLock(value));
});
test('T13 child environments omit deployment, provider, database and preloader authority',async()=>{
 const {safeEnvironment}=await load();assert.deepEqual(safeEnvironment({PATH:'tools',TEMP:'temp',DATABASE_URL:'private',SMTP_PASSWORD:'private',OPENAI_API_KEY:'private',NODE_OPTIONS:'--require private',DOCKER_HOST:'tcp://production',DOCKER_CONTEXT:'production',ELYQRETH_EDGE_BROWSER:'false',GITHUB_TOKEN:'private'}),{PATH:'tools',TEMP:'temp'});
});
test('T13 runner cannot accept existing output or arbitrary deployment commands',async()=>{
 const {main,suites}=await import(pathToFileURL(resolve(root,'scripts/staging-rehearsal.mjs')).href);
 await assert.rejects(main(['--deploy','production']));await assert.rejects(main(['--run','--output',root]));
 assert.ok(suites.some(([id])=>id==='database-uat'));assert.ok(suites.some(([id])=>id==='backup-restore'));
 const source=readFileSync(resolve(root,'scripts/staging-rehearsal.mjs'),'utf8');assert.ok(!source.includes("'docker','build'"));assert.match(source,/DOCKER_CONFIG_ID_NOT_REGISTRY_DIGEST/);
});
test('T13 optional content lock reaches API, web and edge without breaking existing harness defaults',()=>{
 const harness=readFileSync(resolve(root,'scripts/container-hardening.mjs'),'utf8'),edge=readFileSync(resolve(root,'scripts/edge-network.mjs'),'utf8');
 assert.match(harness,/readImageLock/);assert.match(harness,/edgeImage:imageLock\?\.images.edge/);assert.match(edge,/edgeImage=c.edgeImage\?\?/);
});
