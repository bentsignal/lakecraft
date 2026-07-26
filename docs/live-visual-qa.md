# Integrated local-world visual QA

This is the executable post-integration route for Task 41. It verifies the
local world browser, isolated crash-safe saves, cave-lighting behavior,
single-player combat, frame/draw-call health, a clean console, zero
Singleplayer network traffic, and the strict Lakebed artifact reserve.

Do not capture final evidence from a branch that lacks the completed local
world browser. Rebase this evidence-only branch onto the integrated Task 135
commit, record that exact 40-character commit in the evidence file, and run the
entire route against one uninterrupted `npx lakebed dev` process. The three QA
worlds are disposable browser-local data.

## Required setup

1. Start from a clean integrated commit and run the full automated suite.
2. Start `npx lakebed dev` and keep that process alive for the whole route.
3. Use one Chromium-family browser profile with extensions disabled. Record
   its name and full version.
4. In DevTools, disable cache and enable Preserve log. Load the title screen,
   then clear both Network and Console immediately before choosing
   **Singleplayer**. Do not clear them again.
5. Create an evidence root outside the repository. Keep every screenshot,
   recording, transcript, JSON snapshot, console export, HAR, build report,
   artifact, and staged bundle beneath that root.
6. Run `git rev-parse HEAD` and record the result before interaction. If HEAD
   changes, restart the route.

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
The validator rejects incomplete, reordered, duplicated, or extra cases.

## Browser probe

Create a DevTools Snippet from
`scripts/task41-browser-probe.js` and run it once on the title screen before
opening Singleplayer. It wraps the existing WebGL draw methods without
short-circuiting them and samples animation frames; it does not alter app
source or the deploy artifact. The Console info message must report one or two
patched context prototypes.

For each performance scene:

1. Reach a stable camera pose and stop interacting.
2. Run `window.__lakecraftTask41Probe.reset()`.
3. Wait at least five seconds and at least 120 animation frames.
4. Save the result of
   `window.__lakecraftTask41Probe.snapshot("desktop/surface-day")`, replacing
   the label with the current viewport and scene.

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
   **Play Selected World**, **Create New World**, **Reset World…**, and
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

Before fault injection, copy all keys beginning with
`lakecraft.singleplayer.worlds.` or `lakecraft.singleplayer.world.` to the
evidence root. Inspect the valid registry slot with the newest revision, find
the exact ID whose name is `QA Fault`, and record that ID. Never infer an ID
from its display name.

Set only these two values to invalid JSON, substituting the recorded ID:

```text
lakecraft.singleplayer.world.<QA_FAULT_ID>.save.a
lakecraft.singleplayer.world.<QA_FAULT_ID>.save.b
```

Reload. QA Fault must show a corrupt-save health state and be unable to damage
or hide QA Survival and QA Creative. Open both healthy worlds and prove their
six surviving markers still match. Save the corrupt slot values as evidence,
then reset QA Fault through the UI before continuing.

### Capacity boundary

After QA Fault is healthy again, back up its two save slots. Replace one target
save-slot value with more than 150,000 characters and reload. The fault world
must show the storage-limit state and its unsafe play path must be disabled;
the other two worlds must remain searchable and playable. Reset QA Fault
through the UI and confirm storage returns to a healthy state. Do not fill the
entire origin quota, because that would invalidate the isolation check.

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

## Console and network

At the end of the route:

- Console must show zero errors and zero warnings. Informational messages,
  including probe installation, are allowed and should remain in the export.
- The preserved, cleared Network capture must contain zero requests from the
  first Singleplayer click through the final world interaction. Export the HAR
  without content; its `log.entries` array must be empty. This proves both zero
  Lakebed traffic and zero other network traffic during the measured route.

Any request, uncaught error, or warning fails the run. Record counts in the
manifest and hash the exports.

## Deterministic compact artifact

After the integrated live route, build from the same recorded commit twice.
Use two fresh staging directories and retain both artifacts plus both staged
client and server entrypoints in the evidence root:

```sh
stage_a="$(mktemp -d)"
stage_b="$(mktemp -d)"
node scripts/prepare-lakebed-deploy.mjs "$stage_a"
node scripts/prepare-lakebed-deploy.mjs "$stage_b"
(cd "$stage_a" && LAKEBED_COMPACT_BUNDLE=1 npx lakebed build --json)
(cd "$stage_b" && LAKEBED_COMPACT_BUNDLE=1 npx lakebed build --json)
```

Run `scripts/check-lakebed-artifact-size.mjs` on each artifact. Both artifacts,
both staged `client/index.tsx` files, and both staged `server/index.ts` files
must be byte-identical. The artifact must remain below 1,048,576 bytes with at
least 32,768 bytes of headroom. Record the Lakebed artifact and client-bundle
hashes from the JSON output, plus ordinary file SHA-256 values.

Finally, place the completed manifest in the evidence root and run:

```sh
node scripts/validate-live-qa-evidence.mjs \
  /absolute/path/to/evidence/task41-evidence.json \
  --root /absolute/path/to/evidence
```

The command must print `"ok": true`. Keep the validator output with the run.

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
| `console-clean` | Preserved console export and zero error/warning counts |
| `singleplayer-zero-network` | Empty HAR and zero request counts |
| `artifact-reserve-determinism` | Two byte-identical compact builds with strict reserve |
<!-- task41-cases:end -->

If a required observation cannot be reproduced, leave its status pending,
preserve the failing evidence, and report the blocker. Never edit the validator
or thresholds to make a failing integrated run pass.
