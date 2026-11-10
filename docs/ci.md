# Continuous integration

`.github/workflows/verify.yml` is the primary automatic CI workflow. It runs on pull requests and pushes to `main`, avoiding duplicate push/PR runs for feature branches. Manual and reusable invocation remain available. It has one job:

1. Check out without persisted Git credentials and set up the patched Node 24 LTS version in `.node-version`.
2. Install the lockfile with `npm ci`.
3. Audit production dependencies and validate workflow permissions, action pins, shell input boundaries and configuration/security contracts.
4. Build the API and frontend once.
5. Run syntax/browser type checks, migration metadata checks, frontend and API unit tests, real database integration, browser smoke/hardening, and database-role/backup security integration tests.

The API build already performs strict TypeScript checking, so CI does not repeat `check:api`. Commands ending in `:compiled` require the API build to have completed. The ordinary `test`, `test:db` and `db:migrate` API commands still build automatically for standalone local use.

`npm run verify:phase1` builds the API/frontend once, then invokes `verify:phase1:tests`. CI uses the latter after its separate Build step. The database migration CLI test uses `db:migrate:compiled`, retaining real npm workspace/CLI coverage without another compilation.

## PostgreSQL isolation

CI supplies a digest-pinned PostgreSQL 17.11 service with `pg_isready` health checks and disposable test credentials. The harness receives its container ID through `CI_POSTGRES_CONTAINER` and its test password through `CI_POSTGRES_PASSWORD`. It validates the exact container ID, pinned image, test label and bootstrap identity before using or restarting it. It connects through loopback, creates a random test database, applies all migrations, preserves the real restart test, and drops only its own databases afterward. GitHub owns service-container cleanup.

Without those CI variables, local tests retain their existing owned container/volume fixture. No developer or production database URL is accepted. Database-role and backup security tests retain their separate isolated permission/TLS fixtures.

## Additional manual verification

Image hardening/rehearsal, capacity/profile sampling, and specialized acceptance tiers are available through the existing scripts, but are not repeated by the primary CI job:

```sh
docker build --target api -t elyqreth-t05-api:verification .
docker build --target web -t elyqreth-t05-web:verification .
docker build --target edge -t elyqreth-t06-edge:verification .
npm run test:containers
npm run test:edge
npm run test:interaction:e2e
npm run test:city:e2e
node --expose-gc scripts/phase5-collaboration-profile.mjs
```

The existing manual release-candidate and promotion-review workflows are unchanged. This CI workflow does not publish or deploy.
