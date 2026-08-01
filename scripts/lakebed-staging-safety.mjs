import {
  constants,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

export const RELEASE_STAGING_FLAG = "--release-with-binding-and-server-env";

const LAKEBED_CONFIG = "lakebed.json";
const SERVER_ENV = ".env.lakebed.server";
const STAGE_SENTINEL = ".lakecraft-stage-owner";
const LEGACY_CREDENTIAL_PATHS = [
  ".lakebed/deploy.json",
  ".lakebed/credentials.json",
  ".lakebed/auth.json",
  ".lakebed/token",
];
const CREDENTIAL_KEY = /(?:deployId|token|secret|password|credential|apiKey|privateKey|accessKey)/i;

function usage() {
  return `Usage: node scripts/prepare-lakebed-deploy.mjs <empty-stage-directory> [${RELEASE_STAGING_FLAG}]`;
}

export function parseStagingArguments(args) {
  if (!Array.isArray(args)) throw new Error("Staging arguments must be an array.");
  const positional = [];
  let release = false;
  for (const argument of args) {
    if (argument === RELEASE_STAGING_FLAG) {
      if (release) throw new Error(`${RELEASE_STAGING_FLAG} may be passed only once.`);
      release = true;
    } else if (typeof argument === "string" && argument.startsWith("-")) {
      throw new Error(`Unknown staging option: ${argument}. ${usage()}`);
    } else {
      positional.push(argument);
    }
  }
  if (positional.length !== 1 || typeof positional[0] !== "string" || !positional[0]) {
    throw new Error(usage());
  }
  return { release, stagePath: positional[0] };
}

async function regularFileIfPresent(path, label) {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new Error(`${label} must be a regular, non-symlink file.`);
    }
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function assertNoCredentialFields(value, path = LAKEBED_CONFIG) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoCredentialFields(entry, `${path}[${index}]`));
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (CREDENTIAL_KEY.test(key)) {
      throw new Error(`Unexpected credential field at ${path}.${key}.`);
    }
    assertNoCredentialFields(entry, `${path}.${key}`);
  }
}

export function parseLakebedConfig(source) {
  let config;
  try {
    config = JSON.parse(source);
  } catch {
    throw new Error(`${LAKEBED_CONFIG} must contain valid JSON.`);
  }
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error(`${LAKEBED_CONFIG} must contain a JSON object.`);
  }
  if (Object.hasOwn(config, "deployId")) {
    if (typeof config.deployId !== "string" || !/^dep_[A-Za-z0-9]+$/.test(config.deployId)) {
      throw new Error(`${LAKEBED_CONFIG} deployId must be a valid Lakebed deployment ID.`);
    }
  }
  const safeConfig = { ...config };
  delete safeConfig.deployId;
  assertNoCredentialFields(safeConfig);
  return { config, safeConfig };
}

function isInside(parent, candidate) {
  const path = relative(parent, candidate);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

async function canonicalProspectivePath(path) {
  let existing = path;
  const suffix = [];
  while (true) {
    try {
      await lstat(existing);
      return resolve(await realpath(existing), ...suffix.reverse());
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const parent = dirname(existing);
      if (parent === existing) throw new Error(`Unable to resolve staging ancestor for ${path}.`);
      suffix.push(basename(existing));
      existing = parent;
    }
  }
}

async function assertInitiallyEmptyStage(stageRoot) {
  try {
    const info = await lstat(stageRoot);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error("The staging path must be absent or an empty, non-symlink directory.");
    }
    if ((await readdir(stageRoot)).length !== 0) {
      throw new Error("The staging directory must be empty; refusing to inherit existing files or credentials.");
    }
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function assertNoUnexpectedCredentialPaths(sourceRoot) {
  for (const relativePath of LEGACY_CREDENTIAL_PATHS) {
    if (await regularFileIfPresent(join(sourceRoot, relativePath), relativePath)) {
      throw new Error(`Unexpected credential path ${relativePath}; staging refuses legacy or implicit credentials.`);
    }
  }
  const rootEntries = await readdir(sourceRoot);
  const unexpectedEnv = rootEntries.find((name) => name.startsWith(".env.lakebed") && name !== SERVER_ENV);
  if (unexpectedEnv) {
    throw new Error(`Unexpected credential path ${unexpectedEnv}; only ${SERVER_ENV} is recognized.`);
  }
}

function sameIdentity(info, identity) {
  return info.dev === identity.dev && info.ino === identity.ino;
}

async function stageInventory(stageRoot, prefix = "") {
  const paths = [];
  for (const name of (await readdir(join(stageRoot, prefix))).sort()) {
    const relativePath = prefix ? `${prefix}/${name}` : name;
    const absolutePath = join(stageRoot, ...relativePath.split("/"));
    const info = await lstat(absolutePath, { bigint: true });
    if (info.isSymbolicLink()) throw new Error(`Staging path became a symlink: ${relativePath}.`);
    if (info.isDirectory()) {
      paths.push(relativePath);
      paths.push(...await stageInventory(stageRoot, relativePath));
    } else if (info.isFile()) {
      paths.push(relativePath);
    } else {
      throw new Error(`Staging path has an unsupported type: ${relativePath}.`);
    }
  }
  return paths;
}

async function assertStageRoot(plan) {
  let info;
  try {
    info = await lstat(plan.stageRoot, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error("Owned staging directory disappeared after preflight.");
    throw error;
  }
  if (info.isSymbolicLink() || !info.isDirectory() || !sameIdentity(info, plan.stageIdentity)) {
    throw new Error("Owned staging directory identity changed after preflight.");
  }
  if (await realpath(plan.stageRoot) !== plan.stageRoot) {
    throw new Error("Owned staging directory canonical path changed after preflight.");
  }
}

async function assertSentinel(plan) {
  const path = join(plan.stageRoot, STAGE_SENTINEL);
  const info = await lstat(path, { bigint: true });
  if (info.isSymbolicLink() || !info.isFile() || !sameIdentity(info, plan.sentinelIdentity)) {
    throw new Error("Staging ownership sentinel changed identity or type.");
  }
  if ((await readFile(path, "utf8")) !== plan.stageNonce) {
    throw new Error("Staging ownership sentinel changed after preflight.");
  }
}

export async function assertStagingPhase(plan, phase, { finalized = false } = {}) {
  await assertStageRoot(plan);
  if (!finalized) await assertSentinel(plan);
  const inventory = await stageInventory(plan.stageRoot);
  const allowed = new Set(plan.ownedPaths);
  if (!finalized) allowed.add(STAGE_SENTINEL);
  const unexpected = inventory.find((path) => !allowed.has(path));
  if (unexpected) {
    const credential = unexpected === ".lakebed" || unexpected.startsWith(".lakebed/")
      || unexpected.startsWith(".env.lakebed");
    throw new Error(`${credential ? "Unexpected credential" : "Unexpected"} path ${unexpected} during ${phase}.`);
  }
  const missing = [...allowed].find((path) => !inventory.includes(path));
  if (missing) throw new Error(`Owned staging path ${missing} disappeared during ${phase}.`);
}

async function acquireStage(plan) {
  const existed = await assertInitiallyEmptyStage(plan.stageRoot);
  try {
    if (!existed) await mkdir(plan.stageRoot, { mode: 0o700, recursive: true });
    const canonical = await realpath(plan.stageRoot);
    if (canonical !== plan.stageRoot || isInside(plan.sourceRoot, canonical)) {
      throw new Error("Staging ancestry changed or resolved inside the capsule during acquisition.");
    }
    if ((await readdir(plan.stageRoot)).length !== 0) {
      throw new Error("The staging directory changed before ownership could be acquired.");
    }
    const stageInfo = await lstat(plan.stageRoot, { bigint: true });
    if (stageInfo.isSymbolicLink() || !stageInfo.isDirectory()) {
      throw new Error("The staging directory changed type during acquisition.");
    }
    const stageNonce = `lakecraft-stage:${randomUUID()}\n`;
    plan.createdStage = !existed;
    plan.stageIdentity = { dev: stageInfo.dev, ino: stageInfo.ino };
    plan.stageNonce = stageNonce;
    await writeFile(join(plan.stageRoot, STAGE_SENTINEL), stageNonce, { flag: "wx", mode: 0o600 });
    const sentinelInfo = await lstat(join(plan.stageRoot, STAGE_SENTINEL), { bigint: true });
    plan.sentinelIdentity = { dev: sentinelInfo.dev, ino: sentinelInfo.ino };
    await assertStagingPhase(plan, "stage acquisition");
  } catch (error) {
    if (plan.stageIdentity && plan.stageNonce) await cleanupStagingSafetyPlan(plan);
    else if (!existed) {
      try { await rmdir(plan.stageRoot); } catch { /* Refuse broader cleanup on ancestry drift. */ }
    }
    throw error;
  }
}

export async function createStagingSafetyPlan({ args, sourceRoot }) {
  const parsed = parseStagingArguments(args);
  const requestedSource = resolve(sourceRoot);
  const canonicalSource = await realpath(requestedSource);
  const sourceInfo = await lstat(canonicalSource);
  if (!sourceInfo.isDirectory()) throw new Error("The capsule source must be a directory.");
  const requestedStage = resolve(requestedSource, parsed.stagePath);
  const stageRoot = await canonicalProspectivePath(requestedStage);
  if (isInside(canonicalSource, stageRoot)) {
    throw new Error("Pass an empty staging directory outside the capsule after canonical path resolution.");
  }
  await assertInitiallyEmptyStage(stageRoot);
  await assertNoUnexpectedCredentialPaths(canonicalSource);

  const configPath = join(canonicalSource, LAKEBED_CONFIG);
  if (!await regularFileIfPresent(configPath, LAKEBED_CONFIG)) {
    throw new Error(`${LAKEBED_CONFIG} is required for staging.`);
  }
  const configSource = await readFile(configPath, "utf8");
  const { config, safeConfig } = parseLakebedConfig(configSource);
  if (parsed.release && !Object.hasOwn(config, "deployId")) {
    throw new Error(`${RELEASE_STAGING_FLAG} requires an explicit deployId in ${LAKEBED_CONFIG}.`);
  }

  const serverEnvPath = join(canonicalSource, SERVER_ENV);
  const hasServerEnv = await regularFileIfPresent(serverEnvPath, SERVER_ENV);
  const plan = {
    configSource,
    createdStage: false,
    hasServerEnv,
    ownedPaths: new Set(),
    release: parsed.release,
    safeConfigSource: `${JSON.stringify(safeConfig, null, 2)}\n`,
    serverEnvSource: parsed.release && hasServerEnv ? await readFile(serverEnvPath) : undefined,
    sentinelIdentity: undefined,
    sourceRoot: canonicalSource,
    stageIdentity: undefined,
    stageNonce: undefined,
    stageRoot,
  };
  await acquireStage(plan);
  return plan;
}

function normalizeStagePath(relativePath) {
  if (typeof relativePath !== "string" || !relativePath || relativePath.startsWith("/")
    || relativePath.split(/[\\/]/).some((part) => !part || part === "." || part === "..")) {
    throw new Error(`Invalid owned staging path: ${String(relativePath)}.`);
  }
  return relativePath.split(/[\\/]/).join("/");
}

export async function createOwnedStageDirectory(plan, relativePath) {
  const normalized = normalizeStagePath(relativePath);
  await assertStagingPhase(plan, `before creating ${normalized}`);
  await mkdir(join(plan.stageRoot, ...normalized.split("/")), { mode: 0o700 });
  plan.ownedPaths.add(normalized);
  await assertStagingPhase(plan, `after creating ${normalized}`);
}

export async function writeOwnedStageFile(plan, relativePath, contents) {
  const normalized = normalizeStagePath(relativePath);
  await assertStagingPhase(plan, `before writing ${normalized}`);
  await writeFile(join(plan.stageRoot, ...normalized.split("/")), contents, { flag: "wx", mode: 0o600 });
  plan.ownedPaths.add(normalized);
  await assertStagingPhase(plan, `after writing ${normalized}`);
}

export async function copyOwnedStageFile(plan, sourcePath, relativePath) {
  const normalized = normalizeStagePath(relativePath);
  await assertStagingPhase(plan, `before copying ${normalized}`);
  await copyFile(sourcePath, join(plan.stageRoot, ...normalized.split("/")), constants.COPYFILE_EXCL);
  plan.ownedPaths.add(normalized);
  await assertStagingPhase(plan, `after copying ${normalized}`);
}

export async function writeStagingControlFiles(plan) {
  await writeOwnedStageFile(
    plan,
    LAKEBED_CONFIG,
    plan.release ? plan.configSource : plan.safeConfigSource,
  );
  if (plan.release && plan.hasServerEnv) {
    await writeOwnedStageFile(plan, SERVER_ENV, plan.serverEnvSource);
  }
}

export async function finalizeStagingSafetyPlan(plan) {
  await assertStagingPhase(plan, "before finalization");
  await unlink(join(plan.stageRoot, STAGE_SENTINEL));
  await assertStagingPhase(plan, "finalization", { finalized: true });
}

async function removeOwnedPath(plan, relativePath) {
  const path = join(plan.stageRoot, ...relativePath.split("/"));
  try {
    const info = await lstat(path);
    if (info.isDirectory() && !info.isSymbolicLink()) await rmdir(path);
    else await unlink(path);
  } catch (error) {
    if (error?.code !== "ENOENT" && error?.code !== "ENOTEMPTY") throw error;
  }
}

export async function cleanupStagingSafetyPlan(plan) {
  try {
    await assertStageRoot(plan);
    await assertSentinel(plan);
  } catch {
    return false;
  }
  const owned = [...plan.ownedPaths].sort((a, b) => b.split("/").length - a.split("/").length);
  for (const path of owned) await removeOwnedPath(plan, path);
  try { await unlink(join(plan.stageRoot, STAGE_SENTINEL)); } catch { /* Best effort after identity validation. */ }
  if (plan.createdStage) {
    try { await rmdir(plan.stageRoot); } catch { /* Preserve unexpected injected paths. */ }
  }
  return true;
}
