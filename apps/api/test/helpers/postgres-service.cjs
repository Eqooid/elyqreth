const assert = require('node:assert/strict');

function postgresService(env = process.env) {
  const container = env.CI_POSTGRES_CONTAINER, password = env.CI_POSTGRES_PASSWORD;
  if (container === undefined && password === undefined) return undefined;
  assert.ok(typeof container === 'string' && /^[a-f0-9]{64}$/.test(container), 'CI_POSTGRES_CONTAINER must identify the disposable CI service');
  assert.ok(typeof password === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(password), 'CI_POSTGRES_PASSWORD must be an explicit test-only credential');
  return { container, password };
}

function assertPostgresService(state, service, image) {
  assert.equal(state.Id, service.container, 'CI PostgreSQL container identity changed');
  assert.equal(state.Config.Labels?.['elyqreth.test.service'], 'phase1', 'Refusing a PostgreSQL container without the CI test label');
  assert.equal(state.Config.Image, image, 'CI PostgreSQL must use the pinned test image');
  const env = state.Config.Env;
  assert.ok(env.includes('POSTGRES_USER=elyqreth_test') && env.includes('POSTGRES_DB=postgres'), 'CI PostgreSQL must use the test bootstrap identity');
  assert.ok(env.includes('POSTGRES_PASSWORD=' + service.password), 'CI PostgreSQL credential mismatch');
}

function postgresPort(state, service) {
  const mapping = state.NetworkSettings.Ports['5432/tcp']?.find(value => value.HostIp === '127.0.0.1' || service && value.HostIp === '0.0.0.0');
  assert.ok(mapping, 'Test PostgreSQL has no reachable IPv4 port mapping');
  const port = Number(mapping.HostPort);
  assert.ok(Number.isInteger(port) && port > 0 && port <= 65535, 'Invalid test PostgreSQL port');
  return port;
}

function testDatabases(database) {
  assert.match(database, /^elyqreth_test_[a-f0-9]{24}$/, 'Refusing cleanup outside this test run');
  return ['', '_blank', '_t05_upgrade', '_t07_upgrade', '_auth_upgrade'].map(suffix => database + suffix);
}

module.exports = { postgresService, assertPostgresService, postgresPort, testDatabases };
