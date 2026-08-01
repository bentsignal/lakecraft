import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

export const RELEASE_STAGING_FLAG = "--release-with-binding-and-server-env";

const LAKEBED_CONFIG = "lakebed.json";
const SERVER_ENV = ".env.lakebed.server";
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

async function assertEmptyStage(stageRoot) {
  try {
    const info = await lstat(stageRoot);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error("The staging path must be absent or an empty, non-symlink directory.");
    }
    if ((await readdir(stageRoot)).length !== 0) {
      throw new Error("The staging directory must be empty; refusing to inherit existing files or credentials.");
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
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

export async function createStagingSafetyPlan({ args, sourceRoot }) {
  const parsed = parseStagingArguments(args);
  const canonicalSource = resolve(sourceRoot);
  const sourceInfo = await lstat(canonicalSource);
  if (sourceInfo.isSymbolicLink() || !sourceInfo.isDirectory()) {
    throw new Error("The capsule source must be a real directory.");
  }
  const stageRoot = resolve(canonicalSource, parsed.stagePath);
  if (isInside(canonicalSource, stageRoot)) {
    throw new Error("Pass an empty staging directory outside the capsule.");
  }
  await assertEmptyStage(stageRoot);
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
  const serverEnvSource = parsed.release && hasServerEnv ? await readFile(serverEnvPath) : undefined;
  return Object.freeze({
    configSource,
    hasServerEnv,
    release: parsed.release,
    safeConfigSource: `${JSON.stringify(safeConfig, null, 2)}\n`,
    serverEnvSource,
    sourceRoot: canonicalSource,
    stageRoot,
  });
}

export async function writeStagingControlFiles(plan) {
  await mkdir(plan.stageRoot, { recursive: true });
  await writeFile(
    join(plan.stageRoot, LAKEBED_CONFIG),
    plan.release ? plan.configSource : plan.safeConfigSource,
  );
  if (plan.release && plan.hasServerEnv) {
    await writeFile(join(plan.stageRoot, SERVER_ENV), plan.serverEnvSource);
  }
}
