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
   its name and full version.
5. In DevTools, disable cache and enable Preserve log. Load the title screen.
   Tooling traffic used to load the page and install the probe is outside the
   measured Singleplayer boundary. Immediately before choosing
   **Singleplayer**, clear Console and Network, start the structured combined
   Console/CDP and Network/WebSocket reports, and record that instant as
   `runStartedAt`. Do not clear or restart them again. Stop the captures after
   the final world interaction, then finish the paired builds and record
   `runCompletedAt`. The zero-network claim applies only from the cleared
   Singleplayer boundary through the stopped capture; the dev-server WebSocket
   or other tooling traffic before that boundary must not be counted as
   Singleplayer app traffic.
6. Keep every screenshot, recording, transcript, JSON snapshot, console
   report, CDP network report, build report, artifact, and staged bundle
   beneath the one evidence root. Every regular file there must be referenced
   by the manifest (except the manifest and requested validator output); the
   validator rejects extra or missing files.
7. Re-run `git rev-parse HEAD` after interaction and after both builds. If it
   differs from the trusted expected commit, or any evidence timestamp is
   outside `runStartedAt` through `runCompletedAt`, restart the route. Finish
   within eight hours and validate within 24 hours.

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

Create a DevTools Snippet from
`scripts/task41-browser-probe.js` and run it once on the title screen before
opening Singleplayer. It wraps the existing WebGL draw methods without
short-circuiting them and samples animation frames; it does not alter app
source or the deploy artifact. The Console info message must report one or two
patched context prototypes. Bind the probe once, using the run ID and trusted
Git commit captured during setup:

```js
window.__lakecraftTask41Probe.bind({
  runId: "<32-lowercase-hex-run-id>",
  appCommit: "<40-lowercase-hex-expected-commit>",
});
```

The probe refuses an unbound capture, a different later binding, an unknown
scene, a mismatched CSS viewport, or a reused capture sequence.

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
   immutable raw-frame evidence; do not save only a Console preview.
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

1. On **Select World**, verify the list, search field, selected-row treatment,
   **Play World**, **Create New World**, **Reset World…**, and
   **Delete World…** fit without horizontal clipping.
2. Search separately for `Survival`, `Creative`, and `Fault`. Each query must
   produce the expected world only. Clear search, use Home/End and arrow keys
   to move selection, and activate the selected world from the keyboard.
3. Enter QA Survival. Verify Survival restrictions, then use the command
   console to switch to Creative and back to Survival. Enter QA Creative and
   verify its initial mode, then switch to Survival and back to Creative.
4. Build and store that world's three markers. Use **Save World**, then
   **Save and Quit to Title**. The latter must return to **Select World**, not
   the multiplayer directory or an empty gameplay shell.
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

Reload. QA Fault must show a corrupt-save health state and be unable to damage
or hide QA Survival and QA Creative. Open both healthy worlds and prove their
six surviving markers still match. Never save the corrupt values themselves
or overwrite the earlier bound healthy storage summary. Reset QA Fault through
the UI before continuing.

### Capacity boundary

After QA Fault is healthy again, replace one target save-slot value with more
than 150,000 characters and reload. Do not export that injected value. The
fault world must show the storage-limit state and its unsafe **Play World**
action must be disabled; the other two worlds must remain searchable and
playable. Reset QA Fault through the UI and confirm storage returns to a
healthy state. Do not fill the entire origin quota, because that would
invalidate the isolation check.

### Reset/delete modal keyboard and focus

With QA Fault selected:

1. Open **Reset World…**. Initial focus must be on **Cancel**. Tab and
   Shift+Tab must remain trapped inside the modal; Escape must cancel and
   restore focus to the reset trigger.
2. Reopen it and choose **Confirm Reset**. The world remains listed with fresh
   state, and its former three markers are absent.
3. Open **Delete World…**. Repeat initial-focus, Tab-trap, Escape, and
   focus-restoration checks.
4. Reopen and choose **Confirm Delete**. QA Fault disappears while the other
   two rows, saves, and selection behavior remain healthy.

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
It must also prove the hosted route is enabled and the quota was observed
healthy. The behavior transcripts may include the sustained cadence,
remote-pose percentiles, quota reconciliation, retry suppression, and recovery
details.

For this commit, set the whole scope to `deferred`, keep `checks` and
`identityHashes` empty, and use the ordered reason codes
`hosted-route-disabled`, `authorized-identities-unavailable`, and
`quota-observation-unavailable`. Report the independently checked production
quota as healthy context with `quotaObserved: false`: a quota snapshot is not
an observed two-client traffic or degradation trace. Never perform production
mutations merely to turn this partial run into a pass.

## Console and network

At the end of the route:

- The structured combined Console/CDP report must show zero errors, warnings,
  uncaught exceptions, and unhandled rejections. Keep its ordered entries with
  explicit `console` or `cdp` sources and levels so the validator can recompute
  all four counts. Informational messages are allowed. Because probe
  installation occurs before the measured boundary, its installation message
  belongs in preflight, not the cleared report.
- The structured Network/WebSocket report must show zero HTTP requests, zero
  Lakebed requests, and zero opened WebSockets from the first Singleplayer
  click through the final world interaction. Keep the raw ordered CDP events
  in that JSON report so the validator can recompute all three manifest counts.
- If pre-boundary tooling traffic is useful for diagnosis, keep it outside the
  strict evidence root. A Vite/Lakebed dev-server WebSocket opened before the
  boundary does not invalidate the Singleplayer claim, but any request or
  socket opened by the app after the boundary starts does.

Development-server WebSocket traffic is outside the cleared Singleplayer
capture boundary only when opened before that boundary.

Any in-boundary request, socket, uncaught error, page error, or warning fails
the run. Bind each structured report to the same run ID, expected commit, and
run interval; record counts in the manifest and hash the reports.

## Deterministic compact artifact

After the integrated live route, build from the same recorded commit twice.
Use two fresh staging directories and retain both artifacts plus both staged
client and server entrypoints in the evidence root:

```sh
stage_a="$(mktemp -d)"
stage_b="$(mktemp -d)"
node scripts/prepare-lakebed-deploy.mjs "$stage_a"
node scripts/prepare-lakebed-deploy.mjs "$stage_b"
(cd "$stage_a" && LAKEBED_COMPACT_BUNDLE=1 npx lakebed build --target anonymous --json) \
  > /absolute/path/to/evidence/build-a.json
(cd "$stage_b" && LAKEBED_COMPACT_BUNDLE=1 npx lakebed build --target anonymous --json) \
  > /absolute/path/to/evidence/build-b.json
```

Run `scripts/check-lakebed-artifact-size.mjs` on each artifact. Both artifacts,
both staged `client/index.tsx` files, and both staged `server/index.ts` files
must be byte-identical. The artifact must remain below 1,048,576 bytes with at
least 32,768 bytes of headroom. Record the Lakebed artifact and client-bundle
hashes from the JSON output, plus ordinary file SHA-256 values.

The two retained `--json` outputs are the structured build reports. The
manifest binds their paths and hashes to the run ID and expected commit, and
the validator independently parses both reports and recomputes the anonymous
artifact target and hashes. Do not replace them with prose or a fabricated
wrapper report.

Finally, place the completed manifest in the evidence root and validate it
against the trusted commit captured before testing:

```sh
node scripts/validate-live-qa-evidence.mjs \
  /absolute/path/to/evidence/task41-evidence.json \
  --root /absolute/path/to/evidence \
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
