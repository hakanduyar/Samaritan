# Static demo deployment

Local development keeps the normal Next.js server and root asset paths. Static hosting is opt-in at build time:

```sh
STATIC_EXPORT=1 NEXT_PUBLIC_BASE_PATH=/Samaritan pnpm build
NEXT_PUBLIC_BASE_PATH=/Samaritan pnpm verify:static
```

`out/` contains the deployable HTML, scripts and bundled scene. The verifier serves it under the actual project prefix, fetches root/deep-link pages and client scripts, and compares the served GLB hash with the bundled file. Query parameters remain client-side (`mode`, `t`, `qa`, `autoplay`), including first-value semantics for repeated parameters. The root static page renders the same scene; normal server mode retains its existing redirect.

The Static demo workflow verifies pull requests but cannot deploy them. Deployment is manual (`workflow_dispatch`) from main only, after source review and actual-use acceptance. Enable GitHub Pages with GitHub Actions as the publishing source before dispatch. The deploy job uses the existing ephemeral GITHUB_TOKEN/OIDC with pages/id-token permissions; no personal token, paid host or new external account is required.

Expected URL after a successful deployment: https://hakanduyar.github.io/Samaritan/ . This document does not claim it is already live. No experimental opening candidate or private assets are included in this hosting change.

Before deployment, inspect the locally served static export on desktop and portrait, refresh a deep link, and verify scene loading and controls. HTTP/asset verification is not visual acceptance. Roll back the hosting commit or deploy a previously reviewed static artifact without changing scene geometry or local approved previews.