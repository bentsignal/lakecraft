# Lakecraft community game server

This is the standalone Bun realtime data plane for a single Lakecraft world. It is authoritative for movement, blocks, server-specific inventory, world drops, combat, and mob ecology; persists to SQLite in WAL mode; and intentionally has no Lakebed runtime or npm dependencies.

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

Optional settings are `HOST` (default `0.0.0.0`), `PORT` (Railway injects this; default `3001`), `DATA_DIR` (default `./data`), `PUBLIC_SERVER_NAME`, `PUBLIC_SERVER_DESCRIPTION`, `TICK_HZ` (20), `SNAPSHOT_HZ` (10), `IDLE_SUSPEND_MS` (15000), `MAX_PLAYERS` (32), and `MAX_PERSISTED_BLOCKS` (1,000,000). `SPAWN_X`, `SPAWN_Z`, `SPAWN_YAW_DEGREES`, `DAYLIGHT_CYCLE`, and `DAY_PHASE` seed persistent world controls only on first boot; later changes are made in `/admin`. `ALLOWED_ORIGINS` is a comma-separated browser-origin allowlist and is required in Lakebed-authenticated mode.

World shape and the first-join role are server-owned settings:

- `WORLD_PRESET=default` retains the existing deterministic survival terrain. `WORLD_PRESET=superflat` creates an infinite flat grass surface with three dirt layers, stone beneath, and bedrock at y=1.
- `SUPERFLAT_GROUND_Y` is the inclusive grass height from 11 through 64 (default 20, yielding 18 breakable layers above bedrock).
- `DEFAULT_GAME_MODE=survival|creative` controls a player's role on their first join (default survival). An existing player's persisted server role still wins.

The selected terrain preset and height are pinned in the world's SQLite volume. Changing either against an existing volume fails startup instead of silently reinterpreting block edits or player positions. Use a fresh volume for a new terrain shape.

Set `ADMIN_TOKEN` to a separate secret of at least 24 characters to enable the per-world command deck at `https://YOUR-SERVER/admin`. It persists spawn/time/daylight, public/password/whitelist/closed access, operators and moderators; exposes server chat; changes game modes; and can kick, ban, or pardon players. The service owner mints a one-time 10-character pairing code through authenticated `POST /admin/api/pair-code`; the browser exchanges it at `POST /admin/api/pair` for a signed 30-day session. The Railway service token never enters the page, pairing codes expire after 24 hours and are single-use, and **Lock** removes the browser session.

`ACCESS_MODE` is `token` (legacy invitation token), `public`, `password`, `whitelist`, or `closed`. `SERVER_PASSWORD` is required only for a password bootstrap. `WHITELIST_USERNAMES` seeds a comma-separated persistent whitelist. Public and whitelist community servers should use `AUTH_MODE=lakebed` so usernames come from verified one-use tickets; `local-demo` accepts claimed browser identity and is only appropriate for trusted testing.

Set `AGENT_TOKEN` to a third, independent secret of at least 32 characters to enable the bounded builder API at `/agent/v1`. Startup rejects reuse of the player invitation, Lakebed registration, or administrator secret. Builder authentication is Railway-local and bearer-header-only; neither the API nor the CLI sends gameplay operations through Lakebed. See [`tools/lakecraft-agent/README.md`](../../tools/lakecraft-agent/README.md) for status, block/region/edit/fill, camera PNG, and deterministic example commands. If `AGENT_TOKEN` is absent, every builder path returns 404.

Builder mutations commit a maximum of 512 edits atomically to SQLite, persist an exact idempotency receipt across restarts, and immediately broadcast ordinary `block_patch` events to connected players. The most recent 512 potentially large receipts are retained to bound storage. Reads and native PNG renders sample the same config-selected terrain authority used by gameplay; camera output is capped at 320×200 and 128 blocks.

Attach a Railway volume at `/data` and set `DATA_DIR=/data`. A single replica is required because SQLite is the authority for one world.

## Protocol v1

Messages are JSON text objects with `{ "v": 1, "type": "..." }`. After `welcome`, the browser subscribes to the 8×8 coordinate chunks inside its selected render distance. The server sends compact sparse chunks only when the client's known revision is stale, unloads chunks that leave the window, and scopes durable `block_patch` events to subscribers. It never loads or serializes the whole edited world for a join. The 256-bit rotating `resumeToken` is hash-at-rest and expires after ten minutes. Sequenced input and block-edit retries remain bounded and idempotent across reconnects and restarts.

`hello.capabilities` advertises the additive `appearance-v1` path. Selected skins are reduced in the browser to exact 64×64 RGBA, SHA-256-addressed, and relayed only after join; the original PNG is never sent. Armor and skin references use out-of-band appearance state rather than realtime snapshots. A joining client receives a bounded roster and requests missing ~22 KB base64 blobs sequentially. The server keeps at most one transient blob per live connection, validates hashes and exact armor slots, rate-limits uploads and blob requests, and never writes appearance bytes to SQLite. Armor is cosmetic browser self-report rather than inventory-authorized state; gameplay authority must never derive protection or combat outcomes from it.

Block values are numeric append-only Lakecraft `BlockId` values across the current catalog. Movement axes are normalized world-space X/Z intent, while the accompanying pose is accepted only inside a tight per-sample displacement bound. The JSON envelope is deliberately versioned so compact chunk codecs can be negotiated without changing authority semantics.

The realtime server persists bounded shared item drops and each server-specific player pack in the world SQLite database. Survival placement validates the current block, chunk revision, selected stack, and inventory revision before atomically debiting the item and committing the block. Mining atomically commits air, tool wear, and exactly one delayed persisted ground drop; pickup atomically credits the eligible player's pack while consuming that drop. Q-drop likewise debits the exact source slot and creates the entity in one transaction. Every operation has a fingerprinted SQLite receipt, so retry and restart cannot duplicate a block, item, or credit. Legacy clients may read the filtered v1 chunk stream during a rolling release, but block writes without the current authority envelope fail closed. It also owns melee PvP health, reach/aim checks, cooldowns, weapon damage, death, and respawn. Selected items, canonical swing/use actions, and explicit crouch state are relayed so remote avatars use the shared third-person rig. Cosmetic armor is deliberately not trusted for damage reduction yet. Authored block edits, trees, and cave interiors do not yet alter server collision. Reconnect credentials expire after ten minutes, and block/drop/attack interactions are reach-limited against the accepted player pose. Player/event snapshots use a 21-chunk authority radius; each browser independently renders 2–12 terrain chunks according to its saved performance setting.

Survival mobs are Railway-owned as well: the fixed-tick ecology keeps bounded persistent habitats around as many as four separated active players, groups sparse passive herds, and admits hostiles only where current sky and block light are dark enough. Mob identities, motion checkpoints, health, deaths, and loot remain in the world SQLite authority. Skeleton arrows are launched, flown, missed, and resolved on the server (the current wire path presents the resulting hit but does not yet render an in-flight remote arrow). Completed creeper fuses atomically consume the mob and commit one replay-safe crater before ordinary chunk patches, lossy block drops, and exposed-player damage are published. Creative servers remain mob-free by default.
