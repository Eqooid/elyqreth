# Run Elyqreth with Docker

Use Docker Desktop with Linux containers and Docker Compose. Host Node/npm is not required to build or run the containers. Start from the repository root.

## Start the local stack

In PowerShell:

```powershell
cd "C:\Users\user\Desktop\Project\Elyqreth"
if (!(Test-Path .env)) { Copy-Item .env.example .env }
notepad .env
```

Replace `POSTGRES_PASSWORD=replace_with_a_local_password` with a local password. Keep existing credentials if the database volume already exists; editing .env does not change a previously initialized PostgreSQL password. Do not overwrite an existing .env with the example.

```powershell
docker compose up --build -d
docker compose ps -a
```

- City: **http://127.0.0.1:8080**
- API liveness: **http://127.0.0.1:3001/health**
- PostgreSQL: loopback port 5432 by default.

Compose first waits for PostgreSQL health, runs the existing additive migrations, and starts the API after migration success. The `migrate` container exits with code 0 on success; that is expected. The frontend serves the maintained `dist/` directory intact, including native JS modules and dynamically loaded city assets.

Use `WEB_PORT`, `API_PORT` and `POSTGRES_PORT` in root .env to avoid conflicts with host development servers. For example, `API_PORT=3002` changes the host URL to http://127.0.0.1:3002/health; the internal API port remains 3001.

```powershell
docker compose logs -f web api migrate
docker compose down
```

`down` stops this stack while preserving its database volume. Do not add `--volumes` for a database you want to retain. Changes to city/backend source require another `docker compose up --build -d`.

## City only

For just the city, without PostgreSQL, credentials or backend:

```powershell
docker build --target web -t elyqreth-web:local .
docker run --rm --name elyqreth-city -p 127.0.0.1:8080:8080 elyqreth-web:local
```

Stop that foreground container with Ctrl+C. This command does not require a root .env.

## Runtime access limitation

The city simulation, NPC movement, camera, animations and simulated missions run normally. This Docker stack does **not** enable real Agent runtime operations or city activity synchronization. The existing protected registry/runtime/city endpoints require both a loopback bind and a loopback peer. Bridged container access cannot satisfy that boundary safely. Compose explicitly keeps those features disabled rather than weakening their guards or proxying around them.

The backend image can connect to PostgreSQL and serve liveness. It does not seed owners/Agents, download models, contact providers, or execute tasks. For current real-Agent local workflows, run the API on the host using the existing [registry](ai-agent-platform/agent-registry.md) and [frontend integration](ai-agent-platform/phase-3/frontend-runtime-integration.md) setup. Production/container-compatible identity authorization needs a separate design; this packaging is for local development.

## Images and configuration

`Dockerfile` has `api-build`, `api` and default `web` targets. The backend compiles with Node 24, prunes development dependencies and runs as the Node user. The static web image runs Nginx as a non-root user on 8080. Compose additionally makes the web filesystem read-only with a temporary /tmp, drops application container capabilities, and publishes ports only on loopback. The existing PostgreSQL image pin and persistent volume remain unchanged.

The base tags use the [official Node image](https://github.com/nodejs/docker-node) and [official Nginx image](https://hub.docker.com/_/nginx). These application base tags are mutable; use `docker compose build --pull` to refresh them. No image publication or deployment is performed by the local commands.

`.dockerignore` excludes local environment files, credentials, node_modules, compiled host backend output, tests, documentation and reference artwork. Root dist is maintained source and must remain included. `docker/api-start.cjs` builds the internal database URL from Compose's PostgreSQL settings using URL-encoded credentials, then invokes existing configuration/bootstrap or migration code. Passwords are supplied at runtime, never as image build arguments. The local stack uses its PostgreSQL bootstrap role; it is not a production role/secret-management design.

## Verification

Executed successfully:

- `docker build --target web --tag elyqreth-web:local .`
- `docker build --target api --tag elyqreth-api:local .`
- `node --test tests/docker-config.test.js`: credential URL encoding and explicit URL preservation passed.
- `npm run lint` and `npm test`: static/type checks and all 125 frontend tests passed.
- `npm run test:docker`: actual isolated Compose build/start, four migrations, frontend assets/modules, API health, disabled protected endpoints, non-root application users, and Chrome smoke passed. Chrome reported zero exceptions. The smoke test uses a unique Compose project, random credentials/ports and its own disposable volume; cleanup removes only that project's test resources.

`BROWSER_BASE_URL` optionally points the existing browser smoke suite at a loopback HTTP origin instead of launching Vite. The Docker smoke uses this to test the actual Nginx-served city, including existing T04–T08 deterministic browser fixtures. It does not claim live LLM execution or production runtime authorization.

The original image build reported three high-severity dependency findings, and its detailed audit was blocked by an approval-review usage limit. T09 subsequently verified and patched the two affected HTTP parsers, with zero production audit findings and an image dependency check in `test:docker`. Rebuild existing images to receive those fixes. See the [T09 verification report](ai-agent-platform/phase-3/security-performance-verification.md). This local setup is not a production security acceptance.
