# Sustained presence and quota-recovery evidence · 2026-07-15

Lakebed is the only synchronization transport in every scenario below. The
fault scenario injects only a Lakebed-shaped quota result into the shared
client guard; it does not store, forward, or synchronize game state elsewhere.

## Repeatable deterministic run

Command:

```sh
node --test tests/presenceMotion.test.ts tests/twoClientMultiplayerQa.test.ts tests/presenceBurstClient.test.ts
```

Result at `2026-07-15T07:52:10Z`:

| Measurement | Result | Gate |
| --- | ---: | ---: |
| Sustained duration | 60 s | >= 60 s |
| Active heartbeat mutations | 600 total / 300 per client | 5 Hz/client |
| Session-start mutations | 2 | explicitly counted |
| Representative chat/drop/pickup/PvP/leave mutations | 6 | explicitly counted |
| Modeled deterministic operations | 608 | scenario self-check |
| Synthetic sample-to-delivery P50 / P95 | 100 ms / 210 ms | capacity model only |
| Maximum arrival gap | 270 ms | <= 335 ms |
| Synthetic fixed 400 ms round-trip capacity | 300 writes, max 2 in flight | 300 / <= 2 |
| Pure guard transition after injected 429 | immediate | state-machine proof |
| Presence attempts during one paused minute | 0/client | <= 1/client |
| Recovery | same guard at exact reset | no reload |

These deterministic measurements do not claim a browser wire capture, live
Lakebed latency, visible two-client pause timing, or production quota-counter
reconciliation. Those remain in the production gate below.

The action fixtures separately prove normalized chat, Alice dropping two
diamonds, Bob picking up exactly those two diamonds, and one authoritative
iron-sword hit reducing Bob from 20 to 14 health. They are correctness evidence,
not synthetic latency claims.

The full repository suite passed 86/86 tests. The anonymous Lakebed build
reported artifact hash
`sha256:538dd9518336e60ccd437b530f1268188971e21e83b3b24ebe9fa3a913ea9f86`
and client bundle hash
`sha256:bfa2ca1eede11e051884994726874ff87c0be84b8e15a42214778f5efca8cdec`.

## Production gate before reset

`npx lakebed deploy list --json` at `2026-07-15T07:52Z` reported:

- deployment `dep_GeGTYPSk0TrcWk9E`;
- `requestsToday = 10,049` against the 10,000 request limit;
- `mutationsToday = 463` against the 1,000 mutation limit;
- deployed artifact before this change:
  `sha256:505c3275de5ac40757b49c50f4d645427622385c2204bb3029ab9b7c13758839`.

The authenticated two-client production trace, actual browser error-envelope
capture, live request/mutation reconciliation, and production chat/item/PvP
latency evidence remain gated until Lakebed's exact bucket reset at
`2026-07-16T00:00:00.000Z`. This is an external Lakebed quota gate; another
multiplayer backend is explicitly prohibited.
