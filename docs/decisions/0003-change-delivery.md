# 0003 — Reviewable changes and rollback

Date: 2026-11-07

Status: Accepted (delivery policy documented now)

## Decision

Use a small number of meaningful feature branches and pull requests, each tied to a concrete issue or acceptance criteria. Separate navigation, scene geometry/materials, ambient behavior and opening changes when they can be reviewed or reverted independently. Avoid branch/PR churn for cosmetic activity, and do not combine unrelated features merely to simplify merging.

Each PR explains the user-visible change, scope, executed checks and remaining limits. Use independent review for material interaction or asset changes; the implementer's own claim is not acceptance. Architecture changes should update or supersede the relevant decision record.

## Validation and merge

The existing CI checks locked dependency installation, TypeScript, tests and production build. Changes must pass their relevant checks and the repository's required gates. Report a visual review separately with the actual browser, viewport and interactions inspected. Do not present fake-renderer tests, exported screenshots or a successful build as a whole-flow browser pass.

Rebase a feature branch onto current main when needed, resolving and retesting conflicts. Preserve individual feature commits when they provide useful rollback boundaries. Squashing several implementation-fix commits for one coherent feature can be appropriate; squashing unrelated independently reversible features into one commit is not the default. Follow repository protection rules and coordinate before rewriting any shared branch. A recommendation here does not claim that branch protection is already configured.

## Rollback and public history

Revert the specific feature commit or restore its compatible asset/manifest selection, then rerun relevant checks. Preserve evidence and previous compatible assets where practical; do not delete production history as a rollback mechanism. A runtime change and an asset update that require each other must revert together.

Public commits contain only intended source, distributable assets and useful documentation. Exclude secrets, private prompts, local paths, logs and generated dependency/build folders. Record actual authorship and significant tool contributions without inventing identities or retroactive history. Keep scene/media provenance and licensing accurate. These practices support traceability; they do not substitute for privacy review.
