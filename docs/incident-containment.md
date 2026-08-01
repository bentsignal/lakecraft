# Incident-preserved cloud backup schema

The three single-player cloud tables retained during incident containment are
now intentionally activated by the reviewed signed-in backup protocol. Their
field and index topology remains exactly preserved:

- `singlePlayerCloudBackupParts`
- `singlePlayerCloudBackupQuota`
- `singlePlayerCloudBackupBudgets`

Activation is deliberately narrow. The server exposes one authenticated query
and one authenticated mutation; guest and signed-out calls are rejected before
database access. Ownership always comes from `ctx.auth.userId`, part reads use
the exact owner index, writes re-check that owner, and no external cloud-backup
endpoint exists.

The protocol bounds owner rows, payload chunks, aggregate bytes, daily writes,
and global storage. A global generation supplies compare-and-swap revisions.
Permanent deletion replaces payload with a durable owner/world tombstone, and
malformed owner state can only be disposed in bounded owner-scoped batches that
finish behind an explicit account fence. Cross-owner cleanup candidates are
validated independently and skipped when malformed or still associated with
parts.

This activation does not authorize operational action against the earlier
incident. During development there was no hosted data inspection and no deployment.
There was also no export, retention change, deletion, schema removal, or
control-plane action.
Any such action still requires separate explicit authorization and a reviewed
operations plan.
