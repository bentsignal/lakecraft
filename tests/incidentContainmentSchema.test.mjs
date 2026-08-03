import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
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
  .replace(/\n    \/\*\* INCIDENT-CONTAINMENT-SCHEMA-END \*\/$/, "");
assert.equal(executableSchema, expectedSchema,
  "inert table fields and indexes stay byte-for-byte equal to the deployed checkpoint");

const withoutContainment = `${server.slice(0, start)}${server.slice(finish + end.length)}`
  .replace('.index("by_created", ["receiptCreatedAt"]),\n  },', '.index("by_created", ["receiptCreatedAt"])\n  },');
assert.equal(
  createHash("sha256").update(withoutContainment).digest("hex"),
  "8d16e16af75b6fe08cf3dabffafd24e47d05a8a61ffcd8398b3035dde8333867",
  "removing containment declarations reproduces the reviewed compact server behavior source",
);

assert.doesNotMatch(server, /\bsinglePlayerCloudBackups\s*:/,
  "containment must not expose a cloud query");
assert.doesNotMatch(server, /\bmutateSinglePlayerCloudBackup\s*:/,
  "containment must not expose a cloud mutation");
assert.doesNotMatch(server, /\bendpoint\([^)]*singlePlayerCloud/i,
  "containment must not expose a cloud endpoint");

const runtimeFiles = [];
function collect(directory) {
  for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) collect(path);
    else if (/\.[tj]sx?$/.test(entry.name) && path !== "server/index.ts") runtimeFiles.push(path);
  }
}
collect("client");
collect("shared");
collect("server");
runtimeFiles.sort();
const runtimeHash = createHash("sha256");
for (const path of runtimeFiles) {
  const contents = readFileSync(join(root, path));
  runtimeHash.update(relative(".", path));
  runtimeHash.update("\0");
  runtimeHash.update(String(contents.length));
  runtimeHash.update("\0");
  runtimeHash.update(contents);
}
assert.equal(runtimeFiles.length, 135, "reviewed main runtime file set changed");
assert.equal(runtimeHash.digest("hex"),
  "067ec8546277bb8da4c57f716966606014eda90fb642738ba2aaf8c830e56ec4",
  "runtime sources match the reviewed bedrock-floor, translated-terrain, diamond-depth, paused-pose, combat, and containment checkpoint");

const clientSource = runtimeFiles.filter((path) => path.startsWith("client/"))
  .map((path) => read(path)).join("\n");
assert.doesNotMatch(clientSource,
  /SinglePlayerCloud|singlePlayerCloud|cloudBackupClient|mutateSinglePlayerCloudBackup|getIdentity/,
  "main client contains no cloud hook, transport, query, mutation, or identity seam");
assert.equal(existsSync(join(root, "client/singleplayer/SinglePlayerCloudTransport.tsx")), false);
assert.equal(existsSync(join(root, "client/singleplayer/cloudBackupClient.ts")), false);

console.log("incident containment schema is exact, inert, and reviewed-runtime preserving: ok");
