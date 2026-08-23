# Lakecraft agent builder CLI

This Bun CLI reads and edits one Railway-hosted Lakecraft world. Railway SQLite
remains the gameplay authority. The builder never calls Lakebed.

Configure the game server with a random `AGENT_TOKEN` of at least 32 characters.
Do not reuse the player invitation, Lakebed registration, or `ADMIN_TOKEN`
secret. Pass the server URL and token through the environment:

```sh
export LAKECRAFT_AGENT_URL=https://your-world.up.railway.app
export LAKECRAFT_AGENT_TOKEN='replace-with-a-random-32-byte-secret'
bun run tools/lakecraft-agent/cli.ts status --json
```

The CLI sends the token only in an `Authorization: Bearer` header. It has no
`--token` option and rejects URLs containing credentials, query parameters, or
fragments. For file-based secret injection, use `--token-file`.

## Build and inspect

```sh
bun run tools/lakecraft-agent/cli.ts get 0 21 0 --json
bun run tools/lakecraft-agent/cli.ts region -5 20 -5 5 26 5 --json
bun run tools/lakecraft-agent/cli.ts set 0 21 0 stone_bricks --operation agent.tower.base.0001 --json
bun run tools/lakecraft-agent/cli.ts fill -2 21 -2 2 21 2 planks --operation agent.tower.floor.0001 --json
bun run tools/lakecraft-agent/cli.ts camera 14 29 18 --yaw -38 --pitch -16 --width 320 --height 200 --out view.png --json
```

Every mutation takes an idempotency operation ID. The CLI creates a UUID-backed
ID when one is omitted. Retrying the same ID and payload replays its receipt.
Reusing the ID for a different edit fails. Batch and fill commands accept at
most 512 cells and commit atomically. Region reads accept at most 4,096 cells.
Camera renders stop at 320×200 pixels and a 128-block ray distance.

Mutation commands print `operationId`, replay status, final revision, and edit
count, including under `--json`. Add `--verbose` or `--include-edits` only when
you need each cell's authoritative revision.

`region` returns a dense numeric `blocks` array in `x,z,y` order: X changes fastest, then Z, then Y. Run `status` for the append-only block palette.

## Deterministic example

Build the same small glass observatory every time:

```sh
bun run tools/lakecraft-agent/cli.ts example --x 0 --z 0 --json
bun run tools/lakecraft-agent/cli.ts camera 14 29 18 --yaw -38 --pitch -16 --width 320 --height 200 --out observatory.png --json
```

When `--y` is omitted, the example builds one block above the server-reported
ground. Its stable operation ID makes an exact rerun safe. The server broadcasts
builder edits to connected clients as ordinary authoritative block patches.
