# Lakecraft community game server

This is the standalone Bun realtime data plane for a single Lakecraft world. It is authoritative for movement inputs and block edits, persists to SQLite in WAL mode, and intentionally has no Lakebed runtime or npm dependencies.

## Run locally

```sh
AUTH_MODE=local-demo \
SERVER_ID=my-local-world \
LOCAL_DEMO_TOKEN=replace-with-at-least-16-characters \
ADMIN_TOKEN=replace-with-a-separate-32-byte-secret \
AGENT_TOKEN=replace-with-a-third-independent-32-byte-secret \
bun run src/index.ts
```

Health and public server metadata are at `GET /status`; WebSocket clients connect to `/ws`. Run deterministic tests with `bun test`. A short synthetic multiplayer smoke is:

```sh
CLIENTS=10 LOCAL_DEMO_TOKEN=replace-with-at-least-16-characters \
bun run scripts/synthetic-client.ts
```

The release gameplay scenario starts a real server on a fresh temporary world,
drives two WebSocket clients through place/break/pickup, Q-drop transfer, death
drops, and respawn, verifies the full item ledger, and removes the isolated
world:

```sh
bun run apps/game-server/scripts/transactional-gameplay-qa.ts
```

## Configuration

Required in production ticket mode:

- `AUTH_MODE=lakebed` (the default)
- `SERVER_ID`: the exact registration row id returned by the Lakebed control plane
- `LAKEBED_TICKET_REDEEM_URL`: HTTPS endpoint that atomically redeems a 30–60 second, one-use, server-scoped join ticket
- `LAKEBED_REGISTRATION_CREDENTIAL`: secret server registration credential sent as a Bearer token during redemption

For explicitly insecure local demos, use `AUTH_MODE=local-demo` and set `LOCAL_DEMO_TOKEN` to at least 16 characters. Only this mode accepts a client-provided id and name; anyone holding the shared token can impersonate another demo identity, so it is for trusted friend testing only.

Optional settings are `HOST` (default `0.0.0.0`), `PORT` (Railway injects this; default `3001`), `DATA_DIR` (default `./data`), `PUBLIC_SERVER_NAME`, `PUBLIC_SERVER_DESCRIPTION`, `TICK_HZ` (20), `SNAPSHOT_HZ` (10), `IDLE_SUSPEND_MS` (15000), `MAX_PLAYERS` (32; the current renderer and appearance-protocol maximum), and `MAX_PERSISTED_BLOCKS` (1000; the current full-snapshot protocol cap). `ALLOWED_ORIGINS` is a comma-separated browser-origin allowlist and is required in Lakebed-authenticated mode.

World shape and the first-join role are server-owned settings:

- `WORLD_PRESET=default` retains the existing deterministic survival terrain. `WORLD_PRESET=superflat` creates an infinite flat grass surface with three dirt layers, stone beneath, and bedrock at y=1.
- `SUPERFLAT_GROUND_Y` is the inclusive grass height from 11 through 64 (default 20, yielding 18 breakable layers above bedrock).
- `DEFAULT_GAME_MODE=survival|creative` controls a player's role on their first join (default survival). An existing player's persisted server role still wins.

The selected terrain preset and height are pinned in the world's SQLite volume. Changing either against an existing volume fails startup instead of silently reinterpreting block edits or player positions. Use a fresh volume for a new terrain shape.

Set `ADMIN_TOKEN` to a separate secret of at least 24 characters to enable the per-world console at `https://YOUR-SERVER/admin`. The console keeps its token in browser session storage, sends it only in an Authorization header, and can grant or revoke Creative mode and disconnect a player. Player roles are persisted in this world's SQLite database. Never reuse or share the player invitation token as the admin token.

Set `AGENT_TOKEN` to a third, independent secret of at least 32 characters to enable the bounded builder API at `/agent/v1`. Startup rejects reuse of the player invitation, Lakebed registration, or administrator secret. Builder authentication is Railway-local and bearer-header-only; neither the API nor the CLI sends gameplay operations through Lakebed. See [`tools/lakecraft-agent/README.md`](../../tools/lakecraft-agent/README.md) for status, block/region/edit/fill, camera PNG, and deterministic example commands. If `AGENT_TOKEN` is absent, every builder path returns 404.

Builder mutations commit a maximum of 512 edits atomically to SQLite, persist an exact idempotency receipt across restarts, and immediately broadcast ordinary `block_patch` events to connected players. The most recent 512 potentially large receipts are retained to bound storage. Reads and native PNG renders sample the same config-selected terrain authority used by gameplay; camera output is capped at 320×200 and 128 blocks.

Attach a Railway volume at `/data` and set `DATA_DIR=/data`. A single replica is required because SQLite is the authority for one world.

## Protocol v1

Messages are JSON text objects with `{ "v": 1, "type": "..." }`. The server sends `hello`; the client answers with `join`. A successful join receives `welcome` followed by a complete bounded `world_snapshot`. The 256-bit `resumeToken` returned by `welcome` can authenticate a short reconnect without replaying the one-use join ticket; it is stored only as a hash, expires ten minutes after issuance, and rotates on every successful reconnect. After expiry, the player must return through the lobby for a fresh Lakebed join ticket. Clients send sequenced `input` and `block_edit` messages. Each input includes the browser's canonical pose, which the server bounds and acknowledges by sequence so reconciliation never rewinds to a stale snapshot. The server emits nearby-player `snapshot` messages and durable `block_patch` events. Every block edit has an `operationId`, echoed on acceptance or rejection, and retries are idempotent across reconnects/restarts.

`hello.capabilities` advertises the additive `appearance-v1` path. Selected skins are reduced in the browser to exact 64×64 RGBA, SHA-256-addressed, and relayed only after join; the original PNG is never sent. Armor and skin references use out-of-band appearance state rather than realtime snapshots. A joining client receives a bounded roster and requests missing ~22 KB base64 blobs sequentially. The server keeps at most one transient blob per live connection, validates hashes and exact armor slots, rate-limits uploads and blob requests, and never writes appearance bytes to SQLite. Armor is cosmetic browser self-report rather than inventory-authorized state; gameplay authority must never derive protection or combat outcomes from it.

Block values are numeric Lakecraft `BlockId` values 0 through 33. Movement axes are normalized world-space X/Z intent, while the accompanying pose is accepted only inside a tight per-sample displacement bound. The JSON envelope is deliberately versioned so a later compact binary codec can be negotiated without changing authority semantics.

The realtime server persists bounded shared item drops and each server-specific player pack in the world SQLite database; nearby players can exchange exact stacks through replay-safe, server-validated drop, pickup, and inventory operations. It also owns melee PvP health, reach/aim checks, cooldowns, weapon damage, death, and respawn. Selected items, canonical swing/use actions, and explicit crouch state are relayed so remote avatars use the shared third-person rig. Cosmetic armor is deliberately not trusted for damage reduction yet, and multiplayer mobs still use the browser's existing simulation. Authored block edits, trees, and cave interiors do not yet alter server collision. Reconnect credentials expire after ten minutes, and block/drop/attack interactions are reach-limited against the accepted player pose. Player/event snapshots use a 21-chunk authority radius; each browser independently renders 2–12 terrain chunks according to its saved performance setting.
