# Lakebed multiplayer budget and QA

Lakebed is intentionally the only multiplayer transport. Presence, chat,
inventory, world edits, item drops, and combat must not be moved to WebSockets,
WebRTC, or another realtime service even when those choices would be easier.

## Presence budget

The client treats the currently claimed 1,000 mutations/day and 10,000
requests/day as a hard warning, even though a browser cannot see or coordinate
the deployment-wide counters.

- 100 mutations are reserved for gameplay actions.
- The common two-player case receives 450 presence attempts per participant,
  persisted in local storage for a rolling 24-hour window. Two full browser
  budgets plus the action reserve equal 1,000.
- Each participant receives 150 realtime attempts: 30 seconds at 5 Hz. Once
  spent, that participant degrades to the existing one-write-per-minute lease.
- Solo movement never enables the realtime stream. It writes the join and then
  only the sparse lease.
- A quota-like rejection pauses presence until the rolling window resets. A
  generic rejection backs off for 1 second, then 2 seconds; a third consecutive
  rejection is treated as an opaque production quota rejection and stops the
  retry loop. One successful retry clears transient backoff.
- All of this wraps the existing `heartbeatPlayer` Lakebed mutation. There is no
  polling loop or alternate transport.

This is intentionally conservative and imperfect: separate browsers cannot
share their local counters, and gameplay mutations can still consume more than
the 100-call reserve. The client guard prevents the known 5 Hz path from
silently spending 18,000 calls per player-hour; it does not pretend to be a
server-owned global quota ledger.

## User-visible telemetry

Press F3 in-world. The `SYNC` line reports:

- `SOLO`, `BURST`, `DEGRADED`, `BACKOFF`, `QUOTA_PAUSED`, or
  `BUDGET_EXHAUSTED`;
- effective cadence (`5Hz`, `1/min`, or `paused`);
- realtime attempts remaining out of 150;
- browser-day presence attempts remaining out of 450;
- confirmed calls versus attempted calls.

The HUD also emits a warning when the realtime burst degrades, a quota/retry
storm pauses presence, or the browser-day budget is exhausted.

## Deterministic regression checks

Run:

```sh
node --experimental-strip-types --test \
  tests/presenceMotion.test.ts \
  tests/twoClientMultiplayerQa.test.ts \
  tests/presenceBurstClient.test.ts
```

The simulation must show:

- two moving clients produce 300 presence calls in the first minute, not 600;
- injected network latency has P95 at or below 210 ms and no burst arrival gap
  over 335 ms;
- solo movement stays at the lease cadence;
- two complete browser-day budgets total 900, preserving 100 gameplay calls;
- realtime and session counters cannot overrun their limits;
- transient failures recover after backoff, while quota-like and repeated
  generic failures stop retry storms until the 24-hour reset.

For live QA, open two separately authenticated browser profiles, join both to
the production world, enable F3, move both clients during the burst, and confirm
remote interpolation stays smooth while `RT` counts down. Leave both clients
open past burst exhaustion and verify `SYNC DEGRADED 1/min` appears without a
new mutation loop. A real production quota rejection is opportunistic; the
deterministic tests are the required repeatable evidence for pause/recovery.
