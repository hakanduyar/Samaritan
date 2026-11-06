# Architecture

- `app/`: full-viewport page, shared styles and document metadata. The root redirects to `/samaritan`.
- `src/contract/manifest.ts`: validates the local scene manifest and same-origin asset URLs.
- `src/player/sceneRig.ts`: binds the imported camera and animation; evaluates exact authored time with Three's animation mixer.
- `src/player/runtime.ts`: rendering, input, bounded manual traversal, playback and visibility lifecycle.
- `src/player/Startup.tsx`: foreground-time opening sequence and interaction barrier.
- `src/player/ambient.ts`: allowlisted static far-cell motion on a separate foreground clock.
- `public/assets/samaritan/`: the bundled scene and minimal public manifest.
- `tests/`: contract, timing, route and lifecycle checks.

## Time and ownership

The authored animation owns spatial transforms. Input changes the time at which it is evaluated; the player does not construct a competing camera path. Reference mode and diagnostic bookmarks use exact local clip seconds, not television footage timestamps. Playback advances by visible elapsed time, while manual input is bounded. Hidden-tab handling prevents accumulated hidden time from becoming a jump.

## Assets and privacy

Scene geometry, animation, materials and textures are embedded in GLB. Public packaging removes private production annotations from the asset header, while retaining image content credentials and functional scene data. No private production projects, source captures, logs or editing histories are needed to run the app.

## Change boundaries

Keep navigation, scene assets, ambient behavior and opening changes independently reviewable. Match snapshots at identical authored times and test forward/reverse transitions. A test pass establishes its stated control contract; actual render quality and device performance require separate observation.
