# 0001 — Browser application stack

Date: 2026-11-07

Status: Accepted (current architecture; rationale documented now)

## Context and decision

This is a browser visualization with a bundled scene, authored camera route and local input. Keep TypeScript for application, contract and control logic; React for the page-level lifecycle and interface; Three.js for rendering; CSS for layout and visual presentation. Keep the existing Next.js application host for this release.

TypeScript's strict checks make named scene contracts, timing state and controller interfaces easier to change together. It compiles to JavaScript executed by the browser; it is not a separate runtime or a guarantee that downloaded JSON is valid. The manifest therefore also has runtime validation. Plain JavaScript could implement the same behavior with less type syntax, but would lose the compiler checks currently exercised by this project. CSS controls the DOM overlay and page layout, not imported 3D camera transforms or scene materials.

React owns mounting, status and controls. The animation/render loop remains imperative in the player rather than routing every frame through React state. This limits coupling between UI updates and rendering without claiming a measured performance advantage.

## Host tradeoff

Next.js currently supplies routes, metadata, development tooling and the production build/start workflow. Retaining it avoids a host migration while scene behavior is still being refined. Its server/build conventions and dependency surface are more than a single canvas inherently needs. React is useful for the existing controls and lifecycle, but is not required for Three.js.

Vite with React, or Vite with plain TypeScript and DOM controls, is a credible simpler alternative if deployment becomes strictly static or framework maintenance outweighs the small route layer. No comparative startup, bundle or rendering benchmark has been performed here. Revisit with a working migration prototype that preserves URLs, query parsing, loading/error states, cleanup and the test suite; measure actual bundle/load behavior before claiming a benefit.

## Local data and alternatives

Scene and manifest are same-origin assets. No application database, account service, telemetry service or domain backend is configured. The documented production workflow still uses Next's server; static scene data does **not** mean the repository is configured as a static export or an installable offline app.

Do not add Rust/WASM merely because the view is graphical: GPU rendering is already delegated through Three.js/WebGL, and WASM does not automatically reduce draw calls or texture cost. Consider a small WASM module only after profiling identifies a substantial CPU-bound algorithm and a prototype demonstrates benefit after transfer, initialization and maintenance costs.

Go or Java could support future shared persistence, ingestion or authenticated services. Neither is needed to serve this local scene, and neither replaces the browser renderer. Add a backend only for a concrete multi-user/server-side requirement, with its data and security boundaries specified first. These are decision triggers, not results of an unperformed language benchmark.

## Consequences and verification

Keep dependencies and lockfile reviewed together. Run type checks, control/lifecycle tests and production build. Browser behavior, accessibility and frame-time claims still require observed use on stated devices; a successful build cannot establish them.
