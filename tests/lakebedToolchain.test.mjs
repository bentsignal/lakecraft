import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalJson, LAKEBED_ARTIFACT_FORMAT, LAKEBED_NPX_ARGS } from "../scripts/lakebed-toolchain.mjs";

test("v2 artifact hashes canonicalize nested object keys without reordering arrays", () => {
  assert.equal(canonicalJson(JSON.parse('{"z":[{"b":2,"a":1},null],"a":true}')),
    '{"a":true,"z":[{"a":1,"b":2},null]}');
  assert.equal(canonicalJson(JSON.parse('{"__proto__":{"z":1,"a":2}}')),
    '{"__proto__":{"a":2,"z":1}}');
  assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1]));
  assert.equal(LAKEBED_ARTIFACT_FORMAT, "lakebed.capsule.artifact.v2");
  assert.ok(LAKEBED_NPX_ARGS.includes("lakebed@0.0.33"));
});
