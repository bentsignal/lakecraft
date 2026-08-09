import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  COMPACT_CLIENT_BUILTIN_ALIASES,
  COMPACT_CLIENT_BUILTIN_OCCURRENCES,
  COMPACT_CLIENT_BUILTIN_SOURCE_FINGERPRINT,
  compactClientBuiltinAliases,
} from "../scripts/client-builtin-alias-compaction.mjs";

assert.equal(COMPACT_CLIENT_BUILTIN_ALIASES.length, 10, "the alias boundary remains deliberately narrow");
assert.equal(COMPACT_CLIENT_BUILTIN_OCCURRENCES, 1_219);
assert.match(COMPACT_CLIENT_BUILTIN_SOURCE_FINGERPRINT, /^[0-9a-f]{64}$/);
assert.deepEqual(COMPACT_CLIENT_BUILTIN_ALIASES.map(([receiver, method]) => `${receiver}.${method}`), [
  "Math.abs", "Math.cos", "Math.ceil", "Math.floor", "Math.hypot", "Math.max", "Math.min", "Math.round",
  "Math.sin", "Object.freeze",
]);

const fixtureKeys = [
  "Math.abs", "Math.cos", "Math.ceil", "Math.floor", "Math.hypot", "Math.max", "Math.min", "Math.round",
  "Math.sin", "Object.freeze",
];
const fixture = "globalThis.__lcAliasFixture=[Math.abs(-4),Math.cos(0),Math.ceil(2.1),Math.floor(2.9),Math.hypot(3,4),Math.max(3,7),Math.min(-4,9),Math.round(2.5),Math.sin(0),Object.freeze({a:1}).a];";
const fixtureBoundary = {
  counts: Object.freeze(Object.fromEntries(fixtureKeys.map((key) => [key, 1]))),
  occurrences: fixtureKeys.length,
  fingerprint: createHash("sha256").update(JSON.stringify(fixtureKeys)).digest("hex"),
};
const transformed = await compactClientBuiltinAliases(fixture, fixtureBoundary);
new Function(transformed)();
assert.deepEqual(globalThis.__lcAliasFixture, [4, 1, 3, 2, 5, 7, -4, 3, 0, 1],
  "receiver-independent aliases preserve native call results and argument order");
delete globalThis.__lcAliasFixture;
for (const key of fixtureKeys) {
  assert.equal(transformed.split(key).length - 1, 1, `${key} remains only in the one-time alias declaration`);
}

await assert.rejects(
  compactClientBuiltinAliases("const Math={floor(){return 0}};Math.floor(1);", fixtureBoundary),
  /Math is shadowed/,
);
await assert.rejects(
  compactClientBuiltinAliases("Math['floor'](1);", fixtureBoundary),
  /computed Math access/,
);
await assert.rejects(
  compactClientBuiltinAliases("const callback=Math.floor;callback(1);", fixtureBoundary),
  /outside a direct, non-optional call/,
);
await assert.rejects(
  compactClientBuiltinAliases("Math.floor=()=>0;Math.floor(1);", fixtureBoundary),
  /is mutated/,
);
await assert.rejects(
  compactClientBuiltinAliases(fixture, { ...fixtureBoundary, occurrences: 4 }),
  /live set changed/,
);

console.log("compact client builtin alias live-set and parity tests passed");
