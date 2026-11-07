# Optional LangGraph reference runtime

This is a real LangGraph Agent Server development deployment with a deterministic external graph. It is not a replacement Elyqreth runtime, production deployment, LLM strategy or mock server. Nothing in the ordinary API startup or CI requires Python or this provider.

Verified: Python 3.13.3, langgraph-api 0.16.8, langgraph 1.2.18, langgraph-cli 0.4.40. The API package declares Elastic-2.0; the graph library has its own license. Review upstream deployment/licensing requirements before any production use. Tracing is disabled for the local test; no API key, LLM or paid service was needed for this dev mode.

From the repository root, PowerShell:

```powershell
python -m venv .tmp-t08-venv
.\.tmp-t08-venv\Scripts\python.exe -m pip install -r tools/langgraph-reference/requirements.lock.txt
$env:PYTHONUTF8='1'
$env:LOG_JSON='true'
$env:LANGSMITH_TRACING='false'
$env:LANGCHAIN_TRACING_V2='false'
Set-Location tools/langgraph-reference
..\..\.tmp-t08-venv\Scripts\langgraph.exe dev --host 127.0.0.1 --port 20240 --no-browser --no-reload
```

Keep that terminal open. LOG_JSON avoids upstream's Windows colorama console dependency. Port 20240 must be available; do not bind to a public interface or enable a tunnel. On other platforms use the equivalent virtual environment executable path. The pinned lock is optional reference tooling, not a backend dependency.

In another root terminal with Node 24, Docker Desktop and Chrome available:

```powershell
npm.cmd run test:langgraph:live
```

This explicitly starts the established disposable PostgreSQL harness, applies migrations and runs all current backend/database regressions plus the real LangGraph test. It creates/deletes its own provider thread, starts one disposable provider-side graph invocation, then observes it through the actual Elyqreth adapter and inbox. The fixture's provider-side invocation is not an Elyqreth dispatch capability. The harness never consumes a developer DATABASE_URL. Ordinary npm run test:db uses captured real provider responses with an HTTP fixture; it does not require this server or skip live tests as if they passed.

Stop the development server with Ctrl+C. The owned test database/container/volume and live test thread are cleaned up automatically. Provider development persistence is confined to ignored .langgraph_api here; retain it for investigation or remove only that exact disposable directory after stopping the server. Do not remove an unrelated deployment's state. The virtual environment is ignored and may be retained for reproduction.

For a manually configured existing development database, see the [integration guide](../../docs/ai-agent-platform/phase-5/reference-integration.md). The example profile contains placeholders; replace owner/connection UUIDs with approved existing records. No credential is included. Hosted API keys belong only in EXTERNAL_SECRET_* server environment variables and require credentialRef in the trusted profile.
