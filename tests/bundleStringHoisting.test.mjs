import assert from "node:assert/strict";
import {
  CLIENT_BUNDLE_SHARED_STRINGS,
  SERVER_BUNDLE_SHARED_STRINGS,
  hoistRepeatedBundleStrings,
} from "../scripts/bundle-string-hoisting.mjs";

function execute(source) {
  return Function(`"use strict";${source};return result;`)();
}

function assertSemanticRoundTrip(source, label) {
  const output = hoistRepeatedBundleStrings(source, ["invalid_state"]);
  assert.doesNotThrow(() => Function(output), `${label} remains valid JavaScript`);
  assert.deepEqual(execute(output), execute(source), `${label} retains runtime behavior`);
  return output;
}

function assertSloppySemanticRoundTrip(source, label) {
  const output = hoistRepeatedBundleStrings(source, ["invalid_state"]);
  assert.doesNotThrow(() => Function(output), `${label} remains valid JavaScript`);
  assert.deepEqual(Function(`${output};return result;`)(), Function(`${source};return result;`)(),
    `${label} retains runtime behavior`);
  return output;
}

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

const moduleSpecifiers = [
  'import value from "invalid_state";',
  'export {value} from "invalid_state";',
  'const lazy=()=>import("invalid_state");',
  'const required=()=>require("invalid_state");',
  'const resolved=()=>require.resolve("invalid_state");',
  'const meta=()=>import.meta.resolve("invalid_state");',
].join("");
assert.equal(hoistRepeatedBundleStrings(moduleSpecifiers, ["invalid_state"]), moduleSpecifiers,
  "static, dynamic, require, and resolver module specifiers stay literal");

const controlRegexes = [
  "const result=[];",
  `if(true)/"invalid_state"/.test('"invalid_state"')&&result.push("invalid_state");`,
  `if(true){result.push("invalid_state")}/"invalid_state"/.test('"invalid_state"')&&result.push("invalid_state");`,
  `let w=0;while(w++<1)/"invalid_state"/.test('"invalid_state"')&&result.push("invalid_state");`,
  `for(let f=0;f<1;f++)/"invalid_state"/.test('"invalid_state"')&&result.push("invalid_state");`,
  `try{throw 1}catch(error){result.push("invalid_state")}/"invalid_state"/.test('"invalid_state"')&&result.push("invalid_state");`,
  `result.push("invalid_state");`,
].join("");
const controlRegexOutput = assertSemanticRoundTrip(
  controlRegexes,
  "regex expression statements after control conditions and bodies",
);
assert.equal(controlRegexOutput.split('/"invalid_state"/').length - 1, 5,
  "control-flow regex bodies stay opaque while neighboring expressions may be hoisted");
assert.ok(controlRegexOutput.includes("__lakecraftSharedBundleStrings[0]"),
  "proven expression strings still hoist around control-flow regex literals");

const controlCorpus = ["const result=[];"];
for (let index = 0; index < 1_000; index += 1) {
  if (index % 4 === 0) {
    controlCorpus.push(`if(true)/"invalid_state"/.test('"invalid_state"')&&result.push("invalid_state");`);
  } else if (index % 4 === 1) {
    controlCorpus.push(`let w${index}=0;while(w${index}++<1)/"invalid_state"/.test('"invalid_state"')&&result.push("invalid_state");`);
  } else if (index % 4 === 2) {
    controlCorpus.push(`for(let f${index}=0;f${index}<1;f${index}++)/"invalid_state"/.test('"invalid_state"')&&result.push("invalid_state");`);
  } else {
    controlCorpus.push(`try{throw ${index}}catch(e${index}){}/"invalid_state"/.test('"invalid_state"')&&result.push("invalid_state");`);
  }
}
const controlCorpusOutput = assertSemanticRoundTrip(controlCorpus.join(""), "1,000 structured control-body regex fixtures");
assert.equal(controlCorpusOutput.split('/"invalid_state"/').length - 1, 1_000,
  "every structured control-body regex is tokenized as one opaque literal");

const withRegex = [
  "const result=[];",
  `with({enabled:true})/"invalid_state"/.test('"invalid_state"')&&result.push("invalid_state");`,
  `result.push("invalid_state","invalid_state","invalid_state");`,
].join("");
assertSloppySemanticRoundTrip(withRegex, "sloppy with-body regex expression statement");

for (const ambiguousBody of [
  `function declaration(){} /"invalid_state"/.test('"invalid_state"');const result=["invalid_state","invalid_state","invalid_state"];`,
  `function* generator(){} /"invalid_state"/.test('"invalid_state"');const result=["invalid_state","invalid_state","invalid_state"];`,
  `async function asynchronous(){} /"invalid_state"/.test('"invalid_state"');const result=["invalid_state","invalid_state","invalid_state"];`,
  `class Declaration{} /"invalid_state"/.test('"invalid_state"');const result=["invalid_state","invalid_state","invalid_state"];`,
  `const value=function(){} / 2;const result=[value,"invalid_state","invalid_state","invalid_state"];`,
  `const value=function*(){} / 2;const result=[value,"invalid_state","invalid_state","invalid_state"];`,
  `const value=class{} / 2;const result=[value,"invalid_state","invalid_state","invalid_state"];`,
  `label:{break label}/"invalid_state"/.test('"invalid_state"');const result=["invalid_state","invalid_state","invalid_state"];`,
]) {
  assert.equal(hoistRepeatedBundleStrings(ambiguousBody, ["invalid_state"]), ambiguousBody,
    "ambiguous slash after a function or class body fails closed for the complete segment");
  assert.doesNotThrow(() => Function(ambiguousBody), "fail-closed function/class slash fixtures still parse");
}

const divisionPairs = [
  "const result=[];",
  "const half=(8)/2,objectRatio={valueOf(){return 8}}/2;",
  `const pattern=/"invalid_state"/;`,
  `result.push(half,objectRatio,pattern.test('"invalid_state"'),"invalid_state","invalid_state","invalid_state");`,
].join("");
assertSemanticRoundTrip(divisionPairs, "adjacent division and regex lexical goals");

const asiDivision = [
  "const quotient=8",
  "/2",
  `const result=[quotient,"invalid_state","invalid_state","invalid_state"];`,
].join("\n");
assertSemanticRoundTrip(asiDivision, "ASI-sensitive division continuation");

const exportRegex = [
  `export default /"invalid_state"/.test('"invalid_state"');`,
  `export const values=["invalid_state","invalid_state","invalid_state"];`,
].join("");
const exportRegexOutput = hoistRepeatedBundleStrings(exportRegex, ["invalid_state"]);
assert.ok(exportRegexOutput.includes(`export default /"invalid_state"/.test`),
  "export-default regex literals retain their lexical goal");
const exportModule = await import(`data:text/javascript,${encodeURIComponent(exportRegexOutput)}`);
assert.equal(exportModule.default, true, "the transformed export-default regex module parses and executes");

const importMetadata = [
  `import payload from "data:application/json,%22ok%22" with {type:"json",mode:"invalid_state",state:"invalid_state",reason:"invalid_state"};`,
  `export {payload} from "data:application/json,%22ok%22" with {type:"json",mode:"invalid_state",state:"invalid_state",reason:"invalid_state"};`,
  `const lazy=()=>import("data:text/javascript,export default 1",{with:{type:"invalid_state",mode:"invalid_state",reason:"invalid_state"}});`,
].join("");
assert.equal(hoistRepeatedBundleStrings(importMetadata, ["invalid_state"]), importMetadata,
  "static and dynamic import attribute values are immutable grammar metadata");
await assert.rejects(
  import(`data:text/javascript,${encodeURIComponent(importMetadata)}#attributes`),
  (error) => !(error instanceof SyntaxError),
  "the unchanged import-attribute fixture parses before the loader rejects unsupported metadata",
);
const legacyAssertion = `import payload from "pkg" assert {type:"invalid_state",mode:"invalid_state",reason:"invalid_state"};`;
assert.equal(hoistRepeatedBundleStrings(legacyAssertion, ["invalid_state"]), legacyAssertion,
  "legacy import assertion values also stay literal");

const methods = [];
for (let index = 0; index < 75; index += 1) {
  methods.push(
    `const o${index}={"invalid_state"(){return ${index}}};`,
    `class C${index}{"invalid_state"(){return ${index + 1}}}`,
  );
}
methods.push("const result=[");
for (let index = 0; index < 75; index += 1) {
  methods.push(`o${index}["invalid_state"](),new C${index}()["invalid_state"](),`);
}
methods.push("];");
const methodOutput = assertSemanticRoundTrip(methods.join(""), "150 quoted object/class methods");
assert.equal((methodOutput.match(/"invalid_state"\(\)/g) ?? []).length, 150,
  "quoted object and class method names are never rewritten");

const protectedLexemes = [
  '"invalid_state";',
  'const tag=(raw,...values)=>[raw.raw,values];',
  'const template=`raw "invalid_state" ${"invalid_state"} ${`nested "invalid_state"`}`;',
  'const tagged=tag`tagged "invalid_state" ${"invalid_state"}`;',
  'const regex=/"invalid_state"/giu;',
  'const escaped="prefix \\"invalid_state\\" suffix";',
  'const object={"invalid_state":1};',
  'const optional=object?.["invalid_state"];',
  'const computed={["invalid_state"]:2};',
  '// "invalid_state" must remain comment text\n',
  '/* "invalid_state" must remain block comment text */',
  'const a="invalid_state",b="invalid_state",c="invalid_state";',
  'const result={template,tagged,regex:regex.test(\'"invalid_state"\'),escaped,optional,computed:computed.invalid_state,a,b,c};',
  '\n//# sourceMappingURL=data:application/json;base64,ImludmFsaWRfc3RhdGUi',
].join("");
const protectedOutput = assertSemanticRoundTrip(protectedLexemes, "templates, regexes, comments, directives, and optional access");
assert.ok(protectedOutput.includes('`raw "invalid_state" ${"invalid_state"} ${`nested "invalid_state"`}`'),
  "template raw text and interpolation source are opaque to hoisting");
assert.ok(protectedOutput.includes('/"invalid_state"/giu'), "regex bodies and flags remain opaque");
assert.ok(protectedOutput.includes('"invalid_state";'), "directive prologues stay literal");
assert.ok(protectedOutput.startsWith('"invalid_state";const __lakecraftSharedBundleStrings='),
  "the shared declaration is inserted after the module directive prologue");
assert.ok(protectedOutput.endsWith("//# sourceMappingURL=data:application/json;base64,ImludmFsaWRfc3RhdGUi"),
  "the source-map boundary is byte-for-byte preserved");

const asiDirective = [
  '"use strict"',
  'const a="invalid_state",b="invalid_state",c="invalid_state";',
  "const result=[a,b,c];",
].join("\n");
const asiDirectiveOutput = assertSemanticRoundTrip(asiDirective, "ASI-terminated directive prologue");
assert.ok(asiDirectiveOutput.startsWith('"use strict";const __lakecraftSharedBundleStrings='),
  "a declaration inserted after an ASI directive receives an explicit boundary");

function assertInitialStringContinuation(continuation, label, executeFixture = true) {
  const fixture = [
    `"invalid_state"\r\n/* continuation across comments */\r\n${continuation};`,
    `const a="invalid_state",b="invalid_state",c="invalid_state";`,
    "const result=[a,b,c];",
  ].join("");
  const output = hoistRepeatedBundleStrings(fixture, ["invalid_state"]);
  assert.doesNotThrow(() => Function(output), `${label} remains parseable`);
  if (executeFixture) assert.deepEqual(execute(output), execute(fixture), `${label} retains behavior`);
  assert.ok(output.startsWith("const __lakecraftSharedBundleStrings="),
    `${label} inserts before the continued expression, never inside it`);
  assert.equal(output.includes('"invalid_state";const __lakecraftSharedBundleStrings='), false,
    `${label} is not mistaken for an ASI directive`);
}

for (const [continuation, label] of [
  ["?.length", "optional-chain continuation"],
  [".length", "property continuation"],
  ["[0]", "computed-property continuation"],
  ['+"suffix"', "binary-operator continuation"],
  ["/2", "division continuation"],
  ["in {invalid_state:true}", "in-operator continuation"],
  ["instanceof String", "instanceof continuation"],
]) {
  assertInitialStringContinuation(continuation, label);
}
assertInitialStringContinuation("(false)", "call continuation", false);
assertInitialStringContinuation("`suffix`", "tagged-template continuation", false);

const commentedAsiDirective = [
  '"use strict"\r\n',
  "/* a real statement begins after this comment */\r\n",
  'const a="invalid_state",b="invalid_state",c="invalid_state";',
  "const result=[a,b,c];",
].join("");
const commentedAsiOutput = assertSemanticRoundTrip(commentedAsiDirective, "commented CRLF ASI directive");
assert.ok(commentedAsiOutput.startsWith('"use strict";const __lakecraftSharedBundleStrings='),
  "comments and CRLF do not hide a true ASI directive boundary");

const fields = [];
for (let index = 0; index < 75; index += 1) {
  fields.push(`class F${index}{"invalid_state"=${index}}`);
}
fields.push("const result=[");
for (let index = 0; index < 75; index += 1) fields.push(`new F${index}()["invalid_state"],`);
fields.push("];");
const fieldOutput = assertSemanticRoundTrip(fields.join(""), "75 quoted class fields");
assert.equal((fieldOutput.match(/"invalid_state"=/g) ?? []).length, 75,
  "quoted class field names are never rewritten");

let fuzzState = 0x127c0de;
function fuzzIndex(length) {
  fuzzState = (Math.imul(fuzzState, 1_664_525) + 1_013_904_223) >>> 0;
  return fuzzState % length;
}
const fuzzFactories = [
  (index) => `const v${index}="invalid_state";result.push(v${index});`,
  (index) => `const p${index}={"invalid_state":${index}};result.push(p${index}?.["invalid_state"]);`,
  (index) => `const q${index}={"invalid_state"(){return ${index}}};result.push(q${index}["invalid_state"]());`,
  (index) => `result.push(\`raw "invalid_state" \${"invalid_state"} ${index}\`);`,
  (index) => `const r${index}=/"invalid_state"/gi;result.push(r${index}.test('"invalid_state"'));`,
  (index) => `const e${index}="escaped \\"invalid_state\\"";result.push(e${index});`,
  (index) => `result.push(({value:"invalid_state"})?.value);`,
  (index) => `result.push((()=>"invalid_state")());`,
  (index) => `if(${index}%2===0)/"invalid_state"/.test('"invalid_state"')&&result.push("invalid_state");`,
  (index) => `for(let n${index}=0;n${index}<1;n${index}++)/"invalid_state"/.test('"invalid_state"')&&result.push("invalid_state");`,
  (index) => `try{throw ${index}}catch(e${index}){result.push("invalid_state")}/"invalid_state"/.test('"invalid_state"');`,
  (index) => `const d${index}=(${index}+2)/2;result.push(d${index},"invalid_state");`,
];
const fuzzParts = ["const result=[];"];
for (let index = 0; index < 600; index += 1) {
  fuzzParts.push(fuzzFactories[fuzzIndex(fuzzFactories.length)](index));
}
const fuzzSource = fuzzParts.join("");
const fuzzOutput = assertSemanticRoundTrip(fuzzSource, "600 seeded expression and protected-token fixtures");
assert.equal(
  hoistRepeatedBundleStrings(fuzzSource, ["invalid_state"]),
  fuzzOutput,
  "seeded adversarial output is deterministic",
);

for (const candidates of [CLIENT_BUNDLE_SHARED_STRINGS, SERVER_BUNDLE_SHARED_STRINGS]) {
  assert.equal(new Set(candidates).size, candidates.length, "allowlisted strings stay unique");
  assert.ok(candidates.every((candidate) => candidate.length >= 8 && !/["\\\n\r]/.test(candidate)),
    "allowlisted strings are direct JSON literals supported by the transform");
}

console.log("production bundle string-hoisting tests passed");
