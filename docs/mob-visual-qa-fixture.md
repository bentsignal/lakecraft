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

Run the ordinary anonymous capsule build at exact `main` and at this branch;
both builds must succeed. Their client bundles may be compared as an additional
production-import check. Do **not** require the ordinary raw artifacts to be
byte-identical: Lakebed includes a source/repository snapshot in that artifact,
so adding these `scripts/`, `tests/`, and `docs/` files (and even checking out a
worktree with a `.git` file instead of a `.git` directory) legitimately changes
its bytes. An ordinary raw-artifact delta does not prove production leakage.

For byte-identical shipping proof, archive the exact `main` and head commits
into clean source directories, then run each source tree's transactional audit
wrapper into a distinct absent evidence directory:

```sh
node scripts/build-lakebed-audit.mjs /absolute/absent/evidence-directory
```

Compare the raw anonymous artifact plus the staged `client/index.tsx` and
`server/index.ts` bytes. Build head into a second clean stage as the
determinism pair. Main, head A, and head B must be byte-identical because the
canonical production stage contains only the shipping entrypoints and optional
deployment bindings, not this QA tooling.

For base `88ba5b3` and this fixture change, the independently reproduced
canonical evidence is:

- raw artifact: 1,014,192 bytes,
  SHA-256 `29ace59bb975fdff5343769198da5cdbf49e4305fb18f9982e0f6a577973f514`;
- staged client: 448,805 bytes,
  SHA-256 `c5ca29a9738c0b5f71eb5a7a330869ee79851bedf2a49b00b3769ba60bb8e5f9`;
- staged server: 262,862 bytes,
  SHA-256 `a30750abee044ae609de016c4338725f948968d0acc889e7492fc42b924e7a21`;
- Lakebed artifact hash
  `sha256:8d543382c7c33847b789a76a9be1b6349df1a04654584d3bcd2f6e9328c53a26`;
- Lakebed client-bundle hash
  `sha256:28ca917976e3de3423005e65e840ff2e782a7dd316d0c870c9e3c33335ada255`.
