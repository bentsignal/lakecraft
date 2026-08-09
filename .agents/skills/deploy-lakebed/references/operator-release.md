# Isolated compact operator release

Lakecraft needs a compact private stage because an ordinary Lakebed build includes enough repository source and inline source maps to exceed the deploy request limit. The checked-in audit helper proves the compact artifact but deliberately destroys the deployable stage, so production release must reproduce the same preparation inside a one-use operator transaction.

## Prepare the source

1. Require a clean worktree and record `git rev-parse HEAD`.
2. Create an unpredictable temporary directory with `mktemp -d`.
3. Export that exact commit with `git archive HEAD | tar -x -C "$release_source"`.
4. If `.env.lakebed.server` exists, copy it into the private archive without printing it. Delete the temporary source after the transaction.

Using a Git archive excludes the ignored live `.lakebed/deploy.json` file that the staging safety checks correctly reject. It also binds the release to committed bytes rather than a mutable checkout.

## Prepare the capsule

Use the repository modules from the archived source:

- `runStagedTransaction` from `scripts/lakebed-build-transaction.mjs`
- `prepareLakebedStage` from `scripts/prepare-lakebed-deploy.mjs`
- `copyOwnedStageFile` from `scripts/lakebed-staging-safety.mjs` when the server environment exists

The operator-specific prepare callback must:

1. Set `plan.safeConfigSource = plan.configSource` before preparation. This retains the reviewed production `deployId`; the audit path normally removes it.
2. Call `prepareLakebedStage(plan)`.
3. Copy `.env.lakebed.server` into the owned capsule only when it exists.

The transaction creates the isolated `.lakebed` workspace, seals payload files, validates their identities before and after consumption, and removes the stage afterward.

## Invoke Lakebed

Inside the transaction consumer, spawn only:

```sh
npx lakebed deploy "$plan_capsule_root" --json
```

Use the transaction root as the command working directory and add `LAKEBED_COMPACT_BUNDLE=1` to the inherited environment. Capture stdout and stderr without printing credentials.

The compact client-bundle hash must match the hash from the preflight audit build. The claimed artifact hash can differ from the anonymous audit artifact hash, so obtain the final artifact hash from the post-deploy control plane.

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

If those checks pass, treat the deployment as completed and use the observed claimed `artifactHash` for `scripts/audit-lakebed-production.mjs --expected-artifact ...`. If they do not pass, stop and report the ambiguous state; do not retry automatically.

## First deployment versus updates

Routine releases update the deploy ID in `lakebed.json`; the public alias and database remain attached. Only a genuinely new deployment needs `npx lakebed claim` and `npx lakebed domains add craft.lakebed.app --json`. Never replace the production deploy as a shortcut around packaging or verification failures.
