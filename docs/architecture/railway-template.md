# Railway multiplayer template

The Railway template runs one Lakecraft world as a Bun process backed by a
SQLite volume. It uses the public
`ghcr.io/bentsignal/lakecraft-server:railway-beta` image, exposes `/status` for
health checks, and accepts player sockets at `wss://YOUR-DOMAIN/ws`.

Railway creates the public domain, a 500 MB volume mounted at `/data`, and the
invitation and administrator secrets. The service stays at one replica because
one SQLite file owns the world. The volume keeps player and block state through
restarts and image updates.

You need a Railway account with enough usage allowance for one running service
and its volume. You do not need a repository connection or private registry
credentials.

After deployment, copy the generated domain from Railway's Networking settings.
Reveal `LOCAL_DEMO_TOKEN` under Variables. Send the WebSocket address and token
separately, and only to trusted players. The shared beta token does not prove an
individual player's identity.
