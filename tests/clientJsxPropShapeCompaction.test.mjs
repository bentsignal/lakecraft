import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  COMPACT_CLIENT_JSX_PROP_SHAPE_INPUT_BOUNDARY,
  COMPACT_CLIENT_JSX_PROP_SHAPE_COUNTS,
  COMPACT_CLIENT_JSX_PROP_SHAPE_SOURCE_FINGERPRINT,
  analyzeClientJsxPropShapes,
  assertRawPreJsxPropShapeInput,
  compactClientJsxPropShapes,
} from "../scripts/client-jsx-prop-shape-compaction.mjs";

assert.equal(Object.keys(COMPACT_CLIENT_JSX_PROP_SHAPE_COUNTS).length, 13,
  "the production transform stays limited to the thirteen reviewed generated-JSX shapes");
assert.equal(COMPACT_CLIENT_JSX_PROP_SHAPE_INPUT_BOUNDARY, "raw-pre-jsx-v1");
assert.equal(COMPACT_CLIENT_JSX_PROP_SHAPE_SOURCE_FINGERPRINT,
  "3b7877ce26abdbcea7b7649ac109ba3598feed6a7a74ab555e3e0e0b70f23496",
  "the production fingerprint is sampled at the raw pre-JSX, pre-string-pool boundary");
assert.deepEqual(COMPACT_CLIENT_JSX_PROP_SHAPE_COUNTS, {
  "className,aria-hidden": 9,
  "className,aria-hidden,children": 3,
  "className,aria-label,children": 11,
  "className,children": 56,
  "className,id,children": 4,
  "className,onClick,type,children": 7,
  "className,role,aria-label,children": 9,
  "className,role,aria-live,children": 3,
  "className,role,aria-modal,aria-labelledby,children": 5,
  "className,role,children": 11,
  "disabled,onClick,type,children": 1,
  "id,children": 12,
  "onClick,type,children": 5,
});

const fixtureManifest = {
  "className,children": 2,
  "className,role,aria-label,children": 1,
  "className,role,aria-modal,aria-labelledby,children": 1,
};
const fixture = [
  "const events=[];",
  "const mark=(name,value)=>{events.push(name);return value};",
  "const labelled={get value(){events.push('getter');return 'Inventory panel'}};",
  "const jsx=(tag,props)=>({tag,props});",
  "const make=()=>[",
  "jsx('div',{className:mark('outer-class','outer'),children:jsx('span',{className:mark('inner-class','inner'),children:mark('inner-child','text')})}),",
  "jsx('section',{className:mark('aria-class','panel'),role:mark('aria-role','region'),'aria-label':labelled.value,children:mark('aria-child','inventory')}),",
  "jsx('dialog',{className:mark('modal-class','modal'),role:mark('modal-role','dialog'),'aria-modal':mark('aria-modal','true'),'aria-labelledby':mark('aria-labelledby','title'),children:mark('modal-child','body')})",
  "];",
  "const untouched=(value)=>value;",
  "const firstArgument=untouched({className:'not-jsx',children:'not-jsx-child'});",
  "const spread={className:'spread',...{children:'spread-child'}};",
  "globalThis.__compactShapeFixture={events,make,firstArgument,spread};",
].join("");
const fixtureAnalysis = await analyzeClientJsxPropShapes(fixture, fixtureManifest);
assert.deepEqual(fixtureAnalysis.counts, fixtureManifest);
const transformed = await compactClientJsxPropShapes(fixture, {
  counts: fixtureManifest,
  fingerprint: fixtureAnalysis.fingerprint,
});
new Function(transformed)();
const fixtureResult = globalThis.__compactShapeFixture;
const first = fixtureResult.make();
const second = fixtureResult.make();
assert.notEqual(first[0].props, second[0].props, "each helper call allocates a fresh props object");
assert.notEqual(first[0].props.children.props, second[0].props.children.props,
  "nested generated JSX also receives fresh props objects");
assert.deepEqual(Object.keys(first[0].props), ["className", "children"], "ordinary prop key order is exact");
assert.deepEqual(Object.keys(first[1].props), ["className", "role", "aria-label", "children"],
  "ARIA prop names remain literal and ordered");
assert.deepEqual(Object.keys(first[2].props),
  ["className", "role", "aria-modal", "aria-labelledby", "children"],
  "modal public prop keys remain literal and ordered");
const onePassEvents = [
  "outer-class", "inner-class", "inner-child", "aria-class", "aria-role", "getter", "aria-child",
  "modal-class", "modal-role", "aria-modal", "aria-labelledby", "modal-child",
];
assert.deepEqual(fixtureResult.events, [...onePassEvents, ...onePassEvents],
  "property initializers and getters retain exact left-to-right evaluation order");
assert.deepEqual(fixtureResult.firstArgument, { className: "not-jsx", children: "not-jsx-child" },
  "matching objects outside a generated JSX second argument are excluded");
assert.deepEqual(fixtureResult.spread, { className: "spread", children: "spread-child" },
  "spread-bearing objects are excluded");
delete globalThis.__compactShapeFixture;

await assert.rejects(
  compactClientJsxPropShapes(fixture, {
    counts: { ...fixtureManifest, "className,children": 3 },
    fingerprint: fixtureAnalysis.fingerprint,
  }),
  /live counts changed/,
  "shape-count drift fails closed",
);

assert.throws(
  () => assertRawPreJsxPropShapeInput(`${fixture}const __lakecraftClientStrings=[];`),
  /before client string pooling/,
  "an immediate string-pool output cannot masquerade as the raw pre-JSX fixture",
);
assert.throws(
  () => assertRawPreJsxPropShapeInput(`${fixture}throw new Error("Invalid client string pool.");`),
  /before client string pooling/,
  "a minified final-stage string-pool runtime cannot masquerade as the raw pre-JSX fixture",
);
await assert.rejects(
  compactClientJsxPropShapes(`${fixture}function __lakecraftJsxShape0(){}`, {
    counts: fixtureManifest,
    fingerprint: fixtureAnalysis.fingerprint,
  }),
  /already shape-compacted bundle/,
  "production compaction fails closed when invoked twice or after the JSX boundary",
);

const prepareSource = await readFile(new URL("../scripts/prepare-lakebed-deploy.mjs", import.meta.url), "utf8");
assert.match(prepareSource, /compactClientBuiltinAliases\(bundledText\)/,
  "production compact staging applies the native-call alias boundary");
assert.match(prepareSource, /compactClientJsxPropShapes\(aliased\)/,
  "production compact staging applies the JSX shape boundary");
assert.match(prepareSource, /compactClientStringPool\(shaped\)/,
  "string pooling follows shape reconstruction while normal dev remains untouched");
assert.ok(
  prepareSource.indexOf("compactClientBuiltinAliases(bundledText)")
    < prepareSource.indexOf("compactClientJsxPropShapes(aliased)")
    && prepareSource.indexOf("compactClientJsxPropShapes(aliased)")
    < prepareSource.indexOf("compactClientStringPool(shaped)"),
  "production invokes builtin aliasing and fail-closed JSX compaction before client string pooling",
);
assert.doesNotMatch(prepareSource, /compactClientStringPool\(bundledText\)/,
  "production cannot bypass the reviewed raw pre-JSX transform boundary");

const stagedPath = process.env.LAKECRAFT_COMPACT_CLIENT_STAGE;
if (stagedPath) {
  assert.equal(process.env.LAKECRAFT_COMPACT_CLIENT_STAGE_BOUNDARY,
    COMPACT_CLIENT_JSX_PROP_SHAPE_INPUT_BOUNDARY,
    "LAKECRAFT_COMPACT_CLIENT_STAGE must be explicitly identified as a raw pre-JSX fixture");
  const stagedSource = await readFile(stagedPath, "utf8");
  assert.doesNotThrow(() => assertRawPreJsxPropShapeInput(stagedSource),
    "the live production fixture must precede both JSX compaction and string pooling");
  const live = await analyzeClientJsxPropShapes(stagedSource);
  assert.deepEqual(live.counts, COMPACT_CLIENT_JSX_PROP_SHAPE_COUNTS);
  assert.equal(live.fingerprint, COMPACT_CLIENT_JSX_PROP_SHAPE_SOURCE_FINGERPRINT);
} else {
  assert.equal(process.env.LAKECRAFT_COMPACT_CLIENT_STAGE_BOUNDARY, undefined,
    "a boundary label without a fixture path is rejected rather than silently ignored");
}

console.log("compact generated-JSX prop-shape freshness, order, exclusion, and drift tests passed");
