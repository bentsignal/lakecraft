import { access, cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, extname, join, relative, resolve } from "node:path";
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

const { transform } = await import(pathToFileURL(await findLakebedEsbuild()).href);

async function transformTree(directory) {
  const sourceDirectory = join(sourceRoot, directory);
  for (const entry of await readdir(sourceDirectory, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const sourcePath = join(entry.parentPath, entry.name);
    const targetPath = join(stageRoot, relative(sourceRoot, sourcePath));
    await mkdir(dirname(targetPath), { recursive: true });
    const output = await transform(await readFile(sourcePath, "utf8"), {
      format: "esm",
      jsx: "automatic",
      jsxImportSource: "preact",
      loader: extname(sourcePath) === ".tsx" ? "tsx" : "ts",
      minify: true,
      target: "es2022",
    });
    await writeFile(targetPath, output.code);
  }
}

await mkdir(join(stageRoot, ".lakebed"), { recursive: true });
await Promise.all([transformTree("client"), transformTree("server"), transformTree("shared")]);
await cp(join(sourceRoot, "favicon.svg"), join(stageRoot, "favicon.svg"));
for (const relativePath of [".lakebed/deploy.json", ".env.lakebed.server"]) {
  try {
    await cp(join(sourceRoot, relativePath), join(stageRoot, relativePath));
  } catch {
    // Optional binding and environment files may not exist yet.
  }
}

console.log(stageRoot);
