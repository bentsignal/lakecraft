# Mob renderer visual-QA fixture

This is a **test-only, non-shipping** fixture for completing the live visual
gate on PR16. It creates four disposable local worlds through the same strict
registry, two-slot journal, canonical JSON, checksum, runtime, mob-snapshot,
and terrain shapes used by ordinary Singleplayer.

It adds no query parameter, global hook, QA route, production import, Lakebed
query/mutation, or deploy behavior. Use a dedicated browser profile on an
isolated local `npx lakebed dev` port. The installer refuses to replace any
existing `lakecraft.singleplayer.*` data.

## Generate and verify

From a clean worktree:

```sh
evidence_root="$(mktemp -d /tmp/lakecraft-mob-qa.XXXXXX)"
node --experimental-strip-types scripts/mob-visual-qa-fixture.ts --out "$evidence_root"
node --test --experimental-strip-types tests/mobVisualQaFixture.test.ts
```

The generator writes:

- `mob-visual-qa-fixture.json`: exact storage values, per-value SHA-256,
  fixture digest, camera contracts, distance bands, and state expectations;
- `install-mob-visual-qa-fixture.js`: an isolated-profile browser installer
  that SHA-256 checks every value before writing, verifies every readback, and
  removes only its own partial writes if installation fails.

In the isolated browser, open DevTools Console on the local Lakecraft origin,
paste the generated installer, and wait for its returned digest/world list.
Reload once. **Select World** should show, in order of last-played/name:

- `Mob QA Narrow Animals` — pig, cow, sheep, chicken at 3–6 blocks;
- `Mob QA Narrow Hostiles` — zombie, skeleton, creeper at 3–6 blocks;
- `Mob QA States` — walking cow, sheared sheep, delayed fusing creeper at
  3–6 blocks under two unobstructed torches;
- `Mob QA Wide` — all seven required species at 4–8 blocks.

Every face is aimed toward the saved camera. Each mob stands on a contrasting
wool cell inside a flat stone-brick platform at y=6. The player, camera rays,
and mob bodies are above the floor; there are no walls or blocks between the
camera and lineup. The wide pig includes a tested full-body viewport margin.
Baseline creepers are parked by a future-scheduled, strictly validated fuse:
their saved/rendered fuse progress is zero, but ordinary daylight hostility
cannot walk them out of the frame while paired evidence is captured.

## Capture matrix

Use real Computer Use, not DOM scripting, CDP, Playwright, a production hook,
or a synthetic renderer. Disable browser zoom. Keep the same isolated dev
process and profile for the matrix.

1. At 1280 × 720, enter **Mob QA Wide** and capture all seven recognizable
   front faces. The pig must be fully visible, including its left side.
2. At 800 × 720, capture **Mob QA Narrow Animals**, then **Mob QA Narrow
   Hostiles**. Together they cover all seven species at the 3–6 block band.
3. For no-shimmer evidence, stop all input in either daylight baseline world.
   Capture frame A, do not move the mouse or press a movement key, wait at
   least 500 ms, and capture frame B. Compare the eye/mouth/nostril pixels at
   native resolution; their screen-space edges must not crawl or shimmer.
4. Enter **Mob QA States** and immediately press Escape. This preserves the
   loaded walking interpolation, sheared coat, and approximately 53% creeper
   fuse state before ordinary simulation can advance them. Capture once, then
   leave with **Save and Quit to Title**. If the state advanced before pause,
   reinstall into a fresh isolated profile rather than editing storage.
5. Walking is also available as real simulation: resume **Mob QA States** and
   capture within thirty seconds while the cow crosses its open cell. Quit
   before the delayed creeper fuse completes.

## Hurt-tint evidence must be gameplay

The fixture intentionally does **not** persist or inject renderer-private hurt
state. Hurt tint is a transient response to a health decrease, so prove it with
a real gameplay hit:

1. Enter **Mob QA Narrow Animals** at 800 × 720 and acquire pointer lock.
2. Aim the crosshair at the cow's torso. Left-click once; do not hold the
   button and do not edit browser storage or invoke a renderer method.
3. Capture immediately while the cow flashes red, then capture the untinted
   cow after the flash expires. The cow must remain alive and recognizable in
   both frames.

Record the fixture digest, exact app commit, isolated port, viewport, capture
times, and screenshot SHA-256 values beside the PR16 evidence. Fixture
installation is browser-local only and must produce zero Lakebed traffic.

## Shipping-byte proof

Run the ordinary anonymous capsule build at exact `main` and at this branch,
then compare the raw artifact and client-bundle SHA-256 values. Since this
change only adds files under `scripts/`, `tests/`, and `docs/`, both artifacts
must be byte-identical. Any delta is a blocker and indicates the tooling leaked
into the production graph.
