# Deploy and Host Lakecraft Multiplayer Server on Railway

Lakecraft Multiplayer Server is the persistent realtime backend for Lakecraft's
browser-based multiplayer mode. This template creates an invitation-only server
with a generated public WebSocket address, generated access token, and a durable
SQLite world volume.

## About Hosting Lakecraft Multiplayer Server

The service runs the public `ghcr.io/bentsignal/lakecraft-server:railway-beta`
image as one Bun process. Railway terminates HTTPS and WSS, checks `/status`, and
mounts a persistent volume at `/data`. Player positions and block edits survive
deployments and restarts while the public domain remains stable.

## Why Deploy Lakecraft Multiplayer Server on Railway

- No local port forwarding, router configuration, Node installation, or Docker
  setup is required.
- Railway generates the public domain and high-entropy invitation credentials.
- The included volume persists the shared world across restarts and updates.
- The service is preconfigured for `https://craft.lakebed.app`, one replica,
  health checks, and automatic restart.

## Common Use Cases

- Host a private Lakecraft world for friends.
- Test Lakecraft multiplayer across multiple computers and networks.
- Run a persistent development or playtest server without keeping a laptop on.

## Dependencies for Lakecraft Multiplayer Server Hosting

### Deployment Dependencies

- A Railway account with enough trial credit or account usage allowance to run
  one small always-on service and one 500 MB volume.
- A current browser and the Lakecraft client at `https://craft.lakebed.app`.
- No repository connection or private container-registry credentials are needed;
  the server image is public.

After deployment, open the service's Networking settings and copy its generated
domain. Players connect to `wss://YOUR-DOMAIN/ws`. Reveal
`LOCAL_DEMO_TOKEN` in Variables and share it privately, separately from the
address. This beta token is intended only for trusted friends.
