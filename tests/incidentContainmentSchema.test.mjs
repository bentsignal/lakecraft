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
  "051aec1e0c70d5e72a8e763d6259e668ae2ebe88ca87e6d2882fd89e20bacb86",
  "removing containment declarations reproduces the reviewed integrated server behavior source",
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
// The reviewed runtime adds atomic chunk replacement, stable bounded torch
// lighting, render-only step easing, live paused-world presentation, and a
// first-painted-frame loading gate, connected glass, derived stair/door
// presentation, paired-door Railway commits, expanded thin-block skylight,
// the decorative catalog, and immutable Railway-served texture delivery;
// none adds another authority or transport.
assert.equal(runtimeFiles.length, 184, "reviewed main runtime file set changed");
assert.equal(runtimeHash.digest("hex"),
  "dd1e1d97ba0e70fd079753ada2a6e1af28fe7f2eeada3991c1de1c7fa3113efc",
  "runtime sources match the reviewed shared-gameplay authority and presentation boundary");

const clientSource = runtimeFiles.filter((path) => path.startsWith("client/"))
  .map((path) => read(path)).join("\n");
assert.doesNotMatch(clientSource,
  /SinglePlayerCloud|singlePlayerCloud|cloudBackupClient|mutateSinglePlayerCloudBackup|getIdentity/,
  "main client contains no cloud hook, transport, query, mutation, or identity seam");
assert.equal(existsSync(join(root, "client/singleplayer/SinglePlayerCloudTransport.tsx")), false);
assert.equal(existsSync(join(root, "client/singleplayer/cloudBackupClient.ts")), false);

console.log("incident containment schema is exact, inert, and reviewed-runtime preserving: ok");
