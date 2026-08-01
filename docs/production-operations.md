# Lakecraft production operations

This runbook keeps Lakebed as the only deployment, database, auth, and
synchronization service. It is deliberately fail-closed: a missing claim,
private-inspection authorization failure, quota shortage, unexpected deploy,
artifact mismatch, or compact-size regression stops the release.

The checked-in production identity is
`docs/production-target.json`. The top-level `lakebed.json` must name the same
deploy ID; it is the production binding and must not enter ordinary audit
stages.
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
deployment, plus its claimed owner, non-expiring target state, private
inspection, live canonical target, documented platform limits, and at least
1,000 requests plus 100 mutations remaining. The public player URL is trusted
checked-in configuration; `deploy list` does not prove that the public alias
maps to the canonical target. Explicitly archived historical entries with
unique valid deploy IDs and canonical UTC archive timestamps are allowed. Every
other extra entry—including active, pending, unknown, incompletely archived, or
malformed lifecycle state—fails closed. Preserve the report's UTC timestamp,
artifact hashes, usage, limits, gates, and failures. Do not preserve claim tokens,
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
4. Run the transactional compact audit twice in distinct evidence directories. Both
   artifact files, staged client files, staged server files, artifact hashes,
   and client bundle hashes must match.
5. Run `scripts/check-lakebed-artifact-size.mjs` on the artifact and require at
   least 32,768 bytes of headroom.
6. Run the production audit immediately before deployment. Stop if any gate
   fails.

```sh
npx lakebed build . --target anonymous --json
evidence_parent="$(mktemp -d)"
node scripts/build-lakebed-audit.mjs "$evidence_parent/build-a"
node scripts/build-lakebed-audit.mjs "$evidence_parent/build-b"
cmp "$evidence_parent/build-a/artifact.json" "$evidence_parent/build-b/artifact.json"
cmp "$evidence_parent/build-a/client/index.tsx" "$evidence_parent/build-b/client/index.tsx"
cmp "$evidence_parent/build-a/server/index.ts" "$evidence_parent/build-b/server/index.ts"
node scripts/check-lakebed-artifact-size.mjs "$evidence_parent/build-a/artifact.json"
node scripts/audit-lakebed-production.mjs
```

The audit command owns a fresh private transaction, keeps its sentinel outside
the capsule, writes a safe `lakebed.json` without `deployId`, omits
`.env.lakebed.server`, seals payload files to `0400` and directories to `0500`,
and leaves only a sibling `.lakebed` workspace writable. It invokes and verifies
the anonymous build before exporting non-deployable evidence and deleting the
transaction. A `.lakebed/deploy.json` file is an unexpected legacy
credential path, not the production binding; staging fails closed if it or an
unrecognized `.env.lakebed*` path exists. Never copy credentials into the
repository, a PR, an evidence bundle, or another user's worktree. If hosted
inspection says authorization is required, stop and use an already-authorized
operator checkout or an approved ephemeral credential mechanism. Do not make
the inspection endpoint public.

This contract protects against accidental contamination and other operating-
system users, and detects persistent mutation. It cannot eliminate a malicious
same-UID process that can chmod and transiently replace pathnames; Node does not
expose the directory-descriptor isolation required for that claim.

## Deploy and verify

Deployment is an explicit operator action after review approval; this runbook
does not authorize an automated deploy. The audit helper has no release flag or
deploy invocation and never exports a deployable capsule. Production deployment
is blocked here until a separate reviewed operator transaction validates both
audited manifests and safely handles Lakebed rewriting top-level `lakebed.json`
after a successful network request. Do not reconstruct the removed manual
stage-and-deploy handoff: a post-network local write failure could make the
release result ambiguous.

Record the returned deploy ID, artifact hash, client bundle hash, URL, and UTC
completion time. Then require the control plane to report the exact artifact:

```sh
node scripts/audit-lakebed-production.mjs \
  --expected-artifact sha256:REPLACE_WITH_DEPLOY_RESULT
```

Probe <https://craft.lakebed.app> once after the audit and record the HTTP
result; that probe consumes hosted request quota and is the step that verifies
the configured public alias, independently of the control-plane canonical URL.
With authorized private inspection, capture the manifest/schema, bounded table
counts, quota snapshot, and logs once. Redact identity data and secrets. Do not
loop on logs, database dumps, or a quota error.

## Failure and recovery

| Failure | Required response |
| --- | --- |
| Artifact reserve below 32 KiB | Do not deploy. Reduce the staged artifact and rebuild twice. |
| Deploy ID, owner, expiry, canonical URL, status, or limits differ | Do not deploy. Reconcile `production-target.json`, `lakebed.json`, and the Lakebed control plane with the owner. |
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
