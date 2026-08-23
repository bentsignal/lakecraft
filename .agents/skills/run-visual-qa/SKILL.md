---
name: run-visual-qa
description: Use before accepting changes to rendering, UI, animation, cameras, or other player-visible output.
---

# Run visual QA

Use representative screenshots and observed motion as acceptance evidence for
rendering, UI, camera, animation, interaction feedback, and other visible work.
Automated tests guard regressions but cannot establish that a visual result looks
right.

Read `docs/quality/live-visual-qa/README.md`, then only the linked route files
needed for the change. For focused combat or mob work, also read
`docs/quality/creative-combat.md` or `docs/quality/mob-fixture.md`.

Compare the live result with the intended Minecraft reference in every affected
camera, state, and representative viewport. Capture stills and inspect motion;
iterate on visible discrepancies before claiming completion. Preserve the
trusted commit, console, performance, and report evidence required by the
runbook.
