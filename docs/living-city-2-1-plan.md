# Living City 2.1 — audited incremental plan

## Findings before scene changes

Inspected world.js, scenery.js, scene.js, tile-map.js, renderer.js, locations.js,
activities.js, movement.js, citizens.js, traffic.js, train.js and the real browser
preview. `references/living-city-2-1-before.jpg` records the original terrace.

1. Renderer draws terrain sprite 13 (computer/desks) at five workplace alcoves.
   These are exposed on the frontage. Remove that render-only loop; keep all
   building IDs, entrances, work cells and mission logic as abstract indoor work.
2. Ember Café counter is at (1696,248), north of boulevard rows 22–25; four
   tables and sixteen seats are at y=440–696 on the south side. Coffee admission
   goes straight to a chair, bypassing counter service. There is no order queue.
3. Every shopping completion adds a forty-second bag, then resumes wandering.
   There is no purchase outcome, eating destination or delivery lifecycle.
4. Street cleaner/courier/passenger role strings only bias random wandering.
   Train arrivals do not notify passengers. No barista exists.
5. Pedestrian A* penalizes unmarked asphalt but permits it, and road waiting
   reacts to immediate car proximity rather than selecting safe crossings.
6. Existing bilateral social sessions, park benches, leases, needs/utility,
   home rest, dynamic registry and task cancellation are reusable. Their
   identity, working status and mission boundaries must remain authoritative.
7. Counter artwork includes a legitimate till; vending machines, station
   wayfinding, neon signs, public kiosks and billboards belong outdoors and stay.
   Main road graph/lanes/canals/bridges/rail and landmark geometry remain intact.

## Implementation sequence

- Keep the café building north of the road. Reuse three existing tables with
  two chairs each in its immediate paved frontage; update all colliders, points,
  queue and terrace bounds. Retire the other table/chairs and old seat coordinates.
- Extend ActivityController with data-defined chained steps, owner-checked queue
  transfers, order/prepare/receive then seat, three Market outcomes, home delivery,
  eating and common cancellation/prop cleanup. Keep existing reading/social/rest.
- Add a separate decorative café service resident and bounded service response.
- Restrict pedestrian routes to marked main-road crossings, coordinate sidewalk
  waiting with vehicles, preserve lane geometry and avoid mutual yielding stalls.
- Add lightweight NPC job definitions through the same controller: courier
  pickup/delivery, local sidewalk cleaning, train-event passenger gates and sparse
  central-plaza hologram attendance. Never add NPCs to the functional registry.
- Reuse existing sprites wherever sufficient; add consistent activity frames only
  where existing art cannot visibly convey eating/cleaning/preparing coffee.
- Verify reachability, step/prop/lease cleanup, interruption, train gates and NPC
  limits through regression tests and multiple real-browser animation cycles.
  Keep developer overlays hidden by default and publish the existing private app.

Additional navigation audit: strict crossing routes revealed that the west Clinic
garden was boxed in by a full-width planter. Its decorative planter is reduced
from five to three cells, retaining the same asset and district while opening a
two-cell paved path. The existing Station front-platform deck is made walkable
over its actual depicted canal surface; no rail cells or train route are moved.
The former south-road café seating square becomes a small canal-side green with
its existing promenade and a reused bench/planter, rather than an empty asphalt
or furniture field.

Crossing stress tests also found a bin at Café Studio (75,21) blocking the only
one-cell north frontage. It is moved to the café's east service side (77,16).
Pedestrians now wait at the sidewalk anchor before starting a crossing, rather
than creeping into a car's stop buffer. Recovery route searches are bounded to
one per 0.75 seconds instead of repeated every frame during a blocked encounter.

Longer camera-focused verification revealed zero-distance floating-point remainder
updates resetting courtesy timers in offscreen NPC batches. Batches now ignore
those remainders; the camera-focused multi-day regression covers the former
station/Market stalls. Fixed destinations blocked by an occupied interaction
point wait and retry with a bounded budget. Whole-city departure endpoints are
held exclusively so camera-deferred removal cannot stack NPCs at one exit.
