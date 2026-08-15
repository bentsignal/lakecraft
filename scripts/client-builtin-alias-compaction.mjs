import { createHash } from "node:crypto";
import { access, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// These receiver-independent native statics dominate the remaining repeated
// syntax in the closed production client. Snapshotting their values
// once is lossless for Lakecraft, whose bundle neither shadows nor mutates the
// corresponding globals. The ordered occurrence fingerprint makes that claim
// fail closed whenever the first-stage bundle changes.
export const COMPACT_CLIENT_BUILTIN_ALIASES = Object.freeze([
  Object.freeze(["Math", "abs", 96]),
  Object.freeze(["Math", "cos", 53]),
  Object.freeze(["Math", "ceil", 34]),
  Object.freeze(["Math", "floor", 247]),
  Object.freeze(["Math", "hypot", 35]),
  Object.freeze(["Math", "imul", 35]),
  // Superflat generation clamps its lower materialization bound once per region.
  Object.freeze(["Math", "max", 249]),
  Object.freeze(["Math", "min", 202]),
  Object.freeze(["Math", "round", 29]),
  Object.freeze(["Math", "sin", 65]),
  Object.freeze(["Math", "PI", 109]),
  // The shared, immutable default/superflat terrain descriptor joins the client bundle.
  Object.freeze(["Object", "freeze", 161]),
  Object.freeze(["Object", "keys", 31]),
  // Query bridges reject Lakebed's [] loading sentinel before publishing data.
  Object.freeze(["Array", "isArray", 88]),
  Object.freeze(["Number", "isFinite", 259]),
  // Realtime PvP validates integral damage and health at the untrusted wire boundary.
  Object.freeze(["Number", "isInteger", 58]),
  // Terrain descriptors reject non-integral or unsafe superflat ground heights.
  Object.freeze(["Number", "isSafeInteger", 50]),
  Object.freeze(["Number", "MAX_SAFE_INTEGER", 20]),
  Object.freeze(["Number", "NEGATIVE_INFINITY", 26]),
  Object.freeze(["Number", "POSITIVE_INFINITY", 14]),
  Object.freeze(["Number", "parseInt", 10]),
  Object.freeze(["Date", "now", 60]),
  Object.freeze(["JSON", "stringify", 19]),
  Object.freeze(["JSON", "parse", 12]),
]);
export const COMPACT_CLIENT_BUILTIN_OCCURRENCES = 1_962;
export const COMPACT_CLIENT_BUILTIN_SOURCE_FINGERPRINT = "791be36eaec7273512d8fbcfc9630c375ee36f5f1f5ea54d38df4c81558782ba";
const PRODUCTION_BOUNDARY = Object.freeze({
  counts: Object.freeze(Object.fromEntries(COMPACT_CLIENT_BUILTIN_ALIASES.map(([receiver, method, count]) => [
    `${receiver}.${method}`, count,
  ]))),
  fingerprint: COMPACT_CLIENT_BUILTIN_SOURCE_FINGERPRINT,
  occurrences: COMPACT_CLIENT_BUILTIN_OCCURRENCES,
});

const RECEIVERS = new Set(COMPACT_CLIENT_BUILTIN_ALIASES.map(([receiver]) => receiver));
const ALIAS_INDEX = new Map(COMPACT_CLIENT_BUILTIN_ALIASES.map(([receiver, method], index) => [
  `${receiver}.${method}`, index,
]));

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
    if (!candidates[0]) throw new Error("Compact client builtin audit requires Lakebed's cached TypeScript runtime.");
    return import(pathToFileURL(candidates[0].path).href);
  })();
  return typescriptPromise;
}

function fail(message) {
  throw new Error(`Unsafe compact client builtin transform: ${message}`);
}

function collectBindingNames(ts, name, names) {
  if (!name) return;
  if (ts.isIdentifier(name)) names.add(name.text);
  else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    for (const element of name.elements) {
      if (ts.isBindingElement(element)) collectBindingNames(ts, element.name, names);
    }
  }
}

function assignmentTarget(ts, node) {
  const parent = node.parent;
  if (!parent) return false;
  if (ts.isDeleteExpression(parent) || ts.isPostfixUnaryExpression(parent)) return true;
  if (ts.isPrefixUnaryExpression(parent)) {
    return parent.operator === ts.SyntaxKind.PlusPlusToken || parent.operator === ts.SyntaxKind.MinusMinusToken;
  }
  return ts.isBinaryExpression(parent) && parent.left === node
    && parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
    && parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment;
}

export async function compactClientBuiltinAliases(source, expected = PRODUCTION_BOUNDARY) {
  if (typeof source !== "string") throw new TypeError("Compact client builtin transform requires JavaScript source.");
  if (source.includes("__lakecraftBuiltin")) fail("runtime identifier collides with source text");
  const ts = await typescript();
  const sourceFile = ts.createSourceFile(
    "lakecraft-client-stage.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS,
  );
  const bindings = new Set();
  const occurrences = [];
  const counts = new Map([...ALIAS_INDEX.keys()].map((key) => [key, 0]));

  function visit(node) {
    if (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node)) {
      collectBindingNames(ts, node.name, bindings);
    } else if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) {
      bindings.add(node.name.text);
    } else if (ts.isImportClause(node)) {
      if (node.name) bindings.add(node.name.text);
      if (node.namedBindings) {
        if (ts.isNamespaceImport(node.namedBindings)) bindings.add(node.namedBindings.name.text);
        else for (const element of node.namedBindings.elements) bindings.add(element.name.text);
      }
    } else if (ts.isCatchClause(node) && node.variableDeclaration) {
      collectBindingNames(ts, node.variableDeclaration.name, bindings);
    }

    if ((ts.isElementAccessExpression(node) || ts.isElementAccessChain(node))
      && ts.isIdentifier(node.expression) && RECEIVERS.has(node.expression.text)) {
      fail(`computed ${node.expression.text} access entered the closed builtin boundary`);
    }
    if ((ts.isPropertyAccessExpression(node) || ts.isPropertyAccessChain(node))
      && ts.isIdentifier(node.expression) && RECEIVERS.has(node.expression.text)) {
      if (assignmentTarget(ts, node) || assignmentTarget(ts, node.expression)) {
        fail(`${node.expression.text}.${node.name.text} is mutated`);
      }
      const key = `${node.expression.text}.${node.name.text}`;
      if (ALIAS_INDEX.has(key)) {
        counts.set(key, counts.get(key) + 1);
        occurrences.push({
          end: node.end,
          index: ALIAS_INDEX.get(key),
          key,
          start: node.getStart(sourceFile),
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  for (const receiver of RECEIVERS) if (bindings.has(receiver)) fail(`${receiver} is shadowed by a bundle binding`);
  const countDrifts = COMPACT_CLIENT_BUILTIN_ALIASES.flatMap(([receiver, method]) => {
    const key = `${receiver}.${method}`;
    const actual = counts.get(key);
    const expectedCount = expected.counts?.[key];
    return actual === expectedCount ? [] : [`${key} expected ${expectedCount}, received ${actual}`];
  });
  if (countDrifts.length) fail(countDrifts.join("; "));
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(occurrences.map(({ key }) => key)))
    .digest("hex");
  if (occurrences.length !== expected.occurrences || fingerprint !== expected.fingerprint) {
    fail(`live set changed; expected ${expected.occurrences}/${expected.fingerprint}, received `
      + `${occurrences.length}/${fingerprint}`);
  }

  let output = source;
  for (const occurrence of [...occurrences].sort((left, right) => right.start - left.start)) {
    output = output.slice(0, occurrence.start)
      + `__lakecraftBuiltin${occurrence.index}`
      + output.slice(occurrence.end);
  }
  const declarations = COMPACT_CLIENT_BUILTIN_ALIASES
    .map((_entry, index) => `__lakecraftBuiltin${index}`).join(",");
  const values = COMPACT_CLIENT_BUILTIN_ALIASES
    .map(([receiver, method]) => `${receiver}.${method}`).join(",");
  return `const [${declarations}]=[${values}];${output}`;
}
