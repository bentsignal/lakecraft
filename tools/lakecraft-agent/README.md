# Lakecraft agent builder CLI

This dependency-free Bun CLI lets an agent inspect and build in one Railway-hosted Lakecraft world. Railway SQLite remains the only gameplay authority; the builder never calls Lakebed.

Configure the game server with a unique, randomly generated `AGENT_TOKEN` of at least 32 characters. Do not reuse the player invitation, Lakebed registration, or `ADMIN_TOKEN` secret. Give an agent the server URL and token through its environment:

```sh
export LAKECRAFT_AGENT_URL=https://your-world.up.railway.app
export LAKECRAFT_AGENT_TOKEN='replace-with-a-random-32-byte-secret'
bun run tools/lakecraft-agent/cli.ts status --json
```

The token is sent only in an `Authorization: Bearer` header. The CLI deliberately has no `--token` option and rejects URLs containing credentials, query parameters, or fragments. For file-based secret injection, use `--token-file`.

## Build and inspect

```sh
bun run tools/lakecraft-agent/cli.ts get 0 21 0 --json
bun run tools/lakecraft-agent/cli.ts region -5 20 -5 5 26 5 --json
bun run tools/lakecraft-agent/cli.ts set 0 21 0 stone_bricks --operation agent.tower.base.0001 --json
bun run tools/lakecraft-agent/cli.ts fill -2 21 -2 2 21 2 planks --operation agent.tower.floor.0001 --json
bun run tools/lakecraft-agent/cli.ts camera 14 29 18 --yaw -38 --pitch -16 --width 320 --height 200 --out view.png --json
```

Every mutation takes an idempotency operation ID. If omitted, the CLI creates a UUID-backed ID. Retrying the exact same ID and payload replays its receipt; reusing the ID for a different edit is rejected. A batch or fill is capped at 512 cells and commits atomically. Region reads are capped at 4,096 cells. Camera renders are capped at 320×200 pixels and a 128-block ray distance.

Mutation commands print a compact receipt (`operationId`, replay status, final revision, and edit count), including under `--json`, so an agent does not spend context on hundreds of echoed cells. Add `--verbose` or `--include-edits` only when exact per-cell authoritative revisions are needed.

`region` returns a dense numeric `blocks` array in `x,z,y` order: X changes fastest, then Z, then Y. Run `status` for the append-only block palette.

## Deterministic example

Build the same small glass observatory every time:

```sh
bun run tools/lakecraft-agent/cli.ts example --x 0 --z 0 --json
bun run tools/lakecraft-agent/cli.ts camera 14 29 18 --yaw -38 --pitch -16 --width 320 --height 200 --out observatory.png --json
```

The example chooses one block above the server-reported ground when `--y` is omitted. Its stable operation ID makes an exact rerun safe. Builder edits are broadcast immediately to connected game clients as ordinary authoritative block patches.
