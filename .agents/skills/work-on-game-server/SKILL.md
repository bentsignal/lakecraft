---
name: work-on-game-server
description: Use when changing Railway-owned multiplayer authority, persistence, protocols, or operations.
---

# Work on the Railway game server

Read `docs/architecture/gameplay-authority.md`,
`docs/architecture/railway-multiplayer.md`, and `apps/game-server/README.md`.

Railway SQLite is authoritative for all multiplayer gameplay and persistent
world state. Lakebed is only the identity, directory, registration, and scoped
join-ticket control plane. Do not introduce Lakebed gameplay polling, writes, or
fallback authority.

Keep operations bounded, transactional where conservation spans records,
revisioned, and replay-safe. Replays may return current canonical state to the
initiator but must not reapply inventory, damage, drops, edits, or broadcasts.
Preserve server isolation and validate ownership or reach again at every
mutation boundary.

Run the focused Bun tests in `apps/game-server/`, the shared protocol tests, and
the transactional gameplay QA when the change crosses authority boundaries.
Treat deployment of Railway or Lakebed as a separate production operation.
