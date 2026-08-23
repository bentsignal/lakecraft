# Lakecraft

Lakecraft is a browser-native voxel survival sandbox built with TypeScript and
WebGL. Single-player worlds stay in the browser; multiplayer worlds run on
self-hostable Railway servers, while the Lakebed capsule provides the client,
identity, and server directory.

[Play Lakecraft](https://craft.lakebed.app) · [Read the docs](docs/README.md) ·
[Browse open work](https://github.com/bentsignal/lakecraft/issues)

## Run locally

```sh
npx lakebed dev
```

Single-player needs no account. To test multiplayer locally with a development
identity, run `npx lakebed auth as alice` before opening the app. See
[Getting started](docs/getting-started.md) for controls and save behavior.

## Repository map

- `client/`: WebGL game client and browser-local single-player authority
- `server/`: Lakebed identity, server directory, and join tickets
- `apps/game-server/`: Bun/Railway multiplayer authority with SQLite storage
- `shared/`: pure TypeScript gameplay and protocol contracts
- `docs/`: architecture, design, operations, performance, and QA guidance

Development conventions live in [AGENTS.md](AGENTS.md). Lakecraft is not
affiliated with Mojang or Microsoft; third-party attribution is recorded in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
