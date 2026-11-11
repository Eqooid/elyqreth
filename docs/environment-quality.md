# City environment quality verification

## Scope and audit

Starting revision: `aa8751d`; the working tree was clean. No applicable `AGENTS.md` files were found. `dist/` is the maintained frontend source, not disposable build output.

The city remains 116 × 64 cells at 16 world pixels per tile (1856 × 1024). `TileMap` owns terrain IDs and a separate collision/walkability array. `RoadNetwork` rasterizes the five existing cardinal street segments and owns crossing and road-adjacency data. Production pedestrian navigation uses `TileMap.neighbors`, named crossings, reservation views and `findPath`; none of those rules changed.

The previous polish already supplied reflected, cached terrain swatches, one-to-one integer sampling, paving-side grass/water borders, continuous terrace paths, contained building artwork, furniture that preserves its underlying material, full collision footprints, seven sparse infill objects and station-vent ordering. Those fixes were retained. There is no separate soil category or bank-tile atlas to autotile. Existing paving/plaza/floor transitions, bridge openings and water masks remain appropriate; no new terrain or floor transition system was needed.

`TownRenderer` builds a ground canvas once, then draws water/tracks, Y-sorted static objects, characters, furniture, vehicles and train, followed by effects and labels. Building depth anchors intentionally differ from artwork bottoms to expose entrance alcoves. Camera transforms include DPR rounding and disable image smoothing. Static terrain work is outside the frame loop. Existing dynamic sorting, citizen offscreen updates and status-marker culling remain unchanged; there is no general static-object viewport-culling system to replace.

The implementation plan was to correct concave road joins, bind rooftop props to existing host anchors, make infill context rules explicit, improve the existing deterministic road grain, add offline validation and extend the existing Chromium/CDP verification. No backend, simulation, asset, layout, navigation or dependency changes were required.

## Changes

- **Connectivity:** descriptors now include diagonal concave-corner joins in addition to the existing N/E/S/W mask. A missing diagonal road with both cardinal neighbors present gets a one-pixel curb join. Connected edges remain open, including asphalt/alley connections. Straight, corner, T and four-way geometry still derives from the logical network. Invalid fractional road queries return the same empty-surface sentinel as other invalid coordinates.
- **Depth:** station vent and apartment tank identify their host building. Scene initialization resolves each attachment to host depth + 1 instead of maintaining independent numeric anchors. The tank previously tied its host at 1024. Ordinary Y sorting, entrance anchors, benches, chairs, bridges, train, NPCs and effects retain their existing conventions. No broader NPC/rooftop defect was confirmed.
- **Decoration:** the existing seven infill placements now declare commercial, residential, park or promenade context. The validator enforces suitable types, at most eight infill objects (the established Balanced budget), no shared solid footprints, no road occupation, destination clearance and spacing between matching ornaments. Existing café tables, seats, reservations and all decoration positions remain unchanged. This is validation of authored placement, not a new generator.
- **Variation:** road-grain offsets use an unsigned coordinate/surface hash. The same ten one-pixel flecks, colors, markings and curbs remain; the previous short repeating coordinate pattern is reduced. No render-time randomness is used. Other seamless surfaces and rooftops retain existing art to avoid breaking edge continuity or palette consistency.
- **Performance:** corner descriptors and grain are evaluated only while the terrain cache is built. Roof depths resolve once per scene. Full validation is opt-in through tests/CLI, with no gameplay logging or frame-loop validation. No new per-frame work, sorting or decoration generation was added. No comparable FPS benchmark or long-duration performance guarantee is claimed.

## Validation rules and tests

Run `npm.cmd run check:city` on Windows (`npm run check:city` elsewhere). It prints a structured report and exits nonzero for failures. Current result: **96 objects, 81 destinations, zero errors**.

`validateCity` reads the authoritative map and authored object lists, returning category, ID, cell coordinates, expected condition and actual data. It checks:

1. Unique object IDs, finite artwork bounds and positive integral in-map collision footprints.
2. Solid footprint coverage in existing walkability data; workplace alcoves retain their intentional exception.
3. Separate building footprints, including decorative buildings. Sprite/roof silhouette overlaps are not treated as collision overlaps.
4. Known terrain IDs, road paint backed by logical roads, matching visual surface/cardinal masks and all diagonal corner joins. Existing graph connectivity and blocked-asphalt checks continue in `RoadNetwork.validate`.
5. Walkable and reachable workplace doors/work cells, location entry/exit cells, points of interest and activity anchors, using the production A* implementation.
6. Existing rooftop hosts, contained nonblocking roof props and consistency of any explicitly authored depth override.
7. Infill context/type compatibility, Balanced count, full-footprint exclusion from roads, existing solids and required destinations, two-cell Manhattan clearance from destination cells and three-tile separation for matching infill types.

`tests/environment-quality.test.js` adds six regression tests: immutable successful validation, all 16 cardinal masks/four concave orientations, stable road rendering without randomness, host-relative depths, malformed geometry/roads/blocked or isolated destinations, and overlap/context/clearance failures. Existing geometry, rendering, simulation, identity, activity, collision and integration tests remain enabled.

Validation is for the authored static city, not live reservation occupancy. Existing historical scenery can intentionally share collision parts (for example basin walls and bridge piers); arbitrary prop-to-prop overlap is therefore checked for new infill, while building-to-building geometry is checked citywide. Artwork silhouette overlap and every possible pedestrian corridor are not inferred from sprite pixels. Required destination reachability provides the reliable navigation guard without creating another navigation implementation.

## Repeatable visual evidence

The existing Chromium smoke harness invokes `scripts/environment-browser.mjs`. It constructs an isolated real `TownRenderer` and simulation, uses seed 141, time 0, a 960 × 640 canvas at DPR 1, and performs no simulation updates. Two warm-up draws precede exact consecutive-frame comparison to avoid first-use browser sprite-raster cache differences. No screenshot library or production debugging hook was added.

Capture another set with PowerShell:

```powershell
$env:ENVIRONMENT_SCREENSHOTS='references/environment-quality/review'
npm.cmd run test:browser
```

The PNGs and `scenarios.json` record fixed camera positions and zooms. The checked-in `before` set uses the starting environment source at `aa8751d`; the `after` set uses this implementation. All eight after images were visually inspected. A separate fresh Chromium run produced identical SHA-256 hashes for every after PNG. Browser: Chrome 157.0.8103.39. Exact PNG equivalence across other browser versions, machines or GPU backends is not promised.

| Scenario | Camera x, y; zoom | Before | After | Inspect |
| --- | --- | --- | --- | --- |
| Main intersection | 768, 384; 2 | [PNG](../references/environment-quality/before/intersection.png) | [PNG](../references/environment-quality/after/intersection.png) | Curbs join without crossing connected streets; crossings remain clear. |
| Dense building block | 400, 210; 1.2 | [PNG](../references/environment-quality/before/building-block.png) | [PNG](../references/environment-quality/after/building-block.png) | Complete roofs, facade order and entrance paving. |
| Café/commercial | 1696, 280; 1.5 | [PNG](../references/environment-quality/before/cafe.png) | [PNG](../references/environment-quality/after/cafe.png) | Chair/table order, counter, planters and unobstructed activity cells. |
| Park | 480, 670; 1.5 | [PNG](../references/environment-quality/before/park.png) | [PNG](../references/environment-quality/after/park.png) | Benches, tree depth and grass/plaza borders. |
| Terrain transitions | 928, 460; 1.5 | [PNG](../references/environment-quality/before/transitions.png) | [PNG](../references/environment-quality/after/transitions.png) | Asphalt/paving, bridge and water boundaries. |
| City boundary | 1760, 900; 1.2 | [PNG](../references/environment-quality/before/boundary.png) | [PNG](../references/environment-quality/after/boundary.png) | Artwork remains inside the map; outside-map background is intentional. |
| NPC at clinic entrance | 440, 568; 2 | [PNG](../references/environment-quality/before/npc-entrance.png) | [PNG](../references/environment-quality/after/npc-entrance.png) | Fixture places an NPC at a valid entrance; feet and facade depth agree. |
| Decorated sidewalk | 1664, 568; 2 | [PNG](../references/environment-quality/before/sidewalk.png) | [PNG](../references/environment-quality/after/sidewalk.png) | Sparse infill, garden edges and clear paving. |

For motion review, run the city, start the existing local demo task, and follow a resident through a workplace entrance; check the body remains in front of the entrance alcove and behind foreground furniture where appropriate. Use café/park focus controls to review seating and walking, then pan and zoom across bridge approaches and the four map edges. Pause for seam inspection; repeat at 0.5, 1, 1.5 and 2 zoom. Existing automated Canvas terrain tests additionally verify repeat seams, opacity and six zoom levels. Static captures are not a full movement/occlusion visual oracle or an automated approved-baseline pixel-diff gate.

## Implementation verification (before acceptance closure)

- `npm.cmd run check:city`: passed, 96 objects / 81 destinations.
- Focused geometry/rendering/quality suites: 18/18 passed.
- `npm.cmd run lint`: passed syntax checks and both TypeScript checks.
- `npm.cmd run build`: passed backend build.
- `npm.cmd run build:web`: passed disposable frontend production build.
- `npm.cmd run test:browser`: passed baseline, updated and independent repeat captures; zero browser exceptions. Existing camera, task, collaboration, NPC/runtime, pause/resume/reset and mobile checks passed.
- `npm.cmd test`: 263/264 passed. The only failure is the unchanged runtime guard: installed Node 24.9.0 is older than required Node 24.22.2. Before implementation the same guard failed, with 257/258 passing. No test was disabled.
- `npm.cmd run test:api`: 415/415 passed, including registry, task/execution, runtime, collaboration and external adapter regression coverage.
- `git diff --check`: passed. Final status contains only the environment implementation, tests, documentation and captured evidence; no starting user changes existed to disturb.

PowerShell blocks the unsigned `npm.ps1`, so verification used `npm.cmd`. Vite/esbuild could not read ancestor directories within the sandbox; browser and disposable web-build checks passed with approved execution outside that sandbox. No deployment was performed.

## Acceptance closure — 2026-11-11

Final status: **COMPLETE — VERIFIED** for the environment acceptance gate below. The earlier Node-version failure and pending movement review are closed. The historical implementation results above are retained; the following results supersede their pending items.

### Runtime and frontend checks

The default host remains Node 24.9.0 / npm 11.6.2. A compatible existing portable runtime was found at `%TEMP%\elyqreth-audit-node-24.22.2\node.exe`; its OpenJS Foundation Authenticode signature is valid. No runtime, dependencies or version manager needed installation. Only the verification processes' `PATH` was changed, with no system-wide configuration change.

- Selected Node: **v24.22.2**, within the required `>=24.22.2 <25` range.
- Selected npm: **11.19.1**, using the existing portable `npm.cmd` wrapper and npm CLI cache.
- `node -p "process.execPath"`: `C:\Users\user\AppData\Local\Temp\elyqreth-audit-node-24.22.2\node.exe`.
- `npm.cmd test` (complete root frontend suite, `node --test tests/*.test.js`): **264 passed, 0 failed, 0 skipped**, including the unchanged runtime requirement test. Passed on both the initial supported-runtime run and final rerun.
- `npm.cmd run lint`: **PASS**, covering game-module syntax, runtime-web TypeScript and API TypeScript checks.
- `npm.cmd run build:web`: **PASS**, with the existing disposable production-bundle output workflow. Vite's ancestor-directory sandbox restriction required approved execution outside the sandbox, as in the implementation verification.
- `npm.cmd run test:browser` with `ENVIRONMENT_DYNAMIC_DIR` set: **PASS**, Chrome 157.0.8103.39, zero browser exceptions. The existing static terrain, camera/zoom/focus, runtime visualization, task, collaboration, pause/resume/reset, access-session and mobile checks passed alongside the new optional movement capture.

No test was disabled or weakened, and no application defect fix was necessary. The prior backend result remains 415/415; this closure did not rerun live database/provider/orchestrator end-to-end checks or claim those integrations were newly exercised.

### Dynamic NPC evidence and review

Evidence directory: [`references/environment-quality/dynamic-acceptance-2026-11-11-verified`](../references/environment-quality/dynamic-acceptance-2026-11-11-verified/summary.json). It contains four WebM recordings, ten chronological contact sheets, per-scenario movement traces and the review summary. All ten sheets were inspected as movement sequences, not as isolated static screenshots. Their hashes also match the independently captured first-run sequences.

The optional fixture uses an isolated real simulation and renderer served by the existing local Vite/Chromium harness. It uses seed 29 and a fixed 640 × 480 canvas at DPR 1. Simulation advances in production 1/30-second updates; videos are accelerated and burn the simulation timestamp into each frame. Offscreen travel is advanced without recording redundant empty footage. `videoFrames` in the JSON counts sampled simulation groups, including offscreen groups; it is not an encoded-video frame count. Contact-sheet panels are scaled to 320 × 240 and read left-to-right, top-to-bottom.

Unrelated ambient visitors are removed only from each test fixture, incidental routines are suppressed, and the barista service animation remains active. These are controlled verification fixtures, not changes to the running application's behavior. No map cells, collisions, sprite depths, speed rules or pathfinder are replaced. Every production movement tick checks feet against the real walkability map and displacement against the NPC's speed. Sampled frames compare the NPC sprite, shadow and immediate occlusion boundary exactly across unchanged draws.

| Scenario | Result | Actual sequence and observations | Evidence | Camera x, y; zoom |
| --- | --- | --- | --- | --- |
| Workplace entrances | **PASS** | 54 simulation seconds, 1620 ticks, 18 reviewed frames. Ada leaves the R&D frontage to collect the local demo brief, approaches the workplace again, moves into its existing work alcove, works and leaves to deliver the handoff. The work alcove is intentionally visible; this workplace does not simulate hidden indoor entry. Feet remain accessible, with no wall crossing, disappearing sprite, clipping or layering flicker observed. | [Video](../references/environment-quality/dynamic-acceptance-2026-11-11-verified/workplace.webm), [frames 1](../references/environment-quality/dynamic-acceptance-2026-11-11-verified/workplace-01.png), [frames 2](../references/environment-quality/dynamic-acceptance-2026-11-11-verified/workplace-02.png), [trace](../references/environment-quality/dynamic-acceptance-2026-11-11-verified/workplace.json) | 1128, 632; 2 |
| Café seating | **PASS** | 71.467 simulation seconds, 2144 ticks, 27 reviewed frames. Production coffee activity completes queue, order, preparation, receipt, seat approach, drinking and departure. Furniture depth remains coherent, the NPC reappears from intended furniture overlap, and its reservation is released. No solid-table crossing or permanent concealment observed. | [Video](../references/environment-quality/dynamic-acceptance-2026-11-11-verified/cafe.webm), [frames 1](../references/environment-quality/dynamic-acceptance-2026-11-11-verified/cafe-01.png), [frames 2](../references/environment-quality/dynamic-acceptance-2026-11-11-verified/cafe-02.png), [frames 3](../references/environment-quality/dynamic-acceptance-2026-11-11-verified/cafe-03.png), [trace](../references/environment-quality/dynamic-acceptance-2026-11-11-verified/cafe.json) | 1688, 288; 1.7 |
| Trees and greenery | **PASS** | 3.733 simulation seconds, 112 ticks, 10 reviewed frames. A four-leg production-navigation route passes behind the existing terrace-square tree canopy, around its solid trunk cell and across the foreground. Partial canopy concealment is intentional; emergence in front is continuous. No floating sprite or layer flicker observed. | [Video](../references/environment-quality/dynamic-acceptance-2026-11-11-verified/trees.webm), [frames](../references/environment-quality/dynamic-acceptance-2026-11-11-verified/trees-01.png), [trace](../references/environment-quality/dynamic-acceptance-2026-11-11-verified/trees.json) | 1624, 600; 2.5 |
| Bridges | **PASS** | 19.2 simulation seconds, 576 ticks, 44 reviewed frames. Five existing-navigation legs cross the lower bridge in both directions, follow the west bank, and cross the upper deck out and back. Surface alignment and depth remain continuous at deck/bank boundaries; no NPC clipping, incorrect concealment or movement discontinuity observed. | [Video](../references/environment-quality/dynamic-acceptance-2026-11-11-verified/bridges.webm), [frames 1](../references/environment-quality/dynamic-acceptance-2026-11-11-verified/bridges-01.png), [frames 2](../references/environment-quality/dynamic-acceptance-2026-11-11-verified/bridges-02.png), [frames 3](../references/environment-quality/dynamic-acceptance-2026-11-11-verified/bridges-03.png), [frames 4](../references/environment-quality/dynamic-acceptance-2026-11-11-verified/bridges-04.png), [trace](../references/environment-quality/dynamic-acceptance-2026-11-11-verified/bridges.json) | 928, 580; 1.35 |

The tree and bridge routes call the existing `navigate` API on valid authored surfaces. They do not depend on waiting for the autonomous routine selector to randomly choose a particular path. The café fixture starts on a valid frontage cell and invokes the existing activity controller. No positions are reassigned during a recorded route.

### Diagnostic finding and limits

An initial broad identical-full-frame probe flagged bridge captures. Inspection of the first differing PNG pair found **16 water pixels**, at screen bounds `(352,256)`–`(367,256)`, away from the NPC, including alpha differences. The final capture reports 28 full-frame readback differences in the bridge sequence and **zero differences in the NPC region**; all other scenarios report zero full-frame differences. Details remain in `bridges.json` under `readbackDifferences`. A trial using the browser's frequent-read canvas hint did not remove this behavior, so it is not attributed conclusively to a GPU or driver defect.

The new fixture therefore distinguishes exact moving-NPC-region checks from full-frame water readback diagnostics. No pre-existing test was changed, no pixel tolerance was introduced into the NPC comparison, and no application change was made to mask the water observation. It is a nonblocking full-canvas capture limitation/follow-up, not a confirmed NPC occlusion failure. The original [first](../references/environment-quality/dynamic-acceptance-2026-11-11-verified/diagnostics/bridges-full-frame-first.png) and [second](../references/environment-quality/dynamic-acceptance-2026-11-11-verified/diagnostics/bridges-full-frame-second.png) diagnostic images are preserved. The review does not claim exact animated-water PNG determinism, exhaustive movement coverage, a long soak or a quantitative FPS guarantee.

### Baseline preservation and reproduction

All **18 pre-existing baseline files** under `before/` and `after/` retain their starting SHA-256 hashes. No accepted PNG or camera manifest was overwritten or regenerated on disk. The unchanged environment implementation plus the passing existing static-rendering checks support their continued validity. [`baseline-manifest.json`](../references/environment-quality/dynamic-acceptance-2026-11-11-verified/baseline-manifest.json) records the preserved hashes. `after/` remains the accepted static environment baseline; `before/` is historical comparison evidence. The closure also preserves [machine-readable results](../references/environment-quality/dynamic-acceptance-2026-11-11-verified/verification.json), the [full frontend test log](../references/environment-quality/dynamic-acceptance-2026-11-11-verified/frontend-tests.txt) and the [browser smoke report](../references/environment-quality/dynamic-acceptance-2026-11-11-verified/browser-smoke.json).

For another run, select a compatible Node 24.x runtime and verify its executable and npm version first. With the existing portable runtime available, the process-local selection is:

```powershell
$runtime=Join-Path $env:TEMP 'elyqreth-audit-node-24.22.2'
$env:PATH="$runtime;$env:PATH"
node --version
node -p "process.execPath"
npm.cmd --version
npm.cmd test
npm.cmd run lint
npm.cmd run build:web
$env:ENVIRONMENT_DYNAMIC_DIR='references/environment-quality/dynamic-review-new-run'
npm.cmd run test:browser
```

Use a new directory: the dynamic capture refuses to overwrite existing evidence. Leave `ENVIRONMENT_SCREENSHOTS` unset to preserve accepted static captures. The harness serves the documented Vite configuration locally, starts headless Chromium and cleans up the browser/server afterwards. A portable runtime cache is machine-local; if absent, select or install a supported Node 24.x runtime through the developer's normal method before running these commands.

### Acceptance gate and repository review

All eight required gates pass: supported Node 24.x, the full frontend suite, workplace movement, café seating movement, tree occlusion, bridge movement, preserved valid static baselines, and no unresolved critical environment regression. NPC movement, collision, pathfinding and rendering are supported by the per-tick fixture checks, sequence review and full frontend suite. Camera/zoom and agent-to-NPC visualization are additionally covered by the completed browser smoke checks. Existing frontend AI-integration and mocked transport regressions passed; live external providers and backend persistence were not re-exercised in this closure.

Closure changes are limited to this existing report, the optional browser verification helper/harness wiring and new dynamic evidence. All earlier implementation changes remain intact. No application code, dependencies, lockfile, tests, gameplay rules, APIs, schemas, map data or assets were modified during closure. No tests were disabled or weakened. Nothing was committed, pushed, tagged, released or deployed.
