# Lakecraft two-client multiplayer QA

This is the release procedure for validating Lakecraft's intentionally quota-hostile Lakebed multiplayer path. Run the deterministic protocol test first, then the production exercise with two distinct, already-authorized Google identities.

## Automated protocol preflight

```sh
node --experimental-strip-types tests/twoClientMultiplayerQa.test.ts
npx lakebed build --json
```

The first command is a deterministic capacity/state-machine preflight, not a browser wire trace. It verifies the 5 Hz/300-writes-per-player ceiling, synthetic sample-to-delivery jitter, an ideal fixed-400 ms/two-slot capacity model, remote visibility and reconnect semantics, cross-player item conservation, chat bounds, authoritative PvP, and pure guard pause/reset behavior. Its modeled fixture contains 600 presence mutations, two session starts, and six representative actions (608 total). Live Lakebed latency, query executions, visible pause timing, and control-plane reconciliation are production-only evidence.

The claimed production app currently allows 10,000 requests and only 1,000 mutations per day. A two-player continuous active-presence minute can spend up to 600 heartbeat mutations before session starts and incidental systems, while the 5 Hz shared-mob query adds roughly 600 read requests/minute; the daily mutation bucket can still be exhausted in under two minutes. That limitation is intentional evidence for this Lakebed experiment: run one bounded sustained pass and a separately metered gameplay pass after reset, preserve both, and never switch multiplayer to another transport.

## Identity prerequisite

Lakebed supports per-tab development guests such as `http://localhost:3000/?lakebed_guest=alice`, but Lakecraft intentionally rejects guest identities for usernames and shared-world mutations. Guest tabs are therefore useful for checking auth rejection only; they are not a valid end-to-end multiplayer pass.

Production validation requires two separate browser profiles that are already signed in to different Google identities. Do not share cookies, switch an account, or create an account as part of automated QA. Confirm each window shows a different Lakecraft username before continuing.

## Production procedure

1. Confirm the hosted request quota is available before opening two active clients:

   ```sh
   npx lakebed inspect https://craft.lakebed.app --json
   npx lakebed db dump https://craft.lakebed.app > /tmp/lakecraft-before.json
   npx lakebed deploy list --json > /tmp/lakecraft-quota-before.json
   ```

   If the CLI returns `lakebed_quota_exceeded`, stop. Record the bucket, current value, limit, and `resetAt`; retrying only consumes more requests.

   The `deploy list` snapshot must be the final pre-run command so diagnostics do not contaminate the baseline.

2. Open `https://craft.lakebed.app` side by side in the two authenticated browser profiles. Join the same world as distinct usernames. Turn on F3 in both windows and begin a full-desktop recording or timestamped Computer Use capture. Wait until both F3 panels show `SYNC BURST`.

3. Run the sustained cadence trace separately: both clients move and turn continuously for 60 seconds, with no chat, drops, combat, leave, or reconnect. Capture unique-heartbeat F3 server-age samples and browser-observed motion timing. Immediately save `npx lakebed deploy list --json > /tmp/lakecraft-quota-after-sustain.json`. The wire ledger—not a constant—must report the actual session, heartbeat, mob, query, and incidental operations.

4. Take a new quota baseline and run this separate gameplay/reconnect sequence. Do not use its counter delta as the sustained-5 Hz result:

   | Time | Client A | Client B | Required observation |
   | ---: | --- | --- | --- |
   | 0–10 s | Stand still and watch B | Walk, turn, jump | A sees B's nameplate and bounded smooth motion; neither client drops below the frame budget |
   | 10–20 s | Walk, turn, jump | Stand still and watch A | Symmetric movement and nameplate behavior |
   | 20–25 s | Send `qa-a-<timestamp>` | Send `qa-b-<timestamp>` at least 900 ms later | Both messages appear once, in order, in Minecraft-style chat |
   | 25–35 s | Select a two-item stack and press Q once | Walk onto the dropped item | A loses exactly one; B gains exactly one; both see the same world drop transition |
   | 35–45 s | Aim at B and attack once | Stand within four blocks | One authoritative hit is observed; cooldown spam does not add damage |
   | 45–55 s | Watch B | Leave the world, then rejoin | B disappears promptly, reconnects at its saved pose, and has one nameplate/avatar |
   | 55–60 s | Hold Tab | Hold Tab | Both player lists contain the same two unique usernames |

5. Capture evidence:

   - one side-by-side screenshot with both usernames/nameplates;
   - one screenshot of mirrored chat;
   - one screenshot before and after item transfer;
   - one screenshot of PvP health feedback;
   - F3 values from both clients: FPS, P95 frame time, draw calls, chunks, vertices, and mesh time;
   - both F3 `AGE` lines after at least ten unique remote heartbeats; report server-clock snapshot-age P50/P95 and sample count;
   - recording frame counts from the local movement start to the observer's first remote motion. Report median/P95 across at least ten direction changes; label this separately as browser-observed response.

6. Inspect state and logs once after the run:

   ```sh
   npx lakebed deploy list --json > /tmp/lakecraft-quota-after.json
   npx lakebed db dump https://craft.lakebed.app > /tmp/lakecraft-after.json
   npx lakebed logs https://craft.lakebed.app
   ```

   Reconcile each phase's measured wire operation totals against its request/mutation counter deltas with `abs(controlPlaneDelta - wireCount) / controlPlaneDelta × 100`; both errors must be at most 5%. Do not force the gameplay/reconnect script into a 608 constant: it adds another session start/heartbeat and can include cleanup, mob, inventory, and other incidental operations. Presence is an indexed upsert, so row-count growth is not a substitute for mutation accounting.

7. Preserve the per-phase quota snapshots, commit/deployment/artifact hashes, pseudonymous client IDs, UTC bounds, operation ledger, server-age samples, and separate chat/drop/PvP observations. If the actual run reaches 429, verify both clients show a persistent paused state within two seconds, produce at most one fallback presence attempt/client/minute, and recover at the displayed reset without reloading.

## Shared furnace authority check

Run this check when a furnace or inventory-authority milestone changes. Place one furnace where both authenticated clients are within interaction range, then use one shared coordinate throughout:

1. Client A opens the furnace, deposits raw ore and coal, and leaves the drawer open. Client B opens the same furnace and must see the same input/fuel state without refreshing.
2. Observe a full item cook for at least ten seconds. Both clients' arrows should advance from server-derived state and converge on one output; there must be no per-tick furnace mutation in the logs.
3. Close both clients during a second cook, wait more than ten seconds, then reopen the furnace. The output must materialize from elapsed server time even though no client remained connected.
4. Have both clients attempt a transfer from the same revision. Exactly one operation may commit; the loser must reload canonical pack and furnace state. Combined ore, fuel, and output totals must remain conserved.
6. With one drawer open for a minute, verify the Lakebed reconciliation cadence is about 0.5 Hz (approximately 30 reads) while the local progress display remains smooth at 20 Hz, and that progress alone adds zero mutations. Record the request delta separately from presence and mob sampling.

The deterministic preflight for the same invariants is:

```sh
node --test \
  tests/furnaces.test.ts \
  tests/furnaceServerAuthority.test.ts \
  tests/furnaceAuthorityClient.test.ts
```

## Release gates

- Both identities, names, avatars, chat messages, and the transferred item converge without refresh.
- Active pose publication stays at or below 300 mutations/minute/player only when another player is present; solo and idle clients fall back to one lease write/minute.
- Observed remote movement P95 is reported and no unbounded freeze occurs between snapshots.
- The item total is conserved across both inventories and the world drop.
- PvP rejects cooldown spam, reach/aim spoofing, and stale/offline targets.
- Both clients agree on mob IDs/targets and stay within 0.25 blocks; duplicate hostile-damage claims change health once and only persisted death can authorize respawn.
- Both clients converge on the same persistent furnace slots and ten-second cook progress; offline elapsed time completes cooking without background writes.
- Concurrent and retried furnace transfers conserve combined player/furnace items, commit once, and reject semantic operation-ID reuse.
- Disconnect removes the old avatar and reconnect produces exactly one avatar at the saved pose.
- Desktop rendering remains at least 55 FPS with at most 22 ms P95 frame time during the run.
- Quota exhaustion must visibly suppress retries and recover at Lakebed's reset; it must be reported, measured, and never worked around with another backend.
