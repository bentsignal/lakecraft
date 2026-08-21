# Integrated local-world visual QA

This is the executable post-integration route for Task 41. It verifies the
local-world browser, crash-safe saves, cave lighting, combat, frame/draw-call
health, clean console, zero Singleplayer network traffic, and the Lakebed
artifact reserve.

Run the linked guides in order against one uninterrupted `npx lakebed dev`
process. The three QA worlds are disposable browser-local data. This run has
two independently reported scopes: the 18-case anonymous Singleplayer route
and the multiplayer route, which is either fully passed or wholly deferred
with allowlisted reason codes. This legacy Task 41 validator predates the
current Railway authority route; until it is modernized, use
`hosted-route-disabled`, `authorized-identities-unavailable`, and
`quota-observation-unavailable` as the ordered multiplayer reason codes.
Production quota is healthy context, but it is not observed by this anonymous
local run. Deferral is validator-accepted partial evidence, not a pass; the
legacy Task 41 route remains open and the validator exits 2 for that state.

Do not capture final evidence from a branch that lacks the completed local-world
browser. Rebase this evidence-only branch onto the integrated Task 135 commit
and run the entire route against that integrated commit.

## Runbook

Read these focused documents in order:

1. [Setup and browser probe](live-visual-qa-setup.md) — trusted commit,
   evidence-root rules, segment timing, collectors, and performance captures.
2. [Disposable worlds and browser route](live-visual-qa-worlds.md) — world
   fixtures, persistence markers, corruption/capacity isolation, and modal
   keyboard/focus checks.
3. [Cave, combat, and multiplayer routes](live-visual-qa-routes.md) — paired
   lighting evidence, combat regression, and multiplayer scope semantics.
4. [Reports and deterministic artifact](live-visual-qa-reports.md) — console,
   network, packaging, validation, and artifact-reserve rules.

Each companion is deliberately kept below 300 lines. Do not treat this index
as a substitute for the requirements in those guides.

## Evidence manifest template

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
Screenshots and recordings must be real media with decoded dimensions equal to
the declared viewport multiplied by device-pixel ratio; recordings must parse
as WebM or MP4 and last one second through six hours. Every observation names
a unique file and hash. Transcripts are structured JSON with ordered named
actions, timestamps, pass status, and detail. Console/CDP, Network/WebSocket,
storage, multiplayer, and artifact results are separate structured reports
bound to the same run ID and commit. The validator rejects stale, incomplete,
reordered, duplicated, extra, mislabeled, or media-spoofed evidence.

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
Singleplayer case is invalid, not valid-partial. Only the validator's
allowlisted multiplayer deferrals may produce valid-partial. Never edit the
validator or thresholds to make a failing integrated run pass.
