# Incident containment schema

The server schema retains three inert tables from accidental deployment
`dep_GeGTYPSk0TrcWk9E`. They may contain signed-in users' single-player backup
data. Removing the declarations before someone reviews the hosted rows and
Lakebed's schema-removal behavior could either reject rollback or destroy data.
This containment target therefore
retains only the exact deployed table fields and indexes:

- `singlePlayerCloudBackupParts`
- `singlePlayerCloudBackupQuota`
- `singlePlayerCloudBackupBudgets`

The tables are inert. There is no cloud client, auth hook, query, mutation,
endpoint, automatic upload, restore, delete, migration, or cleanup path. A
regression test keeps the declarations isolated from the rest of the server.

The application neither reads nor changes existing rows. Export, retention,
deletion, schema removal, or any hosted inspection requires separate explicit
authorization. Retaining the declarations does not authorize any of those
actions.
