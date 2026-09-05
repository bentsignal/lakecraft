---
name: preview
description: Prepare a Lakecraft release candidate from synced main, publish its Lakebed web preview, and report changes since production. Use for integrated release testing or a new production release request. Branch test links use development.
---

# Preview a release

Read [the delivery contract](../../../docs/operations/workflows.md).
This is the review of merged work before production. Branch feedback belongs
to [development](../development/SKILL.md).

1. Use a clean `main` checkout. Fetch `origin` and tags, then
   `git pull --ff-only origin main`. If work started elsewhere, use a clean
   worktree instead of switching a dirty checkout. Do not reset divergent work.
2. Run `node scripts/release-changes.mjs`. Review the commits, merged PRs, and
   diff to explain all changes since the returned baseline in player terms.
   Include concrete test steps and expected results, especially interactions
   between changes. A workflow-start baseline is not a verified prior release.
3. Run `node scripts/publish-review.mjs preview`. It requires `HEAD` to match
   `origin/main`, runs the full delivery gate, deploys that commit to an
   isolated Lakebed URL, and writes a sanitized candidate receipt at
   `.lakebed/reviews/preview.json`.
4. Follow [hosted verification](references/hosted.md). Present the preview URL,
   expiry, candidate commit, changes, checks, and user testing checklist.
5. Create a GitHub prerelease at an immutable `candidate/<UTC>-<short-sha>` tag
   pointing to the candidate commit. Attach the sanitized receipt and put the
   checklist and URL in its notes. Use a temporary `--notes-file`. Never upload
   `.lakebed/release-preview.json`, which contains a credential. This prerelease
   lets an operator on another machine recover the exact candidate.
6. For corrections, use a fix branch and the development checks. Merge the
   passing fix through a PR, sync `main`, then refresh the release preview and
   create a new candidate record. The user tests the corrected candidate before
   production. A changed candidate invalidates approval of the earlier one.
7. Once the user approves this candidate for production, continue with
   [deploy-lakebed](../deploy-lakebed/SKILL.md). Keep the approved commit pinned
   even if more work merges to `main`. Never silently include later commits.

A request to start a release authorizes preparing and publishing the candidate,
not deploying production before its review. Existing explicit approval for the
specific candidate carries forward without another confirmation.
