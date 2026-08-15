import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  COMPACT_CLIENT_BUILTIN_ALIASES,
  COMPACT_CLIENT_BUILTIN_OCCURRENCES,
  COMPACT_CLIENT_BUILTIN_SOURCE_FINGERPRINT,
  compactClientBuiltinAliases,
} from "../scripts/client-builtin-alias-compaction.mjs";

assert.equal(COMPACT_CLIENT_BUILTIN_ALIASES.length, 24, "the alias boundary remains deliberately narrow");
assert.equal(COMPACT_CLIENT_BUILTIN_OCCURRENCES, 1_962);
assert.equal(COMPACT_CLIENT_BUILTIN_SOURCE_FINGERPRINT,
  "791be36eaec7273512d8fbcfc9630c375ee36f5f1f5ea54d38df4c81558782ba");
assert.deepEqual(COMPACT_CLIENT_BUILTIN_ALIASES.map(([receiver, method]) => `${receiver}.${method}`), [
  "Math.abs", "Math.cos", "Math.ceil", "Math.floor", "Math.hypot", "Math.imul", "Math.max", "Math.min",
  "Math.round", "Math.sin", "Math.PI", "Object.freeze", "Object.keys", "Array.isArray", "Number.isFinite",
  "Number.isInteger", "Number.isSafeInteger", "Number.MAX_SAFE_INTEGER", "Number.NEGATIVE_INFINITY",
  "Number.POSITIVE_INFINITY", "Number.parseInt", "Date.now", "JSON.stringify", "JSON.parse",
]);
assert.deepEqual(Object.fromEntries(COMPACT_CLIENT_BUILTIN_ALIASES
  .filter(([receiver, method]) => ["Math.max", "Object.freeze", "Array.isArray", "Number.isSafeInteger"]
    .includes(`${receiver}.${method}`))
  .map(([receiver, method, count]) => [`${receiver}.${method}`, count])), {
  "Math.max": 249,
  "Object.freeze": 161,
  "Array.isArray": 88,
  "Number.isSafeInteger": 50,
}, "the chunk stream and terrain descriptor keep their validation primitive counts reviewed");

const fixtureKeys = [
  "Math.abs", "Math.cos", "Math.ceil", "Math.floor", "Math.hypot", "Math.imul", "Math.max", "Math.min",
  "Math.round", "Math.sin", "Math.PI", "Object.freeze", "Object.keys", "Array.isArray", "Number.isFinite",
  "Number.isInteger", "Number.isSafeInteger", "Number.MAX_SAFE_INTEGER", "Number.NEGATIVE_INFINITY",
  "Number.POSITIVE_INFINITY", "Number.parseInt", "Date.now", "JSON.stringify", "JSON.parse",
];
const fixture = "globalThis.__lcAliasFixture=[Math.abs(-4),Math.cos(0),Math.ceil(2.1),Math.floor(2.9),Math.hypot(3,4),Math.imul(2,3),Math.max(3,7),Math.min(-4,9),Math.round(2.5),Math.sin(0),Math.PI,Object.freeze({a:1}).a,Object.keys({a:1}).length,Array.isArray([]),Number.isFinite(4),Number.isInteger(4),Number.isSafeInteger(4),Number.MAX_SAFE_INTEGER,Number.NEGATIVE_INFINITY,Number.POSITIVE_INFINITY,Number.parseInt(\"12\",10),typeof Date.now()===\"number\",JSON.stringify({a:1}),JSON.parse(\"{\\\"a\\\":1}\").a];";
const fixtureBoundary = {
  counts: Object.freeze(Object.fromEntries(fixtureKeys.map((key) => [key, 1]))),
  occurrences: fixtureKeys.length,
  fingerprint: createHash("sha256").update(JSON.stringify(fixtureKeys)).digest("hex"),
};
const transformed = await compactClientBuiltinAliases(fixture, fixtureBoundary);
new Function(transformed)();
assert.deepEqual(globalThis.__lcAliasFixture, [4, 1, 3, 2, 5, 6, 7, -4, 3, 0, Math.PI, 1, 1, true, true, true, true, Number.MAX_SAFE_INTEGER, -Infinity, Infinity, 12, true, '{"a":1}', 1],
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
const callbackFixture = `${fixture}globalThis.__lcAliasCallback=[2.9].map(Math.floor);`;
const callbackKeys = [...fixtureKeys, "Math.floor"];
const callbackTransformed = await compactClientBuiltinAliases(callbackFixture, {
  counts: Object.freeze({ ...fixtureBoundary.counts, "Math.floor": 2 }),
  occurrences: callbackKeys.length,
  fingerprint: createHash("sha256").update(JSON.stringify(callbackKeys)).digest("hex"),
});
new Function(callbackTransformed)();
assert.deepEqual(globalThis.__lcAliasCallback, [2],
  "receiver-independent aliases preserve callback references as well as direct calls");
delete globalThis.__lcAliasCallback;
delete globalThis.__lcAliasFixture;
await assert.rejects(
  compactClientBuiltinAliases("Math.floor=()=>0;Math.floor(1);", fixtureBoundary),
  /is mutated/,
);
await assert.rejects(
  compactClientBuiltinAliases(fixture, { ...fixtureBoundary, occurrences: 4 }),
  /live set changed/,
);

console.log("compact client builtin alias live-set and parity tests passed");
