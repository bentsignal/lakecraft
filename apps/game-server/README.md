# Lakecraft community game server

This is the standalone Bun realtime data plane for a single Lakecraft world. It is authoritative for movement inputs and block edits, persists to SQLite in WAL mode, and intentionally has no Lakebed runtime or npm dependencies.

## Run locally

```sh
AUTH_MODE=local-demo \
SERVER_ID=my-local-world \
LOCAL_DEMO_TOKEN=replace-with-at-least-16-characters \
bun run src/index.ts
```

Health and public server metadata are at `GET /status`; WebSocket clients connect to `/ws`. Run deterministic tests with `bun test`. A short synthetic multiplayer smoke is:

```sh
CLIENTS=10 LOCAL_DEMO_TOKEN=replace-with-at-least-16-characters \
bun run scripts/synthetic-client.ts
```

## Configuration

Required in production ticket mode:

- `AUTH_MODE=lakebed` (the default)
- `SERVER_ID`: the exact registration row id returned by the Lakebed control plane
- `LAKEBED_TICKET_REDEEM_URL`: HTTPS endpoint that atomically redeems a 30–60 second, one-use, server-scoped join ticket
- `LAKEBED_REGISTRATION_CREDENTIAL`: secret server registration credential sent as a Bearer token during redemption

For explicitly insecure local demos, use `AUTH_MODE=local-demo` and set `LOCAL_DEMO_TOKEN` to at least 16 characters. Only this mode accepts a client-provided id and name; anyone holding the shared token can impersonate another demo identity, so it is for trusted friend testing only.

Optional settings are `HOST` (default `0.0.0.0`), `PORT` (Railway injects this; default `3001`), `DATA_DIR` (default `./data`), `PUBLIC_SERVER_NAME`, `PUBLIC_SERVER_DESCRIPTION`, `TICK_HZ` (20), `SNAPSHOT_HZ` (10), `IDLE_SUSPEND_MS` (15000), `MAX_PLAYERS` (32), and `MAX_PERSISTED_BLOCKS` (1000; the current full-snapshot protocol cap). `ALLOWED_ORIGINS` is a comma-separated browser-origin allowlist and is required in Lakebed-authenticated mode.

Attach a Railway volume at `/data` and set `DATA_DIR=/data`. A single replica is required because SQLite is the authority for one world.

## Protocol v1

Messages are JSON text objects with `{ "v": 1, "type": "..." }`. The server sends `hello`; the client answers with `join`. A successful join receives `welcome` followed by a complete bounded `world_snapshot`. The 256-bit `resumeToken` returned by `welcome` can authenticate a short reconnect without replaying the one-use join ticket; it is stored only as a hash, expires ten minutes after issuance, and rotates on every successful reconnect. After expiry, the player must return through the lobby for a fresh Lakebed join ticket. Clients send sequenced `input` and `block_edit` messages; the server emits nearby-player `snapshot` messages and durable `block_patch` events. Every block edit has an `operationId`, echoed on acceptance or rejection, and retries are idempotent across reconnects/restarts.

Block values are numeric Lakecraft `BlockId` values 0 through 33. Movement axes are normalized world-space X/Z intent, not a trusted client pose. The JSON envelope is deliberately versioned so a later compact binary codec can be negotiated without changing authority semantics.

The first slice does not yet implement terrain collision beyond the deterministic height-68 spawn plateau, combat, inventory, mobs, chat, or in-place reauthorization of an uninterrupted socket. It uses the matching feet ground plane at y=69.02, expires reconnect credentials after ten minutes, and limits block interaction to eight blocks from the authoritative player pose.
