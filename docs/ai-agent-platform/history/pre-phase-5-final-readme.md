# Historical README checkpoints before Phase 5 final acceptance

Archived on 2026-10-29, Asia/Bangkok, to preserve existing Phase 1-4 and city development notes while keeping the root README concise. These are task-date historical statements, not current implementation status. See the [current README](../../../README.md) and [Phase 5 acceptance](../phase-5/acceptance.md).

## Prior phase acceptance and historical records

**Phase 3 T10 COMPLETE - ACCEPTED WITH LIMITATIONS for local development (2026-10-25).** The [final acceptance report](../../../docs/ai-agent-platform/phase-3/acceptance.md) verifies T01-T10 with 125 frontend, 192 backend and 104 real PostgreSQL tests, plus an additional real Chrome/API/PostgreSQL acceptance workflow covering five executions. Existing city source/assets are unchanged. Public production release remains blocked by the documented identity/access and deployment limits.

Run `npm run test:city:e2e` with Docker and installed Chrome for the isolated combined workflow. Runtime observation uses a distinct, volatile city-read token and explicit trusted local connection; it is disabled by default. See the report for setup, exact commands, evidence and limitations.

## Historical implementation checkpoints

The checkpoints below describe the repository at their task dates. Their "planned" statements are historical; the final T10 inventory above is authoritative.

**Phase 3 T09 COMPLETE — PASS WITH LIMITATIONS (2026-10-25):** [Security, performance and regression evidence](../../../docs/ai-agent-platform/phase-3/security-performance-verification.md) records the approved local trust boundary, patched HTTP parser advisories, measured synchronization/browser resources and reproducible regression checks. T10 final acceptance remains planned.

**Run with Docker:** see [Docker setup](../../../docs/docker.md). The local stack builds the city and backend, starts PostgreSQL, and applies migrations. Open http://127.0.0.1:8080. Protected real-Agent runtime APIs remain disabled in bridged containers; the existing loopback-only security boundary is preserved.

**Phase 3 T08 COMPLETE (2026-10-25):** [Multi-Agent synchronization and reconnection](../../../docs/ai-agent-platform/phase-3/multi-agent-synchronization.md) hardens existing shared REST polling, same-identity version checks, reentrant refresh coalescing and completion suppression. No new transport/backend state machine. T09/T10 remain planned.

**Phase 3 T07 COMPLETE within city-read contracts (2026-10-25):** [Agent inspection implementation](../../../docs/ai-agent-platform/phase-3/agent-inspection.md) extends the existing inspector using authorized city projection references and its latest recorded outcome. Full operator history/results/audit access is not broadened. T08–T10 remain planned.

**Phase 3 T06 COMPLETE (2026-10-25):** [NPC status visualization](../../../docs/ai-agent-platform/phase-3/npc-status-visualization.md) adds read-only Canvas markers and a compact runtime section in the existing NPC inspector. T07 detailed history/results and T08–T10 remain planned. See the implementation guide for verification and limitations.

**Phase 3 T05 verified (2026-10-24):** [NPC Runtime Binding](../../../docs/ai-agent-platform/phase-3/npc-runtime-binding.md) associates existing stable resident identities with authorized synchronized activity through indexed read-only views. Missing NPCs stay unresolved; no spawning, movement, rendering or inspector behavior changed. Checks passed 96 frontend, 190 backend and 103 PostgreSQL tests, builds/static checks and browser smoke. T06–T10 remain planned.

**T12 acceptance (2026-10-24): ACCEPTED WITH LIMITATIONS for local development only.** See [the acceptance report](../../../docs/ai-agent-platform/phase-2/acceptance.md) for 173 backend, 89 isolated PostgreSQL and 51 city tests, both builds, browser smoke and live installed Ollama text/calculator evidence. Live OpenAI was NOT RUN. External production exposure remains BLOCKED without production identity/access controls. Earlier task checkpoints below are historical evidence.

**A Living AI City**

## Historical Phase 1/2 checkpoint

The city in `dist/` remains an independent static Canvas application. The optional
NestJS backend in `apps/api` provides the Phase 1 PostgreSQL control-plane
foundation: local Agent Registry, Tasks, Execution history, internal lifecycle
services and durable audit events. Explicit native LLM execution is now available through the Phase 2 runtime; NPC synchronization remains absent.
See the [Phase 1 acceptance report](../../../docs/ai-agent-platform/phase-1-acceptance.md)
for historical Phase 1 verification, limitations and release decision; use the T12 report above for current Phase 2 acceptance. Earlier release notes
below are historical records.

**Phase 2 status:** T02-T11 include the existing runtime and providers, permissioned
Calculator/Current DateTime tools, and one [LLM Agent Strategy](../../../docs/ai-agent-platform/phase-2/llm-agent.md).
Explicit local execution uses trusted profiles and a bounded structured tool loop;
results and lifecycle events persist through the existing coordinator.
Deterministic/PostgreSQL acceptance passed. Live qwen3:0.6b text-only Task execution passed, while its calculator case produced
invalid numeric arguments and failed safely; live OpenAI was not run. No worker, unrestricted public execution
endpoint or NPC synchronization is implemented. The city remains independent.
Next: Phase 2 T12 - End-to-End Verification & Acceptance Review (not begun).

Use Node 24 and npm from this root (`npm.cmd` in restricted PowerShell):

```sh
npm ci
npm run dev:web
# Separate terminal; does not depend on the city server:
npm run dev:api
```

The API defaults to `127.0.0.1:3001`; `GET /health` is liveness only.
[Backend setup](../../../docs/ai-agent-platform/backend-foundation.md),
[database/environment/migration setup](../../../docs/ai-agent-platform/database-foundation.md)
and [registry credentials/owner provisioning](../../../docs/ai-agent-platform/agent-registry.md)
describe the opt-in local API. Process environment overrides `apps/api/.env`, then
defaults. Never commit credentials or expose this development access mode publicly.

```sh
npm run build            # API only
npm run build:web        # Check bundling in disposable output; preserve source dist/
npm run test:all         # City and backend unit/API tests
npm run test:db          # Owned disposable Docker/PostgreSQL integration tests
npm run test:browser     # Installed Chromium; optional BROWSER_PATH
npm run verify:phase1    # All checks, including builds, migrations and browser
```

The [verification workflow](../../../.github/workflows/verify.yml) runs the same command
without deployment. Docker must be running for database tests; no developer DB is
used. There are no new providers, queues, workers, realtime transports or mandatory
cloud services. Full production authentication/authorization remains required.

Official branding: **Elyqreth — A Living AI City**. The current visual theme is
Icy White (#F2F9FF). Earlier release notes and captured artwork/verification
records retain their historical names. Internal package IDs, source filenames,
hosting identity and URL remain compatible with the existing project.

Rebranding validation: syntax checks and all 48 tests pass. Browser review
confirmed the new title, header and welcome guide, unchanged Icy White lighting,
and a complete four-stage mission with continued city animation. See
`docs/elyqreth-rebranding.md` and `references/elyqreth-rebranding*` for evidence.

Elyqreth is a layered 2 D pixel-art AI city simulator, with the existing resident controls, orchestrator, four-stage workflow, activity log, and recovery behavior preserved.

## Run locally

Serve the complete `dist` folder with any static HTTP server:

```sh
python3 -m http.server 8080 --directory dist
```

Open http://localhost:8080. JavaScript modules need HTTP rather than opening index.html as a file.

Optional development server with automatic reload:

```sh
npm install
npm run dev
```

The standalone city uses vanilla JavaScript, Canvas and CSS and requires no backend, database, model, credential or runtime CDN. Vite serves development assets. Agent-linked interaction additionally requires the local API, persistence and explicit capabilities in the current Phase 4 runbook.

## Play

- Residents start wandering immediately. They choose reachable parks, sidewalks, plazas, and random walkable destinations; their speeds and pauses vary.
- Enter a mission and press Start task. City Hall plans Research → Design → Build → Test. The assigned resident abandons their wandering route without changing position, collects the brief, walks into their workplace alcove, works, and returns the result to City Hall.
- Unassigned residents keep exploring during the mission. After delivering a stage, each resident pauses briefly and resumes wandering, even while later stages continue.
- Click a resident or workplace, or use the roster, to inspect it. The inspector shows direction, destination, role, and task stage.
- Add and remove residents. If an active resident leaves, the orchestrator reassigns the current stage or waits for the missing role. Adding a suitable resident resumes the mission.
- Simulate error from an assigned agent’s inspector. Retry step preserves completed handoffs.
- Pause freezes the entire town, including character and environment animation. Resume, reset the mission, or adjust speed from 0.5× to 4×. Reset keeps the roster and positions; it never teleports residents.
- Drag to pan, scroll or pinch to zoom. With the canvas focused, use arrow keys and + / −. F or the crosshair fits the town. Aa toggles building labels.

City Hall missions are simulated. Any brief uses the same deterministic four-role pipeline and does not produce a real landing page. Simulation state stays in the current browser session. Agent Task/Execution records have their own persisted backend lifecycle as documented in the Phase 4 runbook.

## How the world works

The uploaded illustration is **not rendered as the map**. It is retained only in `references/orange-city-reference.png` as an art reference. Its baked-in citizens are never loaded by the runtime.

The original **1536×1024 image is now the actual placement blueprint**, at one image pixel per world pixel. The original district covers 96×64 cells of 16 pixels; the current café expansion extends the navigation grid to 116×64 cells. Character sprites render at 30×42 world pixels, close to the reference's approximately 40-pixel citizens. The six functional workplaces keep their IDs, roles and workflows; nine decorative buildings reproduce the edge and foreground silhouettes. A static dock vehicle replaces the earlier misplaced dock building.

The arrangement is asymmetric: the cat billboard is at the upper-left edge; Hall, Market and Café form the upper frontage; the Bar and Clinic frame the left globe plaza; a central asphalt spine separates the plaza from the canal; the narrow R&D building and skyline billboards occupy the right; the horizontal train bay and rail platform form the foreground station. A deterministic connected street graph traces the reference: a 64-pixel east–west boulevard, a 64-pixel station approach and a 32-pixel east service alley. The boulevard continues beyond both map edges; branches end at named station drop-off and R&D service courts. Entrances and two canal crossings have small navigation adjustments. `references/reference-blueprint.json` records image-relative render rectangles, ground footprints, roads, sidewalks, water, bridges and public spaces. No building positions are generated randomly.

`TownScene` groups the ground geometry, buildings, decorations, independently rendered scenery, dynamic agents and handoffs. Each building has its own ID, sprite/atlas, world rectangle, solid footprint and render depth. Render rectangles follow the blueprint separately from footprints; the renderer fits the high-detail alpha sprites to those rectangles. Only tiled ground is cached. Signs, basin rim, bridges, platform railings, planters, trees, lamps, workstations, characters and particles remain separate objects. Structural rim and bridge collisions use multiple small parts, leaving crossing decks walkable.

The camera starts with the same image aspect and framing as the reference. Fit restores this comparison view; pan and zoom still explore details. Workplace overlay labels start hidden so architectural signs stay visible; Aa restores them. City Hall remains explicitly identified as the orchestrator in the mission panel and selection information. The roster starts collapsed. Tall roofs and cropped foreground silhouettes retain the original front/down perspective and Y-based sorting.

`references/reference-density.json` measures the reconstructed district footprints. The earlier compact-grid density reports are retained as historical records; their 24-building count and parcel percentages do not describe this blueprint version. The current layout prioritizes the reference's composition rather than retaining invented grid blocks.

`scenery.js` defines reusable decorative types and placements independently of the functional `BUILDINGS` roster. Each instance has an ID, atlas and sprite index, world position, width and height, rendering layer, ground collision footprint, and optional animation configuration. Art can extend above its footprint; rooftop details inherit the parent building's depth and do not add ground collisions. New scenery never appears in workplace selectors or changes the orchestrator. Neon flicker, window pulses, and service beacons use the environment clock; pause freezes their independent ambient clocks. The tile map marks every solid footprint before A* or agent spawning runs. All walkable cells are connected, including the narrow alleys and residential sidewalks.

The walkability grid blocks solid building cells, water, tree trunks, furniture, and utilities. Building alcoves are explicitly walkable working areas. Cardinal A* prevents diagonal corner-cutting. Movement follows grid centers continuously and handles interruption from a tile edge safely. Courtesy pauses and task priority reduce crowd overlap; brief soft overlap is allowed after a timeout to prevent deadlocks in narrow paths.

A character animator selects real frames from a transparent 64-frame atlas: four role appearances × four directions × four poses. Walking visibly alternates feet and arms; idle and work animations use breathing poses. Working residents face their animated workstation. Sprite timing uses simulation time and therefore follows pause and speed controls.

## Modules

| Module | Responsibility |
| --- | --- |
| `world.js` | Buildings, props, points of interest, role colors, and the existing task plan |
| `density.js` | Measured reference-district footprint coverage |
| `scene.js` | Structured scene graph for geometry, static objects, dynamic agents and handoffs |
| `blueprint-frames.js` | Inspected atlas rectangles for complete transparent sprites |
| `scenery.js` | Reusable decorative building/prop types, independent placements, footprints, visual animation settings |
| `tile-map.js` | Terrain types, collision grid, working alcoves, safe spawn positions |
| `pathfinding.js` | Cardinal A* routes |
| `movement.js` | Agent controller: roaming, smooth movement, courtesy pauses, task priority |
| `agent-state.js` | Explicit state transitions and user-visible labels |
| `animator.js` | Directional walking, idle, and working frame selection |
| `simulation.js` | Existing orchestrator, dependencies, progress, handoffs, error/retry, removal |
| `assets.js` | Atlas loading, cell extraction, shared character sizing |
| `camera.js` | Camera fit, pan, zoom, coordinate conversion |
| `water.js` | Cached 24-frame water tile sheet, flow direction, ripples, clipped moving reflections |
| `road-network.js` | Named street graph, surface union, adjacency masks, junction types and connectivity validation |
| `roads.js` | Reusable adjacency road tiles, shared-edge curbs, lane markings, crossings, terminal bays and opt-in debug view |
| `train.js` | Independent rail entity, fixed deck, station stop, departure, randomized return |
| `environment.js` | Independent neon/window/billboard timers, tree sway, lamps, monitors, particles |
| `renderer.js` | Layered Canvas drawing, Y sorting, selections, pointer interactions |
| `game-loop.js` | requestAnimationFrame and bounded delta-time updates |
| `app.js` | Preserved controls, dialogs, roster, inspector, activity, and progress |

States: IDLE, WANDERING, WALKING, WALKING_TO_WORK, WORKING, WAITING, COMPLETED, ERROR. Only the agent controller owns movement; task navigation replaces wandering rather than running a second movement system.

## Artwork and atlas layout

The illustration includes overlapping buildings and baked-in characters, so clean extraction of complete sprites was not possible. The required facades and environmental objects were recreated with built-in image generation, using the original image as their primary architectural reference. This is a close reconstruction, not pixel-for-pixel extraction. All three new atlases have transparent backgrounds and no visible people; the original illustration is never used at runtime. Some roof and window details differ from the original because hidden structures had to be reconstructed.

| Runtime asset | Dimensions | Layout |
| --- | --- | --- |
| `dist/assets/blueprint-landmarks.png` |1536×1024|Six explicitly sliced landmarks: Hall, Market, Café / Clinic, narrow R&D, five landmarks (station cell retained as historical source) |
| `dist/assets/central-station-train.png` |1536×1024|Separate empty station frame with transparent bay and independent train sprite |
| `dist/assets/blueprint-scenery.png` |1536×1024|Eight explicitly sliced reference towers, residences, utility blocks and footbridge |
| `dist/assets/blueprint-props.png` |1536×1024|Six explicitly sliced signs, basin rim, hover truck, rail platform and garden planter |
| `dist/assets/characters.png` |1254×1254|8 columns ×8 rows; each role occupies 2 rows |
| `dist/assets/terrain-props.png` |1254×1254|4 columns ×4 rows:8 terrain swatches,8 props |
| `dist/assets/decorative-buildings.png` |1536×1024|4 columns ×2 rows: apartments, office, store, café / house, warehouse, utility, shop |
| `dist/assets/street-objects.png` |1536×1024|4 columns ×2 rows: vending, bin, signpost, neon sign / vent, tank, planter, bench |
| `dist/assets/urban-architecture.png` |1536×1024|Six independently sliced sprites: arcade, billboard block, apartments, workshop, mixed-use block, corner hotel |

Character role pairs: amber Researcher, pink Designer, cyan Developer, lavender Tester. First role row: down in columns 0–3, left in 4–7. Second row: right in 0–3, up in 4–7. Each group: neutral, left step, breathing/neutral, right step. Actual image dimensions are used when slicing, so fractional cell sizes are handled without assuming 128 px cells. Generated alpha is preserved; some glows and tile edges have fractional alpha.

Exact generation prompts and alpha inspection are in `references/asset-prompts.json`, `references/buildings-fix-prompt.txt`, and `references/asset-validation.json`.

The two expansion atlases were created with built-in image generation using the original artwork and existing atlases as style references. Exact prompts are in `references/density-atlas-prompts.txt`; the required correction removing office-window people silhouettes is in `references/density-atlas-edit-prompt.txt`. The decorative-building rows are sliced at y=540 instead of y=512 to keep the generated top-row bases intact. Assets are loaded from the project and retain their generated alpha; no flattened town image is used.

The urban-fidelity atlas was generated with the re-uploaded original image as its primary target, retaining graphite pixel outlines, amber storefronts, cyan monitors, magenta neon, visible roof depth and empty furnished interiors. The exact built-in generation prompt and inspected source rectangles are in `references/urban-fidelity-prompt.txt` and `references/urban-fidelity-slices.json`. Explicit source rectangles keep whole buildings intact when a generated silhouette crosses its nominal atlas cell. The original reference remains outside the runtime folder and is never loaded into the game.

## Validation

```sh
npm run check
npm test
```

The checks cover all modules and the twenty-one tests exercise every decorative footprint, the connected compact navigation grid, reusable scenery definitions, safe workplace/park routes, blocked buildings/water, four directions, actual animation frame changes, two minutes of roaming without teleportation or entering obstacles, task interruption, working-area arrival, pause, complete handoffs, resumed roaming, retry preserving earlier stages, missing-role recovery, and active-agent replacement, reference landmark placement, in-bounds footprints, bridge collision parts and non-overlapping building footprints.

`references/visual-validation.json` records rendered sprite dimensions relative to the 42-pixel reference-scaled agent height. The browser review checks the initial street view, whole-city overview, enlarged architecture, directional wandering, camera pan/zoom, a complete four-stage mission, and resumed wandering after handoff.


## Reference reconstruction records

`references/blueprint-atlas-manifest.json` and `references/blueprint-props-manifest.json` contain the exact built-in generation prompts and inspected source rectangles. Those rectangles are also used by `blueprint-frames.js`; generated gutters were not uniform, so the loader does not assume a regular grid for these atlases. Raster pixels were not manually repainted. Previous assets remain in the project for reuse, but the reconstructed buildings use the new reference-specific sprites.

The visual review used the fitted original aspect, captured a first pass in `references/blueprint-first-pass.jpg` and the verified result in `references/blueprint-final-pass.jpg`, then corrected its largest missing pieces: plaza story monument, U-shaped basin rim, station wayfinder, dock hover truck, platform railing and raised planters. `references/visual-validation.json` records the reference comparison, render sizes and gameplay checks.

## Living environment update

The city architecture and placement are preserved. The reference and prior town screenshots were compared before changes. The reference's market cross street, central spine and east alley now use dark asphalt, aggregate pixels, curbs, dashed center markings and crossings. The globe plaza, shop/hall sidewalks, canal crossings, station stairs and dock promenade keep stone paving. Collision and A* remain separate from those surfaces.

`WaterSystem` builds a 64-pixel, 24-frame seamless tile sheet once, drawing moving wavelets over the original fine surface grain. Canal and south basin flow down; the dock flows left. Reflections, bright cores and edge currents animate separately inside a cached mask of water cells, so bridges and ground stay dry. It never translates the city or an entire water photograph.

The old baked train station sprite is replaced at runtime by `central-station-train.png`: a matching station frame with an empty, transparent bay and a separate right-facing train. The train enters behind the station, stops for 5–8 seconds, leaves along the horizontal foreground rail deck, exits, then waits 7–15 seconds before repeating. Its sprite is clipped to the rail corridor and draws behind station pillars, roof/sign and front railings. The bay does not retain a painted train. Exact builtin image-generation prompt and alpha inspection are in `references/living-train-prompt.json` and `references/living-train-alpha.json`. Generated pixels were copied intact.

Neon signs, windows, electronic billboards, streetlights, tree canopies and particles use different phases and periods. The ambient clock uses real delta time at a natural pace; mission speed changes residents and workflow only. Pause freezes both systems. Existing autonomous wandering, task movement and state transitions are unchanged.

`references/living-validation.json` records browser and nine automated checks, cropped water-pixel comparison, train positions across frames, and station-empty/arrival/departure/mission-complete screenshots. Motion remained responsive during browser observation; no numerical FPS benchmark is claimed. Terrain and the water atlas are cached and there are no per-frame image loads or pixel readbacks.


## Connected streets update

The previous declared corridors lost 116 tiles when later sidewalk, plaza and building fills overwrote parts of them. Their remaining asphalt still formed one connected component, but varying widths and abrupt ends made the city look fragmented. The road layout is now a named graph rather than independently painted patches. Six nodes and five segments produce one connected 490-cell road/alley surface. The two junctions are T-junctions; the reusable tile system also supports turns and four-way junctions without curbs crossing their connections. Width is explicit per corridor, crossings are named, and lane markings are suppressed at junctions and crossings.

Ground geometry is constructed before the protected road mask. Asphalt, service alley, sidewalk, pedestrian plaza, canal, railway and building footprint have distinct terrain values. Buildings retain their sprite positions and heights. Four ground colliders now start at the actual street-side facade base rather than the projected rooftop; their doors and working areas stay in place. The main street remains unblocked, and existing paths connect all workplaces, parks and canal bridges. The railway deck is classified separately and blocked to pedestrians.

Validation runs before drawing: graph connectivity, cardinal segments, consistent even widths, declared destinations, contiguous surface, unchanged road tiles and no solid obstruction on the boulevard. Tests deliberately inject an overwritten tile, disconnected graph and unnamed ending to verify rejection.

For the temporary road-only view, append `?view=roads` to the app URL. It highlights segments, junctions, endpoints, footprints, water and rail and displays the connectivity report. It is disabled in the normal view; reopening the normal URL restores the full town. `references/road-network-validation.json` records structural and browser checks, and `references/road-network-debug.jpg` and `references/road-network-city.jpg` show both views.

## Road polish and ambient traffic

This refinement keeps the reference-coordinate city and every major building in place.
The existing 64px east–west boulevard and station branch remain connected; the 32px
R&D service alley stays pedestrian-only. Curbs now share quiet continuous borders,
crossings have equal margins, and the station bay has a turnaround marking. Asphalt
and stone remain separate cached ground layers.

`traffic.js` owns three checked lane routes: eastbound, westbound, and the curved
station drop-off loop. At most four cars are active, with randomized 5.5–11 second
spawn intervals. Cars ease into turns, keep spacing, reserve occupied crossings,
and yield to agents and visitors. Pedestrians wait for a car already in a crossing;
a temporary A* detour prevents a permanent head-on wait. Cars and pedestrians use
independent clocks, including at 4× mission speed. All visible cars are independent
sprites from the generated transparent atlas. Asset prompt and measured frame bounds
are in `references/vehicle-atlas-*`.

Three cosmetic visitors wander using the same collision-aware controller. Click one
for a **Visitor / Decorative pedestrian** inspector; they do not appear in the AI
roster, take tasks, or count toward workflow roles. Agents remember four recent
wander destinations, pause near public places, look around, and prefer sidewalks
and marked crossings. Wandering still yields immediately to assignments.

Water now fully covers its old painted base with animated directional tiles and
adds bridge-pier ripples. The station train uses analytic acceleration/deceleration
along the existing rail deck; its stops and random departure intervals remain
independent from mission speed. Lights use cached glow sprites, tree movement is
pixel-snapped, and ambient particles are capped at 22.

### Developer overlays

Click **D** beside the camera controls. Toggle the road graph, vehicle lanes,
pedestrian navigation grid, building collision boundaries, and train route.
Everything is off on a normal page load. Static overlays are cached, with at most
three cached combinations. `?view=roads` remains the optional road-only audit view.
The panel displays frame rate and average draw time. A read-only `#city-state` JSON
DOM element exposes snapshots for browser comparisons without modifying game state.

### Validation

`npm run check` checks module syntax; `npm test` runs 16 meaningful checks, including
lane clearance, curved turns and exits, pedestrian yielding, visitor isolation,
marked crossing preference, train easing, and five-minute traffic/workflow
coexistence checks at 1× and 4× speed. The existing collision, navigation, recovery,
sprite-direction, water-loop, and full-workflow tests remain in place.

Browser screenshots and position snapshots in `references/polish-*` document the
visual comparison and full task cycle. The cloud preview throttles animation-frame
callbacks, so its FPS is not a desktop benchmark; recorded canvas draw timings
provide a rendering-cost check, not a claim of verified 60 FPS on every computer.

## Historical Velqaryn branding

At this earlier release, the application title, header, welcome guide, accessible simulation dashboard name, page description, project description, and Sites display title used **Velqaryn** with the tagline **A Living AI City**. Internal package identifiers and original reference filenames retain their existing names.

Rename verification: module syntax checks and all 16 simulation tests passed. Browser review confirmed the new header, browser title, and welcome guide, a complete four-stage mission, continued agent wandering, changing water frames, vehicle movement and exits, and repeated train arrivals and departures. Evidence is saved in `references/velqaryn-rename-verification.json` and `references/velqaryn-rename.jpg`.

## Ember Café and social routines

The world now measures **1856×1024** pixels. The original 1536×1024 district retains its landmark coordinates. A compact 320-pixel east extension adds Ember Café, four outdoor tables, sixteen individually reservable chair anchors, cups, planters, an umbrella and warm lighting. The east boulevard, pedestrian frontage and horizontal rail deck extend continuously; the station stop stays at its original coordinate. A marked crossing connects the service counter courtyard and table terrace. Use the coffee button to visit the terrace and click its paving for a location inspector. Each table, chair and prop is a separate depth-sorted world object; table/counter/planter bodies have solid collision footprints.

`locations.js` declares locations, furniture interaction points and the `COFFEE_ACTIVITY` definition. Chair anchors contain a unique ID, position, sitting direction, interaction cell and associated table. `activities.js` supplies a reusable `ActivityController` and `ReservationManager`; live occupancy is derived from owner-checked leases, not static furniture data. The existing `STATE`, A* navigator and movement controller handle the routine: walking to café → sitting → drinking coffee/socializing → leaving café → idle/wandering. Waiting times out safely if all seats are reserved. Agents never move directly into furniture: their walkable interaction position is the exact chair foot anchor. These anchors stay traversable for interaction; reservations prevent duplicate use, occupied chair cells block other actors’ routes, and walkers favor ordinary pedestrian destinations. Existing paths detour when a chair becomes occupied. Mission walkers take precedence over idle walkers at shared path encounters.

Defaults: 62% activity decision probability, 12–23 seconds between decisions, at most three functional agents plus one decorative visitor on café routines, 8 seconds between admissions, 38–64 seconds seated and 45–95 seconds between visits, with a minimum 20-second rest after work before another café decision. Durations for AI agents follow simulation speed; decorative visitors retain the ambient clock. Normal wandering continues between visits. Conversations are short preset dialogue with at most two bubbles on screen. Each seat visit has repeated 5.2-second sip cycles with separate resting, holding and sipping sprite frames in four directions. The runtime uses a generated seated sprite atlas, including directional mirrors, plus subtle cup steam and counter lighting.

The orchestrator cancels an assigned agent's routine before collecting its brief: it clears the café path/pose, releases the reservation, and immediately starts ordinary work navigation without changing position. Removal, reset, route failure, missing owners and expired leases also release seats. Pause freezes all routines and environment timers. Visitors share the reservation/activity system but never enter the functional roster or receive mission work; selection explicitly identifies them as decorative visitors.

`cafe-renderer.js` integrates independent props, chair front/back occlusion, seated poses, steam and screen-space dialogue with the existing camera and Y-depth renderer. `cafe-frames.js` contains inspected slices for `assets/cafe-props.png` and `assets/cafe-residents.png`. Assets were generated using the built-in image-generation tool against the existing art and character sheets. Exact prompts and slice inspections are retained in `references/cafe-prompts.json`, `references/cafe-revision-prompts.json`, `references/cafe-final-resident-prompt.txt` and `references/cafe-slices.json`. The default developer overlays now also include live café interaction anchors: amber free, pink reserved, cyan occupied.

Validation includes the original sixteen simulation checks plus five new checks covering all furniture paths/collisions, reservation ownership/expiry, twelve simulated minutes of repeated coffee/social cycles, work interruptions from navigation/sitting/drinking/socializing, and waiting/removal/pause/reset cleanup. Browser evidence and screenshots are retained under `references/cafe-*`.

Final browser observation captured 73 state samples across several activity cycles and completed missions. The final run recorded 18 café admissions, 12 completed visits, 3 work interruptions and zero failed café routes; reservation-owner checks found no duplicate owners or missing actors, and the application console was clear. A seated Researcher transitioned into brief-collection navigation and released its chair. Selecting a seated decorative customer showed `Ren · Visitor`, `Decorative pedestrian` and `Socializing`. Water frames changed, traffic spawned and exited, and the extended train continued arriving/stopping/departing. Detailed evidence is in `references/cafe-browser-verification.json`; `references/cafe-social-final.jpg` and `references/cafe-expanded-overview.jpg` show the terrace and overall preserved composition.

## Living City 2.0

Elyqreth uses its existing gardens as **Circuit Park**, with three independent benches and six reservable reading positions. Two original benches retain their artwork and placement; a third bench fits the clear garden forecourt. The original city dimensions, landmark rectangles, boulevard graph, bridges, rail route and Ember Café are retained. No new district, major building, road surface or framework was introduced.

Residents choose coffee, park reading, shopping and home rest using needs, personality, time, distance, available capacity and per-activity cooldowns. Energy and social are satisfaction levels (higher is better); hunger increases until shopping or a snack. These values are cosmetic and never make a registered worker unavailable. Curious/Relaxed/Focused/Sociable profiles bias choices; they do not determine roles. New residents can independently choose a work role and a jacket appearance.

| Module | Responsibility |
| --- | --- |
| `locations.js` | Shared location registry, furniture/entrance anchors, capacities and timed activity definitions. The two existing foreground residential blocks supply shared homes. |
| `activities.js` | Existing controller extended with common reservations, lifecycle, A* arrivals/departures, indoor visibility, bilateral social sessions and interruption cleanup. |
| `life.js` | Lightweight needs, preference utility and a daily clock starting at 08:00. Default two city minutes per simulation second, with selectable progression. |
| `simulation.js` | Authoritative functional agent registry and unchanged four-stage orchestrator. Stable agent IDs, roles, workplaces and appearance stay on the same objects throughout indoor visits. `workStatus` is separate from the visual `STATE`. |
| `citizens.js` | Separate decorative population, believable boundary entries/exits, camera-aware spawning, nighttime reduction and bounded offscreen updates. No NPC joins the functional registry or receives assignments. |
| `traffic.js` | Existing validated cardinal/curved lanes, pedestrian yield logic and sparse spawning. Weighted appearances: compact car 65%, delivery 26%, service 9%; at most four active vehicles. |
| `cafe-renderer.js`, `life-frames.js` | Existing café renderer extended with inspected reading/page-turn/look-around/wave sprite mappings and bounded dialogue. Existing walking and coffee atlases remain intact. |

The reusable lifecycle is SELECTED → RESERVED → NAVIGATING → PERFORMING → COMPLETED. Cancellation, removal, timeout, expired leases and reset share cleanup. Market visitors approach the reserved door, walk into the existing work alcove, then become hidden for 16–30 simulation seconds. The entrance lease is released once inside. They exit with a small pixel-art shopping bag while retaining their identity. Homes hide resting residents at an accessible entrance anchor, and stagger bed/wake times. Assignment reveals an indoor resident at its valid anchor and clears idle props, leases and shared encounters before the normal brief/work/handoff path begins.

Nearby available residents can greet each other in wide pedestrian clearings. A more distant friend approaches through A* and an exclusive temporary meeting anchor. Both participants must be free; neither can join another activity concurrently. Sessions avoid asphalt, occupied furniture and choke points, expire safely, and enforce pair cooldowns. Brief table chats are bilateral at cafés; park bench mates can exchange quiet remarks. Greeting and farewell gestures use actual sprite frames. Speech bubbles are capped at two.

Activity durations and admission limits remain in the definition data. Coffee admits at most three functional residents and one visitor; reading admits two residents and one visitor. Focused residents take shorter breaks. Activity-specific cooldowns avoid repetition, while the short general decision delay lets a resident choose a different destination. Nighttime increases home-rest utility and gently changes lamps/windows; there is no weather or real model dependency.

Use **P** to visit Circuit Park and the **coffee button** for Ember Café. Selecting a resident shows Role, Work status, Activity, Location, Workplace, Home, Energy, Social, Hunger and Personality. `Assigned` means City Hall currently owns an active assignment, including travel and handoff; daily activities keep work status `Idle`. Developer controls remain hidden initially and include road/lane/navigation/collision/rail overlays, live interaction occupancy, ambient population (0/3/6/8), NPC toggle and city clock rate. Spawns and exits defer until out of camera view, so density changes may take a short walk to become visible.

The current implementation remains browser-local, as before. It adds no external agent gateway, WebSocket transport, credentials, real LLM calls or additional persistence schema. Future registered workers can use the same visual activity controller; needs and idle routines remain separate from work status. Existing simulation identities and handoff behavior are preserved.

Artwork was generated with the built-in image-generation tool against `cafe-residents.png`, supplementing rather than replacing the existing character sprites. The selected transparent atlas is `dist/assets/life-residents.png`; its exact prompt/provenance is `references/living-city-2-art.json`, and inspected alpha rectangles are in `dist/js/life-frames.js`.

Validation: `npm run check` and **31 tests** pass, including the original 21 regressions and ten Living City checks. New coverage includes two complete daily cycles, every reading/shopping/rest interruption phase, bilateral encounters and temporary meeting-anchor cleanup, independent role/appearance, dynamic registration, needs/clock utility, entrance capacity, pause/reset/removal/expiry, NPC population limits/offscreen updates, and full handoffs alongside safe traffic. See `docs/living-city-2-plan.md` for the audit and implementation plan. Browser captures and state samples are saved under `references/living-city-2-*`.

Final browser verification retained 71 state samples through simulation day six, two complete four-stage missions, 107 activity completions, seven task interruptions and zero failed activity routes. Owner checks found no duplicate or orphaned reservations, and the application console was clear. A dynamically registered Researcher used Sociable preferences and a Violet appearance. Reading and indoor home rest were visibly interrupted by assignments; the same agents immediately resumed brief collection. Trains recorded twelve arrivals and departures, traffic recorded 34 exits, and water frames continued changing. The park-reading and overview captures show the preserved city and completed mission. Cloud browser frame callbacks are throttled: canvas draw cost was approximately 10–13 ms, but ordinary desktop frame rate remains unbenchmarked.

## Living City 2.1 — purposeful routines and coherent outdoor spaces

This revision supersedes the earlier café layout and automatic shopping-bag behavior described above. Ember Café now has **three tables and six chairs on the counter’s north-side frontage**. Its terrace, ordering queue, service window and seats share pedestrian paving; no coffee-service step crosses the boulevard. Existing café assets, landmarks, map dimensions, road graph and vehicle lanes are retained. The previous south terrace is a small canal garden with a bench. Five exposed office-computer renderings have been removed while their logical work cells and task workflow remain intact. Public vending machines, kiosks and billboards remain.

`activity-plans.js` defines nested steps consumed by the existing `ActivityController`, rather than a second behavior system. Chains carry destinations, interaction points, durations, visibility, props and completion events. Coffee visits reserve a queue position, acquire the single counter, order, wait for preparation, receive a cup, acquire a chair, drink/socialize and leave. The ambient barista stays behind the service ledge and animates preparation when a customer is actually ordering. Three queue anchors and one counter enforce capacity. The barista has a separate decorative identity and never joins the registry.

Market visits choose window browsing (optionally indoors, without purchases), food or household purchases. Food is carried to a reserved park bench, visibly eaten, then cleared. Household shopping bags travel directly to the resident’s assigned shared home and disappear when the delivery is put away. Cups appear only at receipt. Packages exist only between courier pickup and delivery. Books, food, preparation and broom poses use actual pixel-art frames. Completion, interruption, removal, reset and expiry clear transient props, visibility and leases; work always interrupts routines through the original controller. Temporarily occupied fixed exits wait and retry with a bounded timeout.

Pedestrian A* now uses marked road crossings. Vehicles and pedestrians share simple crossing right-of-way: people wait at the curb for approaching vehicles, and cars yield once pedestrians enter. This retains the independent lane system. A small existing Clinic planter and one bin were adjusted to reopen narrow pedestrian links. The existing station’s visible front platform is now also a walkable deck, with reserved waiting and boarding anchors below the rail line. Decorative passengers approach during train arrival, board only at a stop, and alight through the same station portal before walking away. Functional workers keep their identities and are never removed for train activity.

Couriers repeat a Market-to-R&D delivery route. Cleaners sweep three canal-promenade service positions. Occasional plaza holograms admit at most two available decorative watchers, then disperse them. Defaults are five ambient residents, a maximum of eight plus one fixed barista, sparse train arrivals and bounded offscreen updates; configurable density includes 0/3/5/6/8. A regression fixed floating-point remainder updates that could repeatedly reset courtesy timers during offscreen batching. Developer overlays remain hidden by default and now include service zones alongside paths, lanes, collision, interactions and live occupancy.

New supplementary art was generated with the built-in image-generation tool: `dist/assets/purpose-residents-v2.png`. Existing walking, coffee and reading sheets are preserved. The exact prompts and provenance are in `references/living-city-2-1-art.json`; inspected frame bounds and consistent scales are in `dist/js/purpose-frames.js`. Audit findings and spatial decisions are recorded in `docs/living-city-2-1-plan.md`.

Validation: syntax checks and **44 tests** pass. Coverage includes all coffee/service steps, both window-shopping variants, food consumption, household delivery, fifteen interruption phases, reservation expiry/removal/reset, actual sprite pose changes, service workers, gated passengers, bounded plaza events, traffic separation and a camera-focused multi-day soak that previously reproduced NPC stalls. Detailed browser observations and before/after captures are retained under `references/living-city-2-1-*`. The cloud browser throttles frame callbacks; ordinary desktop FPS remains unbenchmarked.

Final multi-cycle browser review completed two four-stage missions through day two, including nighttime assignments and six interrupted idle routines. It recorded eight served drinks, three completed food meals, one household delivery, seven courier deliveries, eighteen cleaning stops, two boarded passengers, three alighted passengers and a temporary plaza event with zero failed routes. A dynamically created Researcher retained independent Violet appearance and stable identity. No application console errors were observed (the browser extension produced unrelated metadata errors). A final whole-city camera check additionally exposed and corrected shared boundary-exit stacking; departures now hold separate endpoints until off-camera removal.

The final source then completed a third full browser mission, with zero failed routes, no duplicate or orphaned reservations, and no application console errors. Population reduction showed three distinct departure endpoints. Final-source screenshots include the completed mission and the corrected café; debug overlays were restored to disabled.

## Ice Blue visual theme

The city now uses **#E0F0FF** for focal neon and UI accents, **#A8D8F0** for soft illumination, **#65B8E8** for cyan effects, and dark slate/midnight surfaces (**#24384D / #101C2B**). `dist/js/theme.js` centralizes colors, UI tokens, visual role colors and the environmental sprite palette conversion. Original sprites are preserved; environmental atlases receive a one-time cached tonal conversion at loading, keeping their dimensions, alpha, frame crops, silhouettes and shading. Character atlases bypass it, retaining the original jackets, skin tones and walking/activity animations. Greens, pink foliage, magenta signs, dark asphalt and blue-gray pavement retain material separation.

Café/service lighting, building windows, streetlights, electronic display scans, canal reflections, train/station lights, vehicle headlights/service beacons, plaza display and handoff particles use the same palette. UI buttons, borders, selected-agent brackets, status highlights, browser metadata and favicon complement it. This adds no scene filter, snow, ice, weather or simulation dependencies. Palette conversion is cached before drawing, not repeated per frame.

The registry, orchestrator, navigation, needs, clock, furniture reservations, activity chains, map and collisions are unchanged. Train, traffic and ambient NPC edits are confined to drawing colors. See `docs/ice-blue-theme.md` for the audit and implementation notes. Syntax checks and **47 tests** pass, including the existing 44 simulation regressions and focused shading/transparency/contrast checks.

Final browser review reached simulation day three and completed the four-stage mission. It recorded 87 activity completions, 20 served drinks, 10 food consumptions, train boarding/alighting and continued vehicle exits, with zero failed activity routes, road/lane errors or application console errors. Water frames and train/character poses changed across samples. Before/after, café, park, agent-selection and nighttime overview screenshots are retained under `references/ice-blue-*`. Cloud frame callbacks are throttled; ordinary desktop FPS remains unbenchmarked.

## Icy White visual theme — initial conversion

This refinement replaces the Ice Blue lighting with white-dominant **#F2F9FF**
and **#FFFFFF** cores, soft **#DCEEFF** illumination and restrained **#B8DDF5**
undertones. Dark slate architecture, graphite roads and blue-gray water keep
their material separation. `theme.js` extends the existing configuration with
semantic lighting, window, reflection, selection and UI roles. Environmental
atlas conversion now also neutralizes saturated cyan lighting. Terrain foliage
has a separate muted-green ramp so trees do not look frosted. Characters, source
PNG assets, map geometry and simulation behavior are preserved; there is no snow,
ice or weather. Success/error indicators retain distinct semantic colors.

Syntax checks and **48 tests** pass. Browser verification reached day two,
completed the full mission, observed existing activities and changing water,
train and traffic frames, and inspected multiple zoom levels and nighttime
lighting. Activity routes, roads, lanes and application console reported no
errors. See `docs/icy-white-theme.md` and `references/icy-white-*` for audit notes,
before/after screenshots and six state samples. Desktop FPS remains unbenchmarked.

## Living color restoration — current

**#F2F9FF remains the signature architectural and UI lighting color.** Local
materials and lights now retain their own roles: cyan technology, lavender R&D
and display panels, pink Market/arcade signage, amber café and residential
interiors, wooden terrace furniture, natural green foliage and varied vehicle
paint. Dark slate buildings, graphite roads and stone pedestrian paving remain
distinct. Canal reflections combine white with restrained local light colors.

`dist/js/theme.js` centralizes brand lighting, decorative accents, material
colors, building lighting profiles and sprite-region material roles. Environmental
atlases are recolored once at load using their existing inspected frames. The
same source color can represent white neon, brown furniture or warm interiors
without a cached replacement leaking between materials. Native cyan, pink,
neutral surfaces and all character atlases keep their original colors. Source
PNG files, city geometry, animation timing and all simulation systems are unchanged.

Icy White dominance is the palette priority: shared neon, civic lighting and
UI accents default to white or subtle icy blue. Saturated colors are assigned
only to local signage, interiors, materials and identity details. Canal reflection
strips are mostly white, with occasional contextual color. Four of the six
landmark lighting profiles use white main signs; the Market and R&D retain local
accent signs. Colors are not distributed equally across buildings.

Syntax checks and **51 tests** pass, including the complete simulation suite and
regressions for local accent retention, material separation, source transparency,
character preservation, white shared lighting and UI contrast. See `docs/living-color-restoration.md`
and `references/living-color-*` for the audit and browser comparison evidence.

## T02 backend foundation

The city remains a buildless static Canvas application under `dist/`. A separate
NestJS/TypeScript HTTP foundation now lives in `apps/api`; it provides only public
`GET /health`, with no agents, database, LLMs or realtime execution.

Use Node 24.x/npm 11 and `npm ci` from this root. Run `npm run dev:web` and
`npm run dev:api` independently. `npm run build` compiles only the API;
`npm run start:api` runs it. Existing `npm run check` and `npm test` still check
the city; `npm run test:api` checks the backend and `npm run test:all` runs both.

See [backend setup and security assumptions](../../../docs/ai-agent-platform/backend-foundation.md)
and the [AI platform documentation index](../../../docs/ai-agent-platform/README.md).
Earlier sections describe historical city releases; the backend record above
supersedes statements that the entire repository has no backend. The city itself
still requires no backend or credentials.

## T03 PostgreSQL persistence foundation

The API now has a Drizzle/PostgreSQL schema and explicit migrations. No agent or
task CRUD, execution, event publishing or NPC synchronization has been added.
The existing city still needs no backend/database. Use `npm run db:generate`,
`npm run db:check`, `npm run db:migrate` and `npm run test:db` as documented in
[database setup, security and verification](../../../docs/ai-agent-platform/database-foundation.md).
The PostgreSQL-only Compose service uses an ignored root .env, a persistent named
volume and loopback port; API configuration remains in apps/api/.env or process
environment. Migrations are explicit and never run during API startup.

## Current workspace

The complete project now lives at `C:\Users\user\Desktop\Project\Elyqreth`.
Use this folder for future development. See [workspace location and commands](../../../WORKSPACE.md).
Paths in the historical T01–T03 audit records describe their original inspection
location; the former source copy has been removed after verified consolidation.

## T04 implemented checkpoint

The [Agent Registry API](../../../docs/ai-agent-platform/agent-registry.md) now supports logical registration, detail/list, metadata updates and activate/disable/archive via the existing NestJS/Drizzle backend. Access is disabled by default and restricted to explicitly configured loopback development with a bearer credential and existing owner; production access fails closed. The city remains independent. See the guide for provisioning, request examples, validation, tests and limitations. Next implementation task: **Phase 1 T05 — Task & Execution Persistence**.

## T05 implemented checkpoint

[Task & Execution Persistence](../../../docs/ai-agent-platform/task-execution-persistence.md) adds CREATED task registration, owner-scoped idempotency and bounded reads, plus read-only execution history and an internal-only attempt allocation primitive. No work runs automatically. All protected APIs share the existing opt-in loopback development credential boundary and remain closed in production. Apply `npm run db:migrate` explicitly for the new task-list index. Next implementation task: **T06 — Task Lifecycle Service**.

## T06 implemented checkpoint

[Task Lifecycle Service](../../../docs/ai-agent-platform/lifecycle-service.md) adds internal, version-checked PostgreSQL state transitions with atomic Task/Execution/history updates. Cancellation and timeout persist lifecycle decisions without terminating processes. No public mutation endpoints, background workers or AI execution were added. The city remains unchanged. Next implementation task: **T07 — Event Contracts & Audit History**.

## T07 implemented checkpoint

[Event Contracts & Audit History](../../../docs/ai-agent-platform/event-audit-foundation.md) centralizes versioned lifecycle events inside existing transactions and adds protected read-only agent/task/execution history APIs. Existing names/history are preserved; unsafe or unsupported legacy payloads are redacted on reads. Apply `npm run db:migrate` explicitly for the additive history indexes. There is no WebSocket, broker, worker, AI execution or city integration. Next task: **T08 — Integration Tests & Final Acceptance Review**.


