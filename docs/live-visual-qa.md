# Integrated local-world visual QA

This is the executable post-integration route for Task 41. It verifies the
local world browser, isolated crash-safe saves, cave-lighting behavior,
single-player combat, frame/draw-call health, a clean console, zero
Singleplayer network traffic, and the strict Lakebed artifact reserve.

Do not capture final evidence from a branch that lacks the completed local
world browser. Rebase this evidence-only branch onto the integrated Task 135
commit and run the entire route against one uninterrupted `npx lakebed dev`
process. The three QA worlds are disposable browser-local data.

This run has two independently reported scopes:

- the 18-case anonymous single-player route below; and
- the multiplayer route, classified as either passed with every required
  check or wholly deferred with allowlisted reason codes.

On the current commit every `lakebed.app` hostname is deliberately routed to
Singleplayer, and no two independent authorized browser identities are
available. Record `hosted-route-disabled`,
`authorized-identities-unavailable`, and
`quota-observation-unavailable` as the ordered multiplayer reason codes.
Production quota is healthy, but it is **not observed by this anonymous local
run**.

Deferral is an honest, validator-accepted partial result; it is not a pass and
Task 41 is not complete. The evidence validator exits nonzero for that
valid-partial state. Do not relabel deferred scope as passed.

## Required setup

1. Start from a clean integrated commit and run the full automated suite.
   Capture the trusted commit from Git, not from a manifest value:

   ```sh
   expected_commit="$(git rev-parse HEAD)"
   test "$(git status --porcelain)" = ""
   ```

2. Create an evidence root outside the repository. Generate a cryptographically
   random run ID, and bind every structured report and probe snapshot to that
   same run ID and expected commit. Do not reuse an evidence root or run ID:

   ```sh
   run_id="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(16).toString("hex"))')"
   ```

3. Start `npx lakebed dev` and keep that exact process alive for the whole
   route. Record its anonymous local target URL and start time. Do not sign in,
   deploy, mutate production, or point the route at a hosted capsule.
4. Use one Chromium-family browser profile with extensions disabled. Record
   its name and full version. Verify that `ffprobe` and `ffmpeg` are available
   on the validation host:

   ```sh
   command -v ffprobe
   command -v ffmpeg
   ```

   The validator uses `ffprobe` to identify the real video stream, dimensions,
   and duration, then uses `ffmpeg` to decode at least one frame. Container
   magic, padding, renamed files, and metadata-only stubs are rejected.
5. In DevTools, disable cache and enable Preserve log. Load the title screen.
   Immediately before the first **Singleplayer** action, clear Console and
   Network and use that one timestamp for both `runStartedAt` and the first
   measured segment's `startedAt`
   (`segments[0].startedAt === runStartedAt`). There is no unmeasured prefix.
   Capture an ordered series of measured Singleplayer interaction segments.
   End and export a segment before every required navigation or reload. The
   navigation/reload alone forms the intervening gap; after the new page is
   ready, clear and start the next segment at the exact gap completion time.
   A gap may contain its local document navigation request, but it must contain
   no app request or newly opened app socket. Use 4–32 uniquely named,
   descriptive segments. Between every adjacent pair, record exactly one
   `navigation` or `reload` gap whose `afterSegmentId` and `beforeSegmentId`
   name those exact neighbors.

   Every measured segment must have zero app requests and zero newly opened
   WebSockets. Tooling traffic and the development-server WebSocket opened
   before a measured segment belong to its preceding gap, but any request or
   socket opened during a measured interaction segment fails the run.
   Immediately after the final world interaction, end the final measured
   browser segment and use its exact `completedAt` as `runCompletedAt`
   (`segments.at(-1).completedAt === runCompletedAt`), leaving no unmeasured
   suffix in the live route. Do not hold the browser segment open for report
   serialization, artifact builds, or validation.
6. Keep every screenshot, recording, transcript, JSON snapshot, console
   report, CDP network report, build report, artifact, and staged bundle
   beneath the one evidence root. Every regular file there must be referenced
   by the manifest (except the manifest and requested validator output); the
   validator rejects extra or missing files.
7. Re-run `git rev-parse HEAD` after interaction and after both builds. If it
   differs from the trusted expected commit, restart the route. Also restart if
   any live evidence timestamp falls outside `runStartedAt` through
   `runCompletedAt`; post-run derived timestamps follow the packaging rules
   below instead. The run must last at least five minutes and no more than six
   hours. Finish evidence packaging within six hours after `runCompletedAt`.
   At validation, `packagedCompletedAt` may be no more than 60 seconds in the
   future and no more than six hours old.

Every live screenshot, video, transcript, performance capture, storage event,
multiplayer event, identity proof, and interaction proof interval from
`capturedAt` through `completedAt` must fall inside one measured segment. No
live evidence may be captured in a navigation/reload gap or outside the
first/last segment boundaries. Every bounded proof window and every nested
action, frame, telemetry, or event timestamp must also remain wholly inside a
measured segment; a proof may not span or land in a gap. Every measured segment
must contain at least one bound live evidence capture.

After `runCompletedAt`, serialize the complete Console and Network reports from
the frozen collectors. Their timelines still cover exactly
`runStartedAt` through `runCompletedAt`; only their report-generation
timestamps are post-run. Then perform both deterministic artifact builds,
package the remaining evidence in order, and validate before the freshness
deadline. Derived Console/Network reports and build artifacts bind the same run
ID and expected commit, but their post-run generation/package times are not
live capture intervals and must not be placed inside a measured segment.

All evidence files retain `capturedAt` and `completedAt`, with
`completedAt >= capturedAt`. For live evidence, those fields are the
segment-bound capture interval. For derived Console, Network, and artifact
files, they are the post-run generation interval. Set manifest
`packagedCompletedAt` after build B and all packaging finish. Derived intervals
are nonoverlapping and ordered:

1. Console report
2. Network report
3. artifact build A
4. artifact build B

Console starts no earlier than `runCompletedAt`; each next derived
`capturedAt` is greater than or equal to the preceding derived `completedAt`;
and every derived interval ends no later than `packagedCompletedAt`. Require
`packagedCompletedAt >= runCompletedAt` and
`packagedCompletedAt - runCompletedAt` of at most six hours. Preserve the
canonical manifest sequence chronology: observations, performance captures,
storage, multiplayer, Console, Network, build A, then build B. Do not backdate
a generated report or build.

Generate the strict evidence manifest before testing. The marked block is
parsed by `tests/liveVisualQaEvidence.test.mjs`; do not add another command or
move text inside its markers.

<!-- task41-evidence-template:start -->
```sh
node scripts/validate-live-qa-evidence.mjs --template > /tmp/lakecraft-task41-evidence.json
```
<!-- task41-evidence-template:end -->

Replace every `PENDING` value as evidence is collected. A case is not a pass
until its required viewport and evidence kind are present with SHA-256 hashes.
Screenshots must be real PNG files whose decoded dimensions equal the declared
viewport multiplied by the device-pixel ratio. Recordings must be real WebM or
MP4 files whose parsed dimensions obey the same rule and whose parsed duration
is from one second through six hours. Every visual or transcript observation
must name a unique file and hash; do not reuse a generic screenshot,
transcript, or recording for multiple entries. Transcripts are structured JSON
with ordered
named-action records containing timestamp, pass status, and detail, not prose
placeholders. Console/CDP, Network/WebSocket,
storage, and multiplayer results are separate structured JSON reports bound to
the same run ID and commit; the two actual Lakebed JSON build outputs are bound
by the artifact manifest section. The validator rejects stale, incomplete,
reordered, duplicated, extra, mislabeled, or media-spoofed evidence.

## Browser probe

Create a DevTools Snippet from `scripts/task41-browser-probe.js`. Because a
reload destroys the page and its probe, install and bind it after the final
required world-browser reload and before the first performance capture. Do so
in the gap before starting the next measured interaction segment, so its
informational installation message is outside that segment. If another reload
becomes necessary, end/export the current segment, preserve the next run-wide
capture sequence externally, then reinstall and rebind the probe during the
gap before resuming.

The probe wraps the existing WebGL draw methods without short-circuiting them
and samples animation frames; it does not alter app source or the deploy
artifact. Its Console info message must report one or two patched context
prototypes. Bind each installation using the same run ID and trusted Git
commit:

```js
window.__lakecraftTask41Probe.bind({
  runId: "<32-lowercase-hex-run-id>",
  appCommit: "<40-lowercase-hex-expected-commit>",
});
```

The probe refuses an unbound capture, a different later binding, an unknown
scene, a mismatched CSS viewport/device-pixel ratio, a hidden or unfocused
document, or a reused capture sequence. `reset()` records the current visible,
focused viewport contract. Every animation-frame sample includes its sequence,
canonical timestamp, visibility, focus state, exact viewport ID (`desktop` =
1280 × 720 or `narrow` = 800 × 720), and DPR. Sampling fails rather than
silently accepting a backgrounded tab or a viewport change, and `snapshot()`
rechecks the same invariants.

For each performance scene:

1. Reach a stable camera pose and stop interacting.
2. Run `window.__lakecraftTask41Probe.reset()`.
3. Wait at least five seconds and at least 120 animation frames.
4. Allocate the next positive sequence from the run-wide evidence ledger, then
   assign and save the complete result:

   ```js
   const capture = window.__lakecraftTask41Probe.snapshot(
     "desktop/surface-day",
     sequence,
   );
   ```

   Replace the label with the current viewport and scene. The saved JSON is the
   immutable raw-frame evidence. Its top-level `capturedAt` and `completedAt`
   bound the sample window, and every frame timestamp must remain within that
   same measured interaction segment. Do not save only a Console preview.
5. Run `window.__lakecraftTask41Probe.summarize(capture)` on that saved capture
   and copy the returned aggregates into its manifest performance row. The
   validator recomputes those aggregates from the raw frames.

The manifest requires all six scenes at both viewports, at least 45 FPS, p95
frame time no greater than 33.4 ms, and a nonzero p95 draw-call count. A
capture below those thresholds is a failure to diagnose, not a value to round
up.

## Fixed disposable worlds

At 1280 × 720, create these worlds in this order. Record the storage ID assigned
to each world in the manifest.

| Role | Name | Seed | Initial mode |
| --- | --- | ---: | --- |
| survival | QA Survival | 41001 | Survival |
| creative | QA Creative | 41002 | Creative |
| fault | QA Fault | 41003 | Survival |

For every world, create three distinct persistent markers and write their exact
descriptions in the manifest:

- an edit marker: a conspicuous block pattern at a recorded coordinate;
- an inventory marker: a unique carried item/count;
- a container marker: a unique chest item/count.

Do not reuse a marker between worlds. Saving and reloading must prove all nine
markers remain associated only with their owning world.

## World-browser route

Run these checks first at 1280 × 720, then repeat the viewport-dependent
interactions at 800 × 720 without browser zoom.

1. On **Select World**, verify the search field sits left of
   **Create New World**, every compact row shows only its world name and
   last-played time, and each right-aligned **Delete** button fits without
   horizontal clipping or offset text shadows.
2. Search separately for `Survival`, `Creative`, and `Fault`. Each query must
   produce the expected world only. Clear search, single-click a row to select
   it, press Enter on a focused row to play it, then return and double-click
   another row to play it.
3. Enter QA Survival. Verify Survival restrictions, then use the command
   console to switch to Creative and back to Survival. Enter QA Creative and
   verify its initial mode, then switch to Survival and back to Creative.
4. Build and store that world's three markers. Continue active play until the
   pause menu's **Last autosaved** time advances, then use
   **Save and Quit to Title**. It must finalize another verified save and
   return to **Select World**, not the multiplayer directory or an empty
   gameplay shell.
5. Reopen every world and compare its edit, carried inventory, and container
   contents with the manifest. No marker from either sibling may appear.
6. Reload the browser between saves and repeat the three-world check. This is
   the crash-safe/restart boundary, not merely an in-memory world switch.

### Corrupt only the fault world

Before fault injection, create the sanitized storage summary required by the
manifest. Obtain the three IDs from the selected valid registry envelope, then
address storage only through those exact IDs and the two fixed registry slot
names. Never infer an ID from its display name, use browser-storage enumeration
APIs, copy a storage prefix, or inspect foreign origin data. Capture this
report while all three worlds are healthy or recovered and all nine
persistence markers have been confirmed; then keep it immutable.

The summary must contain exactly QA Survival, QA Creative, and QA Fault. For
each ID, read only these four expected keys:

```text
lakecraft.singleplayer.world.<ID>.v1
lakecraft.singleplayer.world.<ID>.save.head
lakecraft.singleplayer.world.<ID>.save.a
lakecraft.singleplayer.world.<ID>.save.b
```

The registry input is limited to
`lakecraft.singleplayer.worlds.a` and
`lakecraft.singleplayer.worlds.b`; do not read the legacy transaction keys or
any discovered key. For each expected registry/save key, record only:

- the exact key name;
- the value's character length and SHA-256;
- the UI-reported health state; and
- booleans stating whether the edit, inventory, and container markers were
  observed.

Use the validator template's binding values and this exact per-world topology,
in survival/creative/fault order:

```json
{
  "role": "survival",
  "worldId": "<exact-id>",
  "registered": true,
  "uiHealth": "healthy",
  "markers": {
    "editPersisted": true,
    "inventoryPersisted": true,
    "containerPersisted": true
  },
  "keys": [
    { "name": "<exact .v1 key>", "present": false, "length": 0, "sha256": null },
    { "name": "<exact .save.head key>", "present": true, "length": 1, "sha256": "<sha256>" },
    { "name": "<exact .save.a key>", "present": true, "length": 1, "sha256": "<sha256>" },
    { "name": "<exact .save.b key>", "present": false, "length": 0, "sha256": null }
  ]
}
```

`uiHealth` may be `healthy` or `recovered`. A present key has a positive
length and lowercase SHA-256; an absent key has exactly zero length and a null
hash. At least one crash-safe save slot must be present for each world.

Never record or export a raw localStorage value, parsed save payload, inventory
contents, player data, corrupt string, or unrelated key. A hash and length are
enough to bind the storage state without leaking its contents.

Set only these two values to invalid JSON, substituting the recorded ID:

```text
lakecraft.singleplayer.world.<QA_FAULT_ID>.save.a
lakecraft.singleplayer.world.<QA_FAULT_ID>.save.b
```

Reload. QA Fault must remain isolated and be unable to damage or hide QA
Survival and QA Creative. Open both healthy worlds and prove their six
surviving markers still match. Never save the corrupt values themselves or
overwrite the earlier bound healthy storage summary. Delete QA Fault through
the typed-confirmation flow, then recreate it with the original seed and mode
before continuing.

### Capacity boundary

After QA Fault is healthy again, replace one target save-slot value with more
than 150,000 characters and reload. Do not export that injected value.
Double-click and Enter must not open the unsafe fault world; the other two
worlds must remain searchable and playable. Delete and recreate QA Fault, then
confirm storage returns to a healthy state. Do not fill the entire origin
quota, because that would invalidate the isolation check.

### Delete modal keyboard, phrase, and focus

With QA Fault selected:

1. Open its right-aligned **Delete** control. The dialog must name QA Fault and
   initial focus must be in the confirmation input. Tab and Shift+Tab must
   remain trapped inside the modal; Escape must cancel and restore focus to
   that row's Delete trigger.
2. Reopen it. Enter near-matches, capitalization changes, leading/trailing
   whitespace, and partial text; **Delete World** must remain disabled.
3. Type exactly `yes, I want to delete this world`. **Delete World** must
   become enabled. Submit it and confirm QA Fault disappears while the other
   two rows and saves remain healthy; focus must fall back to the
   **Select World** heading because the opener was removed.

Use a continuous recording for these keyboard/focus checks at each viewport.

## Cave-lighting route

Use QA Creative. Build a repeatable stone test structure that crosses both an
X and Z multiple-of-eight chunk seam:

- a daylight-exposed surface pad;
- a fully roofed and walled cave with no sky path;
- an adjacent room with a one-block-wide vertical shaft open to the sky;
- one seam wall or roof block whose removal opens the cave and whose
  replacement encloses it again;
- one torch inside the enclosed cave to prove emissive light is preserved.

Record coordinates and a plan screenshot. Keep the camera pose and exposure
setting fixed between paired captures.

1. In daytime, capture the surface, open shaft floor, roofed cave, and torch.
   Surface must be brightest, shaft light must propagate downward, the roofed
   cave must remain dark except for local emissive light, and seams must not
   show a lighting discontinuity.
2. Repeat at night. Surface and shaft skylight must dim with the sky cycle;
   the enclosed cave must not receive global night tint or brighten because
   its roof is present.
3. Record removing and replacing the seam block. Lighting must invalidate on
   both sides of the chunk boundary without a reload or visible stuck seam.
4. Start a continuous recording before dawn with the surface and roofed cave
   both observable through a fixed route. As dawn advances, surface and
   open-shaft skylight may brighten; the enclosed, non-emissive cave must not
   globally brighten.

The default day/night cycle is eight minutes, so a half-cycle wait can take up
to four minutes. Do not use a source-only assertion or post-process brightness
to substitute for the live paired captures.

Collect probe snapshots for `surface-day`, `roofed-cave-day`,
`open-shaft-day`, `surface-night`, `roofed-cave-night`, and
`open-shaft-night` at both viewports. The scene must visibly render during
each sampling window.

## Combat regression

Run the route in `docs/creative-combat-qa.md` in QA Creative. Capture the
following as separate cases at both viewports:

- melee hit/miss, armor mitigation/wear, and solid hostile/explosion cover;
- manual TNT ignition, shortened adjacent TNT fuse, single explosions, and
  cover/armor behavior;
- bow draw stages, cancel-without-consumption, partial/full releases,
  projectile hit, and no-ammunition prevention.

Do not skip Survival mode for consumption, durability, damage, or death
observations. The viewport must remain usable without clipped hotbar, HUD,
modal, or command-console controls.

## Multiplayer scope

The multiplayer report has one scope status: `passed` or `deferred`. A passed
report must contain these ordered passing checks:

1. `distinct-identities`
2. `hosted-route`
3. `movement-nameplates`
4. `chat`
5. `item-sharing`
6. `pvp`
7. `reconnect`
8. `quota-accounting`

Passed evidence must use exactly two distinct SHA-256 identity hashes; never
store account names, email addresses, tokens, cookies, or other identity data.
Each hash must be derived from a run-salted proof record and stored in its own
unique evidence file. The two proof records must demonstrate:

- overlapping active session windows;
- each identity seeing the other's hashed peer identity;
- reciprocal peer visibility;
- at least one successful interaction in each direction;
- positive quota attempts and positive granted operations while not paused;
  and
- all attempts and grants remaining within the documented quota.

The hosted route must be enabled and quota must be observed healthy. Behavior
transcripts may add sustained cadence, remote-pose percentiles, quota
reconciliation, retry suppression, and recovery details. Identity proof from
non-overlapping sessions, a one-way observer, paused/background samples, zero
attempts, or zero grants is not a pass.

Use the fixed ordered identity IDs `identity-a` and `identity-b`. Each manifest
identity includes `identityCommitment`, `runSaltedIdentityHash`,
`windowStartedAt`, `windowCompletedAt`, `proofPath`, and `proofSha256`.
`runSaltedIdentityHash` is the `sha256:` hash of the UTF-8 string
`<runId>:<identityCommitment>`. Each active window lasts 60 seconds through 30
minutes, and the two windows overlap for at least 60 seconds. Its
schema-version 1 proof repeats that binding, names only the other fixed ID in
`peerVisibilityIds`, and contains 2–3,600 ordered `quotaTelemetry` rows with
`sequence`, `timestamp`, monotonic `attempts`, monotonic `grants`, and
`paused: false`. Attempts may not exceed grants; final attempts and grants are
positive and the session observes a positive delta.

Use exactly two manifest interaction summaries:
`identity-a-to-b` and `identity-b-to-a`, each with fixed actor/target IDs and a
unique proof path/hash. Each schema-version 1 interaction proof is bound to the
run and both identity windows and contains these ordered passing event kinds:
`movement-nameplate`, `chat`, `item-sharing`, `pvp`, and `reconnect`.

For this commit, set the whole scope to `deferred`, keep `identities` and
`interactions` empty, and use the ordered reason codes
`hosted-route-disabled`, `authorized-identities-unavailable`, and
`quota-observation-unavailable`. Report the independently checked production
quota as healthy context with `quotaObserved: false`: a quota snapshot is not
an observed two-client traffic or degradation trace. Never perform production
mutations merely to turn this partial run into a pass.

## Console and network

At the end of every measured interaction segment:

- End and export that segment before the next navigation/reload gap.
- Its structured combined Console/CDP entries must show zero errors, warnings,
  uncaught exceptions, and unhandled rejections. Entries remain ordered and
  identify `console` or `cdp` source and level so the validator can recompute
  all four counts.
- Its structured Network/WebSocket events must show zero app HTTP requests,
  zero Lakebed requests, and zero newly opened WebSockets. Keep the raw ordered
  CDP events so the validator can recompute every segment and aggregate.

The reports list measured segments and explicit intervening navigation/reload
gaps in chronological, contiguous order: each gap starts exactly when the
preceding segment completes, and the next segment starts exactly when that gap
completes. No unclassified time may hide traffic. Only gaps may contain a
reload or navigation; measured segments may not. Console and Network reports
must use identical IDs, kinds, and timestamps for the full timeline. Every gap
contains one or more ordered local `document` navigation requests and zero
`appRequests` or `newSockets`; this allowed navigation is not smuggled into a
measured segment. Clear and restart both collectors only after the new page is
ready. Probe installation/reinstallation also occurs in a gap, so its
informational Console message may appear in the ordered gap entries but not in
a cleared measured segment.

Console cleanliness covers the whole contiguous route, including gap entries:
warnings, errors, exceptions, and unhandled rejections are all zero in both
segments and gaps. Network treatment is intentionally different only for the
gap's local document navigation; no gap may contain app traffic or a newly
opened app socket.

At the final interaction boundary, stop both collectors before setting
`runCompletedAt`; their last segment must end at that same instant. Serialize
the complete reports afterward. Each report's post-run generation interval
(`capturedAt` through `completedAt`) starts no earlier than `runCompletedAt`,
while its embedded coverage still begins at `runStartedAt` and ends at
`runCompletedAt`. Serialization must not add, omit, stretch, or retime a
segment or gap.

Development-server WebSocket traffic is outside the cleared Singleplayer
capture segment only when opened before that segment.
A Vite/Lakebed dev-server WebSocket opened before the boundary of a measured
segment is pre-boundary tooling and does not invalidate that segment or count
as an app `newSocket`; a new app socket opened after the boundary does.

Any measured-segment request, new socket, uncaught error, page error, or warning
fails the run. Bind every segment and aggregate report to the same run ID,
expected commit, and run interval; record counts in the manifest and hash the
reports.

## Deterministic compact artifact

After the last integrated live interaction has closed the final measured
segment and fixed `runCompletedAt`, build from two independent archives of the
trusted expected commit. These are post-run derived artifacts; do not extend or
rewrite the browser timeline around them, and do not stage from the mutable
current filesystem. Retain both full Lakebed JSON reports, artifacts, and
staged client/server entrypoints in the evidence root:

```sh
repo_root="$(git rev-parse --show-toplevel)"
archive_a="$(mktemp -d)"
archive_b="$(mktemp -d)"
evidence_parent="$(mktemp -d)"
git -C "$repo_root" archive "$expected_commit" | tar -x -C "$archive_a"
git -C "$repo_root" archive "$expected_commit" | tar -x -C "$archive_b"
(cd "$archive_a" && node scripts/build-lakebed-audit.mjs "$evidence_parent/build-a")
(cd "$archive_b" && node scripts/build-lakebed-audit.mjs "$evidence_parent/build-b")
```

Run `scripts/check-lakebed-artifact-size.mjs` on each artifact. Both artifacts,
both staged `staged/client-index.tsx` files, and both staged
`staged/server-index.ts` files
must be byte-identical. The artifact must remain below 1,048,576 bytes with at
least 32,768 bytes of headroom. Record the Lakebed artifact and client-bundle
hashes from the JSON output, plus ordinary file SHA-256 values.

Each output contains the raw `build-report.json`, verified `artifact.json`,
staged sources under non-capsule filenames, sanitized
`staged/lakebed.audit.json`, and wrapper
`summary.json`. The raw reports remain the structured Lakebed build reports. The
manifest binds their paths and hashes to the run ID and expected commit, and
the validator requires the complete Lakebed `source.files` set, independently
recomputes the anonymous artifact target and hashes, creates its own
deterministic `git archive` of the exact expected commit beneath the trusted
repository root, runs the repository's prepare step, and compares that rebuild
with the captured artifacts and full staged sources. Dirty working-tree files,
current-filesystem substitution, a partial `source.files` report, and staged
source drift all fail. Do not replace the Lakebed reports with prose or a
fabricated wrapper report.

Finally, place the completed manifest in the evidence root and validate it
against the trusted commit captured before testing:

After build B and manifest assembly are complete, set
`packagedCompletedAt` to that packaging-completion instant. Do not mutate the
evidence package afterward except for the validator output path.

```sh
node scripts/validate-live-qa-evidence.mjs \
  /absolute/path/to/evidence/task41-evidence.json \
  --root /absolute/path/to/evidence \
  --repo-root "$repo_root" \
  --expected-commit "$expected_commit" \
  --validator-output /absolute/path/to/evidence/validator-output.json
```

The command exits `0` only for complete evidence. With the current mandatory
multiplayer deferrals it must identify `valid-partial` with process exit 2;
keep that output with the run and leave Task 41 open. Process exit 1 means invalid
evidence, not a deferral.

## Canonical case ledger

The marked table is parsed as an ordered contract. Every row is mandatory.

<!-- task41-cases:start -->
| Case ID | Required proof |
| --- | --- |
| `world-create-search-select` | Screenshot evidence at both viewports |
| `world-modes-and-commands` | Screenshot and command transcript across both viewports |
| `world-save-quit-return` | Continuous video at both viewports |
| `world-state-isolation` | Three-world edit/inventory/container screenshots at both viewports |
| `world-corruption-isolation` | Corrupt-one/healthy-two screenshots at both viewports |
| `world-reset-delete-keyboard-focus` | Keyboard and focus video at both viewports |
| `world-capacity-boundary` | Target-only limit screenshots at both viewports |
| `cave-day-surface-shaft-roofed` | Day comparison screenshots at both viewports |
| `cave-night-surface-shaft-roofed` | Night comparison screenshots at both viewports |
| `cave-seam-edit-invalidation` | Cross-seam edit video at both viewports |
| `cave-dawn-no-global-brightening` | Fixed-route dawn video at desktop |
| `performance-draw-frame` | Probe JSON for six scenes at both viewports |
| `combat-melee-armor-cover` | Combat video at both viewports |
| `combat-tnt-chain` | TNT video at both viewports |
| `combat-bow` | Bow video at both viewports |
| `console-clean` | Structured Console/CDP JSON and zero error/warning/exception counts |
| `singleplayer-zero-network` | Structured CDP network/WebSocket JSON and zero counts |
| `artifact-reserve-determinism` | Two byte-identical compact builds with strict reserve |
<!-- task41-cases:end -->

If a required observation cannot be reproduced, leave its status pending,
preserve the failing evidence, and report the blocker. A pending or failed
single-player case is invalid, not valid-partial. Only the validator's
allowlisted multiplayer deferrals may produce valid-partial. Never edit the
validator or thresholds to make a failing integrated run pass.
