# Hosted HTTPS preview

Use this path whenever the user will test the work. It publishes an isolated, unclaimed Lakebed preview on a public HTTPS URL with hosted Google auth.

## Publish safely

Run the checked-in publisher from the worktree:

```sh
node tests/publishLakebedPreview.test.mjs
node scripts/publish-lakebed-preview.mjs
```

The publisher pins Lakebed 0.0.29 and TypeScript 5.9.3, builds the compact capsule, verifies its hashes and 32 KiB artifact headroom, removes the production deploy binding in an isolated stage, and calls the anonymous deployment endpoint directly. It deletes `LAKEBED_TOKEN` from its toolchain environment, so a developer login cannot turn a preview into an owned deployment.

Never run `npx lakebed deploy .` from the worktree. The root `lakebed.json` is bound to production.

The publisher stores the anonymous claim credential at `.lakebed/preview.json` with mode 0600. A later run updates the same worktree preview while it exists. If Lakebed reports it expired, the publisher creates one replacement. Never print the claim token or claim the preview.

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

Lakebed assigns and reports the exact expiry. Unclaimed previews stop serving after expiry and are eventually deleted; they have no CLI terminate operation. Reusing `.lakebed/preview.json` prevents repeated active deployments within one worktree. Do not create a fresh preview merely to refresh the URL.

The Lakebed 0.0.29 anonymous defaults are a 1 MiB artifact, 1 MiB state, 16,384 rows, 10,000 requests per day, and 1,000 mutations per day. Deploy creation is rate-limited. The publisher's audit requires 32 KiB of artifact headroom.

Each preview has a fresh database. After first Google sign-in, the user may need to choose a username. Production server-directory rows do not appear in the preview.
