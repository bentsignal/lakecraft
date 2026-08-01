import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const server = read("server/index.ts");
const begin = "\n\n    /** INCIDENT-CONTAINMENT-SCHEMA-BEGIN";
const end = "    /** INCIDENT-CONTAINMENT-SCHEMA-END */";
const start = server.indexOf(begin);
const finish = server.indexOf(end, start);
assert.ok(start > 0 && finish > start, "containment schema has one bounded source region");
assert.equal(server.indexOf(begin, start + begin.length), -1, "containment start marker is unique");
assert.equal(server.indexOf(end, finish + end.length), -1, "containment end marker is unique");

const containment = server.slice(start + 2, finish + end.length);
const expectedSchema = `singlePlayerCloudBackupParts: table({
      userId: string(),
      worldId: string(),
      part: string(),
      data: string(),
    })
      .index(BS.byUser, ["userId"]),

    singlePlayerCloudBackupQuota: table({
      quotaKey: string(),
      activeStateBytes: string(),
      dayKey: string(),
      acceptedToday: string(),
      lastAcceptedAt: string(),
      revision: string(),
    }).index("by_key", ["quotaKey"]),

    singlePlayerCloudBackupBudgets: table({
      userId: string(),
      dayKey: string(),
      acceptedToday: string(),
      lastAcceptedAt: string(),
      activeBackup: string(),
      cleanupAfter: string(),
    })
      .index("by_user", ["userId"])
      .index("by_cleanup", ["activeBackup", "cleanupAfter"])`;
const executableSchema = containment
  .replace(/^.*INCIDENT-CONTAINMENT-SCHEMA-BEGIN[\s\S]*?\*\/\n    /, "")
  .replace(/\n    \/\*\* INCIDENT-CONTAINMENT-SCHEMA-END \*\/$/, "")
  .replace(/\n    \/\*\* (?:Transaction-serialized|Cross-tab\/device)[\s\S]*?\*\//g, "");
assert.equal(executableSchema, expectedSchema,
  "activated table fields and indexes stay byte-for-byte equal to the preserved incident schema");

assert.match(server, /singlePlayerCloudBackups: query\(async \(ctx\) => \{[\s\S]*?if \(!ctx\.auth\.isAuthenticated \|\| ctx\.auth\.isGuest\)/,
  "the activated read surface is signed-in-only");
assert.match(server, /mutateSinglePlayerCloudBackup: mutation\(async \(ctx, requestJson: string\) => \{[\s\S]*?if \(!ctx\.auth\.isAuthenticated \|\| ctx\.auth\.isGuest\)/,
  "the activated write surface is signed-in-only");
assert.doesNotMatch(server, /\bendpoint\([^)]*singlePlayerCloud/i,
  "cloud backup remains an authenticated Lakebed query/mutation protocol, never an external endpoint");
assert.match(server, /oldestByIndex\(ctx\.db\.singlePlayerCloudBackupParts,\s*BS\.byUser, \(q\) => q\.eq\(BS\.userId, ctx\.auth\.userId\)\)/,
  "query reads only the authenticated owner's exact index partition");
assert.match(server, /const userId = ctx\.auth\.userId[\s\S]*?q\.eq\(BS\.userId, userId\)/,
  "mutation derives ownership only from ctx.auth and never accepts an owner argument");
assert.doesNotMatch(server, /mutateSinglePlayerCloudBackup: mutation\(async \(ctx,\s*(?:userId|ownerId)/,
  "the mutation signature exposes no caller-forged owner selector");

const docs = read("docs/incident-containment.md");
assert.match(docs, /intentionally activated/i);
assert.match(docs, /no hosted data inspection/i);
assert.match(docs, /no deployment/i);

console.log("incident-preserved cloud schema is exact and its activated auth boundary is reviewed: ok");
