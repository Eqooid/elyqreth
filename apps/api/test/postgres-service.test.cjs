const {test} = require('node:test');
const assert = require('node:assert/strict');
const {postgresService, assertPostgresService, postgresPort, testDatabases} = require('./helpers/postgres-service.cjs');
const container = 'a'.repeat(64), password = 'synthetic_test_password', image = 'postgres:17.11@sha256:' + 'b'.repeat(64);
const service = {container, password};
const fixture = () => ({Id:container, Config:{Image:image, Labels:{'elyqreth.test.service':'phase1'},
  Env:['POSTGRES_USER=elyqreth_test', 'POSTGRES_DB=postgres', 'POSTGRES_PASSWORD=' + password]},
  NetworkSettings:{Ports:{'5432/tcp':[{HostIp:'0.0.0.0',HostPort:'32123'}]}}});

test('CI PostgreSQL configuration is explicit and rejects partial or malformed credentials without echoing values', () => {
  assert.equal(postgresService({}), undefined);
  assert.deepEqual(postgresService({CI_POSTGRES_CONTAINER:container, CI_POSTGRES_PASSWORD:password}), service);
  for (const env of [{CI_POSTGRES_CONTAINER:container}, {CI_POSTGRES_PASSWORD:password},
    {CI_POSTGRES_CONTAINER:'production', CI_POSTGRES_PASSWORD:password},
    {CI_POSTGRES_CONTAINER:container, CI_POSTGRES_PASSWORD:'secret-marker!'}]) {
    assert.throws(() => postgresService(env), error => !error.message.includes('secret-marker'));
  }
});

test('service access and cleanup require the exact test container, image, label and bootstrap credentials', () => {
  assertPostgresService(fixture(), service, image);
  for (const change of [s => s.Id='c'.repeat(64), s => s.Config.Labels={}, s => s.Config.Image='postgres:latest',
    s => s.Config.Env=['POSTGRES_USER=production'], s => s.Config.Env[2]='POSTGRES_PASSWORD=secret-marker']) {
    const state=fixture();change(state);
    assert.throws(() => assertPostgresService(state,service,image), error => !error.message.includes('secret-marker'));
  }
});

test('only the explicit CI service permits a wildcard IPv4 binding; connections always use loopback', () => {
  const state=fixture();assert.equal(postgresPort(state,service),32123);
  assert.throws(() => postgresPort(state,undefined));
  state.NetworkSettings.Ports['5432/tcp'][0].HostIp='127.0.0.1';assert.equal(postgresPort(state,undefined),32123);
  state.NetworkSettings.Ports['5432/tcp'][0].HostPort='0';assert.throws(() => postgresPort(state,service));
});

test('cleanup includes upgrade fixtures and accepts only this run\'s generated database namespace', () => {
  const name='elyqreth_test_'+'a'.repeat(24);
  assert.deepEqual(testDatabases(name),[name,name+'_blank',name+'_t05_upgrade',name+'_t07_upgrade',name+'_auth_upgrade']);
  for(const invalid of ['postgres','production',name+'_other',name+'";DROP DATABASE postgres'])
    assert.throws(()=>testDatabases(invalid));
});
