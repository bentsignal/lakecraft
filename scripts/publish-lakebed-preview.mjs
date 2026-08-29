import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runStagedTransaction, verifyLakebedBuild } from "./lakebed-build-transaction.mjs";

const PREVIEW_API = "https://api.lakebed.dev";
const PREVIEW_METADATA = ".lakebed/preview.json";

function parseObject(source, label) {
  try {
    const value = JSON.parse(source);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new Error(`${label} must be one JSON object.`);
  }
}

export function claimTokenFromPreviewResponse(response) {
  if (typeof response?.claimUrl !== "string" || typeof response?.deployId !== "string") return null;
  try {
    const url = new URL(response.claimUrl);
    const segments = url.pathname.split("/").filter(Boolean);
    return segments[0] === "claim" && segments[1] === response.deployId && segments[2]
      ? segments[2]
      : null;
  } catch {
    return null;
  }
}

export function previewRequestBody(envelope) {
  const lakebedVersion = envelope?.artifact?.createdWith?.lakebed;
  if (!envelope?.artifact || typeof envelope.clientBundle !== "string"
    || typeof lakebedVersion !== "string" || !lakebedVersion) {
    throw new Error("Verified Lakebed artifact is missing its deploy envelope fields.");
  }
  return JSON.stringify({
    artifact: envelope.artifact,
    clientBundle: envelope.clientBundle,
    clientVersion: lakebedVersion,
  });
}

export function parsePreviewMetadata(source) {
  const value = parseObject(source, "Lakebed preview metadata");
  if (value.api !== PREVIEW_API
    || typeof value.claimToken !== "string" || value.claimToken.length < 16
    || typeof value.deployId !== "string" || !/^dep_[A-Za-z0-9]+$/.test(value.deployId)
    || typeof value.url !== "string") {
    throw new Error("Lakebed preview metadata has an unexpected shape.");
  }
  const url = new URL(value.url);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".lakebed.app")) {
    throw new Error("Lakebed preview metadata contains an unexpected app URL.");
  }
  return value;
}

async function readPreviewMetadata(sourceRoot) {
  const path = join(sourceRoot, PREVIEW_METADATA);
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error("Lakebed preview metadata must be a regular file.");
    if (typeof process.getuid === "function" && info.uid !== process.getuid()) {
      throw new Error("Lakebed preview metadata must be owned by the current user.");
    }
    if ((info.mode & 0o077) !== 0) throw new Error("Lakebed preview metadata must use mode 0600.");
    return parsePreviewMetadata(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function writePreviewMetadata(sourceRoot, metadata) {
  const path = join(sourceRoot, PREVIEW_METADATA);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomBytes(8).toString("hex")}.tmp`;
  await writeFile(temporary, `${JSON.stringify(metadata, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  await rename(temporary, path);
  await chmod(path, 0o600);
}

async function runCommand(command, args, { cwd, env }) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolvePromise(Buffer.concat(stdout));
        return;
      }
      const detail = Buffer.concat(stderr).toString("utf8").trim();
      reject(new Error(`Lakebed build failed (${signal ? `signal ${signal}` : `exit ${code}`}): ${detail || "no diagnostic output"}`));
    });
  });
}

async function responseJson(response, label) {
  const source = await response.text();
  if (!response.ok) throw new Error(`${label} failed (${response.status}): ${source || "empty response"}`);
  return parseObject(source, label);
}

function validateDeployResponse(value) {
  if (typeof value.deployId !== "string" || !/^dep_[A-Za-z0-9]+$/.test(value.deployId)
    || typeof value.url !== "string" || typeof value.expiresAt !== "string") {
    throw new Error("Lakebed returned incomplete preview deployment metadata.");
  }
  const url = new URL(value.url);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".lakebed.app")) {
    throw new Error("Lakebed returned an unexpected preview URL.");
  }
  if (!Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= Date.now()) {
    throw new Error("Lakebed returned an expired or invalid preview lifetime.");
  }
  if (value.claimed === true) throw new Error("Refusing to manage a claimed deployment as an expiring preview.");
  return value;
}

async function publishEnvelope(envelope, previous) {
  const body = previewRequestBody(envelope);
  let response = null;
  let mode = "created";
  if (previous) {
    response = await fetch(`${PREVIEW_API}/v1/deploys/${encodeURIComponent(previous.deployId)}`, {
      body,
      headers: {
        Authorization: `Bearer ${previous.claimToken}`,
        "Content-Type": "application/json",
      },
      method: "PUT",
    });
    if (response.status === 404 || response.status === 410) response = null;
    else mode = "updated";
  }
  if (!response) {
    response = await fetch(`${PREVIEW_API}/v1/anonymous-deploys`, {
      body,
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
  }
  const deployed = validateDeployResponse(await responseJson(response, `Lakebed preview ${mode}`));
  const claimToken = claimTokenFromPreviewResponse(deployed) ?? (mode === "updated" ? previous?.claimToken : null);
  if (!claimToken) throw new Error("Lakebed did not return a reusable anonymous preview credential.");
  return { claimToken, deployed, mode };
}

export async function publishLakebedPreview({ sourceRoot = process.cwd() } = {}) {
  const canonicalRoot = resolve(sourceRoot);
  const previous = await readPreviewMetadata(canonicalRoot);
  const toolchainEnvironment = { ...process.env };
  delete toolchainEnvironment.LAKEBED_TOKEN;
  delete toolchainEnvironment.LAKEBED_TOKEN_API;
  await runCommand("npx", [
    "--yes",
    "--package",
    "lakebed@0.0.29",
    "--package",
    "typescript@5.9.3",
    "lakebed",
    "--version",
  ], { cwd: canonicalRoot, env: toolchainEnvironment });
  const published = await runStagedTransaction({
    sourceRoot: canonicalRoot,
    consume: async (plan) => {
      const environment = { ...process.env, LAKEBED_COMPACT_BUNDLE: "1" };
      delete environment.LAKEBED_TOKEN;
      delete environment.LAKEBED_TOKEN_API;
      delete environment.LAKECRAFT_BUNDLE_METAFILE_DIR;
      const reportBuffer = await runCommand("npx", [
        "--yes",
        "--package",
        "lakebed@0.0.29",
        "--package",
        "typescript@5.9.3",
        "lakebed",
        "build",
        plan.capsuleRoot,
        "--target",
        "anonymous",
        "--out",
        join(plan.stageRoot, ".lakebed", "artifacts", "audit.anonymous.json"),
        "--json",
      ], { cwd: plan.stageRoot, env: environment });
      const verified = await verifyLakebedBuild(plan, reportBuffer);
      const envelope = parseObject(verified.artifactBuffer.toString("utf8"), "Verified Lakebed artifact");
      const remote = await publishEnvelope(envelope, previous);
      return {
        artifactBytes: verified.artifactBuffer.length,
        artifactHash: verified.artifactHash,
        clientBundleHash: verified.clientBundleHash,
        ...remote,
      };
    },
  });
  const metadata = {
    api: PREVIEW_API,
    claimToken: published.claimToken,
    deployId: published.deployed.deployId,
    expiresAt: published.deployed.expiresAt,
    updatedAt: published.deployed.updatedAt,
    url: published.deployed.url,
  };
  await writePreviewMetadata(canonicalRoot, metadata);
  return {
    artifactBytes: published.artifactBytes,
    artifactHash: published.artifactHash,
    clientBundleHash: published.clientBundleHash,
    deployId: metadata.deployId,
    expiresAt: metadata.expiresAt,
    mode: published.mode,
    url: metadata.url,
  };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) throw new Error("Usage: node scripts/publish-lakebed-preview.mjs");
  console.log(JSON.stringify(await publishLakebedPreview(), null, 2));
}
