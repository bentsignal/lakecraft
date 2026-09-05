# Lakecraft

Lakecraft is a dependency-free TypeScript/WebGL game built toward a one-to-one,
pixel-perfect Minecraft Java Edition clone, one playable slice at a time. Favor
faithful proportions, interactions, timing, and restrained pixel presentation
over reinterpretation.

The browser client, identity, and server directory ship as a
[Lakebed](https://docs.lakebed.dev/) capsule. Use the Lakebed documentation for
its platform model, APIs, project structure, and CLI conventions.

Single-player worlds are browser-local. Multiplayer gameplay and persistence
are authoritative in each Railway server and its SQLite volume; Lakebed owns
only identity, server discovery, registration, and scoped join tickets. Read
[the authority architecture](docs/architecture/gameplay-authority.md) before
changing that boundary.

Implement shared gameplay and presentation once under `client/gameplay/`, with
local and Railway adapters handling only authority and persistence differences.

## Work delivery

For implementation requests, follow
[development](.agents/skills/development/SKILL.md). Complete the work in the
assigned worktree branch, validate, commit and push, then provide a verified
Lakebed HTTPS development URL. Repeat that handoff after feedback. User review
approval advances the work through a passing PR into `main`.

For a release request, first follow
[preview](.agents/skills/preview/SKILL.md) to test synced `main` as a release
candidate and list changes since production. After the user approves that
candidate for production, follow
[deploy-lakebed](.agents/skills/deploy-lakebed/SKILL.md).

The shared contract is [delivery workflows](docs/operations/workflows.md).
Use `node scripts/validate-workflow.mjs` at every handoff and before merging or
releasing. Failed or unavailable checks block those steps. Localhost, LAN,
Tailscale, and tunnels are never user review links. Planning and read-only
questions do not start a delivery cycle. Explicit user scope overrides defaults.
