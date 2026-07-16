import { access, cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertNoServerGamePresentationUse,
  stripServerGamePresentation,
} from "./server-game-catalog-transform.mjs";
import {
  compactClientIdentifiers,
  CSS_DICTIONARY_ALPHABET,
  dictionaryCompressCss,
  minifyCssText,
} from "./css-template-compression.mjs";

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

const cssTemplateMinifier = {
  name: "lakecraft-css-template-minifier",
  setup(esbuild) {
    esbuild.onLoad({ filter: /\.[tj]sx?$/ }, async ({ path }) => {
      const source = await readFile(path, "utf8");
      const compactedSource = path.startsWith(`${join(sourceRoot, "client")}${sep}`)
        ? compactClientIdentifiers(source)
        : source;
      const contents = compactedSource.replace(
        /const\s+([A-Z][A-Z0-9_]*_CSS)\s*=\s*`([\s\S]*?)`;/g,
        (_match, name, css) => {
          const minified = minifyCssText(css);
          const packed = dictionaryCompressCss(minified);
          if (!packed) return `const ${name}=\`${minified}\`;`;
          return `const ${name}=(()=>{const d=${JSON.stringify(packed.dictionary)},a=${JSON.stringify(CSS_DICTIONARY_ALPHABET)};return ${JSON.stringify(packed.compressed)}.replace(/~([0-9A-Za-z_$])/g,(t,s)=>d[a.indexOf(s)]??t)})();`;
        },
      );
      return { contents, loader: path.endsWith(".tsx") ? "tsx" : "ts" };
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
  const result = await build({
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
    platform: "browser",
    plugins: server ? [serverGameCatalogStripper, cssTemplateMinifier] : [cssTemplateMinifier],
    sourcemap: false,
    target: "es2022",
    treeShaking: true,
    write: false,
  });
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
