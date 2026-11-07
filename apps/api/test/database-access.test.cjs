const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validateDatabaseEnvironment}=require('../dist/database/database-configuration');
const {identifier}=require('../dist/database/access-policy');
const {migrateDatabase}=require('../dist/database/migrate');
test('migration target is explicit, bound to the URL database and excluded from safe configuration diagnostics',()=>{
  const env={DATABASE_URL:'postgresql://app:synthetic_password@localhost/elyqreth',DATABASE_SSL_MODE:'disable'};
  for(const target of ['other','elyqreth;DROP DATABASE postgres','../elyqreth',''])
    assert.throws(()=>validateDatabaseEnvironment({...env,DATABASE_MIGRATION_TARGET:target},'test'));
  const c=validateDatabaseEnvironment({...env,DATABASE_MIGRATION_TARGET:'elyqreth'},'test');
  assert.equal(c.migrationTarget,'elyqreth');assert.equal(c.production,false);
  assert.ok(!JSON.stringify(c).includes('synthetic_password'));
});
test('production migrator fails before opening a socket without its explicit target',async()=>{
  await assert.rejects(migrateDatabase({production:true,database:'elyqreth'}),/DATABASE_MIGRATION_TARGET/);
});
test('role and database identifiers reject SQL injection and ambiguous names',()=>{
  for(const name of ['PUBLIC','x;DROP ROLE x','x"','a.b','', 'a'.repeat(64)])assert.throws(()=>identifier(name));
  assert.equal(identifier('elyqreth_runtime'),'"elyqreth_runtime"');
});
