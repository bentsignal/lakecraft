---
name: deploy-lakebed
description: Deploy and verify an approved Lakecraft release candidate on craft.lakebed.app, or inspect production. A new release request first uses preview; branch work uses development.
---

# Deploy Lakecraft on Lakebed

Release the compact Lakecraft capsule to its existing claimed deployment.
For integrated release testing use `preview`; for branch work use `development`.
A new release request starts with a candidate preview. After the user approves
that exact candidate for production, continue here without asking again.

For a read-only production verification request, run the production audit and
only the requested public checks. It does not require a candidate or authorize
a deployment, tag, or release.

## Required context

Read these files before changing production:

- `docs/operations/lakebed-production.md`
- `docs/operations/workflows.md`
- `docs/operations/production-target.json`
- `lakebed.json`
- `references/operator-release.md` in this skill

Treat the checked-in target files as authoritative. Run Lakebed commands with
the pinned toolchain specified in `references/operator-release.md`.

## Safety rules

- Deploy one reviewed, clean commit. Stop on unrelated or uncommitted source changes.
- Preserve the existing claimed deploy ID. Updating it preserves the Lakebed database and the attached `craft.lakebed.app` alias.
- Do not run a raw `npx lakebed deploy .` release for Lakecraft. The ordinary source-map-heavy capsule exceeds Lakebed's request limit.
- Use the repository's compact staging transforms and their fail-closed fingerprints.
- Require the repository's artifact reserve gate. Missing the reserve blocks
  deployment even if the artifact clears Lakebed's hard ceiling.
- Never retry an ambiguous deploy blindly. The CLI may complete the network update and then fail while rewriting a sealed temporary `lakebed.json`.
- Probe the public alias once after control-plane verification; avoid request or log polling.

## Release workflow

1. Resolve the approved candidate tag and sanitized receipt from its GitHub
   prerelease. Use a clean detached worktree at that exact commit, even if
   `main` has advanced. Require the candidate commit to be merged into `main`.
   Do not use the current contents of a mutable preview URL as source identity.
   Confirm the exact source and credentials:

   ```sh
   git status -sb
   git rev-parse HEAD
   npx --yes lakebed@0.0.29 auth status --json
   npx --yes lakebed@0.0.29 deploy list --json
   ```

2. Run `node scripts/validate-workflow.mjs`. Require its artifact and client
   hashes to match the approved candidate receipt. A mismatch returns the work
   to preview. Do not stage from a live checkout containing
   `.lakebed/deploy.json`; the safety wrapper rejects that credential path.

3. The shared gate includes paired compact builds and the reserve check. Run
   the production-specific preflight audit next:

   ```sh
   node scripts/audit-lakebed-production.mjs
   ```

4. Follow `references/operator-release.md` to create a private stage from the
   clean archive. Retain the production `deployId`, set
   `LAKEBED_COMPACT_BUNDLE=1`, and run:

   ```sh
   npx --yes --package lakebed@0.0.29 --package typescript@5.9.3 \
     lakebed deploy /absolute/path/to/private-stage/payload --json
   ```

5. If the CLI succeeds, continue to verification. If it reports `EACCES` while
   writing the staged `lakebed.json`, the result is ambiguous. Do not deploy
   again. Fetch `npx --yes lakebed@0.0.29 deploy list --json` once and compare the deploy ID,
   active status, update time, and expected compact client-bundle hash.

6. Verify the returned control-plane artifact exactly:

   ```sh
   node scripts/audit-lakebed-production.mjs \
     --expected-artifact sha256:REPLACE_WITH_CONTROL_PLANE_ARTIFACT
   ```

7. Verify the durable alias once:

   ```sh
   curl --silent --show-error --location --max-time 20 \
     --output /dev/null \
     --write-out 'public_http=%{http_code}\npublic_url=%{url_effective}\n' \
     https://craft.lakebed.app/
   ```

8. Report the commit, deploy ID, artifact hash, client-bundle hash, canonical URL, public URL, UTC completion time, and checks.

9. After verification, create and push an annotated
   `production/<UTC>-<short-sha>` tag on the deployed commit and create a GitHub
   release. Record the candidate tag and sanitized deployment receipt in the
   release, using a temporary `--notes-file`. This tag is the baseline for the
   next release checklist. Never tag a failed or ambiguous deployment as shipped.

## Domain lifecycle

The production alias is already attached. Do not re-add it for routine updates.
For a new claimed replacement deployment, confirm the binding and ownership,
then run:

```sh
npx --yes lakebed@0.0.29 domains add craft.lakebed.app --json
```

Do not terminate or replace the existing claimed deployment merely to update the application.

## Rollback

Use a detached clean worktree at a recorded known-good commit. Repeat the tests,
paired compact builds, reserve gate, production audit, deployment, and
verification. Do not reset `main`, reuse an old stage, or restore database rows
as part of an application rollback.
