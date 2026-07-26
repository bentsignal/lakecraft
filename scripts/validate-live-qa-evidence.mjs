import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const TASK41_EVIDENCE_VERSION = 1;
export const TASK41_TASK_ID = "jx7a5mshjv8ktdk1922wnm0xq58akz0w";
export const TASK41_TEMPLATE_COMMAND =
  "node scripts/validate-live-qa-evidence.mjs --template > /tmp/lakecraft-task41-evidence.json";
export const TASK41_TEMPLATE_START = "<!-- task41-evidence-template:start -->";
export const TASK41_TEMPLATE_END = "<!-- task41-evidence-template:end -->";
export const TASK41_CASES_START = "<!-- task41-cases:start -->";
export const TASK41_CASES_END = "<!-- task41-cases:end -->";
export const TASK41_VIEWPORTS = Object.freeze({
  desktop: Object.freeze({ width: 1280, height: 720 }),
  narrow: Object.freeze({ width: 800, height: 720 }),
});
export const TASK41_WORLD_ROLES = Object.freeze([
  Object.freeze({ role: "survival", name: "QA Survival", seed: 41001, initialMode: "survival" }),
  Object.freeze({ role: "creative", name: "QA Creative", seed: 41002, initialMode: "creative" }),
  Object.freeze({ role: "fault", name: "QA Fault", seed: 41003, initialMode: "survival" }),
]);
export const TASK41_CASES = Object.freeze([
  Object.freeze({ id: "world-create-search-select", viewports: ["desktop", "narrow"], kinds: ["screenshot"] }),
  Object.freeze({ id: "world-modes-and-commands", viewports: ["desktop", "narrow"], kinds: ["screenshot", "transcript"] }),
  Object.freeze({ id: "world-save-quit-return", viewports: ["desktop", "narrow"], kinds: ["video"] }),
  Object.freeze({ id: "world-state-isolation", viewports: ["desktop", "narrow"], kinds: ["screenshot"] }),
  Object.freeze({ id: "world-corruption-isolation", viewports: ["desktop", "narrow"], kinds: ["screenshot"] }),
  Object.freeze({ id: "world-reset-delete-keyboard-focus", viewports: ["desktop", "narrow"], kinds: ["video"] }),
  Object.freeze({ id: "world-capacity-boundary", viewports: ["desktop", "narrow"], kinds: ["screenshot"] }),
  Object.freeze({ id: "cave-day-surface-shaft-roofed", viewports: ["desktop", "narrow"], kinds: ["screenshot"] }),
  Object.freeze({ id: "cave-night-surface-shaft-roofed", viewports: ["desktop", "narrow"], kinds: ["screenshot"] }),
  Object.freeze({ id: "cave-seam-edit-invalidation", viewports: ["desktop", "narrow"], kinds: ["video"] }),
  Object.freeze({ id: "cave-dawn-no-global-brightening", viewports: ["desktop"], kinds: ["video"] }),
  Object.freeze({ id: "performance-draw-frame", viewports: ["desktop", "narrow"], kinds: ["performance-json"] }),
  Object.freeze({ id: "combat-melee-armor-cover", viewports: ["desktop", "narrow"], kinds: ["video"] }),
  Object.freeze({ id: "combat-tnt-chain", viewports: ["desktop", "narrow"], kinds: ["video"] }),
  Object.freeze({ id: "combat-bow", viewports: ["desktop", "narrow"], kinds: ["video"] }),
  Object.freeze({ id: "console-clean", viewports: [], kinds: ["console-log"] }),
  Object.freeze({ id: "singleplayer-zero-network", viewports: [], kinds: ["har"] }),
  Object.freeze({ id: "artifact-reserve-determinism", viewports: [], kinds: ["artifact-json"] }),
]);
export const TASK41_PERFORMANCE_SCENES = Object.freeze([
  "surface-day",
  "roofed-cave-day",
  "open-shaft-day",
  "surface-night",
  "roofed-cave-night",
  "open-shaft-night",
]);

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const ISO_DATE_PATTERN = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/;
const EVIDENCE_KINDS = new Set([
  "artifact-json",
  "console-log",
  "har",
  "performance-json",
  "screenshot",
  "transcript",
  "video",
]);

function occurrences(source, token) {
  return source.split(token).length - 1;
}

export function extractTask41TemplateCommand(source) {
  if (typeof source !== "string"
    || occurrences(source, TASK41_TEMPLATE_START) !== 1
    || occurrences(source, TASK41_TEMPLATE_END) !== 1) {
    throw new Error("Task 41 template markers must each occur exactly once.");
  }
  const start = source.indexOf(TASK41_TEMPLATE_START) + TASK41_TEMPLATE_START.length;
  const end = source.indexOf(TASK41_TEMPLATE_END);
  if (end <= start) throw new Error("Task 41 template markers are out of order.");
  const block = source.slice(start, end).trim();
  const match = /^```sh\n([^\n]+)\n```$/.exec(block);
  if (!match || match[1] !== TASK41_TEMPLATE_COMMAND) {
    throw new Error("Task 41 template block must contain only the canonical command.");
  }
  return match[1];
}

export function extractTask41RunbookCases(source) {
  if (typeof source !== "string"
    || occurrences(source, TASK41_CASES_START) !== 1
    || occurrences(source, TASK41_CASES_END) !== 1) {
    throw new Error("Task 41 case markers must each occur exactly once.");
  }
  const start = source.indexOf(TASK41_CASES_START) + TASK41_CASES_START.length;
  const end = source.indexOf(TASK41_CASES_END);
  if (end <= start) throw new Error("Task 41 case markers are out of order.");
  const ids = [...source.slice(start, end).matchAll(/^\|\s*`([^`]+)`\s*\|/gm)]
    .map((match) => match[1]);
  const expected = TASK41_CASES.map(({ id }) => id);
  exactArray(ids, expected, "Task 41 runbook cases");
  return ids;
}

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function exactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (actual.length !== sortedExpected.length
    || actual.some((key, index) => key !== sortedExpected[index])) {
    throw new Error(`${label} keys must be exactly ${sortedExpected.join(", ")}.`);
  }
}

function nonemptyString(value, label) {
  if (typeof value !== "string" || !value.trim() || value.startsWith("PENDING")) {
    throw new Error(`${label} must be completed.`);
  }
  return value;
}

function finiteNumber(value, label, minimum = -Infinity, maximum = Infinity) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} is outside its allowed range.`);
  }
  return value;
}

function integer(value, label, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  finiteNumber(value, label, minimum, maximum);
  if (!Number.isSafeInteger(value)) throw new Error(`${label} must be an integer.`);
  return value;
}

function sha256(value, label) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256.`);
  }
  return value;
}

function evidencePath(value, label) {
  nonemptyString(value, label);
  const normalized = normalize(value);
  if (isAbsolute(value) || normalized === ".." || normalized.startsWith(`..${sep}`)) {
    throw new Error(`${label} must remain beneath the evidence root.`);
  }
  return normalized;
}

function exactArray(value, expected, label) {
  if (!Array.isArray(value) || value.length !== expected.length
    || value.some((item, index) => item !== expected[index])) {
    throw new Error(`${label} must be exactly ${expected.join(", ")}.`);
  }
}

function validateWorlds(worlds) {
  if (!Array.isArray(worlds) || worlds.length !== TASK41_WORLD_ROLES.length) {
    throw new Error("worlds must contain the three fixed disposable worlds.");
  }
  const worldIds = new Set();
  worlds.forEach((world, index) => {
    const expected = TASK41_WORLD_ROLES[index];
    const value = record(world);
    if (!value) throw new Error(`worlds[${index}] must be an object.`);
    exactKeys(value, [
      "role", "name", "seed", "initialMode", "worldId", "editMarker", "inventoryMarker", "containerMarker",
    ], `worlds[${index}]`);
    for (const key of ["role", "name", "seed", "initialMode"]) {
      if (value[key] !== expected[key]) throw new Error(`worlds[${index}].${key} changed from the runbook.`);
    }
    const worldId = nonemptyString(value.worldId, `worlds[${index}].worldId`);
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(worldId) || worldIds.has(worldId)) {
      throw new Error(`worlds[${index}].worldId must be a unique storage-safe ID.`);
    }
    worldIds.add(worldId);
    for (const key of ["editMarker", "inventoryMarker", "containerMarker"]) {
      nonemptyString(value[key], `worlds[${index}].${key}`);
    }
  });
}

function validateEvidenceEntry(entry, label, allowedViewports) {
  const value = record(entry);
  if (!value) throw new Error(`${label} must be an object.`);
  exactKeys(value, ["kind", "viewport", "path", "sha256"], label);
  if (!EVIDENCE_KINDS.has(value.kind)) throw new Error(`${label}.kind is unsupported.`);
  if (value.viewport !== null && !allowedViewports.includes(value.viewport)) {
    throw new Error(`${label}.viewport is outside its case.`);
  }
  evidencePath(value.path, `${label}.path`);
  sha256(value.sha256, `${label}.sha256`);
}

function validateObservations(observations) {
  if (!Array.isArray(observations) || observations.length !== TASK41_CASES.length) {
    throw new Error("observations must contain every Task 41 case exactly once.");
  }
  observations.forEach((observation, index) => {
    const expected = TASK41_CASES[index];
    const value = record(observation);
    if (!value) throw new Error(`observations[${index}] must be an object.`);
    exactKeys(value, ["id", "status", "viewports", "evidence", "notes"], `observations[${index}]`);
    if (value.id !== expected.id || value.status !== "pass") {
      throw new Error(`observations[${index}] must be passing case ${expected.id}.`);
    }
    exactArray(value.viewports, expected.viewports, `observations[${index}].viewports`);
    nonemptyString(value.notes, `observations[${index}].notes`);
    const expectedEvidence = expected.viewports.length
      ? expected.viewports.flatMap((viewport) =>
        expected.kinds.map((kind) => ({ kind, viewport })))
      : expected.kinds.map((kind) => ({ kind, viewport: null }));
    if (!Array.isArray(value.evidence) || value.evidence.length !== expectedEvidence.length) {
      throw new Error(`${expected.id} needs one evidence item for every required kind and viewport.`);
    }
    value.evidence.forEach((entry, evidenceIndex) => {
      const label = `observations[${index}].evidence[${evidenceIndex}]`;
      validateEvidenceEntry(entry, label, expected.viewports);
      const required = expectedEvidence[evidenceIndex];
      if (entry.kind !== required.kind || entry.viewport !== required.viewport) {
        throw new Error(
          `${label} must be ${required.kind} evidence for ${required.viewport ?? "the global run"}.`,
        );
      }
    });
  });
}

function validatePerformance(performance) {
  const expected = [];
  for (const viewport of Object.keys(TASK41_VIEWPORTS)) {
    for (const scene of TASK41_PERFORMANCE_SCENES) expected.push({ viewport, scene });
  }
  if (!Array.isArray(performance) || performance.length !== expected.length) {
    throw new Error("performance must contain every scene at both viewports.");
  }
  performance.forEach((metric, index) => {
    const value = record(metric);
    if (!value) throw new Error(`performance[${index}] must be an object.`);
    exactKeys(value, [
      "viewport", "scene", "sampleCount", "fps", "p95FrameMs", "drawCallsPerFrameP95",
      "drawCallsPerFrameMax", "totalDrawCalls", "durationMs", "patchedContexts",
      "evidencePath", "evidenceSha256",
    ], `performance[${index}]`);
    if (value.viewport !== expected[index].viewport || value.scene !== expected[index].scene) {
      throw new Error(`performance[${index}] must be ${expected[index].viewport}/${expected[index].scene}.`);
    }
    integer(value.sampleCount, `performance[${index}].sampleCount`, 120);
    finiteNumber(value.fps, `performance[${index}].fps`, 45, 240);
    finiteNumber(value.p95FrameMs, `performance[${index}].p95FrameMs`, 0.001, 33.4);
    integer(value.drawCallsPerFrameP95, `performance[${index}].drawCallsPerFrameP95`, 1);
    integer(
      value.drawCallsPerFrameMax,
      `performance[${index}].drawCallsPerFrameMax`,
      value.drawCallsPerFrameP95,
    );
    integer(value.totalDrawCalls, `performance[${index}].totalDrawCalls`, value.drawCallsPerFrameMax);
    finiteNumber(value.durationMs, `performance[${index}].durationMs`, 5_000);
    integer(value.patchedContexts, `performance[${index}].patchedContexts`, 1, 2);
    evidencePath(value.evidencePath, `performance[${index}].evidencePath`);
    sha256(value.evidenceSha256, `performance[${index}].evidenceSha256`);
  });
}

function validateConsole(value) {
  const consoleEvidence = record(value);
  if (!consoleEvidence) throw new Error("console must be an object.");
  exactKeys(consoleEvidence, ["errorCount", "warningCount", "evidencePath", "evidenceSha256"], "console");
  if (consoleEvidence.errorCount !== 0 || consoleEvidence.warningCount !== 0) {
    throw new Error("console must remain clean.");
  }
  evidencePath(consoleEvidence.evidencePath, "console.evidencePath");
  sha256(consoleEvidence.evidenceSha256, "console.evidenceSha256");
}

function validateNetwork(value) {
  const network = record(value);
  if (!network) throw new Error("network must be an object.");
  exactKeys(network, ["lakebedRequestCount", "totalRequestCount", "evidencePath", "evidenceSha256"], "network");
  if (network.lakebedRequestCount !== 0 || network.totalRequestCount !== 0) {
    throw new Error("the cleared Singleplayer network capture must contain zero requests.");
  }
  evidencePath(network.evidencePath, "network.evidencePath");
  sha256(network.evidenceSha256, "network.evidenceSha256");
}

function validateArtifact(value) {
  const artifact = record(value);
  if (!artifact) throw new Error("artifact must be an object.");
  exactKeys(artifact, [
    "artifactPath", "pairedArtifactPath", "artifactBytes", "maximumBytes", "headroomBytes",
    "minimumHeadroomBytes", "artifactHash", "clientBundleHash", "pairedArtifactsEqual",
    "artifactFileSha256", "stagedClientPath", "pairedStagedClientPath", "stagedClientSha256",
    "stagedServerPath", "pairedStagedServerPath", "stagedServerSha256", "evidencePath",
    "evidenceSha256",
  ], "artifact");
  for (const key of [
    "artifactPath", "pairedArtifactPath", "stagedClientPath", "pairedStagedClientPath",
    "stagedServerPath", "pairedStagedServerPath", "evidencePath",
  ]) evidencePath(artifact[key], `artifact.${key}`);
  const artifactBytes = integer(artifact.artifactBytes, "artifact.artifactBytes", 1);
  const maximumBytes = integer(artifact.maximumBytes, "artifact.maximumBytes", 1);
  const minimumHeadroomBytes = integer(artifact.minimumHeadroomBytes, "artifact.minimumHeadroomBytes", 32_768);
  const headroomBytes = integer(artifact.headroomBytes, "artifact.headroomBytes", minimumHeadroomBytes);
  if (maximumBytes !== 1_048_576 || minimumHeadroomBytes !== 32_768
    || headroomBytes !== maximumBytes - artifactBytes) {
    throw new Error("artifact reserve arithmetic is not exact.");
  }
  if (artifact.pairedArtifactsEqual !== true) throw new Error("paired compact artifacts must be identical.");
  for (const key of [
    "artifactFileSha256", "stagedClientSha256", "stagedServerSha256", "evidenceSha256",
  ]) sha256(artifact[key], `artifact.${key}`);
  for (const key of ["artifactHash", "clientBundleHash"]) {
    if (typeof artifact[key] !== "string" || !/^sha256:[0-9a-f]{64}$/.test(artifact[key])) {
      throw new Error(`artifact.${key} must be a Lakebed SHA-256.`);
    }
  }
}

export function createTask41EvidenceTemplate() {
  const pendingEvidence = (kind, viewport = null) => ({
    kind,
    viewport,
    path: `PENDING/${kind}`,
    sha256: "PENDING_SHA256",
  });
  return {
    schemaVersion: TASK41_EVIDENCE_VERSION,
    taskId: TASK41_TASK_ID,
    appCommit: "PENDING_COMMIT",
    runStartedAt: "PENDING_ISO_DATE",
    runCompletedAt: "PENDING_ISO_DATE",
    browser: { name: "PENDING", version: "PENDING" },
    worlds: TASK41_WORLD_ROLES.map((world) => ({
      ...world,
      worldId: "PENDING_WORLD_ID",
      editMarker: "PENDING_EDIT_MARKER",
      inventoryMarker: "PENDING_INVENTORY_MARKER",
      containerMarker: "PENDING_CONTAINER_MARKER",
    })),
    observations: TASK41_CASES.map((testCase) => ({
      id: testCase.id,
      status: "pending",
      viewports: [...testCase.viewports],
      evidence: testCase.viewports.length
        ? testCase.viewports.flatMap((viewport) =>
          testCase.kinds.map((kind) => pendingEvidence(kind, viewport)))
        : testCase.kinds.map((kind) => pendingEvidence(kind)),
      notes: "PENDING",
    })),
    performance: Object.keys(TASK41_VIEWPORTS).flatMap((viewport) =>
      TASK41_PERFORMANCE_SCENES.map((scene) => ({
        viewport,
        scene,
        sampleCount: 0,
        fps: 0,
        p95FrameMs: 0,
        drawCallsPerFrameP95: 0,
        drawCallsPerFrameMax: 0,
        totalDrawCalls: 0,
        durationMs: 0,
        patchedContexts: 0,
        evidencePath: "PENDING/performance.json",
        evidenceSha256: "PENDING_SHA256",
      }))),
    console: {
      errorCount: -1,
      warningCount: -1,
      evidencePath: "PENDING/console.log",
      evidenceSha256: "PENDING_SHA256",
    },
    network: {
      lakebedRequestCount: -1,
      totalRequestCount: -1,
      evidencePath: "PENDING/network.har",
      evidenceSha256: "PENDING_SHA256",
    },
    artifact: {
      artifactPath: "PENDING/artifact-a.json",
      pairedArtifactPath: "PENDING/artifact-b.json",
      artifactBytes: 0,
      maximumBytes: 1_048_576,
      headroomBytes: 0,
      minimumHeadroomBytes: 32_768,
      artifactHash: "PENDING_ARTIFACT_HASH",
      clientBundleHash: "PENDING_CLIENT_HASH",
      pairedArtifactsEqual: false,
      artifactFileSha256: "PENDING_SHA256",
      stagedClientPath: "PENDING/client-a.js",
      pairedStagedClientPath: "PENDING/client-b.js",
      stagedClientSha256: "PENDING_SHA256",
      stagedServerPath: "PENDING/server-a.js",
      pairedStagedServerPath: "PENDING/server-b.js",
      stagedServerSha256: "PENDING_SHA256",
      evidencePath: "PENDING/build.json",
      evidenceSha256: "PENDING_SHA256",
    },
  };
}

export function validateTask41Evidence(value) {
  const evidence = record(value);
  if (!evidence) throw new Error("Task 41 evidence must be an object.");
  exactKeys(evidence, [
    "schemaVersion", "taskId", "appCommit", "runStartedAt", "runCompletedAt", "browser",
    "worlds", "observations", "performance", "console", "network", "artifact",
  ], "evidence");
  if (evidence.schemaVersion !== TASK41_EVIDENCE_VERSION || evidence.taskId !== TASK41_TASK_ID) {
    throw new Error("Task 41 evidence identity is invalid.");
  }
  if (typeof evidence.appCommit !== "string" || !COMMIT_PATTERN.test(evidence.appCommit)) {
    throw new Error("appCommit must be an exact lowercase Git commit.");
  }
  for (const key of ["runStartedAt", "runCompletedAt"]) {
    if (typeof evidence[key] !== "string" || !ISO_DATE_PATTERN.test(evidence[key])
      || !Number.isFinite(Date.parse(evidence[key]))) throw new Error(`${key} must be an ISO UTC timestamp.`);
  }
  if (Date.parse(evidence.runCompletedAt) < Date.parse(evidence.runStartedAt)) {
    throw new Error("runCompletedAt cannot precede runStartedAt.");
  }
  const browser = record(evidence.browser);
  if (!browser) throw new Error("browser must be an object.");
  exactKeys(browser, ["name", "version"], "browser");
  nonemptyString(browser.name, "browser.name");
  nonemptyString(browser.version, "browser.version");
  validateWorlds(evidence.worlds);
  validateObservations(evidence.observations);
  validatePerformance(evidence.performance);
  validateConsole(evidence.console);
  validateNetwork(evidence.network);
  validateArtifact(evidence.artifact);
  return evidence;
}

async function fileSha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

function containedPath(root, path) {
  const absoluteRoot = resolve(root);
  const absolutePath = resolve(root, path);
  const child = relative(absoluteRoot, absolutePath);
  if (!child || isAbsolute(child) || child === ".." || child.startsWith(`..${sep}`)) {
    throw new Error(`${path} escapes the evidence root.`);
  }
  return absolutePath;
}

export async function verifyTask41EvidenceFiles(evidence, root) {
  validateTask41Evidence(evidence);
  const pairs = [];
  for (const observation of evidence.observations) {
    for (const item of observation.evidence) pairs.push([item.path, item.sha256]);
  }
  for (const metric of evidence.performance) pairs.push([metric.evidencePath, metric.evidenceSha256]);
  pairs.push([evidence.console.evidencePath, evidence.console.evidenceSha256]);
  pairs.push([evidence.network.evidencePath, evidence.network.evidenceSha256]);
  pairs.push([evidence.artifact.evidencePath, evidence.artifact.evidenceSha256]);
  for (const [path, expectedHash] of pairs) {
    const absolute = containedPath(root, path);
    if (await fileSha256(absolute) !== expectedHash) throw new Error(`${path} SHA-256 does not match.`);
  }

  const har = JSON.parse(await readFile(containedPath(root, evidence.network.evidencePath), "utf8"));
  const harEntries = har?.log?.entries;
  if (!Array.isArray(harEntries) || harEntries.length !== evidence.network.totalRequestCount) {
    throw new Error("network HAR entries do not match the zero-request evidence.");
  }

  for (const metric of evidence.performance) {
    const snapshot = JSON.parse(await readFile(containedPath(root, metric.evidencePath), "utf8"));
    const expectedSnapshot = {
      schemaVersion: 1,
      label: `${metric.viewport}/${metric.scene}`,
      sampleCount: metric.sampleCount,
      fps: metric.fps,
      p95FrameMs: metric.p95FrameMs,
      drawCallsPerFrameP95: metric.drawCallsPerFrameP95,
      drawCallsPerFrameMax: metric.drawCallsPerFrameMax,
      totalDrawCalls: metric.totalDrawCalls,
      durationMs: metric.durationMs,
      patchedContexts: metric.patchedContexts,
    };
    if (!record(snapshot)) throw new Error(`${metric.evidencePath} must contain a probe snapshot.`);
    exactKeys(snapshot, Object.keys(expectedSnapshot), `${metric.evidencePath} snapshot`);
    if (Object.entries(expectedSnapshot).some(([key, value]) => snapshot[key] !== value)) {
      throw new Error(`${metric.evidencePath} does not match its performance metric.`);
    }
  }

  const artifactPaths = [
    evidence.artifact.artifactPath,
    evidence.artifact.pairedArtifactPath,
  ].map((path) => containedPath(root, path));
  const artifactBuffers = await Promise.all(artifactPaths.map((path) => readFile(path)));
  if (artifactBuffers.some((buffer) => buffer.length !== evidence.artifact.artifactBytes)
    || !artifactBuffers[0].equals(artifactBuffers[1])
    || createHash("sha256").update(artifactBuffers[0]).digest("hex") !== evidence.artifact.artifactFileSha256) {
    throw new Error("paired artifact bytes do not match the evidence.");
  }

  for (const [leftKey, rightKey, hashKey] of [
    ["stagedClientPath", "pairedStagedClientPath", "stagedClientSha256"],
    ["stagedServerPath", "pairedStagedServerPath", "stagedServerSha256"],
  ]) {
    const left = await readFile(containedPath(root, evidence.artifact[leftKey]));
    const right = await readFile(containedPath(root, evidence.artifact[rightKey]));
    if (!left.equals(right)
      || createHash("sha256").update(left).digest("hex") !== evidence.artifact[hashKey]) {
      throw new Error(`${leftKey} pair does not match the evidence.`);
    }
  }
  return evidence;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "--template") {
    process.stdout.write(`${JSON.stringify(createTask41EvidenceTemplate(), null, 2)}\n`);
    return;
  }
  if (!command || args.length > 2 || (args[0] && args[0] !== "--root")) {
    throw new Error(
      "Usage: node scripts/validate-live-qa-evidence.mjs --template | <evidence.json> [--root <evidence-root>]",
    );
  }
  const evidencePath = resolve(command);
  const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
  const root = args[0] === "--root" ? args[1] : dirname(evidencePath);
  if (!root) throw new Error("--root requires a path.");
  await verifyTask41EvidenceFiles(evidence, root);
  console.log(JSON.stringify({
    ok: true,
    taskId: evidence.taskId,
    appCommit: evidence.appCommit,
    cases: evidence.observations.length,
    performanceSamples: evidence.performance.reduce((total, metric) => total + metric.sampleCount, 0),
    artifactBytes: evidence.artifact.artifactBytes,
    headroomBytes: evidence.artifact.headroomBytes,
  }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
