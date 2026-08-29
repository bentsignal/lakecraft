---
name: deploy-lakebed
description: Use only when the user explicitly asks to release or verify Lakecraft on its main claimed Lakebed production deployment. Do not use for worktree previews, test links, or testing on another computer.
---

# Deploy Lakecraft on Lakebed

Release the compact Lakecraft capsule to its existing claimed deployment.
For a temporary hosted build that the user will test, use the `preview` skill
instead. A request for a test URL or access from another computer is not a
production release request.

## Required context

Read these files before changing production:

- `docs/operations/lakebed-production.md`
- `docs/operations/production-target.json`
- `lakebed.json`
- `references/operator-release.md` in this skill

Treat the checked-in target files as authoritative. Run Lakebed commands with
`npx lakebed ...`.

## Safety rules

- Deploy one reviewed, clean commit. Stop on unrelated or uncommitted source changes.
- Preserve the existing claimed deploy ID. Updating it preserves the Lakebed database and the attached `craft.lakebed.app` alias.
- Do not run a raw `npx lakebed deploy .` release for Lakecraft. The ordinary source-map-heavy capsule exceeds Lakebed's request limit.
- Use the repository's compact staging transforms and their fail-closed fingerprints.
- Require the repository's artifact reserve gate. If the artifact clears
  Lakebed's hard ceiling but misses the repository reserve, report both byte
  counts. Get an explicit release exception before the network request.
- Never retry an ambiguous deploy blindly. The CLI may complete the network update and then fail while rewriting a sealed temporary `lakebed.json`.
- Probe the public alias once after control-plane verification; avoid request or log polling.

## Release workflow

1. Confirm the exact source and credentials:

   ```sh
   git status -sb
   git rev-parse HEAD
   npx lakebed auth status --json
   npx lakebed deploy list --json
   ```

2. Run the relevant tests and compact-release checks from a clean archive. Do
   not stage from a live checkout that contains `.lakebed/deploy.json`. The
   safety wrapper rejects that legacy credential path.

3. Build the compact capsule twice in independent transactions. The artifact
   metadata, staged client, staged server, artifact hash, and client bundle hash
   must match. Run:

   ```sh
   node scripts/check-lakebed-artifact-size.mjs /path/to/artifact-metadata.json
   node scripts/audit-lakebed-production.mjs
   ```

4. Follow `references/operator-release.md` to create a private stage from the
   clean archive. Retain the production `deployId`, set
   `LAKEBED_COMPACT_BUNDLE=1`, and run:

   ```sh
   npx lakebed deploy /absolute/path/to/private-stage/payload --json
   ```

5. If the CLI succeeds, continue to verification. If it reports `EACCES` while
   writing the staged `lakebed.json`, the result is ambiguous. Do not deploy
   again. Fetch `npx lakebed deploy list --json` once and compare the deploy ID,
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

8. Report the commit, deploy ID, artifact hash, client-bundle hash, canonical URL, public URL, UTC completion time, checks, and any reserve exception.

## Domain lifecycle

The production alias is already attached. Do not re-add it for routine updates.
For a new claimed replacement deployment, confirm the binding and ownership,
then run:

```sh
npx lakebed domains add craft.lakebed.app --json
```

Do not terminate or replace the existing claimed deployment merely to update the application.

## Rollback

Use a detached clean worktree at a recorded known-good commit. Repeat the tests,
paired compact builds, reserve gate, production audit, deployment, and
verification. Do not reset `main`, reuse an old stage, or restore database rows
as part of an application rollback.
