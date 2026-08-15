# Lakecraft server operator tools

These dependency-free Node scripts turn a Railway domain into the exact URL
Lakecraft's Direct Connect field expects and validate the environment/template
handoff without reading or printing secret values.

```sh
node --test tools/lakecraft-server/provider.test.mjs
node tools/lakecraft-server/cli.mjs template-check
node tools/lakecraft-server/cli.mjs secrets
node tools/lakecraft-server/cli.mjs connection example.up.railway.app
node tools/lakecraft-server/cli.mjs check https://example.up.railway.app
```

Deploy the current beta with the published
[Lakecraft Multiplayer Server template](https://railway.com/deploy/lakecraft-multiplayer-server).
`railway-template-plan.json` is the reviewed, testable mirror of that Railway
template. It is deliberately not presented as an importable Railway manifest.
The marketplace overview lives in `docs/railway-template-overview.md`.

The template also generates an `ADMIN_TOKEN`. Use it from an operator terminal
to mint a one-time pairing code at `/admin/api/pair-code`, then enter that short
code at `https://YOUR-DOMAIN/admin`. The command deck stores a signed browser
session without exposing the service token to the page. Keep the admin token
separate from the invitation token; the `secrets` command generates both independently.
