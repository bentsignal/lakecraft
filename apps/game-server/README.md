# Lakecraft community game server

This Bun service owns one multiplayer world. It keeps movement, blocks,
server-specific inventory, drops, combat, and mobs in a SQLite database running
in WAL mode. It has no Lakebed runtime or npm dependencies.

## Run locally

From `apps/game-server`:

```sh
AUTH_MODE=local-demo \
SERVER_ID=my-local-world \
LOCAL_DEMO_TOKEN=replace-with-at-least-16-characters \
ADMIN_TOKEN=replace-with-a-separate-32-byte-secret \
AGENT_TOKEN=replace-with-a-third-independent-32-byte-secret \
bun run src/index.ts
```

`GET /status` returns health and public metadata. WebSocket clients connect to
`/ws`.

Run the server tests and synthetic multiplayer smoke from this directory:

```sh
bun test
CLIENTS=10 LOCAL_DEMO_TOKEN=replace-with-at-least-16-characters \
bun run scripts/synthetic-client.ts
```

The transactional gameplay route starts a fresh server, drives two clients
through inventory and death flows, checks the item ledger, and removes its
temporary world:

```sh
bun run apps/game-server/scripts/transactional-gameplay-qa.ts
```

Run that command from the repository root.

## Configuration

Production ticket mode requires:

- `AUTH_MODE=lakebed`, the default
- `SERVER_ID`, copied from the Lakebed registration row
- `LAKEBED_TICKET_REDEEM_URL`, which redeems a one-use ticket valid for 30 to 60
  seconds
- `LAKEBED_REGISTRATION_CREDENTIAL`, sent as a bearer token during redemption
- `ALLOWED_ORIGINS`, an exact comma-separated browser-origin allowlist

Local demos use `AUTH_MODE=local-demo` and a `LOCAL_DEMO_TOKEN` of at least 16
characters. Anyone with that shared token can claim another demo identity. Use
this mode only with trusted players.

`WORLD_PRESET` accepts `default` or `superflat`. `SUPERFLAT_GROUND_Y` sets the
grass height from 11 through 64, and `DEFAULT_GAME_MODE` sets the first-join
role. The server pins terrain settings in SQLite on first boot. A conflicting
later setting stops startup, so use a fresh volume for a different world shape.

Set `ADMIN_TOKEN` to a separate secret of at least 24 characters to enable
`/admin`. Operators mint a one-use pairing code at `POST /admin/api/pair-code`.
The browser exchanges it at `POST /admin/api/pair` for a signed 30-day session.
The Railway service token never enters the page.

Set `AGENT_TOKEN` to a third secret of at least 32 characters to enable
`/agent/v1`. The server rejects reuse of player, registration, or administrator
secrets. Omitting the token makes every builder route return 404. See the
[builder CLI](../../tools/lakecraft-agent/README.md) for commands and limits.

On Railway, mount one volume at `/data`, set `DATA_DIR=/data`, and run exactly
one replica. One SQLite file owns the world.

The full variable list, access modes, admin behavior, protocol, persistence,
appearance transfer, and replay rules live in the
[Railway multiplayer architecture](../../docs/architecture/railway-multiplayer.md).
