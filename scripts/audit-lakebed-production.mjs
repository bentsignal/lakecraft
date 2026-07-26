import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const REQUIRED_LIMITS = [
  "artifactBytes",
  "stateBytes",
  "stateRows",
  "requestsPerDay",
  "mutationsPerDay",
];

function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function string(value, label) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function integer(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${label} must be an integer >= ${minimum}.`);
  }
  return value;
}

function isoDate(value, label) {
  const text = string(value, label);
  if (!Number.isFinite(Date.parse(text))) throw new Error(`${label} must be an ISO timestamp.`);
  return text;
}

function httpsUrl(value, label) {
  const text = string(value, label);
  const url = new URL(text);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error(`${label} must be a credential-free HTTPS URL.`);
  }
  return url.href.replace(/\/$/, "");
}

function hash(value, label) {
  const text = string(value, label);
  if (!HASH_PATTERN.test(text)) throw new Error(`${label} must be a lowercase sha256 hash.`);
  return text;
}

function isArchivedHistoricalDeploy(value) {
  const deploy = record(value, "deploy");
  return deploy.status === "archived"
    && typeof deploy.archivedAt === "string"
    && Number.isFinite(Date.parse(deploy.archivedAt));
}

export function validateProductionTarget(value) {
  const target = record(value, "production target");
  if (target.schemaVersion !== 1) throw new Error("production target schemaVersion must be 1.");
  const minimumLimits = record(target.minimumLimits, "production target minimumLimits");
  const minimumRemaining = record(target.minimumRemaining, "production target minimumRemaining");
  const limits = {};
  for (const key of REQUIRED_LIMITS) limits[key] = integer(minimumLimits[key], `minimumLimits.${key}`, 1);
  return Object.freeze({
    schemaVersion: 1,
    name: string(target.name, "production target name"),
    deployId: string(target.deployId, "production target deployId"),
    ownerId: string(target.ownerId, "production target ownerId"),
    publicUrl: httpsUrl(target.publicUrl, "production target publicUrl"),
    canonicalUrl: httpsUrl(target.canonicalUrl, "production target canonicalUrl"),
    minimumLimits: Object.freeze(limits),
    minimumRemaining: Object.freeze({
      requests: integer(minimumRemaining.requests, "minimumRemaining.requests"),
      mutations: integer(minimumRemaining.mutations, "minimumRemaining.mutations"),
    }),
  });
}

export function auditProductionDeploy(payloadValue, targetValue, options = {}) {
  const payload = record(payloadValue, "Lakebed deploy list");
  const target = validateProductionTarget(targetValue);
  const deploys = payload.deploys;
  if (!Array.isArray(deploys)) throw new Error("Lakebed deploy list deploys must be an array.");
  const matches = deploys.filter((entry) => record(entry, "deploy").deployId === target.deployId);
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one ${target.deployId} deployment; received ${matches.length}.`);
  }
  const deploy = record(matches[0], "production deploy");
  const unexpectedActiveDeploy = deploys.some((entry) => {
    const candidate = record(entry, "deploy");
    return candidate.deployId !== target.deployId && !isArchivedHistoricalDeploy(candidate);
  });
  const limits = record(deploy.limits, "production deploy limits");
  const usage = record(deploy.usage, "production deploy usage");
  const requestsPerDay = integer(limits.requestsPerDay, "limits.requestsPerDay", 1);
  const mutationsPerDay = integer(limits.mutationsPerDay, "limits.mutationsPerDay", 1);
  const requestsToday = integer(usage.requestsToday, "usage.requestsToday");
  const mutationsToday = integer(usage.mutationsToday, "usage.mutationsToday");
  const expectedArtifactHash = options.expectedArtifactHash === undefined
    ? undefined
    : hash(options.expectedArtifactHash, "expected artifact hash");
  const limitSnapshot = {};
  let limitsMeetFloor = true;
  for (const key of REQUIRED_LIMITS) {
    limitSnapshot[key] = integer(limits[key], `limits.${key}`, 1);
    if (limitSnapshot[key] < target.minimumLimits[key]) limitsMeetFloor = false;
  }
  const artifactHash = hash(deploy.artifactHash, "production deploy artifactHash");
  const clientBundleHash = hash(deploy.clientBundleHash, "production deploy clientBundleHash");
  const canonicalUrl = httpsUrl(deploy.url, "production deploy url");
  const claimedAt = deploy.claimedAt === null ? null : isoDate(deploy.claimedAt, "production deploy claimedAt");
  const gates = Object.freeze({
    active: deploy.status === "active" && deploy.archivedAt === null,
    noUnexpectedActiveDeploy: !unexpectedActiveDeploy,
    claimedOwner: deploy.ownerId === target.ownerId && claimedAt !== null,
    currentTarget: deploy.name === target.name && canonicalUrl === target.canonicalUrl,
    privateInspection: deploy.inspectPolicy === "private",
    limitsMeetFloor,
    usageWithinLimits: requestsToday <= requestsPerDay && mutationsToday <= mutationsPerDay,
    requestReserve: requestsPerDay - requestsToday >= target.minimumRemaining.requests,
    mutationReserve: mutationsPerDay - mutationsToday >= target.minimumRemaining.mutations,
    artifactMatch: expectedArtifactHash === undefined || artifactHash === expectedArtifactHash,
  });
  const failures = Object.entries(gates).filter(([, passed]) => !passed).map(([name]) => name);
  const capturedAt = options.capturedAt === undefined
    ? new Date().toISOString()
    : isoDate(options.capturedAt, "capturedAt");
  return Object.freeze({
    schemaVersion: 1,
    ok: failures.length === 0,
    capturedAt,
    target: Object.freeze({
      name: target.name,
      deployId: target.deployId,
      ownerId: target.ownerId,
      publicUrl: target.publicUrl,
      canonicalUrl,
    }),
    release: Object.freeze({
      artifactHash,
      clientBundleHash,
      createdAt: isoDate(deploy.createdAt, "production deploy createdAt"),
      updatedAt: isoDate(deploy.updatedAt, "production deploy updatedAt"),
      claimedAt,
    }),
    quota: Object.freeze({
      requestsToday,
      requestsPerDay,
      requestsRemaining: requestsPerDay - requestsToday,
      mutationsToday,
      mutationsPerDay,
      mutationsRemaining: mutationsPerDay - mutationsToday,
    }),
    limits: Object.freeze(limitSnapshot),
    gates,
    failures: Object.freeze(failures),
  });
}

export function parseAuditArguments(args) {
  const options = { deployListPath: undefined, expectedArtifactHash: undefined };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--deploy-list") {
      if (options.deployListPath !== undefined) throw new Error("--deploy-list may be provided only once.");
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error("--deploy-list requires a path.");
      options.deployListPath = value;
    } else if (argument === "--expected-artifact") {
      if (options.expectedArtifactHash !== undefined) {
        throw new Error("--expected-artifact may be provided only once.");
      }
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error("--expected-artifact requires a sha256 hash.");
      options.expectedArtifactHash = value;
    }
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

async function liveDeployList() {
  const { stdout } = await execFileAsync(
    "npx",
    ["lakebed", "deploy", "list", "--json"],
    { cwd: process.cwd(), encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
  );
  return JSON.parse(stdout);
}

export async function runAuditCli(args = process.argv.slice(2)) {
  const options = parseAuditArguments(args);
  const root = resolve(process.cwd());
  const [targetSource, lakebedSource, payload] = await Promise.all([
    readFile(resolve(root, "docs/production-target.json"), "utf8"),
    readFile(resolve(root, "lakebed.json"), "utf8"),
    options.deployListPath
      ? readFile(resolve(root, options.deployListPath), "utf8").then(JSON.parse)
      : liveDeployList(),
  ]);
  const target = validateProductionTarget(JSON.parse(targetSource));
  const lakebed = record(JSON.parse(lakebedSource), "lakebed.json");
  if (lakebed.deployId !== target.deployId) {
    throw new Error(`lakebed.json deployId ${String(lakebed.deployId)} does not match ${target.deployId}.`);
  }
  return auditProductionDeploy(payload, target, {
    expectedArtifactHash: options.expectedArtifactHash,
  });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const report = await runAuditCli();
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 2;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
