# Icy White visual theme

## Audit and implementation

The existing Ice Blue configuration already supplied cached environmental atlas
conversion, UI tokens and most canvas lighting. Its tonal ramp, neutral tint and
remaining native cyan pixels made the scene blue-lit. Several scenery descriptors
still used cyan literals; UI border/glow colors had matching hardcoded fallbacks.
Orange character jackets, food, cardboard and error colors represent identities
or materials, so they are retained. Magenta signs and pink foliage remain small
secondary accents rather than being flattened into one palette.

The existing `theme.js` now owns Icy White lighting, windows, building highlights,
road illumination, reflections, selection and UI colors. Main light cores use
#F2F9FF / #FFFFFF; #DCEEFF and #B8DDF5 supply restrained undertones. Source warm
and cyan lighting share a low-saturation ramp with dark slate shadows. Neutral
textures receive only a slight cool tint. Atlas dimensions, alpha, frames and
source PNG files remain intact; all character atlases bypass recoloring.

Terrain leaf-cover and tree cells use a separate muted-green material ramp. This
prevents the original orange foliage becoming white or looking frosted. Existing
green vegetation and pink foliage remain varied. Roads are darker graphite,
sidewalks remain stone, and canal wavelets retain a dark blue-gray material.
Reflection strips are predominantly white with occasional soft blue. Café glow,
windows and streetlights are white-first. Successful tasks retain a muted green
status; errors remain pink/red. CSS loading fallbacks match initialized tokens.

Conversion runs once during loading with a material-aware repeated-color cache.
There is no new frame effect, blur, weather, geometry or simulation system. Only
rendering and theme colors changed; activity/controller, registry, orchestrator,
movement, needs, clock, map coordinates and collisions remain untouched.

## Verification

Automated checks cover source-alpha/frame preservation, character-atlas bypass,
shading, green/pink material colors, orange/cyan light-core neutrality, foliage
separation and UI contrast, alongside the existing simulation regression suite.
Browser screenshots and state samples are retained under `references/icy-white-*`.

Syntax checks and all **48 tests** pass. Browser review reached day two and
completed all four mission stages with three safely interrupted routines. It
recorded 37 completed activities, nine served coffees, two food consumptions,
four courier deliveries, 15 cleaning stops and train passenger boarding/alighting.
The road graph and lane validators reported no errors; activity routes had zero
failures. Six samples show changing water frames, train phases, pedestrian poses
and camera zoom levels. Café, park, station, agent inspection and nighttime fit
views were inspected; the UI reports `icy-white` with primary #F2F9FF. Application
console errors were absent. Cloud callbacks are throttled; sampled canvas draw
cost was roughly 4–7 ms, but ordinary desktop FPS remains unbenchmarked.
