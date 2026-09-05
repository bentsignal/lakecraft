import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runAuditBuild } from "./lakebed-build-transaction.mjs";
import { cleanCommit, withCommitArchive, withCommitWorktree } from "./workflow-git.mjs";

export async function run(command, args, cwd) {
  await new Promise((accept, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code, signal) => code === 0 ? accept() : reject(
      new Error(`${command} failed (${signal ?? code}).`),
    ));
  });
}

export async function findTests(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await findTests(path));
    else if (/\.test\.(ts|mjs)$/.test(entry.name)) files.push(path);
  }
  return files.sort();
}

async function validateSnapshot(cwd) {
  const commit = cleanCommit(cwd);
  const failures = [];
  async function check(label, action) {
    console.error(`\nChecking ${label}`);
    try { await action(); } catch (error) {
      failures.push(`${label}: ${error.message}`);
      console.error(failures.at(-1));
    }
  }
  await run("npx", ["--yes", "--package", "lakebed@0.0.29", "--package", "typescript@5.9.3", "lakebed", "--version"], cwd);
  const nodeTests = [];
  const bunTests = await findTests(join(cwd, "apps/game-server/tests"));
  for (const path of [...await findTests(join(cwd, "tests")), ...await findTests(join(cwd, "tools"))]) {
    const source = await readFile(path, "utf8");
    if (/from\s*["'](?:bun:|[^"']*apps\/game-server\/)/.test(source)) bunTests.push(path);
    else nodeTests.push(path);
  }
  await check("repository tests", async () => run(process.execPath, [
    "--experimental-transform-types", "--test", "--test-concurrency=1",
    ...nodeTests,
  ], cwd));
  await check("Railway and Bun-dependent tests", () => run("bun", ["test", ...bunTests], cwd));
  for (const script of ["check-markdown-lines.mjs", "check-markdown-links.mjs"]) {
    await check(script, () => run(process.execPath, [`scripts/${script}`], cwd));
  }
  let artifact;
  await check("ordinary and paired compact builds", () => withCommitArchive(commit, cwd, async (sourceRoot) => {
    await run("npx", ["--yes", "--package", "lakebed@0.0.29", "--package", "typescript@5.9.3", "lakebed", "build", ".", "--target", "anonymous", "--json"], sourceRoot);
    const evidence = await mkdtemp(join(tmpdir(), "lakecraft-checks-"));
    try {
      const first = join(evidence, "a");
      const second = join(evidence, "b");
      await runAuditBuild({ sourceRoot, outputRoot: first });
      await runAuditBuild({ sourceRoot, outputRoot: second });
      for (const path of ["artifact-metadata.json", "staged/client-index.tsx", "staged/server-index.ts", "staged/favicon.svg"]) {
        if (!(await readFile(join(first, path))).equals(await readFile(join(second, path)))) {
          throw new Error(`Independent compact builds differ: ${path}`);
        }
      }
      artifact = JSON.parse(await readFile(join(first, "artifact-metadata.json"), "utf8"));
    } finally {
      await rm(evidence, { recursive: true, force: true });
    }
  }));
  if (cleanCommit(cwd) !== commit) failures.push("HEAD changed during validation.");
  if (failures.length) throw new Error(`Validation failed:\n${failures.join("\n")}`);
  return {
    commit, checkedAt: new Date().toISOString(), artifact,
    timingProfile: process.env.LAKECRAFT_TEST_TIMING_PROFILE ?? "reference",
  };
}

export async function validateWorkflow(cwd = process.cwd()) {
  const commit = cleanCommit(cwd);
  const result = await withCommitWorktree(commit, cwd, validateSnapshot);
  if (cleanCommit(cwd) !== commit) throw new Error("Source changed during validation.");
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) throw new Error("Usage: node scripts/validate-workflow.mjs");
  console.log(JSON.stringify(await validateWorkflow(), null, 2));
}
