const { validateEnvironment } = require('../../dist/config/configuration');
const { createApplication } = require('../../dist/application');
const { DatabaseService } = require('../../dist/database/database.module');
const productionEnvironment = Object.freeze({ NODE_ENV: 'production', API_HOST: '127.0.0.1',
  API_PORT: '3001', CORS_ORIGINS: 'https://city.example',
  DATABASE_URL: 'postgresql://app:synthetic-unit-fixture@db.invalid/elyqreth' });
async function closedApplication(env) {
  const app = await createApplication(validateEnvironment(env.NODE_ENV === 'production'
    ? { ...productionEnvironment, ...env } : env));
  // Unit guard tests only: no queries or real provider/database credentials.
  // Production startup connectivity is tested separately; never imported by src/.
  if (env.NODE_ENV === 'production') {
    app.get(DatabaseService).onModuleInit = async () => {};
    // These route/guard unit fixtures simulate initialized persistence, including T05 schema readiness.
    app.get(DatabaseService).checkReadiness = async () => true;
  }
  return app;
}
module.exports = { productionEnvironment, closedApplication };
