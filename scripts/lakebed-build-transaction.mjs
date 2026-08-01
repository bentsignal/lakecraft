import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { prepareLakebedStage } from "./prepare-lakebed-deploy.mjs";
import {
  assertSealedStagingPlan,
  cleanupStagingSafetyPlan,
  createLakebedWorkspace,
  createStagingSafetyPlan,
  sealStagingSafetyPlan,
} from "./lakebed-staging-safety.mjs";

function digest(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function lakebedHash(buffer) {
  return `sha256:${digest(buffer)}`;
}

function parseJson(buffer, label) {
  try {
    const value = JSON.parse(buffer.toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new Error(`${label} must be one JSON object.`);
  }
}

async function runCommand(command, args, { cwd, env = process.env } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code, signal) => {
      const output = Buffer.concat(stdout);
      const errors = Buffer.concat(stderr).toString("utf8").trim();
      if (code === 0) resolvePromise(output);
      else reject(new Error(
        `Lakebed command failed (${signal ? `signal ${signal}` : `exit ${code}`}): ${errors || "no diagnostic output"}`,
      ));
    });
  });
}

function inside(parent, candidate) {
  const child = relative(parent, candidate);
  return child !== "" && !isAbsolute(child) && child !== ".." && !child.startsWith("../");
}

async function assertRegularFile(path, label) {
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isFile()) throw new Error(`${label} must be a regular, non-symlink file.`);
  return info;
}

export async function verifyLakebedBuild(plan, reportBuffer) {
  const report = parseJson(reportBuffer, "Lakebed build report");
  for (const key of ["artifactHash", "artifactPath", "clientBundleHash", "format"]) {
    if (typeof report[key] !== "string" || !report[key]) throw new Error(`Lakebed build report is missing ${key}.`);
  }
  if (report.format !== "lakebed.capsule.artifact.v1") throw new Error("Lakebed build returned an unexpected format.");
  const artifactsRoot = await realpath(join(plan.stageRoot, ".lakebed", "artifacts"));
  const artifactPath = await realpath(resolve(report.artifactPath));
  if (!inside(artifactsRoot, artifactPath)) throw new Error("Lakebed artifact escaped the isolated workspace.");
  if (artifactPath !== join(artifactsRoot, "audit.anonymous.json")) {
    throw new Error("Lakebed build report did not return the exact requested artifact path.");
  }
  await assertRegularFile(artifactPath, "Lakebed artifact");
  const artifactBuffer = await readFile(artifactPath);
  if (artifactBuffer.length > (1024 * 1024) - (32 * 1024)) {
    throw new Error("Lakebed artifact does not preserve the required 32 KiB headroom.");
  }
  const outer = parseJson(artifactBuffer, "Lakebed artifact");
  if (outer.mediaType !== "application/vnd.lakebed.artifact+json"
    || !outer.artifact || typeof outer.artifact !== "object"
    || typeof outer.clientBundle !== "string") {
    throw new Error("Lakebed artifact has an unexpected structure.");
  }
  const artifactHash = lakebedHash(Buffer.from(JSON.stringify(outer.artifact)));
  const clientBundle = Buffer.from(outer.clientBundle, "base64");
  if (clientBundle.toString("base64") !== outer.clientBundle) throw new Error("Lakebed client bundle is not canonical base64.");
  const clientBundleHash = lakebedHash(clientBundle);
  if (artifactHash !== report.artifactHash || artifactHash !== outer.artifactHash
    || clientBundleHash !== report.clientBundleHash || clientBundleHash !== outer.clientBundleHash
    || outer.artifact.client?.bundleHash !== clientBundleHash
    || outer.artifact.client?.bytes !== clientBundle.length) {
    throw new Error("Lakebed artifact or client bundle hashes do not recompute.");
  }
  const serverSource = outer.artifact.server?.source;
  const serverBundle = Buffer.from(serverSource?.bundle ?? "", "base64");
  if (!serverSource || serverBundle.toString("base64") !== serverSource.bundle
    || lakebedHash(serverBundle) !== serverSource.bundleHash
    || serverBundle.length !== serverSource.bytes) {
    throw new Error("Lakebed server bundle hashes do not recompute.");
  }
  const sourceFiles = outer.artifact.source?.files;
  if (!Array.isArray(sourceFiles)) throw new Error("Lakebed artifact is missing its source manifest.");
  const expectedFiles = [...plan.ownedEntries.entries()]
    .filter(([path, entry]) => entry.kind === "file"
      && path.startsWith("payload/")
      && path !== "payload/lakebed.json"
      && path !== "payload/.env.lakebed.server")
    .map(([path, entry]) => ({
      bytes: entry.bytes,
      hash: `sha256:${entry.digest}`,
      path: path.slice("payload/".length),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const actualFiles = sourceFiles.map(({ bytes, hash, path }) => ({ bytes, hash, path }))
    .sort((a, b) => String(a.path).localeCompare(String(b.path)));
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)
    || outer.artifact.source.snapshotHash !== lakebedHash(Buffer.from(JSON.stringify(sourceFiles)))) {
    throw new Error("Lakebed source manifest does not match the sealed staged payload.");
  }
  return Object.freeze({ artifactBuffer, artifactHash, artifactPath, clientBundleHash, report, reportBuffer });
}

export async function runStagedTransaction({
  consume,
  prepare = prepareLakebedStage,
  sourceRoot,
  stageParent = tmpdir(),
}) {
  if (typeof consume !== "function") throw new Error("A transactional stage consumer is required.");
  const canonicalParent = await realpath(resolve(stageParent));
  const parentInfo = await lstat(canonicalParent);
  if (parentInfo.isSymbolicLink() || !parentInfo.isDirectory()) throw new Error("Stage parent must be a real directory.");
  const stageRoot = await mkdtemp(join(canonicalParent, "lakecraft-audit-"));
  let plan;
  try {
    plan = await createStagingSafetyPlan({ args: [stageRoot], sourceRoot });
  } catch (error) {
    try { await rmdir(stageRoot); } catch { /* Preserve a non-empty or replaced path. */ }
    throw error;
  }
  // createStagingSafetyPlan sees an existing directory, but this wrapper created
  // the unpredictable private transaction root and therefore owns its removal.
  plan.createdStage = true;
  let result;
  let failure;
  try {
    await prepare(plan);
    await createLakebedWorkspace(plan);
    await sealStagingSafetyPlan(plan);
    await assertSealedStagingPlan(plan, "immediately before consumption");
    result = await consume(plan);
    await assertSealedStagingPlan(plan, "immediately after consumption");
  } catch (error) {
    failure = error;
  }
  const cleaned = await cleanupStagingSafetyPlan(plan);
  if (!cleaned) {
    const cleanupError = new Error("Transactional staging cleanup refused because payload ownership changed.");
    if (failure) throw new AggregateError([failure, cleanupError], "Audit transaction failed and cleanup was refused.");
    throw cleanupError;
  }
  if (failure) throw failure;
  return result;
}

async function createEvidenceDirectory(outputRoot) {
  const requested = resolve(outputRoot);
  const parent = await realpath(dirname(requested));
  const name = basename(requested);
  if (!name || name === "." || name === "..") throw new Error("Audit evidence output needs a directory name.");
  const absolute = join(parent, name);
  await mkdir(absolute, { mode: 0o700 });
  return absolute;
}

export async function runAuditBuild({ outputRoot, sourceRoot, stageParent, runBuild } = {}) {
  if (!outputRoot) throw new Error("Pass a new audit evidence output directory.");
  const evidenceRoot = await createEvidenceDirectory(outputRoot);
  try {
    return await runStagedTransaction({
      sourceRoot,
      stageParent,
      consume: async (plan) => {
        const buildEnv = { ...process.env, LAKEBED_COMPACT_BUNDLE: "1" };
        delete buildEnv.LAKECRAFT_BUNDLE_METAFILE_DIR;
        const reportBuffer = runBuild
          ? await runBuild(plan)
          : await runCommand("npx", [
            "lakebed",
            "build",
            plan.capsuleRoot,
            "--target",
            "anonymous",
            "--out",
            join(plan.stageRoot, ".lakebed", "artifacts", "audit.anonymous.json"),
            "--json",
          ], {
            cwd: plan.stageRoot,
            env: buildEnv,
          });
        await assertSealedStagingPlan(plan, "before build-output verification");
        const verified = await verifyLakebedBuild(plan, reportBuffer);
        await mkdir(join(evidenceRoot, "client"), { mode: 0o700 });
        await mkdir(join(evidenceRoot, "server"), { mode: 0o700 });
        await writeFile(join(evidenceRoot, "artifact.json"), verified.artifactBuffer, { flag: "wx", mode: 0o600 });
        await writeFile(join(evidenceRoot, "build-report.json"), verified.reportBuffer, { flag: "wx", mode: 0o600 });
        const files = {};
        for (const path of ["client/index.tsx", "server/index.ts", "favicon.svg"]) {
          const contents = await readFile(join(plan.capsuleRoot, ...path.split("/")));
          await writeFile(join(evidenceRoot, ...path.split("/")), contents, { flag: "wx", mode: 0o600 });
          files[path] = { bytes: contents.length, sha256: digest(contents) };
        }
        const auditConfig = await readFile(join(plan.capsuleRoot, "lakebed.json"));
        await writeFile(join(evidenceRoot, "lakebed.audit.json"), auditConfig, { flag: "wx", mode: 0o600 });
        files["lakebed.audit.json"] = { bytes: auditConfig.length, sha256: digest(auditConfig) };
        const summary = {
          artifactHash: verified.artifactHash,
          artifactPath: join(evidenceRoot, "artifact.json"),
          artifactSha256: digest(verified.artifactBuffer),
          clientBundleHash: verified.clientBundleHash,
          files,
          format: verified.report.format,
          reportPath: join(evidenceRoot, "build-report.json"),
        };
        await writeFile(join(evidenceRoot, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, {
          flag: "wx",
          mode: 0o600,
        });
        return summary;
      },
    });
  } catch (error) {
    // Evidence is non-deployable, but a failed transaction must not look complete.
    await writeFile(join(evidenceRoot, "FAILED"), `${error.message}\n`, { flag: "wx", mode: 0o600 }).catch(() => {});
    throw error;
  }
}
