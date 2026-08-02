import { access, readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const repositoryRoot = resolve(process.cwd());
const approvedRoots = [
  "client/chat",
  "client/components",
  "client/game",
  "client/lobby/LobbyScreen.tsx",
  "client/singleplayer/SinglePlayerApp.tsx",
];
const boundaryRoots = [
  "client/MultiplayerSegmentTransport.tsx",
  "client/multiplayerSegmentClient.ts",
  "client/settings.ts",
  "client/singleplayer/localSave.ts",
  "client/singleplayer/localWorldEditJournal.ts",
  "client/worldBlockEditClient.ts",
  "server",
  "shared",
];
const manuallyReservedNames = new Set([
  "mouseSensitivity",
  "settings",
  "soundMuted",
  "webkitAudioContext",
]);

async function sourcePaths(directory) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await sourcePaths(path));
    else if (/\.[cm]?[tj]sx?$/.test(entry.name)) paths.push(path);
  }
  return paths.sort();
}

async function newestCachedPath(suffix) {
  const cacheRoot = join(homedir(), ".npm", "_npx");
  const candidates = [];
  for (const entry of await readdir(cacheRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(cacheRoot, entry.name, "node_modules", suffix);
    try {
      await access(path);
      candidates.push({ path, modifiedAt: (await stat(path)).mtimeMs });
    } catch {
      // This npx cache entry does not contain the requested Lakebed dependency.
    }
  }
  candidates.sort((left, right) => right.modifiedAt - left.modifiedAt);
  if (!candidates[0]) throw new Error(`Unable to find cached ${suffix}.`);
  return candidates[0].path;
}

const tsPath = await newestCachedPath(join("typescript", "lib", "typescript.js"));
const ts = await import(pathToFileURL(tsPath).href);
const propertyUses = new Map();
const declarations = new Map();
const typeDeclarations = new Map();
const quotedNames = new Map();
const jsonStringifyProperties = new Map();
const dynamicElementAccessFiles = new Set();
const propertyUseCounts = new Map();
const declarationKinds = new Map();

function add(map, name, path) {
  if (!name || !/^[A-Za-z_$][\w$]*$/.test(name)) return;
  const paths = map.get(name) ?? new Set();
  paths.add(path);
  map.set(name, paths);
}

function increment(map, name, key) {
  if (!map || !name || !/^[A-Za-z_$][\w$]*$/.test(name)) return;
  const counts = map.get(name) ?? new Map();
  counts.set(key, (counts.get(key) ?? 0) + 1);
  map.set(name, counts);
}

function declaredPropertyName(node) {
  const name = node.name;
  if (name && (ts.isIdentifier(name) || ts.isPrivateIdentifier(name))) return name.text;
  return null;
}

function inspectSource(path, source, maps = {
  propertyUses,
  declarations,
  typeDeclarations,
  quotedNames,
  propertyUseCounts,
  declarationKinds,
}) {
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const inspectQuotedContracts = path !== "tests/clientPropertyCompaction.test.mjs";
  function visit(node) {
    if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.expression)
      && node.expression.expression.text === "JSON"
      && node.expression.name.text === "stringify"
      && node.arguments[0]
    ) {
      const inspectJsonValue = (value) => {
        if (ts.isObjectLiteralExpression(value)) {
          for (const property of value.properties) {
            if (
              (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property))
              && property.name
              && ts.isIdentifier(property.name)
            ) {
              if (!path.startsWith("tests/")) {
                add(jsonStringifyProperties, property.name.text, path);
              }
            }
            if (ts.isPropertyAssignment(property)) inspectJsonValue(property.initializer);
          }
        } else if (ts.isArrayLiteralExpression(value)) {
          for (const element of value.elements) inspectJsonValue(element);
        }
      };
      inspectJsonValue(node.arguments[0]);
    }
    if (ts.isPropertyAccessExpression(node) || ts.isPropertyAccessChain(node)) {
      add(maps.propertyUses, node.name.text, path);
      increment(maps.propertyUseCounts, node.name.text, path);
    } else if (ts.isElementAccessExpression(node) || ts.isElementAccessChain(node)) {
      if (ts.isStringLiteralLike(node.argumentExpression)) {
        add(maps.propertyUses, node.argumentExpression.text, path);
        increment(maps.propertyUseCounts, node.argumentExpression.text, path);
        if (inspectQuotedContracts) add(maps.quotedNames, node.argumentExpression.text, path);
      } else {
        dynamicElementAccessFiles.add(path);
      }
    }
    if (
      ts.isPropertyDeclaration(node)
      || ts.isPropertySignature(node)
      || ts.isPropertyAssignment(node)
      || ts.isMethodDeclaration(node)
      || ts.isMethodSignature(node)
      || ts.isGetAccessorDeclaration(node)
      || ts.isSetAccessorDeclaration(node)
    ) {
      const name = declaredPropertyName(node);
      add(maps.propertyUses, name, path);
      add(maps.declarations, name, path);
      increment(maps.propertyUseCounts, name, path);
      increment(maps.declarationKinds, name, `${path}:${ts.SyntaxKind[node.kind]}`);
      if (ts.isPropertySignature(node) || ts.isMethodSignature(node)) {
        add(maps.typeDeclarations, name, path);
      }
      if (inspectQuotedContracts && node.name && ts.isStringLiteralLike(node.name)) {
        add(maps.quotedNames, node.name.text, path);
      }
    } else if (ts.isShorthandPropertyAssignment(node)) {
      add(maps.propertyUses, node.name.text, path);
      add(maps.declarations, node.name.text, path);
      increment(maps.propertyUseCounts, node.name.text, path);
      increment(maps.declarationKinds, node.name.text, `${path}:${ts.SyntaxKind[node.kind]}`);
    } else if (ts.isBindingElement(node) && node.propertyName && ts.isIdentifier(node.propertyName)) {
      add(maps.propertyUses, node.propertyName.text, path);
      increment(maps.propertyUseCounts, node.propertyName.text, path);
    }
    if (inspectQuotedContracts && ts.isStringLiteralLike(node) && /^[A-Za-z_$][\w$]*$/.test(node.text)) {
      add(maps.quotedNames, node.text, path);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
}

const runtimePaths = [
  ...await sourcePaths(join(repositoryRoot, "client")),
  ...await sourcePaths(join(repositoryRoot, "server")),
  ...await sourcePaths(join(repositoryRoot, "shared")),
  ...await sourcePaths(join(repositoryRoot, "tests")),
];
for (const absolutePath of runtimePaths) {
  const path = relative(repositoryRoot, absolutePath).split(sep).join("/");
  inspectSource(path, await readFile(absolutePath, "utf8"));
}

const externalProperties = new Map();
const externalDeclarations = new Map();
const externalTypeDeclarations = new Map();
const externalQuoted = new Map();
const preactTypesPath = await newestCachedPath(join("preact", "src", "jsx.d.ts"));
for (const directory of [
  dirname(tsPath),
  dirname(preactTypesPath),
]) {
  try {
    for (const absolutePath of await sourcePaths(directory)) {
      if (!absolutePath.endsWith(".d.ts")) continue;
      inspectSource(absolutePath, await readFile(absolutePath, "utf8"), {
        propertyUses: externalProperties,
        declarations: externalDeclarations,
        typeDeclarations: externalTypeDeclarations,
        quotedNames: externalQuoted,
      });
    }
  } catch {
    // Preact may be in another Lakebed cache entry. DOM/JS types are mandatory.
  }
}

const approved = (path) => approvedRoots.some((root) => path === root || path.startsWith(`${root}/`));
const boundary = (path) => boundaryRoots.some((root) => path === root || path.startsWith(`${root}/`));
const candidates = [...declarations.keys()]
  .filter((name) => [...declarations.get(name)].some(approved))
  .filter((name) => name.length > 3)
  .filter((name) => !externalProperties.has(name))
  .filter((name) => !manuallyReservedNames.has(name))
  .filter((name) => !quotedNames.has(name))
  .filter((name) => !jsonStringifyProperties.has(name))
  .filter((name) => ![...(typeDeclarations.get(name) ?? [])].some((path) => path === "client/index.tsx"))
  .filter((name) => ![...propertyUses.get(name)].some(boundary))
  .sort();

console.log(JSON.stringify({
  candidateCount: candidates.length,
  candidates,
  allPropertyNames: [...propertyUses.keys()].sort(),
  externalPropertyNames: [...externalProperties.keys()].sort(),
  jsonStringifyPropertyNames: [...jsonStringifyProperties.keys()].sort(),
  jsonStringifyPropertyPaths: Object.fromEntries(
    [...jsonStringifyProperties].map(([name, paths]) => [name, [...paths].sort()]),
  ),
  quotedPropertyNames: [...quotedNames.keys()].sort(),
  quotedPropertyPaths: Object.fromEntries(
    [...quotedNames].map(([name, paths]) => [name, [...paths].sort()]),
  ),
  dynamicElementAccessFiles: [...dynamicElementAccessFiles].sort(),
  declarationPaths: Object.fromEntries(
    [...declarations].map(([name, paths]) => [name, [...paths].sort()]),
  ),
  propertyUsePaths: Object.fromEntries(
    [...propertyUses].map(([name, paths]) => [name, [...paths].sort()]),
  ),
  propertyUseCounts: Object.fromEntries(
    [...propertyUseCounts].map(([name, counts]) => [name, Object.fromEntries([...counts].sort())]),
  ),
  declarationKinds: Object.fromEntries(
    [...declarationKinds].map(([name, counts]) => [name, Object.fromEntries([...counts].sort())]),
  ),
}, null, 2));
