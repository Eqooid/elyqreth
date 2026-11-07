# Elyqreth living color restoration

## Audit

Compared the current Icy White implementation at `1826744` with the original
Living City 2.1 source at `2adbb1b`, its retained overview capture
(`references/living-city-2-1-overview-final.jpg`) and original landmark, café,
terrain and vehicle PNG atlases. The original artwork remains available intact.

- The old atlas conversion treated unrelated warm pixels as brand lighting:
  café wood, service interiors, occupied windows and vehicle panels became white.
- Native cyan displays were neutralized globally, reducing signage variation.
- Neutral surfaces received a cool tint; foliage conversion used a muted ramp.
- Building window animations and café glow used one cold white light profile.
- Canal reflection strips alternated white and pale blue, losing local color.
- Character atlases already bypassed conversion. Clothing, skin, identities and
  functional status colors must retain that separation.

## Implementation

Extended the existing render-only `theme.js`; no new theme framework. Brand
lighting stays #F2F9FF, with bright white cores and dark slate shading. Central
decorative accents are cyan #67D5E8, lavender #B99AFF, amber #FFBE78, pink #F48DA9
and green #79CFA7. Materials include wood and dark navy independently of the brand.

Existing inspected sprite rectangles supply normalized material regions. Only
warm source pixels in those regions are converted: civic/architectural light
becomes white, occupied interiors amber, café furniture wood, foliage green,
selected shop and display panels pink/lavender/cyan. Existing native cool, pink
and neutral pixels survive. Terrain tree bark, pink flowering trees, café cups,
blue delivery-vehicle paint and brake signals retain source colors. Compact car
panels become cyan; service-vehicle magenta paint and amber trim remain distinct.

The repeated-color cache includes material role, preventing one RGB shared by
wood and neon from receiving a universal replacement. Row frame candidates are
cached during loading; conversion never runs per rendered frame. PNG sources,
alpha, frame rectangles, silhouettes, proportions and character atlases remain
unchanged. Main city lights and UI selection/branding remain white. Café counter
glow and occupied windows become amber; clinic info is cyan, research signage
lavender, and the Market retains pink signage and warm storefronts.

Water stays dark blue with white, cyan, lavender and amber reflection strips.
Flow, ripple, steam, window, neon and glow timing are unchanged. No map, collision,
activity, reservation, registry, orchestrator, population, traffic-route, train-route,
clock or camera behavior was changed. No snow, ice or weather is added.

## Verification

`npm run check` passes and all **50 tests** pass. Tests cover retained source
alpha/gutters/dimensions, character bypass, material-aware caching, white brand
light, cyan/neutral preservation, warm furniture and interiors, natural foliage,
distinct signage and brake-light colors, plus the existing simulation suite.

Real-browser review retained seven read-only developer-state samples through
simulation day two, at zoom levels 0.61, 0.73 and 1.5. The complete four-stage
mission finished; four idle routines were interrupted safely. The run recorded
47 completed activities, 12 served coffees, five consumed food items, two household
deliveries, four home returns, park reading, eight conversations and decorative
worker/passenger activity. Water frames changed across every sample, the train
recorded five arrivals/departures, and 13 vehicles exited. Activity routes, road
topology, vehicle lanes and application console logs reported no errors.

Inspected the whole-city view, warm café close-up and nighttime scene. White
civic/station outlines remain prominent; Market pink and amber, lavender research
and billboard panels, cyan displays, wood furniture, green foliage and multicolor
canal reflections are visible. Before/after and close-up captures are retained as
`references/living-color-before.jpg`, `living-color-overview.jpg`,
`living-color-cafe.jpg` and `living-color-night.jpg`; raw observations are in
`living-color-browser-verification.json`.

Sampled canvas draw cost was approximately 5–11 ms. Desktop FPS remains
unbenchmarked; the cloud browser throttles frame callbacks.

## Icy White dominance refinement

Shared city neon now defaults to #F2F9FF rather than saturated cyan. This keeps
generic displays, track-edge light, vehicle illumination, task visuals and civic
effects aligned with the brand. UI focus accents use subtle #B8DDF5. Character
role colors remain separate, so the Developer's cyan identity survives. Four of
the six landmark main-sign profiles are white; only the Market and research
signs have explicit pink/lavender profiles. Native cyan information panels and
other contextual shop details remain local supporting colors.

Five of the eight repeating canal reflection slots are white/frost white;
the remaining slots provide occasional cyan, lavender and amber reflections.
Dark architectural surfaces, warm café/interiors, natural vegetation and varied
vehicle materials are unchanged. This is a color configuration refinement only.

Module checks and all **51 tests** pass, including a regression for white shared
lighting, civic sign profiles, mostly white reflections, and preserved local
interior/character colors. New browser review screenshots and state samples use
the `references/white-dominance-*` prefix.
Whole-city morning and evening views at two zoom levels confirm prominent white
architectural lighting against dark surfaces with local supporting colors. Four
browser samples show changing water frames, three train arrivals/departures,
six vehicle exits and a completed four-stage mission. Application console,
road/lane validators and activity routes reported no errors.
