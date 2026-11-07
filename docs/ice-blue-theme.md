# Ice Blue visual transformation

Audit: the dominant lighting was baked into ten environmental sprite atlases.
Canvas effects supplied a separate orange café glow, lamps, water reflections,
train indicators, vehicle lights and ambient particles. CSS used an orange primary
variable and warm panel borders. Character appearance colors were also reused in
labels, which made the Researcher’s orange jacket become a general UI accent.

The existing renderer now converts environmental textures once at asset loading.
`theme.js` owns the Ice Blue palette, warm-to-blue tonal ramp, neutral slate tint,
render-only role colors and UI token initialization. Original atlas files, frame
rectangles, alpha, positions and animation timing remain untouched. Character,
coffee/reading/eating/gesture character atlases bypass conversion entirely.

Warm light cores map toward #E0F0FF; mids use #65B8E8 and #A8D8F0; shadows stay
slate. Greens and magentas remain distinct. Roads retain their independent dark
asphalt renderer and brighter crossing stripes; stone pavement is blue-gray.
Water flow/ripples keep the same animation but receive cool reflection colors.
No full-scene filter, snow, ice or weather is introduced. Per-pixel conversion
happens only at loading, with a local repeated-color cache; drawing uses the
ordinary cached atlases afterward. CSS fallbacks match the runtime tokens for
loading and pre-script states. The source artwork stays available unchanged.

Only appearance and rendering code are changed. Registry, activity definitions,
controller, leases, orchestrator, movement, navigation, needs, daily clock, map
coordinates and collisions remain unchanged. Train and traffic edits are color
expressions in drawing methods only. Selected-agent brackets use Ice Blue, while
role labels preserve pink/cyan/violet differentiation. Researcher clothing remains
orange to preserve character identity; its UI labels now use the Ice Blue primary.

## Verification

`npm run check` and all 47 tests pass. The three theme tests cover tonal shading,
unchanged green/magenta pixels, alpha and frame geometry, untouched character
atlases, and readable UI contrast. The existing purposeful-activity fixture now
disables unrelated random encounters so its reservation-cleanup assertion checks
only the forced activity; production behavior is unchanged.

Browser verification ran through simulation day three. The four-stage mission
completed, including three interrupted routines. The final sample recorded 87
activity completions, 20 served coffees, 10 food consumptions, three household
deliveries, four courier deliveries, 27 cleaning stops, three boarded passengers
and eight alighted passengers. Roads and vehicle routes reported no errors;
activity routes had zero failures. Water frames, train phases and character poses
changed across samples. Night lighting, camera fit/zoom, café frontage, reading
sprites, role differentiation and selected-agent UI were inspected visually.
There were no application console errors. Cloud frame callbacks are throttled;
sampled canvas draw cost was roughly 7–13 ms, but desktop FPS is not benchmarked.

Before/after screenshots and five final-source state samples are retained in
`references/ice-blue-*`. The source PNG atlases and all map/navigation/activity
modules are unchanged.
