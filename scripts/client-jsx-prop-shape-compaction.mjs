import { createHash } from "node:crypto";
import { access, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Reviewed generated-JSX second-argument shapes in the closed compact client.
// Helpers preserve these public prop names literally; no property is mangled.
export const COMPACT_CLIENT_JSX_PROP_SHAPE_COUNTS = Object.freeze({
  "className,aria-hidden": 9,
  "className,aria-hidden,children": 4,
  "className,aria-label,children": 11,
  "className,children": 54,
  "className,d": 4,
  "className,id,children": 4,
  "className,onClick,type,children": 6,
  "className,role,aria-label,children": 9,
  "className,role,aria-live,children": 4,
  "className,role,aria-modal,aria-labelledby,children": 6,
  "className,role,children": 12,
  "disabled,onClick,type,children": 3,
  "id,children": 13,
  "onClick,type,children": 4,
});
// This fingerprint belongs to the raw first-pass client bundle immediately
// before JSX shape reconstruction. Do not sample it from the staged client:
// string pooling and the following minify pass intentionally change the AST
// value kinds that this fail-closed boundary records.
export const COMPACT_CLIENT_JSX_PROP_SHAPE_SOURCE_FINGERPRINT = "5b315e816d23c91a3e1241d5e9fc9b7b4b73bae2fe79957a736a6c1af9a91dd5";
export const COMPACT_CLIENT_JSX_PROP_SHAPE_INPUT_BOUNDARY = "raw-pre-jsx-v1";

let typescriptPromise;
async function typescript() {
  if (typescriptPromise) return typescriptPromise;
  typescriptPromise = (async () => {
    const cacheRoot = join(homedir(), ".npm", "_npx");
    const candidates = [];
    for (const entry of await readdir(cacheRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const path = join(cacheRoot, entry.name, "node_modules", "typescript", "lib", "typescript.js");
      try {
        await access(path);
        candidates.push({ path, modifiedAt: (await stat(path)).mtimeMs });
      } catch {}
    }
    candidates.sort((left, right) => right.modifiedAt - left.modifiedAt);
    if (!candidates[0]) throw new Error("Compact JSX prop-shape audit requires Lakebed's cached TypeScript runtime.");
    return import(pathToFileURL(candidates[0].path).href);
  })();
  return typescriptPromise;
}

function fail(message) {
  throw new Error(`Unsafe compact JSX prop-shape transform: ${message}`);
}

export function assertRawPreJsxPropShapeInput(source) {
  if (source.includes("__lakecraftJsxShape")) {
    fail("input must be the raw pre-JSX bundle, not an already shape-compacted bundle");
  }
  if (source.includes("__lakecraftClientStrings") || source.includes("Invalid client string pool.")) {
    fail("input must be the raw pre-JSX bundle before client string pooling");
  }
}

function propertyName(ts, property) {
  if (!property.name) return null;
  if (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) return property.name.text;
  return null;
}

export async function analyzeClientJsxPropShapes(source, manifest = COMPACT_CLIENT_JSX_PROP_SHAPE_COUNTS) {
  const ts = await typescript();
  const sourceFile = ts.createSourceFile(
    "lakecraft-client-stage.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS,
  );
  const indexes = new Map(Object.keys(manifest).map((shape, index) => [shape, index]));
  const counts = Object.fromEntries(Object.keys(manifest).map((shape) => [shape, 0]));
  const records = [];
  function visit(node) {
    if (ts.isObjectLiteralExpression(node) && ts.isCallExpression(node.parent)
      && node.parent.arguments[1] === node && node.properties.length >= 2) {
      const names = node.properties.map((property) => propertyName(ts, property));
      if (names.every(Boolean)) {
        const shape = names.join(",");
        if (indexes.has(shape)) {
          if (!node.properties.every((property) => ts.isPropertyAssignment(property)
            || ts.isShorthandPropertyAssignment(property))) {
            fail(`${shape} unexpectedly contains a spread, method, getter, or setter`);
          }
          counts[shape] += 1;
          records.push({
            end: node.end,
            index: indexes.get(shape),
            names,
            node,
            properties: [...node.properties],
            shape,
            start: node.getStart(sourceFile),
            tagKind: ts.SyntaxKind[node.parent.arguments[0]?.kind ?? ts.SyntaxKind.Unknown],
            valueKinds: node.properties.map((property) => ts.SyntaxKind[
              ts.isShorthandPropertyAssignment(property) ? property.name.kind : property.initializer.kind
            ]),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  const fingerprint = createHash("sha256").update(JSON.stringify(records.map((record) => ({
    shape: record.shape,
    tagKind: record.tagKind,
    valueKinds: record.valueKinds,
  })))).digest("hex");
  return { counts, fingerprint, records, sourceFile, ts };
}

function literalKey(name) {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name);
}

export async function compactClientJsxPropShapes(source, expected = {
  counts: COMPACT_CLIENT_JSX_PROP_SHAPE_COUNTS,
  fingerprint: COMPACT_CLIENT_JSX_PROP_SHAPE_SOURCE_FINGERPRINT,
}) {
  assertRawPreJsxPropShapeInput(source);
  const analysis = await analyzeClientJsxPropShapes(source, expected.counts);
  const countMismatches = Object.entries(expected.counts).flatMap(([shape, count]) =>
    analysis.counts[shape] === count ? [] : [`${shape}: expected ${count}, received ${analysis.counts[shape]}`]);
  if (countMismatches.length > 0) fail(`live counts changed; ${countMismatches.join("; ")}`);
  if (analysis.fingerprint !== expected.fingerprint) {
    fail(`source fingerprint changed; expected ${expected.fingerprint}, received ${analysis.fingerprint}`);
  }

  const selected = new Map(analysis.records.map((record) => [record.node, record]));
  for (const record of analysis.records) {
    let ancestor = record.node.parent;
    while (ancestor && !selected.has(ancestor)) ancestor = ancestor.parent;
    record.parentRecord = ancestor ? selected.get(ancestor) : null;
  }

  function initializer(property) {
    return analysis.ts.isShorthandPropertyAssignment(property) ? property.name : property.initializer;
  }

  function rewriteRange(start, end, parentRecord) {
    let text = source.slice(start, end);
    const children = analysis.records.filter((record) => record.parentRecord === parentRecord
      && record.start >= start && record.end <= end).sort((left, right) => right.start - left.start);
    for (const child of children) {
      text = text.slice(0, child.start - start) + renderRecord(child) + text.slice(child.end - start);
    }
    return text;
  }

  function renderRecord(record) {
    const values = record.properties.map((property) => {
      const value = initializer(property);
      return rewriteRange(value.getStart(analysis.sourceFile), value.end, record);
    });
    return `__lakecraftJsxShape${record.index}(${values.join(",")})`;
  }

  let output = source;
  const topLevel = analysis.records.filter((record) => !record.parentRecord)
    .sort((left, right) => right.start - left.start);
  for (const record of topLevel) {
    output = output.slice(0, record.start) + renderRecord(record) + output.slice(record.end);
  }
  const helpers = Object.keys(expected.counts).map((shape, index) => {
    const names = shape.split(",");
    const parameters = names.map((_name, parameter) => `v${parameter}`);
    const properties = names.map((name, property) => `${literalKey(name)}:${parameters[property]}`);
    return `function __lakecraftJsxShape${index}(${parameters.join(",")}){return{${properties.join(",")}}}`;
  }).join("");
  return `${helpers}${output}`;
}
