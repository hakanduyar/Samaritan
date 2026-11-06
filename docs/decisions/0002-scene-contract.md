# 0002 — Authored assets and runtime ownership

Date: 2026-11-07

Status: Accepted (current architecture; rationale documented now)

## Decision

Unity was used for scene blockout and camera/animation authoring; Blender for material/export refinement and GLB production. They are authoring tools, not browser runtime dependencies. The published application consumes the resulting GLB and a small JSON manifest through Three.js. Private authoring projects are not needed to run the public application, and this repository does not claim to reproduce their entire production pipeline.

The imported camera and clip remain authoritative. Manual input and playback select authored time through the scene rig rather than constructing another camera path. Application-specific background motion must be explicitly scoped and must not silently overwrite camera animation or focal anchors.

## Contract

The manifest reader validates supported schema, world, scene URL, camera/clip names, positive duration, framing and bookmarks. The shipped schema2 scene uses authored time and named screen anchors/hold intervals; those times are not television footage timestamps. The runtime loads the asset, resolves named objects and checks the rig contract, including clip duration. URL validation and type checking do not establish that every visual or material property is correct.

Ship a compatible manifest and scene together. If camera names, clip duration or anchor semantics change, update the contract data and tests in the same asset feature. Do not guess missing names, substitute a fallback camera or repair malformed producer data silently. A broken asset should produce a useful load/error state.

## Tradeoffs and change triggers

Embedding meshes, materials, animation and textures in GLB makes the asset boundary portable and keeps the browser independent of authoring installations. It also creates a binary that is harder to review than text, can cost download/decode memory, and may render differently across engines. Retain provenance and license information; a format conversion is not a rights grant.

Procedural browser geometry would simplify some dynamic effects but move scene-authoring responsibility into runtime code. Consider it for a specific small effect only when deterministic geometry, camera compatibility and visual review are practical. Streaming or separately encoded textures may become useful if measured initial-load or memory costs justify a more complex delivery contract. Do not introduce either solely as a general optimization.

## Required evidence for scene changes

Compare matched authored-time frames in the actual browser consumer, including focus, approach, departure and reverse traversal. Check material transparency, texture sharpness, imported names/duration and anchor preservation. Inspect continuous motion as well as stills. Automated GLB/contract tests establish structural behavior; simulated-renderer tests do not prove output pixels or interaction comfort. Keep a compatible prior scene/manifest pair available for feature rollback.
