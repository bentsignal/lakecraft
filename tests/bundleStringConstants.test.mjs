import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const constantsSource = readFileSync(join(repositoryRoot, "shared/bundleStrings.ts"), "utf8");
const prepareSource = readFileSync(join(repositoryRoot, "scripts/prepare-lakebed-deploy.mjs"), "utf8");
const constants = new Map(
  [...constantsSource.matchAll(/^export const (\w+) = ("[^"\r\n]*");$/gm)]
    .map(([, name, literal]) => [name, JSON.parse(literal)]),
);

assert.ok(constants.size >= 70, "the source-level dictionary retains the audited repeated runtime strings");
assert.equal(constants.get("invalidState"), "invalid_state");
assert.equal(constants.get("operationIdReused"), "operation_id_reused");
assert.equal(constants.get("craftingTable"), "crafting_table");
assert.equal(new Set(constants.values()).size, constants.size, "dictionary values stay unique");
assert.equal(prepareSource.includes("bundle-string-hoisting"), false, "compact staging has no post-minify string lexer");
assert.equal(prepareSource.includes("hoistRepeatedBundleStrings"), false, "compact staging never rewrites inferred bundle tokens");

const sourcePaths = [
  "client/singleplayer/localContainers.ts",
  "shared/chestTransfers.ts",
  "shared/droppedItems.ts",
  "shared/inventoryActions.ts",
  "shared/worldBlockOperations.ts",
];
let referenceCount = 0;
for (const sourcePath of sourcePaths) {
  const source = readFileSync(join(repositoryRoot, sourcePath), "utf8");
  assert.match(source, /import \* as BS from ["'][^"']*bundleStrings(?:\.ts)?["'];/);
  for (const [, name] of source.matchAll(/\bBS\.(\w+)/g)) {
    assert.ok(constants.has(name), `${relative(repositoryRoot, sourcePath)} references a declared bundle string`);
    referenceCount += 1;
  }
}
assert.ok(referenceCount >= 120, "high-frequency client and shared model paths use explicit source constants");

function execute(source) {
  return Function(`"use strict";${source}`)();
}

const exactComputedMethod = [
  `const S={invalidState:"invalid_state"};`,
  `const result=[];`,
  `const api={["m"](){if(true)/x+"invalid_state"/.test('xx"invalid_state"')&&result.push(1)}};`,
  `api.m();result.push(S.invalidState,S.invalidState,S.invalidState);return result;`,
].join("");
assert.deepEqual(
  execute(exactComputedMethod),
  [1, "invalid_state", "invalid_state", "invalid_state"],
  "computed methods keep nested control-body regexes opaque while explicit value references stay shared",
);

const methodCorpus = [
  `const S={invalidState:"invalid_state"},result=[];`,
  `const object={`,
  `"quoted"(){if(true)/x+"invalid_state"/.test('xx"invalid_state"')&&result.push("quoted")},`,
  `1(){while(result.length<2)/x+"invalid_state"/.test('xx"invalid_state"')&&result.push("numeric")},`,
  `["computed"](){for(let n=0;n<1;n++)/x+"invalid_state"/.test('xx"invalid_state"')&&result.push("computed")},`,
  `get value(){if(true)/x+"invalid_state"/.test('xx"invalid_state"')&&result.push("get");return 1},`,
  `set value(input){if(input)/x+"invalid_state"/.test('xx"invalid_state"')&&result.push("set")},`,
  `*generator(){if(true)/x+"invalid_state"/.test('xx"invalid_state"')&&result.push("generator")},`,
  `};`,
  `class Methods{`,
  `static ["static"](){if(true)/x+"invalid_state"/.test('xx"invalid_state"')&&result.push("static")}`,
  `get value(){if(true)/x+"invalid_state"/.test('xx"invalid_state"')&&result.push("class-get");return 1}`,
  `set value(input){if(input)/x+"invalid_state"/.test('xx"invalid_state"')&&result.push("class-set")}`,
  `*["generator"](){if(true)/x+"invalid_state"/.test('xx"invalid_state"')&&result.push("class-generator")}`,
  `}`,
  `object.quoted();object[1]();object.computed();void object.value;object.value=1;object.generator().next();`,
  `Methods.static();const instance=new Methods;void instance.value;instance.value=1;instance.generator().next();`,
  `result.push(S.invalidState,S.invalidState,S.invalidState);return result;`,
].join("");
assert.deepEqual(
  execute(methodCorpus),
  [
    "quoted", "numeric", "computed", "get", "set", "generator",
    "static", "class-get", "class-set", "class-generator",
    "invalid_state", "invalid_state", "invalid_state",
  ],
  "quoted, numeric, computed, getter, setter, static, and generator methods need no bundle grammar inference",
);

for (const [name, prefix] of [
  ["directive", `"use strict"\n`],
  ["number", `0\n`],
  ["call", `(()=>0)()\n`],
  ["postfix", `let n=0;n++\n`],
  ["array", `[]\n`],
  ["regex", `/z/\n`],
]) {
  const result = execute(
    `const S={invalidState:"invalid_state"},result=[];${prefix}`
      + `if(true)/x+"invalid_state"/.test('xx"invalid_state"')&&result.push(1);`
      + `result.push(S.invalidState,S.invalidState,S.invalidState);return result;`,
  );
  assert.deepEqual(result, [1, "invalid_state", "invalid_state", "invalid_state"], `${name} ASI boundary stays valid`);
}

assert.deepEqual(
  execute(
    `const S={invalidState:"invalid_state"},result=[];`
      + `label:{if(true)/x+"invalid_state"/.test('xx"invalid_state"')&&result.push(1);break label}`
      + `const api={["m"](){nested:{if(true)/x+"invalid_state"/.test('xx"invalid_state"')&&result.push(2);break nested}}};`
      + `api.m();result.push(S.invalidState,S.invalidState,S.invalidState);return result;`,
  ),
  [1, 2, "invalid_state", "invalid_state", "invalid_state"],
  "top-level and computed-method labeled blocks remain ordinary JavaScript",
);

for (const continuation of [
  `"invalid_state"\n.toUpperCase()`,
  `"invalid_state"\n[0]`,
  `"invalid_state"\n+ "!"`,
  `"invalid_state"\n? 1 : 0`,
  `"invalid_state"\n&& 1`,
]) {
  assert.doesNotThrow(() => execute(`return ${continuation};`), "non-ASI continuations remain parseable");
}

console.log("source-level bundle string constants: ok");
