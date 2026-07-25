# Lakebed-only batched multiplayer sync

Lakecraft intentionally does **not** add a realtime backend. The claimed
Lakebed deployment currently exposes 10,000 requests and 1,000 mutations per
UTC calendar day. Those are deployment-wide buckets, not per-user allowances.
The exact reset observed in production is midnight UTC.

That makes ordinary game networking impossible. Ten players publishing at 1
Hz spend 1,000 mutations in 100 seconds; at 5 Hz they spend them in 20 seconds.
Ten players polling at 1 Hz spend 10,000 requests in 16 minutes 40 seconds.
Batching reduces payload overhead, but it cannot change those call counts.

## Daily budget

The motion protocol reserves 400 mutations for sparse authority leases, mob
checkpoints, joins, chat, world changes, inventory, item transfer, combat, and
other authoritative actions. It assigns
at most 600 mutations to visual motion batches. It reserves 1,000 requests for
the rest of the app and assigns at most 9,000 to proximity-composite snapshots.
Failed attempts count against the browser grant so a flaky connection cannot
form a retry storm. A Lakebed 429 pauses both paths until its reset timestamp.

The plan is computed from players × session length × sessions per UTC day:

| Envelope | Motion publish | Composite read | Motion calls | Read calls | User-visible tradeoff |
| --- | ---: | ---: | ---: | ---: | --- |
| 5 players × 10 min × 1 | 5 s | 334 ms | 600 | 9,000 | delayed but recognizably interactive showcase |
| 10 players × 30 min × 1 | 30 s | 2 s | 600 | 9,000 | long delayed bursts; exploration/chat, not fair combat |
| 10 players × 2 h × 1 | 120 s | 8 s | 600 | 9,000 | presence only; motion is badly stale |

These are maximum envelopes assuming no other sessions that UTC day. Two
planned sessions double the intervals. The UI must show the granted interval,
attempts remaining, remote staleness, and quota-paused state. It must never
label the 30-second or 120-second modes “realtime.”

The useful target is therefore a short scheduled session, not all-day realtime
service. A higher Lakebed quota would improve cadence linearly without changing
the protocol.

## Wire model

Each client samples locally without network traffic. It quantizes position to
1/32 block, angles to 1/1024 turn, and time to 50 ms. Collinear samples can be
coalesced into a bounded batch of at most 128 keyframes and 64 visual actions
covering at most 30 seconds. Actions are animation facts such as swing, jump,
crouch, selected slot, and bow draw/release. They cannot change health,
inventory, blocks, drops, or survival state. The server runs the final pose of
every accepted batch through the same bounded presence-trajectory rule used by
heartbeats. A recent retained final pose can then locate a PvP target; the
attacker still needs a serialized action-time authority heartbeat and the
combat mutation still owns aim, reach, cooldown, damage, armor, and durability.

The server strictly decodes the batch, rejects unknown keys/coercions/oversize
arrays/non-monotonic samples, binds it to `ctx.auth`, and accepts only the next
contiguous sequence. An operation ID plus canonical fingerprint makes exact
retry idempotent and rejects operation-ID collisions. Receipts are limited to
32 for 15 minutes. Motion history is limited to eight rows per player and 15
minutes. Authoritative world, item, inventory, and combat mutations keep their
own operation IDs and validation.

One proximity-composite query returns all nearby players' retained batches and
latest canonical pose. It replaces per-player queries; the caller spends one
request, not one request per neighbor. It is sampled only at the granted read
cadence.

## Remote presentation

The receiver anchors relative sample times to Lakebed's acceptance time,
interpolates behind the newest frame by 300 ms, and catches up at a bounded
1–4× speed. It extrapolates for at most 750 ms. After 15 seconds without a new
batch it freezes and marks the avatar stale. Joining mid-session starts near
the latest pose rather than replaying minutes of history. Visual actions emit
once as their sequence crosses the replay cursor. Swing/use and bow draw/release
drive the remote avatar's arm instead of disappearing inside the replay layer.

This hides ordinary jitter and makes a five-second showcase batch look like a
short delayed recording. It cannot hide a 30-second publication delay; target
location may come from recent server-retained motion, but hit resolution never
comes from client visual action claims.

## Traffic gates

There are zero segment calls in true single-player, while signed out, paused,
or while the document is hidden/unfocused. With no nearby peer, pose mutations
stop; only a sparse discovery composite read may run. Quota exhaustion stops
all attempts until reset. Calls are serialized with one frozen operation ID per
retry, and attempts—not successes—debit the local grant.

The deployment-wide ceiling cannot be perfectly coordinated by ten browsers.
The server rejects *accepted* motion writes after the shared 600-write
allocation is spent, while browser grants debit every attempt before transport.
Lakebed queries are read-only, so no application-level query can atomically
increment a deployment-wide read counter; Lakebed's hard 10,000-request ceiling
remains the final read guard. Invalid calls and exact retries still consume
platform calls, so this is cooperative containment, not a mathematical hard
guarantee against modified or malicious clients.

The current runtime deliberately plans for one ten-player, ten-minute showcase.
Longer envelopes in the table illustrate degradation, not the default runtime.
Because one batch covers at most 30 seconds, a 120-second publication envelope
retains only its newest 30-second history window and must be labeled severely
stale rather than realtime.
