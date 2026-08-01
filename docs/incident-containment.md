# Incident containment schema

This branch is a non-destructive containment target for accidental deployment
`dep_GeGTYPSk0TrcWk9E`. It starts from exact main commit
`e245f0ba0a4b4654eb03e720d071bcd16b941c43` and preserves main client and
runtime behavior.

The accidental deployment introduced three tables that may contain signed-in
users' single-player backup data. Removing those declarations before the
hosted row state and Lakebed's schema-removal behavior are explicitly reviewed
could either reject rollback or destroy data. This containment target therefore
retains only the exact deployed table fields and indexes:

- `singlePlayerCloudBackupParts`
- `singlePlayerCloudBackupQuota`
- `singlePlayerCloudBackupBudgets`

The tables are inert. There is no cloud client, auth hook, query, mutation,
endpoint, automatic upload, restore, delete, migration, or cleanup path. A
regression test proves that removing the marked declarations reproduces the
exact main server source and that every other client, shared, and server runtime
source remains byte-for-byte equal to main.

Existing rows are intentionally neither read nor changed. Export, retention,
deletion, schema removal, or any hosted inspection requires separate explicit
authorization. This branch must not be used to infer consent for any of those
actions.
