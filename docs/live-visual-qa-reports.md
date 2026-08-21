# Task 41 reports and deterministic artifact

Return to [the visual-QA index](live-visual-qa.md) for run order and the
canonical case ledger. This guide covers collectors, report chronology,
post-run packaging, and validation.

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
segments and gaps. Network treatment differs only for the gap's local document
navigation; no gap may contain app traffic or a newly opened app socket.

At the final interaction boundary, stop both collectors before setting
`runCompletedAt`; their last segment must end at that same instant. Serialize
the complete reports afterward. Each report's post-run generation interval
(`capturedAt` through `completedAt`) starts no earlier than `runCompletedAt`,
while its embedded coverage still begins at `runStartedAt` and ends at
`runCompletedAt`. Serialization must not add, omit, stretch, or retime a
segment or gap.

Development-server WebSocket traffic is outside the cleared Singleplayer
capture segment only when opened before that segment. A Vite/Lakebed
dev-server WebSocket opened before the boundary of a measured segment is
pre-boundary tooling and does not invalidate that segment or count as an app
`newSocket`; a new app socket opened after the boundary does.

Any measured-segment request, new socket, uncaught error, page error, or warning
fails the run. Bind every segment and aggregate report to the same run ID,
expected commit, and run interval; record counts in the manifest and hash the
reports.

## Deterministic compact artifact

After the last integrated live interaction has closed the final measured
segment and fixed `runCompletedAt`, build from two independent archives of the
trusted expected commit. These are post-run derived artifacts; do not extend or
rewrite the browser timeline around them, and do not stage from the mutable
current filesystem. Retain both Lakebed build reports, redacted artifact
metadata records, noncanonical staged-source snapshots, and wrapper summaries
in the evidence root. The transaction must delete each full artifact envelope
and client bundle rather than export either as evidence:

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

Run `scripts/check-lakebed-artifact-size.mjs` on each `artifact-metadata.json`.
Both redacted artifact metadata records, both staged
`staged/client-index.tsx` files, and both staged `staged/server-index.ts` files
must be byte-identical. The artifact must remain below 1,048,576 bytes with at
least 32,768 bytes of headroom. Record the Lakebed artifact and client-bundle
hashes from the JSON output, plus ordinary file SHA-256 values.

Each output contains the raw `build-report.json`, verified redacted
`artifact-metadata.json`, staged sources under non-capsule filenames,
sanitized `staged/lakebed.audit.json`, and wrapper `summary.json`. The raw
reports remain the structured Lakebed build reports. The manifest binds their
paths and hashes to the run ID and expected commit, and the transactional
wrapper verifies the complete Lakebed `source.files` set and all bundle hashes
before deleting the full envelope. The validator creates its own deterministic
`git archive` of the exact expected commit beneath the trusted repository root,
reruns that transaction, and compares the rebuilt redacted metadata and
staged-source hashes with the captured evidence. Dirty working-tree
substitution and staged-source drift fail without retaining a
request-body-consumable artifact or client bundle. Do not replace the Lakebed
reports with prose or a fabricated wrapper report.

Finally, place the completed manifest in the evidence root and validate it
against the trusted commit captured before testing. After build B and manifest
assembly are complete, set `packagedCompletedAt` to that packaging-completion
instant. Do not mutate the evidence package afterward except for the validator
output path.

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
keep that output with the run and leave Task 41 open. Process exit 1 means
invalid evidence, not a deferral.
