# Asset provenance and licensing

The bundled GLB contains original project-authored geometry and animation produced with Unity and Blender. Its photographic panes use fictional AI-generated surveillance-style stills, with atlas and format derivatives for rendering. These are not television footage or real surveillance images. No show video, reference screenshot collection or private production prompt is bundled.

## License scope

The [MIT license](LICENSE) covers the original application source, tests, authored scene geometry/animation and generated still-image assets, to the extent the project can license them. This grant does not assert exclusive ownership of generated output or grant rights to third-party trademarks, characters, television footage or other third-party material. Dependencies retain their own licenses. System font families are referenced through CSS; no font files are distributed.

*Person of Interest* and related names belong to their respective rights holders. This is an unofficial fan interface and is not affiliated with or endorsed by the original production. Inspiration is not a claim of official provenance.

## Transparency and packaging

OpenAI image generation produced the synthetic photographic stills. Existing embedded content credentials remain where present; they record generation provenance rather than a rights guarantee. Private production annotations were removed from the GLB header without changing geometry, animation, material data or decoded texture pixels. The public scene manifest contains only the runtime contract and authored-time bookmarks.

| Material | Origin | Distribution |
|---|---|---|
| Scene geometry and camera animation | Original project authoring with Unity and Blender | MIT, within the scope above |
| Photographic atlas and focal stills | Synthetic image generation and derived encodings | MIT, within the scope above |
| Interface code and procedural visual elements | Original project implementation | MIT |
| Referenced system fonts | Installed on the viewer's device | Not bundled |
| External library code | Resolved through the package lockfile | Respective upstream licenses |
