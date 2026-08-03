import assert from "node:assert/strict";
import { access, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  analyzeClientStaticStrings,
  COMPACT_CLIENT_STATIC_STRING_MANIFEST,
  COMPACT_CLIENT_STATIC_STRING_VALUES,
  compactClientStaticStrings,
} from "../scripts/client-static-string-compaction.mjs";
import { runStagedTransaction } from "../scripts/lakebed-build-transaction.mjs";
import { loadLakebedCompilerRuntime } from "../scripts/lakebed-compiler-runtime.mjs";
import { prepareLakebedStage } from "../scripts/prepare-lakebed-deploy.mjs";

const repositoryRoot = resolve(new URL("..", import.meta.url).pathname);

async function newestCachedTypeScript() {
  const cacheRoot = join(homedir(), ".npm", "_npx");
  const candidates = [];
  for (const entry of await readdir(cacheRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(cacheRoot, entry.name, "node_modules", "typescript", "lib", "typescript.js");
    try {
      await access(path);
      candidates.push({ modifiedAt: (await stat(path)).mtimeMs, path });
    } catch {
      // This cache entry has no TypeScript parser.
    }
  }
  candidates.sort((left, right) => right.modifiedAt - left.modifiedAt || left.path.localeCompare(right.path));
  if (!candidates[0]) throw new Error("Run the test suite once so its TypeScript parser is available.");
  return import(pathToFileURL(candidates[0].path).href);
}

assert.equal(COMPACT_CLIENT_STATIC_STRING_MANIFEST.length, 94, "reviewed string manifest changes intentionally");
assert.deepEqual(
  COMPACT_CLIENT_STATIC_STRING_VALUES,
  COMPACT_CLIENT_STATIC_STRING_MANIFEST.map(({ value }) => value),
  "the audit value list and fixed compatibility manifest stay identical",
);
assert.equal(new Set(COMPACT_CLIENT_STATIC_STRING_VALUES).size, COMPACT_CLIENT_STATIC_STRING_VALUES.length);
assert.ok(COMPACT_CLIENT_STATIC_STRING_MANIFEST.every(({ count, contextFingerprint, value }) => (
  typeof value === "string"
  && value.length > 0
  && Number.isSafeInteger(count)
  && count >= 2
  && /^[0-9a-f]{64}$/.test(contextFingerprint)
)), "every reviewed literal has a bounded live count and normalized context fingerprint");

let originalClientBundle = "";
let compactedClientBundle = "";
await runStagedTransaction({
  sourceRoot: repositoryRoot,
  prepare: (plan) => prepareLakebedStage(plan, {
    compactClientStrings(source) {
      assert.equal(originalClientBundle, "", "the client staging transform runs exactly once");
      originalClientBundle = source;
      compactedClientBundle = compactClientStaticStrings(source);
      return compactedClientBundle;
    },
  }),
  consume: async () => true,
});

assert.ok(originalClientBundle.length > 400_000, "the audit covers the real full client bundle");
assert.equal(compactClientStaticStrings(originalClientBundle), compactedClientBundle, "transform is deterministic");
const observed = analyzeClientStaticStrings(originalClientBundle);
assert.deepEqual(observed, COMPACT_CLIENT_STATIC_STRING_MANIFEST, "real first-stage contexts match the manifest");

const ts = await newestCachedTypeScript();
const originalAst = ts.createSourceFile(
  "lakecraft-client-stage.js",
  originalClientBundle,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.JS,
);
assert.deepEqual(originalAst.parseDiagnostics, [], "the original first-stage bundle parses as JavaScript");
const selected = new Set(COMPACT_CLIENT_STATIC_STRING_VALUES);
const astCounts = new Map();
function unsafeLiteralPosition(node) {
  const parent = node.parent;
  if ((ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) && parent.moduleSpecifier === node) return true;
  if (ts.isExpressionStatement(parent) && parent.expression === node) return true;
  return (
    (ts.isPropertyAssignment(parent)
      || ts.isMethodDeclaration(parent)
      || ts.isGetAccessorDeclaration(parent)
      || ts.isSetAccessorDeclaration(parent))
    && parent.name === node
  );
}
function inspect(node) {
  if (ts.isStringLiteralLike(node) && selected.has(node.text)) {
    assert.equal(unsafeLiteralPosition(node), false, `${JSON.stringify(node.text)} is only an expression value`);
    assert.equal(
      originalClientBundle.slice(node.getStart(originalAst), node.end),
      JSON.stringify(node.text),
      `${JSON.stringify(node.text)} uses esbuild's exact canonical literal token`,
    );
    astCounts.set(node.text, (astCounts.get(node.text) ?? 0) + 1);
  }
  ts.forEachChild(node, inspect);
}
inspect(originalAst);
assert.deepEqual(
  COMPACT_CLIENT_STATIC_STRING_MANIFEST.map(({ count, value }) => [value, astCounts.get(value) ?? 0]),
  COMPACT_CLIENT_STATIC_STRING_MANIFEST.map(({ count, value }) => [value, count]),
  "every raw replacement target is exactly one reviewed expression literal",
);

const declaration = `const ${COMPACT_CLIENT_STATIC_STRING_MANIFEST.map(({ value }, index) => (
  `__lakecraftSharedString${index}=${JSON.stringify(value)}`
)).join(",")};`;
assert.ok(compactedClientBundle.startsWith(declaration), "compacted bundle begins with inert primitive constants");
let restored = compactedClientBundle.slice(declaration.length);
for (let index = 0; index < COMPACT_CLIENT_STATIC_STRING_MANIFEST.length; index += 1) {
  restored = restored.replaceAll(
    `(__lakecraftSharedString${index})`,
    JSON.stringify(COMPACT_CLIENT_STATIC_STRING_MANIFEST[index].value),
  );
}
assert.equal(restored, originalClientBundle, "removing the inert declarations restores every runtime byte exactly");
const compactedAst = ts.createSourceFile(
  "lakecraft-client-stage.compact.js",
  compactedClientBundle,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.JS,
);
assert.deepEqual(compactedAst.parseDiagnostics, [], "the transformed first-stage bundle parses as JavaScript");

const { build } = await loadLakebedCompilerRuntime();
async function secondPassBytes(contents) {
  const result = await build({
    absWorkingDir: repositoryRoot,
    bundle: true,
    charset: "utf8",
    external: ["lakebed/client", "lakebed/server", "preact", "preact/hooks", "preact/jsx-runtime"],
    format: "esm",
    legalComments: "none",
    minify: true,
    platform: "browser",
    stdin: { contents, loader: "js", resolveDir: repositoryRoot },
    sourcemap: false,
    target: "es2022",
    treeShaking: true,
    write: false,
  });
  return result.outputFiles[0].contents.length;
}
const originalSecondPassBytes = await secondPassBytes(originalClientBundle);
const compactSecondPassBytes = await secondPassBytes(compactedClientBundle);
assert.ok(
  originalSecondPassBytes - compactSecondPassBytes >= 7_500,
  "reviewed primitive sharing saves at least 7.5 KiB in the final client program",
);

const fixture = 'const alpha="warning",beta=["warning"];export const result=alpha+beta[0];';
const fixtureManifest = analyzeClientStaticStrings(fixture, ["warning"]);
const fixtureCompacted = compactClientStaticStrings(fixture, fixtureManifest);
assert.equal(compactClientStaticStrings(fixture, fixtureManifest), fixtureCompacted, "fixture output is deterministic");
assert.throws(
  () => compactClientStaticStrings(`${fixture}const extra="warning";`, fixtureManifest),
  /corpus drifted/,
  "added occurrences fail closed",
);
assert.throws(
  () => compactClientStaticStrings('const alpha={"warning":1},beta="warning";', fixtureManifest),
  /corpus drifted/,
  "moving a value into a property-name position fails the normalized context fingerprint",
);
assert.throws(
  () => compactClientStaticStrings(`const __lakecraftSharedString0=0;${fixture}`, fixtureManifest),
  /collides/,
  "staging identifier collisions fail closed",
);
assert.throws(
  () => compactClientStaticStrings(fixture, [...fixtureManifest, fixtureManifest[0]]),
  /duplicate/,
  "duplicate manifest values fail closed",
);
assert.throws(
  () => compactClientStaticStrings(fixture, [{ ...fixtureManifest[0], contextFingerprint: "0".repeat(64) }]),
  /corpus drifted/,
  "fingerprint substitutions fail closed",
);
assert.throws(
  () => compactClientStaticStrings(fixture, [{ ...fixtureManifest[0], count: 1 }]),
  /corpus drifted/,
  "unprofitable or malformed counts fail closed",
);
const renamedFixture = fixture.replace("alpha", "omega").replace("beta", "theta");
assert.deepEqual(
  analyzeClientStaticStrings(renamedFixture, ["warning"]),
  fixtureManifest,
  "identifier-only minifier drift is normalized without weakening syntax context checks",
);

console.log("client static-string compaction compatibility boundary: ok");
