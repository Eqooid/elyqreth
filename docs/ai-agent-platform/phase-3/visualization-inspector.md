# NPC visualization and inspector — planned

**Phase 3 T07 COMPLETE within city-read contracts (2026-10-25):** [Agent inspection implementation](agent-inspection.md) extends the existing inspector using authorized city projection references and its latest recorded outcome. Full operator history/results/audit access is not broadened. T08–T10 remain planned.

## Categories and simulation preservation

Use presentation sidecar categories `SIMULATED_RESIDENT`, `DECORATIVE`, `AGENT_LINKED`. These are not new database enums or replacements for existing entity classes. Existing decorative flag/population lifecycle is unchanged. An original resident can have an Agent association while still participating in ambient needs/activities and explicitly simulated missions. Display “Simulation activity” and “Backend runtime” separately; do not combine their progress/status labels.

Never call setState/navigate/teleport because a Task starts, succeeds or fails. Keep existing sprite atlases, activity reservations, collision avoidance, buildings, roads/bridges, animated water/railway, camera and Icy White palette. Existing local “Start task”, remove and simulate-error controls remain simulation-only, visibly labelled as such when runtime is connected; they must never execute/cancel/archive a backend object. Removing a linked original resident hides its local association for this session; binding persists until trusted operator changes it. Reset does not erase a backend mapping or restart execution.

## Indicators

| Fact | Minimal rendering and accessible text |
| --- | --- |
| Linked | Small white link/diamond marker, “Linked Agent” text in resident list/inspector |
| IDLE | Static hollow dot / Idle |
| QUEUED | Small outlined clock / Queued |
| RUNNING fresh | Small white segmented mark with optional slow pulse / Running |
| COMPLETED newly observed | Check mark for 5 seconds / Completed; then baseline indicator |
| FAILED newly observed | Exclamation mark for 10 seconds / Failed; persistent inspector summary |
| CANCELLED newly observed | Short dash for 5 seconds / Cancelled; no red alarm |
| DISABLED/ARCHIVED | Availability slash/text separately from any recorded active work |
| Stale/UNKNOWN | Static question/dotted outline, “Last known …” and age; no working pulse |

Use existing theme tokens, white dominance and restrained existing accent colors only. Shape/text distinguish states without color. At most one compact 6–8 world-pixel marker per linked NPC, using existing scaling/culling; labels primarily on selection/list, not floating status paragraphs over every citizen. Do not recolor entire sprites/buildings or change lighting. Reduced-motion disables new pulses; no status flashing or new particles. Accessible DOM list mirrors Canvas status and keyboard selection; polite live announcements only for selected Agent meaningful changes, not every poll. UI text should state “Sampled runtime status”, not streaming/progress.

Pure overlay helpers consume cached view models from `npc-binding.js`. Existing renderer retains depth/hit-testing and movement. Hidden/offscreen NPCs need no overlay drawing. Update DOM runtime sections on projection revision or selected detail change; existing approximate 200 ms UI loop must not refetch or rebuild unchanging runtime HTML repeatedly.

## One inspector, two kinds of information

Extend the existing `app.js` renderInspector and `#inspect-content` with a clearly labelled runtime section. Keep existing local name/role/location/needs/personality information. Compact runtime fields: backend Agent display name + UUID (copyable plain text), type, optional strategy identifier, availability, sampled activity, current Task/Execution IDs/status, queue/running counts, source updatedAt and freshness. Absence is “Not linked” or “No current task”, never a fabricated success/error. Names are not identifiers and may differ from local resident names.

Expandable content within the same inspector (or its existing panel area): bounded Task/attempt history, started/finished/duration, sanitized fixed failure summary, result availability with explicit reveal action, and bounded safe audit history. Result output is escaped plain text; LLM text is disabled unless the trusted disclosure policy enables it. No automatic prompt/config/tool-argument/raw-provider display. Unknown strategies/models remain unknown rather than fetched from providers.

```mermaid
sequenceDiagram
  participant U as User
  participant H as Existing hit test / resident list
  participant I as Existing inspector
  participant S as Runtime store
  participant A as City read facade
  U->>H: Select resident by current entity ID
  H->>I: Existing selection
  I->>S: Resolve stable slot + Agent projection
  S-->>I: Cached identity/status/freshness
  U->>I: Expand history / reveal permitted result
  I->>A: Scoped GET with read credential
  A-->>I: Safe bounded response
  I->>I: Verify selection generation; render plain text
```

Loading has explicit placeholder; disconnect shows standalone/not connected; stale preserves clearly labelled last-known summaries; auth failure immediately removes protected data; missing Agent/Task returns unavailable without trying adjacent IDs. Cancellation/error details never imply the user may control backend execution. No new run/cancel buttons in Phase 3.

## Multi-agent presentation

One/five/twenty Agents use one batched fetch, Map reconciliation and existing resident renderer. Simultaneous transitions update sidecars, not simulation objects. Agent additions map only to explicit slots; disable/removal is confirmed by complete snapshots and releases only integration-owned avatars. More than twenty mappings/unknown manifest slots are reported as unresolved/unsupported without automatic mass spawn. A larger future population needs measured render/query/pagination review, not arbitrary caps silently removed.
