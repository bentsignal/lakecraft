import { access, cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertNoServerGamePresentationUse,
  stripServerGamePresentation,
} from "./server-game-catalog-transform.mjs";
import {
  bundleCompressCss,
  bundleDecompressCss,
  compactClientIdentifiers,
  CSS_BUNDLE_SEPARATOR,
  cssBundleRuntimeExpression,
  minifyCssText,
} from "./css-template-compression.mjs";
import {
  COMPACT_CLIENT_PROPERTY_MANGLE_CACHE,
  COMPACT_CLIENT_PROPERTY_PATTERN,
  compactClientPropertyCache,
} from "./client-property-compaction.mjs";

const sourceRoot = resolve(process.cwd());
const stageRoot = resolve(process.argv[2] ?? "");
if (!process.argv[2] || stageRoot === sourceRoot) {
  throw new Error("Pass an empty staging directory outside the capsule.");
}

async function findLakebedEsbuild() {
  const cacheRoot = join(homedir(), ".npm", "_npx");
  const candidates = [];
  for (const entry of await readdir(cacheRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const esbuildPath = join(cacheRoot, entry.name, "node_modules", "esbuild", "lib", "main.js");
    const lakebedPath = join(cacheRoot, entry.name, "node_modules", "lakebed", "package.json");
    try {
      await access(lakebedPath);
      candidates.push({
        esbuildPath,
        lakebedBuildPath: join(cacheRoot, entry.name, "node_modules", "lakebed", "dist", "cli", "build.js"),
        modifiedAt: (await stat(esbuildPath)).mtimeMs,
      });
    } catch {
      // This npx cache entry is unrelated or incomplete.
    }
  }
  candidates.sort((left, right) => right.modifiedAt - left.modifiedAt);
  if (!candidates[0]) throw new Error("Run `npx lakebed build` once so Lakebed's bundled compiler is available.");
  return candidates[0];
}

async function enableCompactLakebedBuild(buildPath) {
  const source = await readFile(buildPath, "utf8");
  if (source.includes("LAKEBED_COMPACT_BUNDLE")) return;
  const needle = '        sourcemap: "inline",';
  const matches = source.split(needle).length - 1;
  if (matches !== 2) throw new Error("Lakebed's build layout changed; compact production patch needs review.");
  await writeFile(buildPath, source.replaceAll(
    needle,
    '        sourcemap: process.env.LAKEBED_COMPACT_BUNDLE === "1" ? false : "inline",\n'
      + '        minify: process.env.LAKEBED_COMPACT_BUNDLE === "1",',
  ));
}

const lakebedRuntime = await findLakebedEsbuild();
await enableCompactLakebedBuild(lakebedRuntime.lakebedBuildPath);
const { build } = await import(pathToFileURL(lakebedRuntime.esbuildPath).href);

async function clientSourcePaths(directory = join(sourceRoot, "client")) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await clientSourcePaths(path));
    else if (/\.[tj]sx?$/.test(entry.name)) paths.push(path);
  }
  return paths.sort();
}

async function createCssBundlePlan() {
  const templates = [];
  const indexes = new Map();
  for (const path of await clientSourcePaths()) {
    const source = compactClientIdentifiers(await readFile(path, "utf8"));
    for (const match of source.matchAll(/const\s+([A-Z][A-Z0-9_]*_CSS)\s*=\s*`([\s\S]*?)`;/g)) {
      const index = templates.length;
      templates.push(minifyCssText(match[2]));
      indexes.set(`${path}\0${match[1]}`, index);
    }
  }
  if (templates.some((css) => css.includes(CSS_BUNDLE_SEPARATOR))) {
    throw new Error("A staged stylesheet contains the reserved CSS bundle separator.");
  }
  const joined = templates.join(CSS_BUNDLE_SEPARATOR);
  const packed = bundleCompressCss(joined);
  if (!packed || bundleDecompressCss(packed) !== joined) {
    throw new Error("Unable to round-trip the staged client CSS bundle.");
  }
  return {
    indexes,
    moduleSource: `export const c=(${cssBundleRuntimeExpression(packed)}).split(${JSON.stringify(CSS_BUNDLE_SEPARATOR)});`,
  };
}

const cssBundlePlan = await createCssBundlePlan();

const cssTemplateMinifier = {
  name: "lakecraft-css-template-minifier",
  setup(esbuild) {
    esbuild.onResolve({ filter: /^lakecraft:css$/ }, () => ({
      path: "bundle",
      namespace: "lakecraft-css",
    }));
    esbuild.onLoad({ filter: /.*/, namespace: "lakecraft-css" }, () => ({
      contents: cssBundlePlan.moduleSource,
      loader: "js",
    }));
    esbuild.onLoad({ filter: /\.[tj]sx?$/ }, async ({ path }) => {
      const source = await readFile(path, "utf8");
      const compactedSource = path.startsWith(`${join(sourceRoot, "client")}${sep}`)
        ? compactClientIdentifiers(source)
        : source;
      let usesCssBundle = false;
      const contents = compactedSource.replace(
        /const\s+([A-Z][A-Z0-9_]*_CSS)\s*=\s*`([\s\S]*?)`;/g,
        (match, name) => {
          const index = cssBundlePlan.indexes.get(`${path}\0${name}`);
          if (index === undefined) return match;
          usesCssBundle = true;
          return `const ${name}=__lakecraftCss[${index}];`;
        },
      );
      return {
        contents: usesCssBundle
          ? `import{c as __lakecraftCss}from"lakecraft:css";${contents}`
          : contents,
        loader: path.endsWith(".tsx") ? "tsx" : "ts",
      };
    });
  },
};

const serverGameCatalogStripper = {
  name: "lakecraft-server-game-catalog-stripper",
  setup(esbuild) {
    esbuild.onLoad({ filter: /[/\\]shared[/\\]game\.ts$/ }, async ({ path }) => ({
      contents: stripServerGamePresentation(await readFile(path, "utf8")),
      loader: "ts",
    }));
  },
};

function appendServerSourceMapBoundary(source) {
  // Lakebed bundles this already-minified stage a second time with inline source
  // maps. Give that build a real upstream boundary so it does not embed the full
  // generated server as duplicate sourcesContent in the deploy artifact.
  const map = {
    version: 3,
    sources: ["lakecraft-server-stage.ts"],
    sourcesContent: [null],
    names: [],
    mappings: "AAAA",
  };
  const encoded = Buffer.from(JSON.stringify(map)).toString("base64");
  return `${source}\n//# sourceMappingURL=data:application/json;base64,${encoded}\n`;
}

function appendClientSourceMapBoundary(source) {
  const map = {
    version: 3,
    sources: ["lakecraft-client-stage.tsx"],
    sourcesContent: [null],
    names: [],
    mappings: "AAAA",
  };
  const encoded = Buffer.from(JSON.stringify(map)).toString("base64");
  return `${source}\n//# sourceMappingURL=data:application/json;base64,${encoded}\n`;
}

async function bundleEntrypoint(sourcePath, targetPath, { server = false } = {}) {
  const options = {
    absWorkingDir: sourceRoot,
    bundle: true,
    charset: "utf8",
    entryPoints: [sourcePath],
    external: ["lakebed/client", "lakebed/server", "preact", "preact/hooks", "preact/jsx-runtime"],
    format: "esm",
    jsx: "automatic",
    jsxImportSource: "preact",
    legalComments: "none",
    metafile: server,
    minify: true,
    ...(server ? {} : {
      mangleCache: compactClientPropertyCache(),
      mangleProps: COMPACT_CLIENT_PROPERTY_PATTERN,
      mangleQuoted: false,
    }),
    platform: "browser",
    plugins: server ? [serverGameCatalogStripper, cssTemplateMinifier] : [cssTemplateMinifier],
    sourcemap: false,
    target: "es2022",
    treeShaking: true,
    write: false,
  };
  if (!server) {
    const liveSetAudit = await build({ ...options, mangleCache: {} });
    const actualNames = Object.keys(liveSetAudit.mangleCache ?? {}).sort();
    const expectedNames = Object.keys(COMPACT_CLIENT_PROPERTY_MANGLE_CACHE).sort();
    if (
      actualNames.length !== expectedNames.length
      || expectedNames.some((name, index) => actualNames[index] !== name)
    ) {
      throw new Error("Compact client property live set changed; review the fixed compatibility manifest.");
    }
  }
  const result = await build(options);
  if (!server) {
    const actualCache = result.mangleCache ?? {};
    const expectedEntries = Object.entries(COMPACT_CLIENT_PROPERTY_MANGLE_CACHE);
    if (
      Object.keys(actualCache).length !== expectedEntries.length
      || expectedEntries.some(([name, compactName]) => actualCache[name] !== compactName)
    ) {
      throw new Error("Compact client property mapping changed; review the fixed compatibility manifest.");
    }
  }
  if (server) {
    const inputPaths = Object.keys(result.metafile?.inputs ?? {})
      .filter((path) => !path.includes("node_modules"))
      .map((path) => resolve(sourceRoot, path));
    assertNoServerGamePresentationUse(await Promise.all(inputPaths.map(async (path) => ({
      path,
      source: await readFile(path, "utf8"),
    }))));
  }
  const output = result.outputFiles?.[0];
  if (!output) throw new Error(`Bundling ${sourcePath} produced no output.`);
  const absoluteTarget = join(stageRoot, targetPath);
  await mkdir(dirname(absoluteTarget), { recursive: true });
  await writeFile(
    absoluteTarget,
    server ? appendServerSourceMapBoundary(output.text) : appendClientSourceMapBoundary(output.text),
  );
}

await mkdir(join(stageRoot, ".lakebed"), { recursive: true });
await Promise.all([
  bundleEntrypoint("client/index.tsx", "client/index.tsx"),
  bundleEntrypoint("server/index.ts", "server/index.ts", { server: true }),
]);
await cp(join(sourceRoot, "favicon.svg"), join(stageRoot, "favicon.svg"));
for (const relativePath of ["lakebed.json", ".lakebed/deploy.json", ".env.lakebed.server"]) {
  try {
    await cp(join(sourceRoot, relativePath), join(stageRoot, relativePath));
  } catch {
    // Optional binding and environment files may not exist yet.
  }
}

console.log(stageRoot);
