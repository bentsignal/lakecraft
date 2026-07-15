import { access, cp, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

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
      candidates.push({ esbuildPath, modifiedAt: (await stat(esbuildPath)).mtimeMs });
    } catch {
      // This npx cache entry is unrelated or incomplete.
    }
  }
  candidates.sort((left, right) => right.modifiedAt - left.modifiedAt);
  if (!candidates[0]) throw new Error("Run `npx lakebed build` once so Lakebed's bundled compiler is available.");
  return candidates[0].esbuildPath;
}

const { build } = await import(pathToFileURL(await findLakebedEsbuild()).href);

async function bundleEntrypoint(sourcePath, targetPath) {
  const result = await build({
    absWorkingDir: sourceRoot,
    bundle: true,
    entryPoints: [sourcePath],
    external: ["lakebed/client", "lakebed/server", "preact", "preact/hooks", "preact/jsx-runtime"],
    format: "esm",
    jsx: "automatic",
    jsxImportSource: "preact",
    legalComments: "none",
    minify: true,
    platform: "browser",
    sourcemap: false,
    target: "es2022",
    treeShaking: true,
    write: false,
  });
  const output = result.outputFiles?.[0];
  if (!output) throw new Error(`Bundling ${sourcePath} produced no output.`);
  const absoluteTarget = join(stageRoot, targetPath);
  await mkdir(dirname(absoluteTarget), { recursive: true });
  await writeFile(absoluteTarget, output.text);
}

await mkdir(join(stageRoot, ".lakebed"), { recursive: true });
await Promise.all([
  bundleEntrypoint("client/index.tsx", "client/index.tsx"),
  bundleEntrypoint("server/index.ts", "server/index.ts"),
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
