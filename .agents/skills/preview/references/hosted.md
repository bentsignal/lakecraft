# Hosted review deployments

Use this path for browser verification of development and release-preview
deployments. Both use isolated, unclaimed Lakebed HTTPS URLs with hosted Google
auth. Read [the delivery contract](../../../../docs/operations/workflows.md).

## Publish safely

Run the gated publisher from a committed, pushed worktree branch:

```sh
node scripts/publish-review.mjs development
```

The publisher pins Lakebed 0.0.29 and TypeScript 5.9.3, builds the compact capsule, verifies its hashes and 32 KiB artifact headroom, removes the production deploy binding in an isolated stage, and calls the anonymous deployment endpoint directly. It deletes `LAKEBED_TOKEN` from its toolchain environment, so a developer login cannot turn a preview into an owned deployment.

Never run `npx lakebed deploy .` from the worktree. The root `lakebed.json` is bound to production.

For integrated release testing, use `node scripts/publish-review.mjs preview`
on synced `main`. Both commands run the complete shared validation gate and
publish an archive of the exact pushed commit. The deployment build must match
the validated artifact and client hashes. The low-level publisher is an
implementation helper, not a substitute for the gate.

Development credentials live in `.lakebed/development.json`; release preview
credentials live in `.lakebed/release-preview.json`, both with mode 0600. Reruns
update the same URL while the deployment exists. An expired deployment gets
one replacement. Never print the token or claim the deployment. Sanitized
receipts under `.lakebed/reviews/` can be attached to PRs and prereleases.

## Refresh during review

Once the user starts a hosted-preview review cycle, run the publisher after every completed revision before handing the work back. Run it even when the public URL will remain the same because the deployed contents still need to be refreshed. Present the URL again after each successful refresh so the user can open the latest build directly. If publishing fails, say that the existing preview may be stale instead of presenting it as current.

Verify the reported URL:

```sh
curl --fail --silent --show-error --location '<preview-url>/' >/dev/null
curl --fail --silent --show-error --location '<preview-url>/?multiplayer=1' >/dev/null
curl --fail --silent --show-error '<preview-url>/api/status'
```

Use the collaborative browser when available. Confirm that `/` mounts no auth UI, `/?multiplayer=1` displays the sign-in gate without a server list, and Google sign-in starts. Interactive completion may require the user's Google session.

Report the public Lakebed URL for user testing. This preview is a real hosted deployment, but it is not the project's production binding.

## Lifecycle and limits

Lakebed assigns and reports the exact expiry. Unclaimed previews stop serving
after expiry and are eventually deleted. Reuse the stage-specific binding;
do not create a fresh preview merely to refresh the URL.

The Lakebed 0.0.29 anonymous defaults are a 1 MiB artifact, 1 MiB state, 16,384 rows, 10,000 requests per day, and 1,000 mutations per day. Deploy creation is rate-limited. The publisher's audit requires 32 KiB of artifact headroom.

Each preview has a fresh database. After first Google sign-in, the user may need to choose a username. Production server-directory rows do not appear in the preview.

These URLs are public HTTPS, not access-controlled private environments. They
need no Tailscale, tunnel, or running developer machine. Each origin has separate
browser-local saves. Multiplayer changes require an isolated Railway server
registered to this environment. Never connect test writes to a production world
or claim an untested backend is covered by the capsule's URL.
