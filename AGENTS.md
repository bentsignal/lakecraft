# Lakebed App Instructions

This directory is for a Lakebed "capsule". Lakebed is an all-inclusive suite of tools to build web applications purely from code and a CLI.

Your role is to build software within this capsule. Lakebed is the runtime, the compiler, the database, and the hosting platform. You will be able to control all of this just by writing code and running commands through the CLI.

## Hard rules

- No installing node modules. You can use the built-in APIs. Write TypeScript for anything that is not included.
- Lakebed CLI should always be run with `npx lakebed [command]`. It is not a global. Launch with `npx` always.
- All client code goes in the `client` directory, and all server code goes in the `server` directory. Shared code can go in `shared`.
- Use `lakebed/server` only from `server/*.ts`.
- Use `lakebed/client` only from `client/*.tsx`.
- Data needed on client should be fetched through queries. User-driven changes should be done via mutations. Endpoints should be treated as an "escape hatch" for exposing functionality over endpoints for HTTP-based flows.
- Styling must be done via raw CSS or Tailwind classes in the JSX.
- Do not add a CSS, PostCSS, or Tailwind build pipeline. They are built in.
- Favicons can live at `favicon.svg` or `favicon.ico`; for another capsule path, set `favicon: "assets/icon.svg"` in `server/index.ts`.
- There is no file based routing. Use the built-in client router from `lakebed/client` when you need pages.
- All imports must be from Lakebed or from relative paths.
- Do not use Node built-ins in app code.
- Use auth through `ctx.auth` on the server and `useAuth()` on the client.
- Read server-only environment variables through `ctx.env`; define them in `.env.lakebed.server`.
- Auth can be added with a Google sign-in using `<SignInWithGoogle />` or `signInWithGoogle()` from `lakebed/client`.
- Database calls are async. Await or directly return every `get`, `insert`, `update`, `delete`, `collect`, `take`, `first`, and `paginate` call.
- Declare indexes with `.index(name, fields)` and query them with `withIndex`. Do not use legacy `where`, `orderBy`, `limit`, or `all`.
- Use the built-in `by_creation` index for unfiltered creation-order queries. Use `id("tableName")` for references to another Lakebed table.
- Keep queries read-only. Put writes in mutations or endpoints, and re-check ownership before updating or deleting user-owned rows.
- Keep `shared/` free of DOM, Node, env, and Lakebed runtime imports.
- Environment variables are only available on the server, and must be defined in `.env.lakebed.server`. They are not available during build time. If you need build-time environment variables, define them in code and do conditional logic based on them. They are synced to your hosted deploy when you run `npx lakebed deploy` (the deploy must be claimed first).

## Default project structure

- `server/index.ts`: schema, queries, mutations, and external endpoints.
- `client/index.tsx`: Preact UI entrypoint.
- `shared/`: pure TypeScript shared by client and server.

## Commands

Run locally:

```sh
npx lakebed dev
```

Deploy:

```sh
npx lakebed deploy
```

Inspect local state while `npx lakebed dev` is running:

```sh
npx lakebed db list --port 3000
npx lakebed db dump --port 3000
npx lakebed db export --port 3000 --out backup.json
npx lakebed logs --port 3000
```

## External endpoints

Use `endpoint({ method, path }, handler)` from `lakebed/server` when the app needs to expose an HTTP route for webhooks or other non-Lakebed clients. Endpoint handlers receive request data including `headers.get(name)`, URL params, query params, and body helpers.

## Additional resources

- [Lakebed docs](https://docs.lakebed.dev/)
- [Capsule API docs](https://docs.lakebed.dev/capsule-api/)
- [Database guide](https://docs.lakebed.dev/database/)
- [Database API v1 migration guide](https://docs.lakebed.dev/database-migration/)

## Current Limits

- One server entry.
- One client entry.
- Guest auth locally, with built-in Google sign-in through Lakebed Auth.
- User-uploaded files use built-in object storage (`client.storage`); `npx lakebed dev` keeps them in memory and resets on restart.
- Static capsule assets are limited to the favicon.
- No outbound fetch in anonymous deploys. Claim the deploy before using server-side fetch.
- Non-empty `.env.lakebed.server` files sync only after a deploy is claimed.
- Local state resets when `npx lakebed dev` restarts.
- Hosted deploys are served on `lakebed.app` subdomains.
