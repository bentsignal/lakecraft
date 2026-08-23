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
