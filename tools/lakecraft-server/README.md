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

`railway-template-plan.json` is a reviewed handoff for Railway's template
composer. It is deliberately not presented as an importable Railway manifest:
Railway config-as-code covers build/deploy settings, while the template composer
creates volumes, variables, and public domains.
