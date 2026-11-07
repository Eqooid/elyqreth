const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createApplication}=require('../dist/application');
const {validateEnvironment}=require('../dist/config/configuration');
const {LlmProviderRegistry}=require('../dist/runtime/providers/provider-registry');
const {ProviderSelectionService}=require('../dist/runtime/providers/provider-selection.service');
const {environment}=require('./provider-fixtures.cjs');

// Existing owned disposable PostgreSQL harness, never a developer database.
module.exports=({row,getUrl})=>{
 test('T05 real application rejects enabled unregistered provider profiles before any execution or audit writes',async t=>{
  const owner=await row("INSERT INTO owners(name) VALUES ('t05-provider-test-scope') RETURNING id");
  const config=validateEnvironment({...environment(),DATABASE_URL:getUrl(),AGENT_REGISTRY_OWNER_ID:owner.id});
  const fetch=t.mock.method(globalThis,'fetch',()=>assert.fail('No provider HTTP call is permitted'));
  let app;try{
   app=await createApplication(config);
   assert.ok(app.get(ProviderSelectionService));
   assert.throws(()=>app.get(LlmProviderRegistry).resolve('fixture.local'),e=>e.code==='PROVIDER_UNAVAILABLE');
   await assert.rejects(app.init(),e=>e.code==='PROVIDER_UNAVAILABLE');
   for(const table of ['tasks','executions','agent_events'])
    assert.equal((await row(`SELECT count(*)::int AS n FROM ${table} WHERE owner_id=$1`,[owner.id])).n,0);
  }finally{await app?.close();fetch.mock.restore();}
 });
};
