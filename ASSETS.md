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

## Recorded feeds (optional)

`public/assets/recorded-feeds/{terminal-walk,porch-walk,s01,s02,s03,parked-c17}/` hold media used only when `?recordedFeed=1` is requested (the previous `aircargo/` files are retained unused for rollback); `{moored-marina,s04,s05,s06}/` are fetched only with `?recordedFeed=1&itinerary=extended` (the previous `harbor/` files are retained unused for rollback). Each directory has `loop.mp4` (muted H.264), `poster.jpg`, `tracking.json` and a `CREDITS.txt`. These are ordinary recorded replays shown inside a fictional interface, not live cameras, and the loop point is not guaranteed to be seamless.

| Material | Origin | License |
|---|---|---|
| terminal-walk `loop.mp4` and `poster.jpg` | 20-second excerpt (source seconds 46-66) of MEVA camera admin.G329 (Kitware, Inc. / IARPA); staged research actor | CC BY 4.0, [MEVA data license](https://mevadata.org/resources/MEVA-data-license.txt) |
| porch-walk `loop.mp4` and `poster.jpg` | 16-second excerpt (source seconds 276-292, fixed crop, 960x540) of MEVA camera bus.G506 (Kitware, Inc. / IARPA), an inward porch/door view at a terminal site shared with another outward road camera; staged research actor. Derivative; tracking.json is original, CC BY 4.0. The previous `s00/` files are retained unused for rollback | CC BY 4.0, [MEVA data license](https://mevadata.org/resources/MEVA-data-license.txt) |
| s01-s03 `loop.mp4` and `poster.jpg` | Excerpts of the MEVA dataset (Kitware, Inc. / IARPA) | CC BY 4.0, [MEVA data license](https://mevadata.org/resources/MEVA-data-license.txt) |
| s04-s06 `loop.mp4` and `poster.jpg` | Excerpts of the MEVA dataset (Kitware, Inc. / IARPA) | CC BY 4.0, [MEVA data license](https://mevadata.org/resources/MEVA-data-license.txt) |
| moored-marina `loop.mp4` and `poster.jpg` | 8-second silent excerpt (source seconds 4-12, 24 fps) of Mixkit ["Boats and yachts at a dock"](https://mixkit.co/free-stock-video/boats-and-yachts-at-a-dock-2069/) (original 1280x720), stabilized with a global shore translation (vidstab, tripod reference, no rotation, zoom, fill, reverse or fade), fixed 1248x702 crop at (16, 9), scaled to 960x540; a stationary moored-marina ambient recording, not a departing tug or ferry, and not mathematically seamless. SHA-256 of `loop.mp4`: `CB1F3EA66034F080655CE0C92BDAC7120F1D0DC6F49B5F8CBF2670C7B5B5F12A`; 2026-11-19 | [Mixkit Stock Video Free License](https://mixkit.co/license/modal/videoFree/) and [Mixkit Terms](https://mixkit.co/terms/); not MIT or CC; no stock redistribution or unmodified commercial resale |
| harbor `loop.mp4` and `poster.jpg` (unused, kept for rollback) | NASA's Goddard Space Flight Center, [SVS 13974](https://svs.gsfc.nasa.gov/13974/) | Public domain under the [NASA SVS policy](https://svs.gsfc.nasa.gov/help/), with credit; not relicensed as MIT |
| parked-c17 `loop.mp4` and `poster.jpg` | 8-second silent excerpt (source seconds 378-386, official 1024x576 file scaled to 960x540) of [DVIDS "C-17 B-Roll"](https://www.dvidshub.net/video/437875/c-17-broll), James Truitt / 88th Air Base Wing, U.S. Air Force; a stationary parked C-17 ambient recording, not a loading or departure scene | Public domain (U.S. government work), [DVIDS copyright conditions](https://www.dvidshub.net/about/copyright); no endorsement implied; not relicensed as MIT |
| aircargo `loop.mp4` and `poster.jpg` (unused, kept for rollback) | NASA's Goddard Space Flight Center, [SVS 12881](https://svs.gsfc.nasa.gov/12881/) | Public domain under the [NASA SVS policy](https://svs.gsfc.nasa.gov/help/), with credit; not relicensed as MIT |
| parked-c17 and moored-marina `tracking.json` | Original project-authored marker bounds | MIT |
| The other eight `tracking.json` | Original project-authored marker bounds | CC BY 4.0 |
| Application code that plays them | Original project implementation | MIT |

The MIT license does not cover the media in this directory. Tracking files are hand-authored normalized bounds, not live inference and not an identification of any person or vehicle. Markers are original canvas-drawn geometry only: two centered circular frame styles (one with a red outlined triangle), assigned to people tracks by a fixed authored rule. The circular styles are fan-reference-inspired display variation, not a canonical taxonomy, and imply no role, threat or identity. Vehicle bounds are displayed with a compact centered circle-and-square glyph rather than a body-sized rectangle. No reference image or vector data is included.
