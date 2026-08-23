# Visual QA cave, combat, and multiplayer routes

Return to [the visual-QA index](README.md) for run order and the
canonical case ledger. Complete the [world route](worlds.md)
before these routes, using the same run ID, commit, and measured segments.

## Cave-lighting route

Use QA Creative. Build a repeatable stone test structure that crosses both an
X and Z multiple-of-eight chunk seam:

- a daylight-exposed surface pad;
- a fully roofed and walled cave with no sky path;
- an adjacent room with a one-block-wide vertical shaft open to the sky;
- one seam wall or roof block whose removal opens the cave and whose replacement
  encloses it again;
- one torch inside the enclosed cave to prove emissive light is preserved.

Record coordinates and a plan screenshot. Keep the camera pose and exposure
setting fixed between paired captures.

1. In daytime, capture the surface, open shaft floor, roofed cave, and torch.
   Surface must be brightest, shaft light must propagate downward, the roofed
   cave must remain dark except for local emissive light, and seams must not
   show a lighting discontinuity.
2. Repeat at night. Surface and shaft skylight must dim with the sky cycle;
   the enclosed cave must not receive global night tint or brighten because its
   roof is present.
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
`open-shaft-night` at both viewports. The scene must visibly render during each
sampling window.

## Combat regression

Run the route in `docs/quality/creative-combat.md` in QA Creative. Capture the
following as separate cases at both viewports:

- melee hit/miss, armor mitigation/wear, and solid hostile/explosion cover;
- manual TNT ignition, shortened adjacent TNT fuse, single explosions, and
  cover/armor behavior;
- bow draw stages, cancel-without-consumption, partial/full releases,
  projectile hit, and no-ammunition prevention.

Do not skip Survival mode for consumption, durability, damage, or death
observations. The viewport must remain usable without clipped hotbar, HUD,
modal, or command-console controls.

## Legacy multiplayer scope

This section preserves the evidence schema enforced by the legacy validator.
It does not describe current Railway multiplayer QA. Track missing Railway
evidence in [GitHub Issues](https://github.com/bentsignal/lakecraft/issues).

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
unique evidence file. The two proof records must demonstrate overlapping active
session windows, each identity seeing the other's hashed peer identity,
reciprocal peer visibility, at least one successful interaction in each
direction, positive quota attempts and granted operations while not paused,
and all attempts and grants remaining within the documented quota.

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
`peerVisibilityIds`, and contains 2 through 3,600 ordered `quotaTelemetry` rows.
Each row has `sequence`, `timestamp`, monotonic `attempts`, monotonic `grants`, and
`paused: false`. Attempts may not exceed grants; final attempts and grants are
positive and the session observes a positive delta.

Use exactly two manifest interaction summaries: `identity-a-to-b` and
`identity-b-to-a`, each with fixed actor/target IDs and a unique proof
path/hash. Each schema-version 1 interaction proof is bound to the run and
both identity windows and contains these ordered passing event kinds:
`movement-nameplate`, `chat`, `item-sharing`, `pvp`, and `reconnect`.

Until the validator is updated, set the whole scope to `deferred`. Keep
`identities` and `interactions` empty, and use the ordered reason codes
`hosted-route-disabled`, `authorized-identities-unavailable`, and
`quota-observation-unavailable`. Report the independently checked production
quota as healthy context with `quotaObserved: false`. A quota snapshot is not
an observed two-client traffic or degradation trace. Never perform production
mutations merely to turn this partial run into a pass.
