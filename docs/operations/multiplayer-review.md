# Multiplayer review environments

Use the Railway CLI installed on the developer's machine. Contributors pay for
and control their own test resources. Never put a maintainer Railway token in
PR workflows, fork secrets, or repository configuration. The helper rejects CI
and Railway environment tokens and checks the logged-in account before changes.

## When a world is needed

Shared gameplay, inventory, multiplayer UI, authentication, protocol, server,
and persistence changes require multiplayer review. Pure menu changes do not
require a Railway world. When uncertain, test multiplayer rather than treating
a file-path filter as proof that it is unaffected.

Each active development branch gets its own project, service, and `/data`
volume. A maintainer release checkout retains a separate `preview` binding.
Neither duplicates production services, variables, credentials, or world data.
Only one authoritative process may use a volume. Do not enable sleeping.

## Bootstrap with your CLI account

Install the [Railway CLI](https://docs.railway.com/cli), then run
`railway login` if `railway whoami --json` is not authenticated. Select an exact
workspace ID from that output. For this repository's helper, use Railway 5.49.2
or a version whose command/output compatibility has been checked.

From a development branch:

```sh
node scripts/railway-multiplayer.mjs init development --workspace WORKSPACE_UUID
```

This creates an empty service, isolated volume, and HTTPS domain. It does not
deploy gameplay until Lakebed registration is complete. The default empty
Railway `production` environment is unused. Local binding records are under
ignored `.lakebed/railway/`, keyed by channel and branch. Keep them private.

Provisioning records each acquired resource before the next step. If a step
fails, inspect that record and the exact project with the CLI. Do not blindly
rerun creation or discard the record; partial resources may already exist.

## Register and deploy

1. Follow the development skill to commit, push, and publish the Lakebed URL.
2. Run `node scripts/railway-multiplayer.mjs status development`. Open its
   `setupUrl`, sign in, and claim a username if needed. Register the supplied
   Railway address, then download the registration credential. The screen uses
   ordinary authenticated, owner-scoped registration, not an auth bypass.
3. Move the download into ignored `.lakebed/` and set mode `0600`. Never upload
   it to a PR, print it, or put it in a command argument. Its deploy ID, origin,
   and WSS address must match the review environment.
4. Deploy the exact pushed revision:

   ```sh
   node scripts/railway-multiplayer.mjs deploy development \
     --registration-file .lakebed/review-registration.json
   ```

The helper runs the shared validation gate and uploads a clean commit archive
through `railway up`, with explicit project, environment, and service IDs.
Server secrets travel through CLI stdin. The server uses `AUTH_MODE=lakebed`
and redeems tickets only at this review's Lakebed origin. No demo-token identity
is used to stand in for authenticated testing.

Submission is not verification. Inspect the exact deployment with
`railway deployment list` and bounded logs. Require a successful deployment,
the expected revision, and `/status` before testing. Use two signed-in browsers
to verify joins, shared edits, inventory, reconnects, and persistence after a
server restart. A health response alone does not pass multiplayer review.

Reuse the binding and volume during branch feedback. If the Lakebed URL expires
or is replaced, register in the replacement deployment and reconfigure Railway.
Do not broaden production's origin allowlist to accommodate test clients.

## Release preview and production

For integrated testing, use the same commands with `preview` from synced `main`
in the maintainer release checkout. Reuse that project's volume between
candidates unless a reviewed fixture reset is necessary. Test Survival and
Creative separately when affected; a single world profile is not both.

Record the Lakebed commit/artifact, Railway deployment ID and source revision,
configuration, world profile, and browser test results with the candidate.
Candidate changes invalidate approval. The helper has no production mode.

Production Railway rollout remains a separate operator step. Before shipping,
resolve immutable server image digests, back up the affected volumes, review
client/server compatibility and migration order, and verify each world before
continuing the Lakebed production skill. Never promote a test volume or mutable
`railway-beta` tag as if it were an approved release. Forward-only world data
changes can make a binary rollback unsafe.

The end-to-end hosted registration/join flow must be verified before this setup
can be called release-ready. Asset hosting is still coupled to production
Railway URLs in `scripts/remote-texture-assets.mjs`; new asset testing needs a
separate delivery change, not test writes to production worlds.

## Cleanup

After review is finished, agree whether the test world should be retained.
Deleting it removes its test data and stops its ongoing resource usage:

```sh
node scripts/railway-multiplayer.mjs destroy development --confirm-project PROJECT_UUID
```

The helper verifies account and isolated topology before requesting deletion.
Retain its deletion record until Railway confirms removal. Do not clean up the
persistent release-preview project after each branch or destroy a test world
that the user is still reviewing. No scheduled cleanup uses a shared token.
