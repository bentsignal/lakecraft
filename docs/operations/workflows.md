# Delivery workflows

Every implementation request includes tests, a pushed branch, and an HTTPS
development deployment for user review. Requests for plans or explanations do
not publish anything. The user can narrow the scope of any request.

| Stage | Source | User handoff | Next step |
| --- | --- | --- | --- |
| Development | Assigned worktree branch | Lakebed URL and task test steps | Feedback, or approval followed by PR and merge |
| Preview | Clean, synced `main` commit | Separate Lakebed URL and changes since production | Integrated testing and approval of the candidate |
| Production | Exact approved candidate | `https://craft.lakebed.app` and verified release record | Production tag becomes the next comparison baseline |

## Shared checks

Use Node 24, Bun 1.3, and `ffmpeg`/`ffprobe` on PATH for the video evidence
tests. CI pins Node 24.14.0 and Bun 1.3.3 on the Apple Silicon `macos-15` runner
to match the CPU architecture used for the existing timing guards. Builds pin
Lakebed 0.0.29 and TypeScript 5.9.3. The Lakebed
compiler transforms depend on this pinned toolchain. Changes to it require
validation of the compact output.

Commit the intended source, then run:

```sh
node scripts/validate-workflow.mjs
```

This checks every `.test.ts` and `.test.mjs` below `tests/` and `tools/`, Bun
tests below `apps/game-server/tests`, Markdown lines and links, the ordinary
anonymous build, and two independent compact builds with matching metadata,
client, server, and favicon. Compact builds enforce the existing 32 KiB reserve.
Tests run in a temporary clean worktree. Builds use an archive of the commit
to exclude ignored worktree credentials.
Tests that import Bun or Railway code run under Bun. Node tests run serially
because several assert wall-clock performance budgets. All check groups run
so a failure report exposes more than the first problem.

Focused tests help during implementation but do not replace this gate. Run
visual QA for player-visible changes and benchmarks for performance-sensitive
changes as their skills specify. The automated suite cannot approve gameplay
or screenshots for the user.

Failures block handoff, merge, and release, including failures already present
on the base commit. Diagnose the failure and fix it with meaningful coverage;
do not delete a failing assertion just to pass. If the fix needs separate work,
report the blocker and record it in GitHub. Never describe skipped or unavailable
checks as passed.

`.github/workflows/validate.yml` runs the same command on PRs and `main`. Require
its `Repository validation` check in the repository's `main` ruleset, with the
branch up to date before merging. Do not bypass failures. A workflow file alone
does not enable GitHub branch protection; confirm the repository setting when
configuring enforcement.

## Development review

Follow [development](../../.agents/skills/development/SKILL.md). After committing
and pushing the branch, run:

```sh
node scripts/publish-review.mjs development
```

This command runs the shared gate before any deployment. Return the URL,
expiry, commit, and test steps. On feedback, commit, push, validate, and refresh
the same deployment. When the user approves, open the PR, integrate current
`main`, check the resulting source and CI, then merge. Changes that alter what
the user reviewed require a refreshed development link before merging.

## Integrated release preview

Follow [preview](../../.agents/skills/preview/SKILL.md). Fetch tags and sync a
clean `main` checkout with `git pull --ff-only origin main`, then run:

```sh
node scripts/release-changes.mjs
node scripts/publish-review.mjs preview
```

Explain changes since the latest UTC-named `production/*` tag, including
merged work and any direct commits. Translate the diff into a user test list
with expected results. Save the candidate's sanitized receipt, URL, and test
list in a GitHub prerelease tagged `candidate/<UTC>-<short-sha>`. Each revision
gets a new candidate tag and receipt even when its hosted URL is reused.
The receipt is at `.lakebed/reviews/preview.json`. It records the exact source,
validated artifact, client bundle hash, baseline, expiry, and HTTP verification.

Release fixes go through a branch and passing PR into `main`, then a new
candidate handoff. Candidate approval applies to that commit only. A moving
preview URL or newer `main` never expands the approved source.

The initial comparison marker is `workflow/production-baseline`, at the `main`
commit accepted when this workflow was introduced. It deliberately makes no
claim about the old deployment's source. After the first verified production
release, production tags replace that marker in comparisons.

## Production

Follow [deploy-lakebed](../../.agents/skills/deploy-lakebed/SKILL.md) after the
user approves a candidate for production. Resolve its GitHub prerelease and
receipt, check out that exact commit in a clean detached worktree, run the
shared gate, compare the compact hashes to the candidate, and use the isolated
operator transaction. Preserve the production deploy ID and database.

After control-plane and public-alias verification, create an annotated
`production/<UTC>-<short-sha>` tag on the deployed commit and a GitHub release.
Its notes and sanitized receipt record the candidate tag, source commit, deploy
ID, artifact hash, client hash, public URL, completion time, and checks. Push
the tag only after verification. Never move an existing candidate or production
tag. A verified rollback gets a new production tag on the restored commit.

## Hosting boundaries

Review URLs are public Lakebed HTTPS deployments. They do not depend on
localhost, LAN access, Tailscale, tunnels, or the publishing machine remaining
online. They are unlisted test environments, not private access controls.
Each worktree keeps a development binding, and the release checkout keeps a
separate preview binding. Lakebed assigns the URL and expiry. Expired bindings
get a replacement; an active review reuses its URL.

Another machine can open the link immediately. An agent moving machines can
resume the pushed source and GitHub review records; without the ignored local
credential it creates a replacement URL. Never transmit the claim token in
chat or commit it. Named permanent aliases or portable management credentials
would require a separate claimed-deployment design.

The Lakebed deployment covers the client, identity, and directory. Railway
game servers are separate releases. Test multiplayer changes against an
isolated server and volume with the matching commit, origin allowlist, and
preview registration. Record its tested image/commit with the candidate. A
Lakebed preview alone does not deploy or validate Railway changes.
