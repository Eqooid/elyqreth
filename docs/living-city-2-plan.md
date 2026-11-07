# Living City 2.0 — audit and implementation plan

## Existing implementation

Buildless ES modules in `dist/js`, canvas scene graph, cached terrain and glows. `Simulation` owns the dynamic agent list, stable IDs, task stages and handoffs. `ActivityController` already owns coffee phases and exclusive leased `ReservationManager` seats. `TileMap.navigationView` excludes occupied chairs; shared cardinal A* and `movement.js` handle all walking. Three NPCs use that same navigation without joining the agent list. Road connectivity is deterministic and validated, with three sampled lane routes. Water and the station train have independent animated clocks. The visible clock currently reports elapsed minutes rather than a daily time.

## Preserve and extend

1. Keep the 1856 × 1024 world and all landmark bounds. Activate the two existing plaza/garden benches and add one small bench in a clear globe-plaza area, with independent seats. Reuse existing tree, planter and lamp sprites. Validate every approach and collider.
2. Extend the existing controller with activity definitions for park reading, Market shopping and shared residential rest. Keep the current coffee API and reservation leases. Lifecycle and cancellation are shared, not separate per-character state machines.
3. Add lightweight needs and trait preferences, distance/occupancy/cooldown scoring and a daily clock. Homes reference the two existing foreground residential blocks. Indoor actors retain their identity and a valid entrance anchor. Task cancellation reveals them immediately at that anchor and releases every lease/session/prop.
4. Coordinate bilateral encounters in wide pedestrian clearings, with pair cooldowns and short greeting/conversation/wave phases. Existing café table chats remain and become bilateral. No conversation on asphalt, bridge choke points or narrow entrances.
5. Make decorative population configurable, with valid boundary entries/exits, camera-aware spawning and bounded offscreen updates. NPC identities remain outside the functional registry.
6. Keep the validated road surface and lane routes; add weighted car/delivery/service appearances, night lights, explicit density controls and crossing regression checks. No new asphalt, railway route changes or weather.
7. Inspect work status separately from visual activity; show needs, personality, logical home and location. Keep developer controls hidden initially.
8. Test multiple daily cycles, all interruption phases, dynamic residents, leases, hidden actors, social agreement, NPC limits, road/rail/water and the existing four-stage workflow. Capture available browser evidence; preserve audience when publishing.
