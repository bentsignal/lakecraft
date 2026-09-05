# Hosted review deployments

Use this path for browser verification of development and release-preview
deployments. Both use isolated, unclaimed Lakebed HTTPS URLs. Read
[the delivery contract](../../../../docs/operations/workflows.md) for hosting
boundaries and the owning stage skill for publishing and review steps.

## Publish safely

The publisher pins Lakebed 0.0.29 and TypeScript 5.9.3, builds the compact capsule, verifies its hashes and 32 KiB artifact headroom, removes the production deploy binding in an isolated stage, and calls the anonymous deployment endpoint directly. It deletes `LAKEBED_TOKEN` from its toolchain environment, so a developer login cannot turn a preview into an owned deployment.

Never run `npx lakebed deploy .` from the worktree. The root `lakebed.json` is bound to production.

`scripts/publish-review.mjs` owns gated publication for both stages. The
low-level publisher is an implementation helper, not a substitute for the gate.

Development credentials live in `.lakebed/development.json`; release preview
credentials live in `.lakebed/release-preview.json`, both with mode 0600. Reruns
update the same URL while the deployment exists. An expired deployment gets
one replacement. Never print the token or claim the deployment. Sanitized
receipts under `.lakebed/reviews/` can be attached to PRs and prereleases.

## Browser verification

The publisher probes `/`, `/?multiplayer=1`, and `/api/status`. Its receipt
records HTTP verification, not successful gameplay or authentication. Do not
repeat those probes as a separate delivery gate.

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
