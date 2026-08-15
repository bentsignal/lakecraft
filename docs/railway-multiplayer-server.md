# Host a Lakecraft multiplayer server on Railway

Lakecraft's game server is a small, dependency-free Bun service. Railway runs
the published Lakecraft server image, keeps the world in one SQLite file on a
volume, and terminates HTTPS/WSS for the browser client. The URL players paste
into Direct Connect is `wss://YOUR-DOMAIN/ws`.

This beta uses one server process and one persistent volume. Do not add replicas
or enable app sleeping: player sockets and authoritative tick state live in that
process, and SQLite lives on that process's volume.

## Deploy the current beta

1. Open the [Lakecraft Multiplayer Server template](https://railway.com/deploy/lakecraft-multiplayer-server)
   and click **Deploy**. Railway creates the service, generated HTTPS domain,
   `/data` volume, and separate high-entropy player and administrator credentials.
2. Wait for the deployment and health check to turn green.
3. Copy the generated domain from the service's **Networking** settings and
   convert it to `wss://YOUR-DOMAIN/ws`, or check it from this repository:

   ```sh
   node tools/lakecraft-server/cli.mjs check https://YOUR-DOMAIN
   ```

4. Reveal `LOCAL_DEMO_TOKEN` in the service's **Variables** settings. Share the
   `wss://.../ws` address and token separately with trusted friends. Do not put
   the token in the URL, screenshots, logs, or a public server-list entry.
5. Mint a one-time pairing code with an authenticated
   `POST https://YOUR-DOMAIN/admin/api/pair-code`, then open
   `https://YOUR-DOMAIN/admin` and pair that browser once. The private console
   stores a signed 30-day session without receiving `ADMIN_TOKEN`; do not give
   the pairing code to players.

The relevant Railway settings are captured in
`tools/lakecraft-server/railway-template-plan.json`. That file is a validated
maintainer mirror of the published template, not an importable Railway manifest.
The Railway template owns the public image, [volume](https://docs.railway.com/volumes),
variables, generated domain, health check, restart policy, and one-replica
constraint. The image is published from `apps/game-server` by the checked-in
GitHub Actions workflow.

## Beta variables

| Variable | Value | Purpose |
| --- | --- | --- |
| `AUTH_MODE` | `local-demo` | Enables the invitation-token beta without a control-plane registration. |
| `LOCAL_DEMO_TOKEN` | 32 random bytes | Legacy `ACCESS_MODE=token` invitation secret. |
| `ADMIN_TOKEN` | A different 32-byte secret | Enables the private `/admin` console for roles and live player controls. |
| `AGENT_TOKEN` | A third, different 32-byte secret | Enables the Railway-local `/agent/v1` builder API. Omit it to disable every builder route. |
| `SERVER_ID` | Stable random lowercase/number ID | Keeps the server identity stable across restarts. |
| `PUBLIC_SERVER_NAME` | Your chosen name | Friendly name returned by server metadata/status. |
| `ALLOWED_ORIGINS` | `https://craft.lakebed.app` | Exact browser origin allowed to upgrade to WebSocket. Use a comma-separated list only when intentionally allowing more origins. |
| `WORLD_PRESET` | `default` or `superflat` | Selects ordinary deterministic terrain or a flat building world. |
| `SUPERFLAT_GROUND_Y` | `20` | Superflat grass height; bedrock remains at y=1, with three dirt layers and stone between. |
| `DEFAULT_GAME_MODE` | `survival` or `creative` | First-join role for this server; stored per-player overrides remain authoritative. |
| `SPAWN_X`, `SPAWN_Z` | World-space decimals; default `0.5`, `0.5` | Authoritative first-join and respawn center. Put a Creative showcase spawn outside its build footprint. |
| `SPAWN_YAW_DEGREES` | `-360` through `360`; default `0` | Initial horizontal view direction. The server converts degrees to its wire yaw. |
| `ACCESS_MODE` | `token`, `public`, `password`, `whitelist`, or `closed` | Persistent access policy seeded on first boot. |
| `WHITELIST_USERNAMES` | Comma-separated usernames | Seeds the persistent whitelist. |
| `DAYLIGHT_CYCLE`, `DAY_PHASE` | `true`, `0.5` | Seeds the world clock; Creative commonly uses frozen noon. |

`PORT` and `RAILWAY_PUBLIC_DOMAIN` are injected by Railway. The container sets
`HOST=0.0.0.0` and `DATA_DIR=/data`. Railway also exposes
`RAILWAY_VOLUME_MOUNT_PATH`; the operator doctor verifies that it agrees with
`DATA_DIR`:

```sh
AUTH_MODE=local-demo \
LOCAL_DEMO_TOKEN='replace-me' \
ADMIN_TOKEN='use-a-different-private-secret' \
SERVER_ID='replace-me' \
ALLOWED_ORIGINS='https://craft.lakebed.app' \
DATA_DIR='/data' \
RAILWAY_VOLUME_MOUNT_PATH='/data' \
node tools/lakecraft-server/cli.mjs doctor
```

For the Creative world, use `WORLD_PRESET=superflat`,
`SUPERFLAT_GROUND_Y=20`, `DEFAULT_GAME_MODE=creative`, and a reviewed clear
`SPAWN_X`/`SPAWN_Z` outside the intended build footprint on a new Railway
service with its own empty volume. Terrain identity is pinned in SQLite on first
boot; a later conflicting env change intentionally prevents startup. The
existing Survival service omits these variables and therefore retains its
`default` + `survival` behavior.

To allow trusted coding agents to build in that Creative service, generate a
unique `AGENT_TOKEN` and follow [`tools/lakecraft-agent/README.md`](../tools/lakecraft-agent/README.md).
The token travels only in an Authorization header. It must never be copied into
the service URL, a command argument, screenshots, or logs. The agent API reads,
renders, and mutates only this Railway world's exact SQLite/terrain authority;
it never consumes Lakebed query or mutation quota.

World edits are streamed by 8×8 coordinate chunk and `MAX_PERSISTED_BLOCKS`
defaults to 1,000,000. Joining loads only the selected render-distance window;
the Railway process keeps a bounded on-demand chunk cache. Builder cameras still
render synchronously, so avoid parallel maximum-resolution camera requests.

The doctor reports missing names but never reads back or prints secret values.

## Per-server admin console and data ownership

Every deployed server carries its own small admin surface at `/admin`; it is not
part of `craft.lakebed.app` and adds nothing to the Lakebed capsule artifact.
The Railway `ADMIN_TOKEN` is an operator credential and never enters the portal.
Only a bearer-authenticated operator can mint a single-use, 10-character pairing
code; the portal exchanges that code for a signed, expiring browser session.
That console changes only the selected Railway world's state. Realtime movement,
chat, block edits, reconnect credentials, and per-world roles belong in Railway's
SQLite authority because clients need low-latency ordering and the data must move
with a self-hosted world. Lakebed remains the source of truth for account identity,
the public server directory, server ownership/registration, and short-lived join
tickets. Do not copy per-tick movement or chat into the Lakebed database.

## Lakebed-authenticated mode

`AUTH_MODE=lakebed` replaces the shared demo token with short-lived player
tickets. It additionally requires:

- `LAKEBED_TICKET_REDEEM_URL`
- `LAKEBED_REGISTRATION_CREDENTIAL` (secret)
- `SERVER_ID` — copy the exact registration row ID returned when this server is
  registered in Lakebed. Do not use the unrelated random ID produced for
  `local-demo`; ticket redemption is deliberately scoped to this value.

Keep `ALLOWED_ORIGINS` restricted in either mode. Lakebed mode is the intended
public-server path once registration and ticket redemption are available; the
local-demo mode is intentionally an invitation-only multiplayer demo.

The shared `local-demo` token is not individual identity. A modified client
holding it can choose another demo user ID, so do not use this mode for public
or untrusted players. Lakebed-authenticated mode derives identity only from the
one-use ticket redemption response.

The server-issued reconnect credential is hash-only at rest, rotates whenever
it is used, and expires ten minutes after issuance. An uninterrupted socket can
remain connected; after an expired credential or a later disconnect, the player
returns through the lobby to mint a fresh Lakebed ticket.

## Local Docker smoke test

No project dependencies are installed:

```sh
docker build -f apps/game-server/Dockerfile -t lakecraft-server .
docker volume create lakecraft-world
docker run --rm -p 3001:3001 \
  -v lakecraft-world:/data \
  -e AUTH_MODE=local-demo \
  -e LOCAL_DEMO_TOKEN='replace-with-a-random-token' \
  -e SERVER_ID='local-friends' \
  -e PUBLIC_SERVER_NAME='Local Friends' \
  -e ALLOWED_ORIGINS='http://localhost:3000' \
  lakecraft-server
```

In another terminal:

```sh
node tools/lakecraft-server/cli.mjs check http://127.0.0.1:3001
```

## Persistence and updates

The world database is `/data/lakecraft.sqlite`. Keep the same volume attached
when redeploying. Download backups through Railway's volume tools before a risky
upgrade. A fresh service without the old volume is a fresh world.

Keep the service at exactly one replica. Zero-overlap deployments are deliberate
so two authoritative processes never write the same SQLite volume. Connected
players will briefly disconnect during deploy and should reconnect to the same
domain afterward.

## Bounded player appearance

The additive `appearance-v1` capability keeps appearance out of the 10 Hz pose
snapshot. Each joined player publishes exact equipped armor IDs and either the
installed default or a content-addressed, nearest-neighbor 64×64 RGBA reduction
of their browser-selected skin. The original PNG never leaves the browser.
Joining clients receive a small roster and request missing skin blobs one at a
time, so no message approaches the 256 KB client envelope and a 32-player join
cannot create one unbounded burst. The server validates the SHA-256 and exact
armor slots, rate-limits uploads and blob requests, and retains at most one
transient skin blob per live connection; appearance is never written to SQLite.
Armor is validated cosmetic self-report from the browser, not an inventory-
authorized gameplay signal, so no combat or protection rule may trust it.
Clients render
the 32-player bound through one fixed 512×256 texture atlas and preserve the
installed skin as the fallback for absent, invalid, or legacy-server data.

## Realtime gameplay boundary

Railway owns accepted player poses, shared block edits and drops, ordered chat,
and melee PvP health for this world. Drop and attack operation IDs are replay-
safe; pickup consumes the SQLite world-drop receipt once, and PvP validates
target reach, facing, cooldown, server-observed held item, death, and respawn.
Armor remains cosmetic and grants no protection. Railway also owns each
server-specific player pack and the idempotency receipts for inventory actions;
ordinary multiplayer placement, mining, drops, pickups, crafting, and death do
not query or mutate Lakebed.

The server sends nearby players and events within 21 chunks. This is a feed
limit, not a forced GPU setting: each browser retains its own saved 2–12 chunk
terrain render distance and can lower it without changing server authority.

## Repository and Lakebed artifact boundary

This milestone does not move the existing Lakebed capsule. The compact Lakebed
transaction already builds a sealed temporary payload from only the bundled
`client/index.tsx`, bundled `server/index.ts`, `favicon.svg`, and sanitized
Lakebed control files. It does not recursively copy the repository. Consequently
`apps/game-server`, `tools/lakecraft-server`, and this document stay outside the
Lakebed artifact even though they remain in the same repository.

Continue using the existing audited Lakebed build transaction for release
evidence. Do not replace it with a raw repository-root upload. This boundary can
be verified after multiplayer changes with:

```sh
evidence_parent="$(mktemp -d)"
node scripts/build-lakebed-audit.mjs "$evidence_parent/multiplayer-boundary"
node scripts/check-lakebed-artifact-size.mjs \
  "$evidence_parent/multiplayer-boundary/artifact-metadata.json"
```

A future physical move to `apps/lakebed-capsule` may make the repository shape
more obvious, but it would churn imports, tooling, deployment ownership, and
production evidence without reducing today's compact payload. It is not needed
for this multiplayer demo.

Railway reference: [isolated monorepo root directories and config paths](https://docs.railway.com/deployments/monorepo), [Dockerfiles](https://docs.railway.com/builds/dockerfiles), and [publishing templates](https://docs.railway.com/templates/publish-and-share).
