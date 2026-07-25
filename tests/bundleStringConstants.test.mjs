import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const constantsSource = readFileSync(join(repositoryRoot, "shared/bundleStrings.ts"), "utf8");
const prepareSource = readFileSync(join(repositoryRoot, "scripts/prepare-lakebed-deploy.mjs"), "utf8");
const declarations = [...constantsSource.matchAll(/^export const (\w+) = ("[^"\r\n]*");$/gm)];
const constants = new Map(declarations.map(([, name, literal]) => [name, JSON.parse(literal)]));

assert.equal(constants.get("invalidState"), "invalid_state");
assert.equal(constants.get("operationIdReused"), "operation_id_reused");
assert.equal(constants.get("craftingTable"), "crafting_table");
assert.equal(new Set(constants.values()).size, constants.size, "dictionary values stay unique");
for (const [, name, literal] of declarations) {
  assert.equal(JSON.stringify(constants.get(name)), literal, `${name} reconstructs its source literal byte-for-byte`);
}
assert.equal(prepareSource.includes("bundle-string-hoisting"), false, "compact staging has no post-minify string lexer");
assert.equal(prepareSource.includes("hoistRepeatedBundleStrings"), false, "compact staging never rewrites inferred bundle tokens");

function runtimeSourcePaths(directory) {
  return readdirSync(join(repositoryRoot, directory), { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return runtimeSourcePaths(path);
      return /\.[tj]sx?$/.test(entry.name) && path !== "shared/bundleStrings.ts" ? [path] : [];
    });
}

const referenceCounts = new Map();
const sourcePaths = ["client", "server", "shared"].flatMap(runtimeSourcePaths);
for (const sourcePath of sourcePaths) {
  const source = readFileSync(join(repositoryRoot, sourcePath), "utf8");
  const references = [...source.matchAll(/\bBS\.(\w+)/g)];
  if (references.length) assert.match(source, /import \* as BS from ["'][^"']*bundleStrings(?:\.ts)?["'];/);
  for (const [, name] of references) {
    assert.ok(constants.has(name), `${sourcePath} references a declared bundle string`);
    referenceCounts.set(name, (referenceCounts.get(name) ?? 0) + 1);
  }
}
assert.deepEqual(
  [...referenceCounts.keys()].sort(),
  [...constants.keys()].sort(),
  "runtime references and source-level dictionary exports have exact set equality",
);
for (const name of constants.keys()) {
  assert.ok(referenceCounts.get(name) >= 1, `${name} has at least one runtime reference`);
}

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
