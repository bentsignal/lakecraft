import assert from "node:assert/strict";
import {
  CLIENT_BUNDLE_SHARED_STRINGS,
  SERVER_BUNDLE_SHARED_STRINGS,
  hoistRepeatedBundleStrings,
} from "../scripts/bundle-string-hoisting.mjs";

const source = [
  'import value from "repeated_value";',
  'const lazy=()=>import("repeated_value");',
  'const object={"repeated_value":1};',
  'const a="repeated_value",b="repeated_value",c="repeated_value",d="repeated_value";',
  'export default [a,b,c,d,value,lazy,object];',
].join("");
const transformed = hoistRepeatedBundleStrings(source, ["repeated_value"]);
assert.ok(transformed.startsWith('const __lakecraftSharedBundleStrings=["repeated_value"];'));
assert.ok(transformed.includes('import value from "repeated_value"'), "static module specifiers remain syntax-safe");
assert.ok(transformed.includes('import("repeated_value")'), "dynamic module specifiers remain syntax-safe");
assert.ok(transformed.includes('{"repeated_value":1}'), "quoted property keys retain their wire shape");
assert.equal((transformed.match(/__lakecraftSharedBundleStrings\[0\]/g) ?? []).length, 4);
assert.deepEqual(
  hoistRepeatedBundleStrings(source, ["repeated_value"]),
  transformed,
  "the production transform is deterministic",
);
assert.equal(hoistRepeatedBundleStrings('const a="short",b="short",c="short";', ["short"]),
  'const a="short",b="short",c="short";',
  "short strings stay literal when a lookup cannot save bytes",
);
assert.throws(
  () => hoistRepeatedBundleStrings(`const __lakecraftSharedBundleStrings=[];`, ["repeated_value"]),
  /Reserved bundle string identifier/,
);
for (const candidates of [CLIENT_BUNDLE_SHARED_STRINGS, SERVER_BUNDLE_SHARED_STRINGS]) {
  assert.equal(new Set(candidates).size, candidates.length, "allowlisted strings stay unique");
  assert.ok(candidates.every((candidate) => candidate.length >= 8 && !/["\\\n\r]/.test(candidate)),
    "allowlisted strings are direct JSON literals supported by the transform");
}

console.log("production bundle string-hoisting tests passed");
