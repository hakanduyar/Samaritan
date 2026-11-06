# Samaritan

[Repository](https://github.com/hakanduyar/Samaritan) · [Issues](https://github.com/hakanduyar/Samaritan/issues)

An experimental, full-screen 3D interface inspired by *Person of Interest*. Explore a layered information world and visit 6 anchored photographic screens. The scene, camera and route are imported from a bundled GLB; the player controls time along that route.

This is an unofficial fan interface, not a surveillance service or an official production asset. The photographs are synthetic stills, not footage from the series.

## Run locally

Requires Node.js 22 or newer and pnpm 11.17.0.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open http://localhost:3000. For a production build:

```sh
pnpm build
pnpm start
```

## Controls

- Wheel or touch drag: move forward/backward along the authored route.
- Arrow/Page keys: navigate; Space or K: toggle playback.
- Home/End: navigate to the route boundaries.
- `/samaritan?mode=reference&t=10&qa=1`: exact authored-time inspection with diagnostic controls.

The opening completes before interactive navigation begins. The authored route lasts approximately 80.65 seconds at 1× playback. Manual navigation is separate from playback; this release does not include later experimental hold compression or effort tuning. A small, bounded subset of distant screen cells moves independently while idle; focused screens remain stable.

## Project status

A working local preview, not a production or accessibility certification. The public source was prepared from the approved pre-tuning source checkpoint; it is not claimed to reproduce an archived build byte for byte. Desktop and portrait visual consistency, continuous-motion comfort and performance across devices still need broader testing. See [the roadmap](docs/ROADMAP.md).

`pnpm test` runs control, scene-contract and lifecycle checks; `pnpm typecheck` checks TypeScript. Tests use synthetic fixtures or a real GLB with a simulated renderer and do not replace browser visual review.

## How it works

Next.js and React host a Three.js player. A small manifest identifies the authoritative camera, animation, duration and screen anchors. No accounts, analytics service or application backend are configured. See [architecture](docs/ARCHITECTURE.md) and [asset provenance](ASSETS.md).

## AI-assisted development

Claude Code contributed to scene authoring and production implementation. Codex contributed implementation, integration, orchestration, tests and independent review. OpenAI image generation produced the fictional photographic stills. Unity and Blender were used for scene production and export. Human direction and visual decisions guided the result. This is an account of actual tool roles, not a claim of hand-authored work or a fabricated contributor history.

## Contributing and license

Focused improvements and reproducible bug reports are welcome; see [contributing](CONTRIBUTING.md). Application source is offered under the [MIT license](LICENSE). Scene/media licensing is described separately in [ASSETS.md](ASSETS.md). Names and imagery associated with the original series are not endorsed or licensed by this project.
