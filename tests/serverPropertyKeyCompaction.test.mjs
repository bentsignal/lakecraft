import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  COMPACT_SERVER_KEY_BUILTIN_EXCLUSIONS,
  COMPACT_SERVER_KEY_COUNTS,
  COMPACT_SERVER_KEY_EXCLUSIONS_FINGERPRINT,
  COMPACT_SERVER_EXTENDED_KEY_COUNT,
  COMPACT_SERVER_EXTENDED_KEY_FINGERPRINT,
  COMPACT_SERVER_EXTENDED_KEY_MINIMUM_GAIN,
  COMPACT_SERVER_KEY_MANIFEST_FINGERPRINT,
  COMPACT_SERVER_KEY_REVIEWED_SOURCE_DELTA,
  COMPACT_SERVER_KEY_SOURCE_FINGERPRINT,
  COMPACT_SERVER_KEY_UNCHANGED_SOURCE_FINGERPRINT,
  compactServerPropertyKeys,
} from "../scripts/server-property-key-compaction.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const names = Object.keys(COMPACT_SERVER_KEY_COUNTS);
assert.deepEqual(names, [...names].sort(), "server key manifest stays sorted");
assert.equal(names.length, 115, "server key compatibility boundary changes only intentionally");
assert.equal(COMPACT_SERVER_EXTENDED_KEY_COUNT, 286, "the reviewed extended interning boundary remains exact");
assert.equal(COMPACT_SERVER_EXTENDED_KEY_MINIMUM_GAIN, 10, "extended keys remain above the conservative floor");
assert.match(COMPACT_SERVER_EXTENDED_KEY_FINGERPRINT, /^[0-9a-f]{64}$/);
assert.deepEqual(names.filter((name) => COMPACT_SERVER_KEY_BUILTIN_EXCLUSIONS.includes(name)), [],
  "JavaScript, Lakebed auth, and database methods stay literal");
for (const [name, counts] of Object.entries(COMPACT_SERVER_KEY_COUNTS)) {
  assert.match(name, /^[A-Za-z_$][\w$]*$/);
  assert.equal(counts.length, 2);
  const estimatedNet = counts[0] * (name.length - 3) + counts[1] * (name.length - 4) - name.length - 11;
  assert.ok(estimatedNet > 0, `${name} remains above the reviewed break-even floor`);
}

const fixture = [
  "const schema={inventories:{revision:'0'}};",
  "const result={reason:'conflict',serverNow:7,itemId:'stone',fingerprint:'fp'};",
  "globalThis.__lakecraftServerKeyFixture=[",
  "schema.inventories.revision,result.reason,result.serverNow,result.itemId,result.fingerprint,",
  "Object.keys(schema),Object.keys(schema.inventories),Object.keys(result),JSON.stringify(result)];",
].join("");
const fixtureManifest = {
  fingerprint: [1, 1],
  inventories: [2, 1],
  itemId: [1, 1],
  reason: [1, 1],
  revision: [1, 1],
  serverNow: [1, 1],
};
const expected = ["0", "conflict", 7, "stone", "fp",
  ["inventories"], ["revision"], ["reason", "serverNow", "itemId", "fingerprint"],
  '{"reason":"conflict","serverNow":7,"itemId":"stone","fingerprint":"fp"}'];
new Function(fixture)();
assert.deepEqual(globalThis.__lakecraftServerKeyFixture, expected, "untransformed fixture is canonical");
delete globalThis.__lakecraftServerKeyFixture;
const transformed = await compactServerPropertyKeys(fixture, fixtureManifest);
new Function(transformed)();
assert.deepEqual(globalThis.__lakecraftServerKeyFixture, expected,
  "computed keys preserve schema names, reads, Object.keys order, and serialized result shape byte-for-byte");
delete globalThis.__lakecraftServerKeyFixture;
await assert.rejects(
  compactServerPropertyKeys(fixture, { ...fixtureManifest, reason: [2, 1] }),
  /reason live set changed/,
  "AST live-set drift fails closed",
);

const analysis = JSON.parse(execFileSync(
  process.execPath,
  [join(root, "scripts/analyze-client-properties.mjs")],
  { cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
));
const fingerprintInput = names.map((name) => ({
  name,
  declarations: (analysis.declarationPaths[name] ?? []).filter((path) => !path.startsWith("tests/")),
  uses: (analysis.propertyUsePaths[name] ?? []).filter((path) => !path.startsWith("tests/")),
  counts: Object.fromEntries(Object.entries(analysis.propertyUseCounts[name] ?? {})
    .filter(([path]) => !path.startsWith("tests/"))),
  kinds: Object.fromEntries(Object.entries(analysis.declarationKinds[name] ?? {})
    .filter(([path]) => !path.startsWith("tests/"))),
}));
const fingerprint = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const reviewedKeyNames = Object.keys(COMPACT_SERVER_KEY_REVIEWED_SOURCE_DELTA)
  .filter((name) => Object.hasOwn(COMPACT_SERVER_KEY_COUNTS, name));
assert.equal(fingerprint(COMPACT_SERVER_KEY_COUNTS), COMPACT_SERVER_KEY_MANIFEST_FINGERPRINT,
  "compact key names, counts, order, and emitted runtime strings stay unchanged");
assert.equal(fingerprint(COMPACT_SERVER_KEY_BUILTIN_EXCLUSIONS), COMPACT_SERVER_KEY_EXCLUSIONS_FINGERPRINT,
  "the JavaScript, Lakebed, auth, and database exclusion boundary stays unchanged");
assert.equal(
  fingerprint(fingerprintInput.filter(({ name }) => !reviewedKeyNames.includes(name))),
  COMPACT_SERVER_KEY_UNCHANGED_SOURCE_FINGERPRINT,
  "every non-reviewed key keeps identical declaration/use paths, counts, and kinds",
);
for (const name of reviewedKeyNames) {
  const delta = COMPACT_SERVER_KEY_REVIEWED_SOURCE_DELTA[name];
  const current = fingerprintInput.find((entry) => entry.name === name);
  assert.ok(current, `${name} remains in the analyzed source boundary`);
  for (const path of delta.declarations ?? []) {
    assert.ok(current.declarations.includes(path), `${name} keeps its reviewed declaration path ${path}`);
  }
  const normalized = JSON.parse(JSON.stringify(current));
  normalized.declarations = normalized.declarations.filter((path) => !(delta.declarations ?? []).includes(path));
  for (const path of delta.uses ?? []) {
    assert.ok(current.uses.includes(path), `${name} keeps its reviewed use path ${path}`);
  }
  normalized.uses = normalized.uses.filter((path) => !(delta.uses ?? []).includes(path));
  for (const path of delta.removedUses ?? []) {
    assert.equal(current.uses.includes(path), false, `${name} removes its reviewed use path ${path}`);
  }
  normalized.uses = [...normalized.uses, ...(delta.removedUses ?? [])].sort();
  for (const [path, [previousUses, currentUses]] of Object.entries(delta.counts ?? {})) {
    assert.equal(current.counts[path] ?? null, currentUses, `${name} keeps its reviewed property-use count at ${path}`);
    if (previousUses === null) delete normalized.counts[path];
    else normalized.counts[path] = previousUses;
  }
  normalized.counts = Object.fromEntries(Object.entries(normalized.counts).sort());
  for (const [kind, [previousCount, currentCount]] of Object.entries(delta.kinds ?? {})) {
    assert.equal(current.kinds[kind], currentCount, `${name} keeps its reviewed declaration-kind count at ${kind}`);
    if (previousCount === null) delete normalized.kinds[kind];
    else normalized.kinds[kind] = previousCount;
  }
  assert.equal(fingerprint(normalized), delta.previousEntryFingerprint,
    `${name} paths and every non-reviewed count/kind reproduce the prior checkpoint exactly`);
}
assert.equal(
  fingerprint(fingerprintInput),
  COMPACT_SERVER_KEY_SOURCE_FINGERPRINT,
  "server key declaration/use paths, counts, and declaration kinds cannot drift",
);

console.log("compact server property-key live-set and exact-shape parity tests passed");
