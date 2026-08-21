# Task 41 setup and browser probe

Return to [the visual-QA index](live-visual-qa.md) for the runbook and the
parser-owned evidence-template marker. This document contains the setup,
timing, evidence-boundary, and performance-probe requirements.

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
   measured segment's `startedAt` (`segments[0].startedAt === runStartedAt`).
   There is no unmeasured prefix. Capture an ordered series of measured
   Singleplayer interaction segments. End and export a segment before every
   required navigation or reload. The navigation/reload alone forms the
   intervening gap; after the new page is ready, clear and start the next
   segment at the exact gap completion time. A gap may contain its local
   document navigation request, but it must contain no app request or newly
   opened app socket. Use 4–32 uniquely named, descriptive segments. Between
   every adjacent pair, record exactly one `navigation` or `reload` gap whose
   `afterSegmentId` and `beforeSegmentId` name those exact neighbors.

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
   report, CDP network report, build report, redacted artifact-metadata record,
   and noncanonical staged-source snapshot beneath the one evidence root. Never
   retain the full artifact envelope or client bundle. Every regular file there
   must be referenced by the manifest (except the manifest and requested
   validator output); the validator rejects extra or missing files.
7. Re-run `git rev-parse HEAD` after interaction and after both builds. If it
   differs from the trusted expected commit, restart the route. Also restart if
   any live evidence timestamp falls outside `runStartedAt` through
   `runCompletedAt`; post-run derived timestamps follow the packaging rules in
   [the reports guide](live-visual-qa-reports.md) instead. The run must last at
   least five minutes and no more than six hours. Finish evidence packaging
   within six hours after `runCompletedAt`. At validation,
   `packagedCompletedAt` may be no more than 60 seconds in the future and no
   more than six hours old.

Every live screenshot, video, transcript, performance capture, storage event,
multiplayer event, identity proof, and interaction proof interval from
`capturedAt` through `completedAt` must fall inside one measured segment. No
live evidence may be captured in a navigation/reload gap or outside the
first/last segment boundaries. Every bounded proof window and every nested
action, frame, telemetry, or event timestamp must also remain wholly inside a
measured segment; a proof may not span or land in a gap. Every measured segment
must contain at least one bound live evidence capture.

After `runCompletedAt`, serialize the complete Console and Network reports
from the frozen collectors. Their timelines still cover exactly
`runStartedAt` through `runCompletedAt`; only their report-generation
timestamps are post-run. Then perform both deterministic artifact builds,
package the remaining evidence in order, and validate before the freshness
deadline. Derived Console/Network reports and build artifacts bind the same
run ID and expected commit, but their post-run generation/package times are not
live capture intervals and must not be placed inside a measured segment.

All evidence files retain `capturedAt` and `completedAt`, with
`completedAt >= capturedAt`. For live evidence, those fields are the
segment-bound capture interval. For derived Console, Network, and artifact
files, they are the post-run generation interval. Set manifest
`packagedCompletedAt` after build B and all packaging finish. Derived intervals
are nonoverlapping and ordered: Console report, Network report, artifact build A,
then artifact build B. Console starts no earlier than `runCompletedAt`; each next
derived `capturedAt` is greater than or equal to the preceding derived
`completedAt`; and every derived interval ends no later than
`packagedCompletedAt`. Require `packagedCompletedAt >= runCompletedAt` and a
`packagedCompletedAt - runCompletedAt` of at most six hours. Preserve the
canonical manifest sequence chronology:
observations, performance captures, storage, multiplayer, Console, Network,
build A, then build B. Do not backdate a generated report or build.

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

   Replace the label with the current viewport and scene. The saved JSON is
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
