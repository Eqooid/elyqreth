# Existing system audit

Date: 2026-10-20. Locations refer to `C:\Users\user\Desktop\Project\Elyqreth-source\elyqreth`. IMPLEMENTED indicates source inspection; SIMULATED distinguishes local behavior from real agent execution.

## Discovery and technology

The initial `Elyqreth` workspace was empty. The user supplied this source export and stated it has dummy UI behavior without a backend. Inspection confirms a browser-only application. No `.git` exists: revision, remote, branch and original working-tree state are **UNKNOWN**. No `AGENTS.md` was found within the source or checked ancestors.

```text
elyqreth/
  package.json, package-lock.json, vite.config.js, .gitignore
  README.md
  dist/                   # hand-maintained application, NOT disposable output
    index.html, style.css
    js/                   # 33 JavaScript modules
    assets/               # 16 local assets
  tests/                  # four Node test files
  scripts/check.mjs
  docs/                   # six historical Markdown documents
  references/             # captures, prompts, artwork, verification JSON
  .openai/hosting.json
```

Evidence: [manifest](../../../Elyqreth-source/elyqreth/package.json), [lockfile](../../../Elyqreth-source/elyqreth/package-lock.json), [Vite config](../../../Elyqreth-source/elyqreth/vite.config.js), [entry](../../../Elyqreth-source/elyqreth/dist/index.html), [README](../../../Elyqreth-source/elyqreth/README.md).

| Concern | Verified finding |
| --- | --- |
| Framework | Vanilla JavaScript ES modules, HTML and CSS; no frontend framework |
| Graphics | Native Canvas 2D, Image, Path2D and cached canvases; no third-party rendering engine |
| Tooling | Vite `^6.4.1`, lockfile resolves **6.4.4**; Vite serves `dist` |
| Language | JavaScript; no TypeScript/compiler configuration |
| Package manager | npm lockfile v3; single private package, no workspaces or version pin |
| Scripts | `dev`: Vite; `check`: `node scripts/check.mjs`; `test`: `node --test tests/*.test.js`; no build script |
| State | Mutable classes, arrays, Maps and direct DOM updates/callbacks; no state library |
| Persistence/API | No browser storage, database, API/server, model integration, fetch or WebSocket usage found in runtime |
| Routes | One static HTML entry; `?view=roads` debug view; no router |
| Hosting | `.openai/hosting.json` serves `dist`; Vite binds `0.0.0.0`, allows `terminal.local` |
| Infrastructure | No Compose/Docker, Redis, broker, DB migrations or CI configuration found |

Node **24.9.0** was available for checks. Installed Vite/npm versions and live hosting health/URL are UNKNOWN. There is no declared Node version pin. Internal package name remains `orange-city-ai-town` intentionally per branding history. Never scaffold backend build output into root `dist/`.

## Subsystem inventory

| Implementation location / interface | Responsibilities, models and dependencies | Behavior and integration point | Limitations / modification risk |
| --- | --- | --- | --- |
| `dist/js/app.js`: `updateUi`, form handlers, `selection` | Constructs Simulation/Renderer/GameLoop; owns DOM roster, inspector, mission and selection; uses world/location/theme | IMPLEMENTED controls; SIMULATED start/add/remove/error/retry; future client can sit beside handlers | Broad UI/simulation coupling; debug JSON every ~200ms; changing reset/pause could accidentally command backend |
| `world.js`: WORLD, BUILDINGS, makePlan; `scenery.js` | Fixed geometry, string building IDs, doors/work cells, separate render bounds/colliders; scenery definitions | IMPLEMENTED 1856×1024 world, 116×64 cells at 16px, six functional buildings; layout preservation baseline | High risk: geometry affects collisions/depth; not a backend configuration store |
| `scene.js`: TownScene | Groups ground/buildings/decorations/cafe/park objects; agents/handoffs getters refer to Simulation | IMPLEMENTED lightweight scene graph; read-only future overlay seam | Shared references, no execution projection today |
| `renderer.js`: TownRenderer.update/draw/events/selectAt | Canvas, camera, assets, environment/water/train, Citizens/Traffic; Y/depth sorting, path/progress/packet rendering | IMPLEMENTED independent sprites, hit testing and selection; future projection read seam | Also updates decorative simulation/registers map references; not pure rendering. Sorting/closures allocate per frame |
| `assets.js`: AssetManager; `*-frames.js` | Local atlas loading, explicit crops/alpha, frame drawing; depends on theme | IMPLEMENTED load-time conversion/caching, sprite/footprint separation | Loading errors shown, no newly verified recovery; keep paths/assets intact |
| `theme.js`, `dist/style.css` | Icy White #F2F9FF tokens, lighting/material regions, character-atlas bypass | IMPLEMENTED white civic identity with cyan/pink/amber/green materials | High visual risk; do not replace theme or uniformly neutralize source colors |
| `game-loop.js`: GameLoop | requestAnimationFrame, ≤1/60s substeps, 1s delta cap, visibility timestamp reset | IMPLEMENTED browser-local updates; transport must stay outside frame loop | Throttled tabs cannot execute durable tasks; city pause must not pause backend |
| `camera.js`: Camera | Fit/pan/zoom/clamps, coordinate conversion; WORLD dependency | IMPLEMENTED drag/pinch/wheel/keyboard/buttons | No backend requirement; preserve coordinate transforms and focus |
| `tile-map.js`: TileMap | Typed-array terrain/walkability, road mask, colliders, occupied interaction views, spawning | IMPLEMENTED safe doors/alcoves/crossings; map references activities/citizens/train/traffic | Network coordinate writes bypass collision/occupancy guarantees |
| `pathfinding.js`: findPath; `movement.js`: navigate/updateAgent | Cardinal A*, optional pedestrian costs, recentering; path/purpose/direction/speed/timers/traffic | IMPLEMENTED smooth motion, courtesy and detours; single position owner | High risk: navigate alone does not clean activity leases; two path owners cause leaks/stalls |
| `agent-state.js`: STATE/setState; `animator.js`: SpriteAnimator | Visual states and labels; role/direction/pose atlas selection | IMPLEMENTED idle/walk/work/error and activity poses | Not durable task enums or availability; backend status cannot be assigned directly |
| `simulation.js`: Simulation | agents/nextId/task/stage/phase/steps/currentAgent, logs/packets; map/activity/movement dependencies | IMPLEMENTED roster, SIMULATED City Hall pipeline and recovery; future arbitration seam | One mission/current agent, session IDs, no durable attempts/artifacts/queue/external calls |
| `life.js`: CityClock/utility; `activities.js`: ActivityController/ReservationManager | Needs, traits, home, cooldown, daily clock; timed chains, leases, bilateral sessions, cancellation | IMPLEMENTED autonomous routines and cleanup; `cancel(a,'task')` releases reservations/session/props | Cosmetic needs must not drive backend eligibility; hidden/indoor/session cases make mutation risky |
| `locations.js`, `activity-plans.js`, `cafe-renderer.js` | Location/point registries, capacities, nested timed steps, poses/bubbles/props | IMPLEMENTED coffee service, food/window/household shopping, reading/rest/social/service chains | Local chain events/sessions are not persistent platform events or execution handoffs |
| `citizens.js`: Citizens | Separate decorative people, barista, jobs, train gates; shared activity/movement | IMPLEMENTED target 5/max 8 visitors, reduced night population, 0.2s offscreen batching, boundary exits | Staff ID 9999/visitors 10001+; unlimited functional counter could eventually collide. Never promote these numeric IDs to global identities |
| `road-network.js`, `roads.js`, `traffic.js` | Validated street graph/masks, cached surface drawing, three lane routes, crossing right of way | IMPLEMENTED boulevard/branch/alley, max four vehicles, yielding | Navigation/jobs rely on geometry; no execution routing belongs here |
| `water.js`, `train.js`, `environment.js` | 24-frame 64px water atlas/mask; station phases; cached glows, particles, lighting | IMPLEMENTED ambient clocks; train arrival count feeds decorative passengers | Preserve natural timing, rail clipping and theme; no constant inference required |
| `debug.js`, app `city-state` JSON | Optional overlays, diagnostics and DOM state samples | IMPLEMENTED debugging/historical capture aid | Not a platform API/audit store; future secrets/results must not enter unfiltered JSON |
| `tests/*.test.js`, `scripts/check.mjs` | Node built-in test/assert, model simulation/theme stubs, syntax checks | IMPLEMENTED 51 passing tests and syntax check | No DB/auth/API/transport or automated browser/pixel suite found |

## Rendering and NPC trace

`index.html` loads `app.js`, which creates Simulation (TileMap, ActivityController, four residents), Renderer (scene, assets, effects, decorative population), then GameLoop. Asset completion initializes terrain/road/water caches and enables drawing.

Each update invokes `sim.update(dt)`, then renderer update unless paused. Simulation scales/clamps time with city speed; clock, needs, activities, functional movement and fake mission advance together. Renderer advances environment/water/train/traffic at natural time and citizens at city speed. Pause freezes both; drawing/UI continue. UI updates about every 200ms. DPR is capped at 2, smoothing disabled, terrain/water/glows cached, offscreen citizens batched. Fresh FPS/performance is UNKNOWN.

Residents begin Ada/Researcher, Mika/Designer, Atlas/Developer, Finn/Tester. `addAgent` creates id/name/role/appearance/workplace/x/y/progress/workTime. Movement initialization adds paths, animator, direction, timers and purposes; life initialization adds needs/personality/home/workStatus. Indoor activities hide the same object without deleting identity. Utility decisions use needs, distance, traits, occupancy and time, without LLM inference. Removal/reset/task interruption use shared lease/session/prop cleanup. Selection inspects live objects through roster or canvas.

## Agent concepts: simulation versus execution

Evidence: [Simulation](../../../Elyqreth-source/elyqreth/dist/js/simulation.js), [world plan](../../../Elyqreth-source/elyqreth/dist/js/world.js), [app](../../../Elyqreth-source/elyqreth/dist/js/app.js), [activity cleanup](../../../Elyqreth-source/elyqreth/dist/js/activities.js).

| Concept | Classification and actual behavior |
| --- | --- |
| Agent identifiers/registry | PARTIAL: `agents[]` and incrementing session-local IDs, UI add/remove; no durable logical owner/identity |
| States | IMPLEMENTED simulation: visual STATE/status plus separate workStatus; no external availability |
| Assignments | SIMULATED: makePlan always Research/Design/Build/Test, 5/6/8/5 seconds, first matching non-Error role |
| Orchestration | SIMULATED: City Hall building/UI backed by Simulation methods, not a service/adapter |
| Handoffs | SIMULATED: walk Hall → work → Hall, log text and packets, then next stage; no artifact transfer |
| Retry/reassignment | SIMULATED: earlier stages preserved on retry; absent role blocks, new suitable resident resumes |
| Results | No real execution found: workTime reaches step.seconds and delivers predefined text, not a page/report artifact |
| Agent-NPC mapping | PARTIAL: conceptual agent and NPC are one object, not independent identities with a binding |
| History/events | PARTIAL: onChange callback, 100 newest text logs, temporary packets; no durable/versioned events |
| Persistence | Not found: reload reconstructs all residents/tasks; browser pause/close stops work |

No external runtime/adapters or API placeholders were found. This is a working local simulation, not a partially wired execution backend. Historical city plans are not backend platform specifications.

| State | Current authority | Recommended future boundary |
| --- | --- | --- |
| Roster, mission, stage and orchestrator | Simulation | Preserve demo; separate backend Agent/Task/Execution |
| Position/path/frame | movement and animator on NPC | Browser remains sole movement authority |
| Needs/activity/leases/session/clock | ActivityController/CityClock | Decorative, not backend eligibility/deadlines |
| Decorative people | Citizens, updated by renderer | Outside real agent registry by default |
| Camera/effects/selection | Renderer/Camera and app | Client-local |
| Panels/forms/speed/pause | app DOM and Simulation flags | Explicit future real commands, no implicit reset/cancel coupling |

## Documentation and checks

Existing conventions are Markdown module tables and audit/implementation/verification notes, with captures/prompts/JSON under references. Inspected all six docs: living-city-2-plan, living-city-2-1-plan, ice-blue-theme, icy-white-theme, elyqreth-rebranding, living-color-restoration. Historical layouts/counts/commit references retain provenance but are not the current snapshot. Current source/tests supersede old 21/48/50-test counts. Retained Icy White verification JSON describes earlier browser observations. Visually inspected the retained `references/living-color-overview.jpg`: it shows the white civic lighting with retained colored signs/materials, City Hall mission panel, roads, canal, station and separate residents. This is a historical capture, not a fresh rendering test.

Read-only checks on Node 24.9.0:

- `node scripts/check.mjs`: passed all game-module syntax checks.
- `node --test tests/theme.test.js tests/simulation.test.js tests/living-city.test.js tests/purposeful-city.test.js`: **51 passed, zero failed/skipped**, approximately 17.5 seconds.
- SHA-256 inventory: all **160 source files** identical before/after, including docs, tests, assets and deployment configuration; no additions/removals.
- Documentation inventory (10 files), relative links (28 local targets), fenced blocks, example JSON and T02–T08 required sections checked after writing. Mermaid source reviewed structurally; diagrams were not rendered in a Mermaid engine.

No dependencies installed, build run, migrations created or application code modified. No fresh browser interaction/screenshot/accessibility review, live hosting inspection or FPS benchmark performed. File preservation and model tests passed; historical screenshots are not fresh runtime proof. T08 must capture browser acceptance when implementation changes occur.

Critical risks: shared NPC mutation and lease cleanup; nonpersistent/colliding numeric IDs; accidental dist overwrite; simulated/real dual ownership; network work in animation loop; debug payload exposure. See [city integration](city-integration.md) and [security](security-and-reliability.md).
