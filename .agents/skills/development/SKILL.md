---
name: development
description: Implement Lakecraft work in a worktree branch, validate it, commit and push, publish a web development link, and iterate through review to a merged PR. Use for implementation requests and feedback on branch work.
---

# Develop Lakecraft

Read [the delivery contract](../../../docs/operations/workflows.md).
An implementation request includes the development handoff. Do not wait for a
separate request to commit, push, or publish the finished revision.

1. Use the assigned worktree. If started on `main`, create a work branch before
   edits. Inspect existing changes and preserve unrelated work.
2. Implement the request and run focused checks while editing. Apply visual QA
   and renderer benchmarking when their skills apply. Local browser testing
   follows [local setup](../preview/references/local.md).
3. Commit the finished revision and push the branch with its upstream. Run
   `node scripts/publish-review.mjs development`. This runs the complete shared
   validation gate, builds the pushed commit, and refreshes the development URL.
   Fix failures before handoff, including release packaging failures. Commit
   and push fixes, then rerun. Never skip failures because they predate the task.
4. Verify the changed behavior in the hosted app. Report the URL, expiry,
   commit, checks, and a short list of what the user should try. Say whether
   multiplayer was exercised when relevant. An HTTP check alone is not a
   gameplay or visual check.
5. For feedback, repeat implementation through publish and return the URL
   again. If publishing fails, identify the blocker and mark any old URL stale.
6. When the user approves the work, open a PR to `main`. Fetch `origin`, merge
   current `origin/main` into the branch if necessary, resolve conflicts, and
   rerun `node scripts/validate-workflow.mjs`. If integration changes reviewed
   behavior, republish and return for review. Otherwise wait for all PR checks
   to pass and merge using
   `gh pr merge --merge --match-head-commit <reviewed-head>`.

Approval of the work authorizes its PR and merge. Do not ask for approval again
for those routine steps. Do not merge while the user is still reviewing, use
admin bypass, or treat a missing CI result as a pass. Before merging, confirm
the PR head and base have not advanced beyond the tested integration.

Keep public handoff details in the conversation and PR description. A task can
resume on another machine from its pushed branch. The URL works from any
internet-connected device. Credentials in `.lakebed/` stay on the publishing
machine; never put them in a PR or copy them through chat. If a new publishing
machine lacks the binding, publish a replacement and report the new URL.
