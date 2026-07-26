# Lakecraft production operations

This runbook keeps Lakebed as the only deployment, database, auth, and
synchronization service. It is deliberately fail-closed: a missing claim,
private-inspection authorization failure, quota shortage, unexpected deploy,
artifact mismatch, or compact-size regression stops the release.

The checked-in production identity is
`docs/production-target.json`. `lakebed.json` must name the same deploy ID.
The public player URL is <https://craft.lakebed.app>; the canonical Lakebed URL
is recorded separately because the public alias is the durable user-facing
address.

## Read-only daily checkpoint

Run from a clean checkout. This command only calls `lakebed deploy list` and
prints a sanitized report; it never deploys, archives, claims, or changes state.

```sh
node scripts/audit-lakebed-production.mjs
```

The report verifies that the configured target is the only non-archived
deployment, plus its claimed owner, private inspection, public/canonical target
mapping, documented platform limits, and at least 1,000 requests plus 100
mutations remaining. Explicitly archived historical entries with valid archive
timestamps are allowed. Every other extra entry—including active, pending,
unknown, incompletely archived, or malformed lifecycle state—fails the
`noUnexpectedActiveDeploy` gate. Preserve the report's UTC timestamp, artifact
hashes, usage, limits, gates, and failures. Do not preserve claim tokens,
cookies, `.lakebed/deploy.json`, `.env.lakebed.server`, raw identity rows, or
full database dumps in git.

To audit a previously captured control-plane response without another hosted
request:

```sh
node scripts/audit-lakebed-production.mjs --deploy-list /absolute/path/deploy-list.json
```

## Release preflight

1. Resolve and record the exact clean commit. Review `git status --short` and
   stop on unrelated changes.
2. Run focused tests and the full repository suite. Record pre-existing
   failures separately and prove they reproduce on the base commit.
3. Build the ordinary anonymous capsule.
4. Build the compact staged capsule twice in distinct empty directories. Both
   artifact files, staged client files, staged server files, artifact hashes,
   and client bundle hashes must match.
5. Run `scripts/check-lakebed-artifact-size.mjs` on the artifact and require at
   least 32,768 bytes of headroom.
6. Run the production audit immediately before deployment. Stop if any gate
   fails.

```sh
npx lakebed build . --target anonymous --json
stage_a="$(mktemp -d)"
stage_b="$(mktemp -d)"
node scripts/prepare-lakebed-deploy.mjs "$stage_a"
node scripts/prepare-lakebed-deploy.mjs "$stage_b"
LAKEBED_COMPACT_BUNDLE=1 npx lakebed build "$stage_a" --target anonymous --json
LAKEBED_COMPACT_BUNDLE=1 npx lakebed build "$stage_b" --target anonymous --json
node scripts/check-lakebed-artifact-size.mjs /absolute/path/to/artifact-a.json
node scripts/audit-lakebed-production.mjs
```

The ignored `.lakebed/deploy.json` contains the claim binding needed for
private hosted inspection. Never copy it into the repository, a PR, an evidence
bundle, or another user's worktree. If hosted inspection says authorization is
required, stop and use an already-claimed operator checkout or an approved
ephemeral credential mechanism. Do not make the inspection endpoint public.

## Deploy and verify

Deployment is an explicit operator action after review approval; this runbook
does not authorize an automated deploy. From the exact staged tree:

```sh
LAKEBED_COMPACT_BUNDLE=1 npx lakebed deploy "$stage_a" --json
```

Record the returned deploy ID, artifact hash, client bundle hash, URL, and UTC
completion time. Then require the control plane to report the exact artifact:

```sh
node scripts/audit-lakebed-production.mjs \
  --expected-artifact sha256:REPLACE_WITH_DEPLOY_RESULT
```

Probe <https://craft.lakebed.app> once after the audit and record the HTTP
result; that probe consumes hosted request quota. With authorized private
inspection, capture the manifest/schema, bounded table counts, quota snapshot,
and logs once. Redact identity data and secrets. Do not loop on logs, database
dumps, or a quota error.

## Failure and recovery

| Failure | Required response |
| --- | --- |
| Artifact reserve below 32 KiB | Do not deploy. Reduce the staged artifact and rebuild twice. |
| Deploy ID, owner, URL, status, or limits differ | Do not deploy. Reconcile `production-target.json`, `lakebed.json`, and the Lakebed control plane with the owner. |
| Private inspection unauthorized | Stop. Recover the approved ignored claim binding; never weaken the inspection policy. |
| Request or mutation reserve fails | Stop production QA and deployment verification until the UTC quota reset. Do not retry-loop or change backend. |
| Deploy returns an unknown result | Do not issue a second deploy blindly. Run the read-only audit and compare the artifact hash first. |
| Post-deploy artifact mismatch | Treat the release as failed; preserve evidence and restore the last known-good source commit through the same reviewed staging pipeline. |
| Schema/index/log regression | Stop writes and multiplayer QA. Preserve a redacted snapshot and logs, diagnose against the exact deployed commit, then redeploy a reviewed fix. |
| Public URL fails but control plane is healthy | Record both URLs and HTTP status, avoid repeated probes, and escalate the alias/hosting incident. |

Lakebed does not make git history a rollback mechanism. Restore a prior release
by creating a detached worktree at the recorded last-known-good commit, running
the same tests, paired compact builds, reserve gate, and audit, then explicitly
deploying that staged source to the same claimed deploy ID. Never reset `main`,
reuse an unverified old staging directory, or restore database rows from a dump
without a separate reviewed recovery plan.
