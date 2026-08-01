import {
  chmod,
  constants,
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rm,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

export const RELEASE_STAGING_FLAG = "--release-with-binding-and-server-env";

const LAKEBED_CONFIG = "lakebed.json";
const SERVER_ENV = ".env.lakebed.server";
const STAGE_SENTINEL = ".lakecraft-stage-owner";
const LAKEBED_WORKSPACE = ".lakebed";
const CAPSULE_PAYLOAD = "payload";
const LEGACY_CREDENTIAL_PATHS = [
  ".lakebed/deploy.json",
  ".lakebed/credentials.json",
  ".lakebed/auth.json",
  ".lakebed/token",
];
const CREDENTIAL_KEY = /(?:deployId|token|secret|password|credential|apiKey|privateKey|accessKey)/i;

function usage() {
  return `Usage: <owned-empty-stage-directory> [${RELEASE_STAGING_FLAG}]`;
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function currentUid() {
  if (typeof process.getuid !== "function") {
    throw new Error("Transactional Lakebed staging requires an operating system user ID.");
  }
  return process.getuid();
}

function mode(info) {
  return Number(info.mode) & 0o777;
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
    if (CREDENTIAL_KEY.test(key)) throw new Error(`Unexpected credential field at ${path}.${key}.`);
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
  if (Object.hasOwn(config, "deployId")
    && (typeof config.deployId !== "string" || !/^dep_[A-Za-z0-9]+$/.test(config.deployId))) {
    throw new Error(`${LAKEBED_CONFIG} deployId must be a valid Lakebed deployment ID.`);
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
    if (info.uid !== currentUid()) {
      throw new Error("A pre-existing staging directory must be owned by the current user.");
    }
    if ((mode(info) & 0o022) !== 0) {
      throw new Error("A pre-existing staging directory must not be group- or other-writable.");
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

function normalizeStagePath(relativePath) {
  if (typeof relativePath !== "string" || !relativePath || relativePath.startsWith("/")
    || relativePath.split(/[\\/]/).some((part) => !part || part === "." || part === "..")) {
    throw new Error(`Invalid owned staging path: ${String(relativePath)}.`);
  }
  return relativePath.split(/[\\/]/).join("/");
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
    } else if (info.isFile()) paths.push(relativePath);
    else throw new Error(`Staging path has an unsupported type: ${relativePath}.`);
  }
  return paths;
}

async function assertStageRoot(plan, { sealed = plan.sealed } = {}) {
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
  if (Number(info.uid) !== currentUid()) throw new Error("Owned staging directory ownership changed.");
  if (sealed && mode(info) !== 0o500) throw new Error("Sealed transaction root permissions changed.");
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
  const contents = await readFile(path);
  if (contents.length !== plan.stageNonce.length || sha256(contents) !== plan.sentinelDigest) {
    throw new Error("Staging ownership sentinel changed after preflight.");
  }
}

async function assertOwnedParentChain(plan, relativePath) {
  await assertStageRoot(plan);
  const parts = relativePath.split("/");
  for (let index = 1; index < parts.length; index += 1) {
    const parentPath = parts.slice(0, index).join("/");
    const expected = plan.ownedEntries.get(parentPath);
    if (!expected || expected.kind !== "directory") {
      throw new Error(`Staging parent ${parentPath} is not an owned directory.`);
    }
    const info = await lstat(join(plan.stageRoot, ...parts.slice(0, index)), { bigint: true });
    if (info.isSymbolicLink() || !info.isDirectory() || !sameIdentity(info, expected)) {
      throw new Error(`Owned staging directory ${parentPath} changed identity or type.`);
    }
  }
}

async function entrySnapshot(path, kind) {
  if (kind === "directory") {
    const info = await lstat(path, { bigint: true });
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("Owned staging directory changed type.");
    return { dev: info.dev, ino: info.ino, kind };
  }
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) throw new Error("Owned staging file changed type.");
    const contents = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (!sameIdentity(before, after) || before.size !== after.size || after.size !== BigInt(contents.length)) {
      throw new Error("Owned staging file changed while it was being read.");
    }
    return {
      bytes: contents.length,
      dev: after.dev,
      digest: sha256(contents),
      ino: after.ino,
      kind,
    };
  } finally {
    await handle.close();
  }
}

async function recordOwnedEntry(plan, relativePath, kind, { mutable = false } = {}) {
  await assertOwnedParentChain(plan, relativePath);
  const snapshot = await entrySnapshot(join(plan.stageRoot, ...relativePath.split("/")), kind);
  plan.ownedEntries.set(relativePath, { ...snapshot, mutable });
}

async function assertOwnedEntry(plan, relativePath, expected, { requireSentinel = true } = {}) {
  await assertStageRoot(plan);
  if (requireSentinel) await assertSentinel(plan);
  await assertOwnedParentChain(plan, relativePath);
  let actual;
  try {
    actual = await entrySnapshot(join(plan.stageRoot, ...relativePath.split("/")), expected.kind);
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error(`Owned staging path ${relativePath} disappeared.`);
    throw error;
  }
  if (!sameIdentity(actual, expected)) {
    throw new Error(`Owned staging ${expected.kind} ${relativePath} changed identity or type.`);
  }
  if (expected.kind === "file" && (actual.bytes !== expected.bytes || actual.digest !== expected.digest)) {
    throw new Error(`Owned staging file ${relativePath} changed bytes.`);
  }
}

function pathAllowed(plan, path) {
  if (plan.ownedEntries.has(path)) return true;
  return [...plan.mutableRoots].some((root) => (
    path === `${root}/build`
    || path.startsWith(`${root}/build/`)
    || path === `${root}/artifacts`
    || path.startsWith(`${root}/artifacts/`)
  ));
}

export async function assertStagingPhase(plan, phase) {
  await assertStageRoot(plan);
  await assertSentinel(plan);
  const inventory = await stageInventory(plan.stageRoot);
  const unexpected = inventory.find((path) => path !== STAGE_SENTINEL && !pathAllowed(plan, path));
  if (unexpected) {
    const logical = unexpected.startsWith(`${CAPSULE_PAYLOAD}/`)
      ? unexpected.slice(`${CAPSULE_PAYLOAD}/`.length)
      : unexpected;
    const credential = logical === LAKEBED_WORKSPACE || logical.startsWith(`${LAKEBED_WORKSPACE}/`)
      || logical.startsWith(".env.lakebed");
    throw new Error(`${credential ? "Unexpected credential" : "Unexpected"} path ${unexpected} during ${phase}.`);
  }
  for (const [path, expected] of plan.ownedEntries) {
    if (!inventory.includes(path)) throw new Error(`Owned staging path ${path} disappeared during ${phase}.`);
    await assertOwnedEntry(plan, path, expected);
  }
}

async function acquireStage(plan) {
  const existed = await assertInitiallyEmptyStage(plan.stageRoot);
  try {
    if (!existed) await mkdir(plan.stageRoot, { mode: 0o700 });
    const canonical = await realpath(plan.stageRoot);
    if (canonical !== plan.stageRoot || isInside(plan.sourceRoot, canonical)) {
      throw new Error("Staging ancestry changed or resolved inside the capsule during acquisition.");
    }
    if ((await readdir(plan.stageRoot)).length !== 0) {
      throw new Error("The staging directory changed before ownership could be acquired.");
    }
    const stageInfo = await lstat(plan.stageRoot, { bigint: true });
    if (stageInfo.isSymbolicLink() || !stageInfo.isDirectory()
      || Number(stageInfo.uid) !== currentUid() || (mode(stageInfo) & 0o022) !== 0) {
      throw new Error("The staging directory changed ownership, type, or permissions during acquisition.");
    }
    await chmod(plan.stageRoot, 0o700);
    const stageNonce = Buffer.from(`lakecraft-stage:${randomUUID()}\n`);
    plan.createdStage = !existed;
    plan.stageIdentity = { dev: stageInfo.dev, ino: stageInfo.ino };
    plan.stageNonce = stageNonce;
    plan.sentinelDigest = sha256(stageNonce);
    await writeFile(join(plan.stageRoot, STAGE_SENTINEL), stageNonce, { flag: "wx", mode: 0o600 });
    const sentinelInfo = await lstat(join(plan.stageRoot, STAGE_SENTINEL), { bigint: true });
    plan.sentinelIdentity = { dev: sentinelInfo.dev, ino: sentinelInfo.ino };
    await assertStagingPhase(plan, "stage acquisition");
  } catch (error) {
    if (plan.stageIdentity && plan.stageNonce) await cleanupStagingSafetyPlan(plan);
    else if (!existed) {
      try { await rmdir(plan.stageRoot); } catch { /* Preserve a path whose ownership is uncertain. */ }
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
  if (!await regularFileIfPresent(configPath, LAKEBED_CONFIG)) throw new Error(`${LAKEBED_CONFIG} is required for staging.`);
  const configSource = await readFile(configPath, "utf8");
  const { config, safeConfig } = parseLakebedConfig(configSource);
  if (parsed.release && !Object.hasOwn(config, "deployId")) {
    throw new Error(`${RELEASE_STAGING_FLAG} requires an explicit deployId in ${LAKEBED_CONFIG}.`);
  }
  const serverEnvPath = join(canonicalSource, SERVER_ENV);
  const hasServerEnv = await regularFileIfPresent(serverEnvPath, SERVER_ENV);
  const plan = {
    configSource,
    capsuleRoot: join(stageRoot, CAPSULE_PAYLOAD),
    createdStage: false,
    hasServerEnv,
    mutableRoots: new Set(),
    ownedEntries: new Map(),
    release: parsed.release,
    safeConfigSource: `${JSON.stringify(safeConfig, null, 2)}\n`,
    sealed: false,
    serverEnvSource: parsed.release && hasServerEnv ? await readFile(serverEnvPath) : undefined,
    sentinelIdentity: undefined,
    sourceRoot: canonicalSource,
    stageIdentity: undefined,
    stageNonce: undefined,
    stageRoot,
  };
  await acquireStage(plan);
  await mkdir(plan.capsuleRoot, { mode: 0o700 });
  await recordOwnedEntry(plan, CAPSULE_PAYLOAD, "directory");
  await assertStagingPhase(plan, "capsule payload acquisition");
  return plan;
}

export async function createOwnedStageDirectory(plan, relativePath, { mutable = false } = {}) {
  const logical = normalizeStagePath(relativePath);
  const normalized = `${CAPSULE_PAYLOAD}/${logical}`;
  await assertStagingPhase(plan, `before creating ${normalized}`);
  await assertOwnedParentChain(plan, normalized);
  await mkdir(join(plan.stageRoot, ...normalized.split("/")), { mode: 0o700 });
  await recordOwnedEntry(plan, normalized, "directory", { mutable });
  if (mutable) plan.mutableRoots.add(normalized);
  await assertStagingPhase(plan, `after creating ${normalized}`);
}

export async function writeOwnedStageFile(plan, relativePath, contents) {
  const logical = normalizeStagePath(relativePath);
  const normalized = `${CAPSULE_PAYLOAD}/${logical}`;
  await assertStagingPhase(plan, `before writing ${normalized}`);
  await assertOwnedParentChain(plan, normalized);
  await writeFile(join(plan.stageRoot, ...normalized.split("/")), contents, { flag: "wx", mode: 0o600 });
  await recordOwnedEntry(plan, normalized, "file");
  await assertStagingPhase(plan, `after writing ${normalized}`);
}

export async function copyOwnedStageFile(plan, sourcePath, relativePath) {
  const logical = normalizeStagePath(relativePath);
  const normalized = `${CAPSULE_PAYLOAD}/${logical}`;
  await assertStagingPhase(plan, `before copying ${normalized}`);
  await assertOwnedParentChain(plan, normalized);
  await copyFile(sourcePath, join(plan.stageRoot, ...normalized.split("/")), constants.COPYFILE_EXCL);
  await chmod(join(plan.stageRoot, ...normalized.split("/")), 0o600);
  await recordOwnedEntry(plan, normalized, "file");
  await assertStagingPhase(plan, `after copying ${normalized}`);
}

export async function writeStagingControlFiles(plan) {
  await writeOwnedStageFile(plan, LAKEBED_CONFIG, plan.release ? plan.configSource : plan.safeConfigSource);
  if (plan.release && plan.hasServerEnv) await writeOwnedStageFile(plan, SERVER_ENV, plan.serverEnvSource);
}

export async function createLakebedWorkspace(plan) {
  const normalized = LAKEBED_WORKSPACE;
  await assertStagingPhase(plan, `before creating ${normalized}`);
  await mkdir(join(plan.stageRoot, normalized), { mode: 0o700 });
  await recordOwnedEntry(plan, normalized, "directory", { mutable: true });
  plan.mutableRoots.add(normalized);
  await assertStagingPhase(plan, `after creating ${normalized}`);
}

export async function sealStagingSafetyPlan(plan) {
  if (!plan.mutableRoots.has(LAKEBED_WORKSPACE)) {
    throw new Error("The isolated Lakebed workspace must be created before sealing.");
  }
  await assertStagingPhase(plan, "before payload sealing");
  for (const [path, expected] of [...plan.ownedEntries.entries()].sort(([a], [b]) => b.length - a.length)) {
    if (expected.mutable) continue;
    await chmod(join(plan.stageRoot, ...path.split("/")), expected.kind === "file" ? 0o400 : 0o500);
  }
  await chmod(join(plan.stageRoot, STAGE_SENTINEL), 0o400);
  await chmod(plan.stageRoot, 0o500);
  plan.sealed = true;
  await assertSealedStagingPlan(plan, "payload sealing");
}

export async function assertSealedStagingPlan(plan, phase = "payload consumption") {
  if (!plan.sealed) throw new Error("Staging payload has not been sealed.");
  await assertStageRoot(plan, { sealed: true });
  await assertSentinel(plan);
  const sentinelInfo = await lstat(join(plan.stageRoot, STAGE_SENTINEL));
  if (mode(sentinelInfo) !== 0o400) throw new Error("Sealed staging sentinel permissions changed.");
  for (const [path, expected] of plan.ownedEntries) {
    await assertOwnedEntry(plan, path, expected);
    const info = await lstat(join(plan.stageRoot, ...path.split("/")));
    const expectedMode = expected.mutable ? 0o700 : expected.kind === "file" ? 0o400 : 0o500;
    if (mode(info) !== expectedMode) throw new Error(`Sealed staging path ${path} permissions changed during ${phase}.`);
  }
  const inventory = await stageInventory(plan.stageRoot);
  const unexpected = inventory.find((path) => path !== STAGE_SENTINEL && !pathAllowed(plan, path));
  if (unexpected) throw new Error(`Unexpected staging path ${unexpected} during ${phase}.`);
}

// Compatibility helper for tests and old callers. A finalized stage is evidence only;
// production scripts consume and delete the deployable stage inside one transaction.
export async function finalizeStagingSafetyPlan(plan) {
  await createLakebedWorkspace(plan);
  await sealStagingSafetyPlan(plan);
}

export async function cleanupStagingSafetyPlan(plan) {
  try {
    await assertStageRoot(plan, { sealed: false });
    await assertSentinel(plan);
    for (const [path, expected] of plan.ownedEntries) await assertOwnedEntry(plan, path, expected);
  } catch {
    return false;
  }
  try {
    plan.sealed = false;
    await chmod(plan.stageRoot, 0o700);
    for (const [path, expected] of [...plan.ownedEntries.entries()].sort(([a], [b]) => a.length - b.length)) {
      await chmod(join(plan.stageRoot, ...path.split("/")), expected.kind === "directory" ? 0o700 : 0o600);
    }
    const workspace = plan.ownedEntries.get(LAKEBED_WORKSPACE);
    if (workspace) {
      await assertOwnedEntry(plan, LAKEBED_WORKSPACE, workspace);
      await rm(join(plan.stageRoot, LAKEBED_WORKSPACE), { recursive: true });
      plan.ownedEntries.delete(LAKEBED_WORKSPACE);
    }
    const owned = [...plan.ownedEntries.entries()].sort(([a], [b]) => b.split("/").length - a.split("/").length);
    for (const [path, expected] of owned) {
      await assertOwnedEntry(plan, path, expected);
      const absolute = join(plan.stageRoot, ...path.split("/"));
      if (expected.kind === "directory") await rmdir(absolute);
      else await unlink(absolute);
      plan.ownedEntries.delete(path);
    }
    await unlink(join(plan.stageRoot, STAGE_SENTINEL));
    if (plan.createdStage) await rmdir(plan.stageRoot);
    return true;
  } catch {
    return false;
  }
}
