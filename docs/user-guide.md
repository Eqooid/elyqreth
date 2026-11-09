# Elyqreth user guide

Elyqreth turns connected AI Agent activity into an interactive city. An NPC can represent a real Agent, and its inspection panel can show Tasks, Executions, results and collaboration. Your external orchestrator still runs its own Agents; Elyqreth displays the information a supported connection exposes.

**New users: start with the quick start below.** If someone has already installed Elyqreth for you, skip to [signing in](#sign-in-to-a-configured-installation).

## What you can use today

| Feature | Available now | What you need |
| --- | --- | --- |
| Explore the city and try the built-in mission | Yes, local simulation | Browser and local city server, or a running installation |
| Inspect a real Agent through an NPC | Yes, for explicitly mapped Agents | Configured backend, access and Agent-to-NPC mapping |
| Submit/run a native Agent Task | Yes, for enabled native Agents | Operator access and a configured Agent/runtime; optional LLM provider |
| View collaboration and delegation | Yes, for recorded authorized relationships | Configured collaboration views and access |
| Observe an existing LangGraph run | Yes, limited observation-only connection | Manually configured supported LangGraph connection and existing run |
| Start/cancel work in LangGraph from Elyqreth | No | Not implemented |
| Register Hermes Agents/NPCs and observe listed API runs | Implemented; live E2E not verified here | Explicit backend configuration for Hermes 0.21.2; [setup](../tools/hermes-reference/README.md) |
| Connect CrewAI or AutoGen | No | No implemented adapter for those systems |

There is no packaged desktop installer, public hosted sign-up service or universal “Connect orchestrator” wizard supplied by this repository. A full connected installation currently needs manual setup. The quick start does not automatically connect real Agents.

## Quick start: open the city on your computer

You need Node.js **24**, npm, and the Elyqreth project folder. Open PowerShell in that folder. If dependencies have not been installed, run:

```powershell
npm.cmd ci
```

Then start the city:

```powershell
npm.cmd run dev:web -- --host 127.0.0.1 --port 5173 --strictPort
```

Keep that terminal open and visit **http://127.0.0.1:5173** in your browser. Stop it with Ctrl+C in the same terminal. On Linux/macOS, use `npm` instead of `npm.cmd`.

**What this starts:** the city and its built-in simulation. You do not need a database, an AI subscription or production configuration to explore it. It does not start a real Agent backend, connect LangGraph, or connect Hermes. Keep this local server private; it is not a public deployment.

Already installed dependencies can be left in place; you do not need to reinstall every time you open the city. If the port is in use, stop only your own earlier city server or choose another unused local port. Do not kill unrelated applications.

## Explore and use the city

| Control | What it does |
| --- | --- |
| Drag the map or use arrow keys | Move the camera |
| Mouse wheel, pinch, or + / − | Zoom |
| Residents | Open the resident list and select a resident |
| Click a resident or workplace | Open its inspection panel |
| ? | Open the controls guide |
| Café / park / recenter buttons | Move to those locations or fit the town in view |
| Activity | Read the built-in town activity |

The default **SIMULATED AGENTS** city has a **CITY HALL** mission form. Enter a task and choose **Start task** to watch the simulated research/design/development/testing sequence. **Pause**, **Speed**, **Reset** and **Retry step** belong to that simulation. They do not control real backend Executions or external providers.

**Residents → + Add agent** opens **A new resident** and adds a simulated resident. It does not install an AI model, register a backend Agent, create a Hermes Agent, or connect an orchestrator. Simulated missions/residents reset when the page reloads.

## Sign in to a configured installation

For real Agent features, obtain the installation URL and your access details from the person who set it up. There is no default username/password and no public account-registration flow.

1. Open the installation URL.
2. Choose **Sign in** in the top bar. While configuration is loading, the button can initially say **Access**.
3. If prompted for **Username** and **Password**, enter the local account provided for this installation.
4. If prompted for an **API access token**, use the installation's approved API token. Do not paste your AI-provider key, refresh token, issuer password or an ID token.
5. Wait for confirmed access. The button changes to **Access: operator** or **Access: viewer**.

An **operator** can use permitted Task/Execution controls. A **viewer** can inspect permitted data but cannot submit, start or cancel work. Access is scoped to the configured installation owner. A viewer is a private-team read role within that owner, not an individual public account; another owner's resources remain inaccessible.

If the sign-in button is absent in the standalone preview, account access may be disabled. If access configuration is unavailable, the page keeps protected features closed. Starting another backend on a different port alone does not configure browser access: the account interface requires the reviewed same-origin routing and matching access mode.

## Inspect a real Agent

1. Select a resident that your installer has mapped to a real backend Agent.
2. Look for **Agent Details** in the inspection panel.
3. Read the Agent identity, status and any recorded Task/Execution information.
4. Open an available execution reference to inspect its recorded status/result.

A moving resident or matching display name is not proof of a real Agent connection. Not every resident is mapped. An empty Agent section can mean no mapping, disabled views or insufficient access; it does not necessarily mean the AI provider failed.

## Give a native Agent work

Use this only with a real mapped, enabled native Agent and operator access:

1. Select its resident and open **Agent Task**.
2. Enter **Task instructions** and choose **Save Task**.
3. Confirm that the Task was saved. Saving persists the request; it does not mean the work has run.
4. When available, use **Execution controls → Start Execution**.
5. Follow the recorded lifecycle and result. Use **Refresh lifecycle** if needed.
6. To request cancellation, choose **Cancel Execution** and review **Confirm cancellation**.

If a submission's outcome is unknown, use the panel's **Check submission** flow before creating another Task. Do not submit copies repeatedly to force work through. A disconnect, pending state or saved Task is not successful completion. A disabled control can reflect your role, an inactive Agent, stale state, missing configuration or a draining runtime.

These controls are for Elyqreth-owned native work. They do not start or cancel LangGraph/Hermes work. Rule-based Agents need no LLM. LLM-backed Agents need a separately configured supported provider/model; typing a model name into the city does not configure one.

## View collaboration

Select a mapped resident and open **Agent collaborations**. Existing controls let you inspect a **Collaboration**, **Participants**, **Directed delegations**, **Delegation details**, and related parent/child Task or Execution references. Use **Refresh collaborations** or **Refresh history** for an updated view.

The panel shows recorded relationships you are authorized to see. It is not a drag-and-drop workflow builder. A resident added through the simulation does not automatically become a collaboration participant. External observations do not transfer execution authority to Elyqreth.

## Connect an existing orchestrator

**LangGraph Agent Server and explicitly configured Hermes Agent 0.21.2 have external observation adapters.** For Hermes, use the [configuration guide](../tools/hermes-reference/README.md) to declare stable Agent IDs, resident slots and existing run IDs, apply registrations and run bounded synchronization. The [compatibility audit](ai-agent-platform/hermes-integration-audit.md) records live-testing and source-authorization limits. A healthy connection does not establish Agent availability or activity.

There is no end-user connection form. Initial connection setup is a manual backend/operator operation. For someone installing their own copy, the supported process is:

1. Start your separate, supported LangGraph instance. For a local reference, use the [LangGraph startup instructions](../tools/langgraph-reference/README.md).
2. Configure the existing connection/profile, approved endpoint and backend-only credentials, using real connection/owner IDs. Follow [connection setup](ai-agent-platform/phase-5/reference-integration.md#configuration-authentication-and-transport) and the [current security/access restrictions](ai-agent-platform/phase-6/external-connectivity.md). Placeholder IDs are not an installed connection.
3. Check the connection and discover available workflows with the existing operator commands below.
4. Select an already existing provider thread/run, approve its local mapping and deliberately observe it. These commands do not start provider work.
5. Configure any required external Agent-to-local Agent/NPC mapping explicitly. Discovery does not automatically create backend Agents or residents. The [mapping guide](ai-agent-platform/phase-5/external-ingestion.md) and [NPC binding guide](ai-agent-platform/phase-3/npc-runtime-binding.md) describe these separate relationships.
6. After access and views are configured, inspect available **External Agent/workflow observations** and **Externally owned observations** in the collaboration panel. Not every external workflow is automatically visible as an NPC.

### Register and configure the local connection

Prerequisites: your deliberately selected, migrated local Elyqreth database, an existing owner UUID, and the supported trusted development/operator configuration. This is not a production or named-account activation procedure. Do not change an existing account installation to bypass its source-access restrictions.

Using your local database administration tool, register the connection with your actual IDs. Check whether the intended connection already exists first; do not create duplicates or overwrite an existing connection:

```sql
INSERT INTO orchestrators
  (id, owner_id, name, type, registration_status)
VALUES
  ('ACTUAL_CONNECTION_UUID',
   'ACTUAL_EXISTING_OWNER_UUID',
   'My LangGraph',
   'langgraph.v1',
   'ENABLED');
```

The uppercase placeholders are intentionally invalid until replaced. The owner must already exist. A database registration is not proof that the provider is connected.

Save a copy of [connection.example.json](../tools/langgraph-reference/connection.example.json) as your local connection file. Set `id` and `ownerId` to the same actual IDs used above. For the included host-based local reference, retain `http://127.0.0.1:20240`, `network: local` and the reviewed loopback allowed address. If you run the command inside a container, localhost refers to that container: this host-based example does not automatically supply a Compose network connection.

For another approved endpoint, configure its actual origin/network/address policy rather than blindly substituting a URL. Keep credentials in the documented backend-only `EXTERNAL_SECRET_*` reference, never directly in the profile. The trusted local reference does not require a provider key.

In the root PowerShell terminal where you will run observation commands, load your edited file:

```powershell
$env:EXTERNAL_ORCHESTRATORS_ENABLED = 'true'
$env:EXTERNAL_ORCHESTRATORS = Get-Content 'C:\path\your-connection.json' -Raw
```

Replace the file path. The remaining local database, registry owner and trusted development operator credentials must already be configured for that same installation. These two settings alone do not provision them, grant source access or reconfigure an already running process. Do not overwrite unrelated environment files or print credentials when troubleshooting.

### Check the connection and observe a run

For that authorized, configured local reference, run these from the project folder, replacing the uppercase placeholders with actual IDs:

```powershell
npm.cmd run langgraph:observe -- health ACTUAL_CONNECTION_UUID
npm.cmd run langgraph:observe -- discover ACTUAL_CONNECTION_UUID
npm.cmd run langgraph:observe -- approve ACTUAL_CONNECTION_UUID ACTUAL_THREAD_UUID:ACTUAL_RUN_UUID
npm.cmd run langgraph:observe -- observe ACTUAL_CONNECTION_UUID ACTUAL_THREAD_UUID:ACTUAL_RUN_UUID
npm.cmd run langgraph:observe -- result ACTUAL_CONNECTION_UUID ACTUAL_THREAD_UUID:ACTUAL_RUN_UUID
```

The current reference uses restricted trusted development/source access. Named local/OIDC account mode cannot issue those legacy source grants, and production external activation remains closed. A normal browser sign-in is not connection-setup permission. Do not disable authentication to bypass this restriction.

Each LangGraph observation reads a selected run once and exits. Hermes additionally offers a finite watch command for explicitly configured runs. There is no automatic startup provider-polling service. The browser refreshes observations stored by Elyqreth; it never polls Hermes or receives provider keys. External adapters cannot dispatch/cancel work or invent missing history/results. Follow the separate [Hermes procedure](../tools/hermes-reference/README.md) for its configuration and limits.

## Install the complete connected application yourself

The quick start above is complete for the city preview. A working real-Agent installation additionally needs the following one-time setup; there is currently no all-in-one installer:

| Setup | Why it is needed | Instructions |
| --- | --- | --- |
| PostgreSQL and migrations | Store Agents, Tasks, Executions, accounts and mappings | [Local setup](ai-agent-platform/phase-6/local-operations.md#add-postgresql-and-migrations-for-actual-agent-work) |
| Actual owner and orchestration route | Establish the real resource scope and route before creating Agents | [Agent registration/setup](ai-agent-platform/agent-registry.md); read alongside the current authentication guide |
| Local account or approved OIDC access | Give users an explicitly scoped login | [Account setup](ai-agent-platform/phase-6/authentication-modes.md) |
| Matching frontend mode and same-origin API routing | Make the browser's sign-in and protected requests reach that backend | [Frontend setup](ai-agent-platform/phase-6/frontend-access.md#local-setup-and-troubleshooting) |
| Enabled native Agent, runtime definition and NPC binding | Connect actual work to the resident you inspect | [Native Agent setup](ai-agent-platform/phase-6/local-operations.md#register-activate-and-run-a-native-agent) |
| Optional LLM provider | Run model-backed native Agents | [LLM setup](ai-agent-platform/phase-6/local-operations.md#add-an-llm-provider-deliberately) |
| Optional LangGraph reference | Observe external work | [Supported connection process](#connect-an-existing-orchestrator) |

Use your selected local environment and the guide's separate database/runtime/migration credentials. Do not overwrite existing configuration or databases. Never put provider keys, database passwords or backend secret files into browser configuration. Production hosting/configuration and deployment remain deferred; you do not need to fill the production approval worksheet to try the city.

## Sign out and solve common problems

Open the access dialog and choose **Sign out**. Protected data and synchronization are cleared. Credentials are kept only in page memory, so reloading the page requires signing in again. Signing out does not cancel work already admitted by the backend or a provider.

| Problem | What to do |
| --- | --- |
| The city runs, but nothing is connected | The preview is a simulation. Complete the real backend/access/mapping setup before expecting Agent data |
| I added an Agent through Residents, but it does no AI work | That creates a simulated resident. Backend Agent registration, runtime configuration and mapping are separate |
| There is no Hermes connection form | Configure Hermes on the backend and use its apply/sync commands; no browser wizard is provided |
| There is no Connect orchestrator button | Expected: the current LangGraph connection is manually configured by the installer/operator |
| Sign-in expired | Sign in again; do not repeatedly resend an uncertain Task |
| I can inspect but cannot run Tasks | Check whether access says viewer; ask the installer to review permissions and enabled Agent/runtime state |
| My LangGraph status is old | Check when the selected run was last observed; browser polling does not automatically refresh the provider |
| A Task looks stuck or cancellation is pending | Preserve its ID/status and ask the operator to investigate; do not edit state or assume the work succeeded |
| Access configuration is unavailable | Ask the installer to check the matching public mode and same-origin API route; do not enter secrets into URLs |

For installation troubleshooting, see [local operations](ai-agent-platform/phase-6/local-operations.md). For maintenance and recovery, use the [operator runbook index](ai-agent-platform/phase-6/operations-handover.md#operational-runbook-index). If reporting a problem, include the visible status and relevant Task/Execution identifier privately, but never passwords, tokens or provider keys.
