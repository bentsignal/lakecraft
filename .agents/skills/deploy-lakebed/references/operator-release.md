# Isolated compact operator release

An ordinary Lakebed build includes enough repository source and inline source
maps to exceed the deploy request limit. The audit helper proves the compact
artifact and then destroys its deployable stage. A production release must
repeat that preparation inside a one-use operator transaction.

## Prepare the source

1. Require a clean worktree and record `git rev-parse HEAD`.
2. Create an unpredictable temporary directory with `mktemp -d`.
3. Export that exact commit with `git archive HEAD | tar -x -C "$release_source"`.
4. If `.env.lakebed.server` exists, copy it into the private archive without printing it. Delete the temporary source after the transaction.

A Git archive excludes the ignored live `.lakebed/deploy.json` file, which the
staging checks reject. It also binds the release to committed bytes.

## Prepare the capsule

Use the repository modules from the archived source:

- `runStagedTransaction` from `scripts/lakebed-build-transaction.mjs`
- `prepareLakebedStage` from `scripts/prepare-lakebed-deploy.mjs`
- `copyOwnedStageFile` from `scripts/lakebed-staging-safety.mjs` when the server environment exists

The operator-specific prepare callback must:

1. Set `plan.safeConfigSource = plan.configSource` before preparation. This retains the reviewed production `deployId`; the audit path normally removes it.
2. Call `prepareLakebedStage(plan)`.
3. Copy `.env.lakebed.server` into the owned capsule only when it exists.

The transaction creates an isolated `.lakebed` workspace and seals the payload
files. It checks their identities before and after consumption, then removes the
stage.

## Run the deployment

Inside the transaction consumer, spawn only:

```sh
npx lakebed deploy "$plan_capsule_root" --json
```

Use the transaction root as the command working directory. Add
`LAKEBED_COMPACT_BUNDLE=1` to the inherited environment. Capture stdout and
stderr without printing credentials.

The compact client-bundle hash must match the preflight audit build. The claimed
artifact hash can differ from the anonymous audit hash. Read the final artifact
hash from the post-deploy control plane.

## Resolve the sealed-binding ambiguity

Lakebed currently performs the network update before rewriting the local capsule binding. A sealed operator stage can therefore return:

```text
EACCES: permission denied, open '.../payload/lakebed.json'
```

This does not prove the remote update failed. Do not issue a second deployment. Run `npx lakebed deploy list --json` once and require all of the following:

- the configured deploy ID is still the only non-archived deployment;
- its status is `active` and ownership is unchanged;
- `updatedAt` advanced past the preflight snapshot;
- `clientBundleHash` equals the expected compact build hash.

If those checks pass, treat the deployment as complete. Pass the observed
`artifactHash` to
`scripts/audit-lakebed-production.mjs --expected-artifact ...`. If a check
fails, stop and report the ambiguous state. Do not retry.

## First deployment versus updates

Routine releases update the deploy ID in `lakebed.json`. The public alias and
database remain attached. Only a new deployment needs `npx lakebed claim` and
`npx lakebed domains add craft.lakebed.app --json`. Never replace production to
work around packaging or verification failures.
