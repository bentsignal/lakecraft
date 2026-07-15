# Lakecraft two-client multiplayer QA

This is the release procedure for validating Lakecraft's intentionally quota-hostile Lakebed multiplayer path. Run the deterministic protocol test first, then the production exercise with two distinct, already-authorized Google identities.

## Automated protocol preflight

```sh
node --experimental-strip-types tests/twoClientMultiplayerQa.test.ts
npx lakebed build --json
```

The first command simulates two moving clients for one minute with deterministic network jitter. It verifies the 5 Hz/300-writes-per-player ceiling, remote visibility and reconnect semantics, cross-player item conservation, chat bounds, authoritative PvP, and explicit mutation accounting. Its expected baseline is 600 presence mutations plus six representative action mutations per minute.

The claimed production app currently allows 10,000 requests and only 1,000 mutations per day. A two-player 5 Hz run therefore spends about 606 mutations/minute and can exhaust the daily mutation bucket in under two minutes. That limitation is intentional evidence for this Lakebed experiment: run one bounded 60-second production pass after a reset, preserve the results, and never switch multiplayer to another transport.

## Identity prerequisite

Lakebed supports per-tab development guests such as `http://localhost:3000/?lakebed_guest=alice`, but Lakecraft intentionally rejects guest identities for usernames and shared-world mutations. Guest tabs are therefore useful for checking auth rejection only; they are not a valid end-to-end multiplayer pass.

Production validation requires two separate browser profiles that are already signed in to different Google identities. Do not share cookies, switch an account, or create an account as part of automated QA. Confirm each window shows a different Lakecraft username before continuing.

## Production procedure

1. Confirm the hosted request quota is available before opening two active clients:

   ```sh
   npx lakebed inspect https://craft.lakebed.app --json
   npx lakebed db dump https://craft.lakebed.app > /tmp/lakecraft-before.json
   ```

   If the CLI returns `lakebed_quota_exceeded`, stop. Record the bucket, current value, limit, and `resetAt`; retrying only consumes more requests.

2. Open `https://craft.lakebed.app` side by side in the two authenticated browser profiles. Join the same world as distinct usernames. Turn on F3 in both windows and begin a full-desktop recording or timestamped Computer Use capture.

3. Run this fixed interaction sequence:

   | Time | Client A | Client B | Required observation |
   | ---: | --- | --- | --- |
   | 0–10 s | Stand still and watch B | Walk, turn, jump | A sees B's nameplate and bounded smooth motion; neither client drops below the frame budget |
   | 10–20 s | Walk, turn, jump | Stand still and watch A | Symmetric movement and nameplate behavior |
   | 20–25 s | Send `qa-a-<timestamp>` | Send `qa-b-<timestamp>` at least 900 ms later | Both messages appear once, in order, in Minecraft-style chat |
   | 25–35 s | Select a two-item stack and press Q once | Walk onto the dropped item | A loses exactly one; B gains exactly one; both see the same world drop transition |
   | 35–45 s | Aim at B and attack once | Stand within four blocks | One authoritative hit is observed; cooldown spam does not add damage |
   | 45–55 s | Watch B | Leave the world, then rejoin | B disappears promptly, reconnects at its saved pose, and has one nameplate/avatar |
   | 55–60 s | Hold Tab | Hold Tab | Both player lists contain the same two unique usernames |

4. Capture evidence:

   - one side-by-side screenshot with both usernames/nameplates;
   - one screenshot of mirrored chat;
   - one screenshot before and after item transfer;
   - one screenshot of PvP health feedback;
   - F3 values from both clients: FPS, P95 frame time, draw calls, chunks, vertices, and mesh time;
   - recording frame counts from the local movement start to the observer's first remote motion. Report median/P95 across at least ten direction changes; label this as observed end-to-end latency, not simulated latency.

5. Inspect state and logs once after the run:

   ```sh
   npx lakebed db dump https://craft.lakebed.app > /tmp/lakecraft-after.json
   npx lakebed logs https://craft.lakebed.app
   ```

   Record request/mutation quota deltas when Lakebed exposes them. Expected application mutations for the scripted actions are two chats, one drop, one pickup, one attack, and one leave, plus up to 600 presence writes for two continuously moving clients during a full minute. Presence is an indexed upsert, so row-count growth is not a substitute for mutation accounting.

## Release gates

- Both identities, names, avatars, chat messages, and the transferred item converge without refresh.
- Active pose publication stays at or below 300 mutations/minute/player only when another player is present; solo and idle clients fall back to one lease write/minute.
- Observed remote movement P95 is reported and no unbounded freeze occurs between snapshots.
- The item total is conserved across both inventories and the world drop.
- PvP rejects cooldown spam, reach/aim spoofing, and stale/offline targets.
- Disconnect removes the old avatar and reconnect produces exactly one avatar at the saved pose.
- Desktop rendering remains at least 55 FPS with at most 22 ms P95 frame time during the run.
- Request and mutation quota exhaustion is a failed production gate and must be reported, never worked around with another backend.
