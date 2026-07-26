import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  opendir,
  readFile,
  realpath,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { inflateSync } from "node:zlib";
import {
  extname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";

export const TASK41_EVIDENCE_VERSION = 3;
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
  Object.freeze({ id: "console-clean", viewports: [], kinds: ["console-json"] }),
  Object.freeze({ id: "singleplayer-zero-network", viewports: [], kinds: ["network-json"] }),
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
export const TASK41_TRANSCRIPT_ACTIONS = Object.freeze([
  "search-survival",
  "search-creative",
  "search-fault",
  "keyboard-home",
  "keyboard-end",
  "keyboard-arrows",
  "keyboard-activate",
  "survival-initial",
  "survival-to-creative",
  "survival-back-to-survival",
  "creative-initial",
  "creative-to-survival",
  "creative-back-to-creative",
]);
export const TASK41_MULTIPLAYER_CHECKS = Object.freeze([
  "distinct-identities",
  "hosted-route",
  "movement-nameplates",
  "chat",
  "item-sharing",
  "pvp",
  "reconnect",
  "quota-accounting",
]);
export const TASK41_MULTIPLAYER_DEFERRED_REASONS = Object.freeze([
  "hosted-route-disabled",
  "authorized-identities-unavailable",
  "quota-observation-unavailable",
]);
export const TASK41_MIN_INTERACTION_SEGMENTS = 4;
export const TASK41_INTERACTION_GAP_KINDS = Object.freeze(["navigation", "reload"]);
export const TASK41_MULTIPLAYER_INTERACTIONS = Object.freeze([
  "movement-nameplate",
  "chat",
  "item-sharing",
  "pvp",
  "reconnect",
]);

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const RUN_ID_PATTERN = /^[0-9a-f]{32}$/;
const LAKEBED_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const ISO_DATE_PATTERN = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const MIN_RUN_MS = 5 * 60 * 1_000;
const MAX_RUN_MS = 6 * 60 * 60 * 1_000;
const MAX_EVIDENCE_AGE_MS = 6 * 60 * 60 * 1_000;
const CLOCK_SKEW_MS = 60 * 1_000;
const MIN_PNG_BYTES = 8 * 1_024;
const MAX_PNG_BYTES = 64 * 1_024 * 1_024;
const MIN_VIDEO_BYTES = 64 * 1_024;
const MAX_VIDEO_BYTES = 512 * 1_024 * 1_024;
const MAX_EVIDENCE_FILE_BYTES = MAX_VIDEO_BYTES;
const MAX_JSON_BYTES = 16 * 1024 * 1024;
const MAX_TOOL_OUTPUT_BYTES = 2 * 1024 * 1024;
const TOOL_TIMEOUT_MS = 30_000;
const MULTIPLAYER_MIN_WINDOW_MS = 60 * 1_000;
const MULTIPLAYER_MAX_WINDOW_MS = 30 * 60 * 1_000;
const MAX_EVIDENCE_FILES = 256;
const MAX_PATH_COMPONENTS = 16;
const MAX_EVIDENCE_PATH_CHARS = 320;
const CAPTURE_KEYS = ["taskId", "runId", "appCommit", "capturedAt", "completedAt", "sequence"];
const COMMON_ENTRY_KEYS = ["kind", "viewport", "path", "sha256", ...CAPTURE_KEYS];
const EVIDENCE_KINDS = new Set(TASK41_CASES.flatMap(({ kinds }) => kinds));
const STAGE_REBUILD_CACHE = new Map();
const VIDEO_DECODE_CACHE = new Map();

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
  const match = /^```sh\n([^\n]+)\n```$/.exec(source.slice(start, end).trim());
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
  exactArray(ids, TASK41_CASES.map(({ id }) => id), "Task 41 runbook cases");
  return ids;
}

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function exactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} keys must be exactly ${wanted.join(", ")}.`);
  }
}

function nonemptyString(value, label) {
  if (typeof value !== "string" || !value.trim() || /^pending(?:_|\b)/i.test(value.trim())) {
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

function lakebedHash(value, label) {
  if (typeof value !== "string" || !LAKEBED_HASH_PATTERN.test(value)) {
    throw new Error(`${label} must be a Lakebed SHA-256.`);
  }
  return value;
}

function exactTimestamp(value, label) {
  if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) {
    throw new Error(`${label} must be a canonical ISO UTC timestamp.`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error(`${label} must be a real canonical ISO UTC timestamp.`);
  }
  return parsed;
}

function evidencePath(value, label) {
  nonemptyString(value, label);
  if (value.length > MAX_EVIDENCE_PATH_CHARS
    || value.includes("\\")
    || value.includes("\0")
    || isAbsolute(value)) {
    throw new Error(`${label} must remain beneath the evidence root.`);
  }
  const normalized = normalize(value);
  const components = value.split("/");
  if (normalized !== value
    || normalized === "."
    || normalized === ".."
    || normalized.startsWith(`..${sep}`)
    || components.length > MAX_PATH_COMPONENTS
    || components.some((component) => !component || component === "." || component === "..")) {
    throw new Error(`${label} must be a canonical path beneath the evidence root.`);
  }
  return value;
}

function exactArray(value, expected, label) {
  if (!Array.isArray(value) || value.length !== expected.length
    || value.some((item, index) => item !== expected[index])) {
    throw new Error(`${label} must be exactly ${expected.join(", ")}.`);
  }
}

function captureContext(evidence, expectedCommit, nowMs) {
  if (typeof expectedCommit !== "string" || !COMMIT_PATTERN.test(expectedCommit)) {
    throw new Error("A trusted lowercase --expected-commit is required.");
  }
  if (evidence.appCommit !== expectedCommit) throw new Error("appCommit does not match --expected-commit.");
  if (typeof evidence.runId !== "string" || !RUN_ID_PATTERN.test(evidence.runId)) {
    throw new Error("runId must contain exactly 128 bits as lowercase hexadecimal.");
  }
  const startedAt = exactTimestamp(evidence.runStartedAt, "runStartedAt");
  const completedAt = exactTimestamp(evidence.runCompletedAt, "runCompletedAt");
  if (completedAt - startedAt < MIN_RUN_MS || completedAt - startedAt > MAX_RUN_MS) {
    throw new Error("run duration must be between five minutes and six hours.");
  }
  if (completedAt > nowMs + CLOCK_SKEW_MS || nowMs - completedAt > MAX_EVIDENCE_AGE_MS) {
    throw new Error("the evidence run is stale or implausibly in the future.");
  }
  return {
    taskId: TASK41_TASK_ID,
    runId: evidence.runId,
    appCommit: expectedCommit,
    startedAt,
    completedAt,
    captures: new Map(),
    hashes: new Map(),
    paths: new Map(),
    lastSequence: 0,
    lastCapturedAt: startedAt - 1,
    captureWindows: [],
  };
}

function registerReference(context, path, hash, label, duplicateHashOf = undefined) {
  const priorPath = context.paths.get(path);
  if (priorPath) throw new Error(`${label} reuses evidence path ${path} from ${priorPath}.`);
  const priorHash = context.hashes.get(hash);
  if (priorHash !== undefined && priorHash !== duplicateHashOf) {
    throw new Error(`${label} reuses evidence hash from ${priorHash}.`);
  }
  if (duplicateHashOf !== undefined && priorHash !== duplicateHashOf) {
    throw new Error(`${label} must byte-match ${duplicateHashOf}.`);
  }
  context.paths.set(path, label);
  if (priorHash === undefined) context.hashes.set(hash, path);
}

function validateCapture(
  value,
  label,
  context,
  path = undefined,
  hash = undefined,
  duplicateHashOf = undefined,
) {
  if (value.taskId !== context.taskId || value.runId !== context.runId || value.appCommit !== context.appCommit) {
    throw new Error(`${label} is not bound to this Task 41 run and commit.`);
  }
  const capturedAt = exactTimestamp(value.capturedAt, `${label}.capturedAt`);
  const completedAt = exactTimestamp(value.completedAt, `${label}.completedAt`);
  if (capturedAt < context.startedAt || completedAt > context.completedAt || completedAt < capturedAt) {
    throw new Error(`${label} capture window falls outside the run.`);
  }
  if (capturedAt <= context.lastCapturedAt) {
    throw new Error(`${label}.capturedAt must increase in canonical manifest order.`);
  }
  context.lastCapturedAt = capturedAt;
  const sequence = integer(value.sequence, `${label}.sequence`, 1);
  if (sequence !== context.lastSequence + 1) {
    throw new Error(`${label}.sequence must be contiguous in canonical manifest order.`);
  }
  context.lastSequence = sequence;
  const identity = path === undefined ? label : `${path}\0${hash}`;
  context.captures.set(sequence, identity);
  context.captureWindows.push({ label, startedAt: capturedAt, completedAt });
  if (path !== undefined) registerReference(context, path, hash, label, duplicateHashOf);
}

function validateWorlds(worlds) {
  if (!Array.isArray(worlds) || worlds.length !== TASK41_WORLD_ROLES.length) {
    throw new Error("worlds must contain the three fixed disposable worlds.");
  }
  const worldIds = new Set();
  const markers = new Set();
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
      const marker = nonemptyString(value[key], `worlds[${index}].${key}`);
      if (markers.has(marker)) throw new Error("all nine world markers must be unique.");
      markers.add(marker);
    }
  });
}

function validateEvidenceEntry(entry, label, expected, context) {
  const value = record(entry);
  if (!value) throw new Error(`${label} must be an object.`);
  const mediaKeys = value.kind === "screenshot"
    ? ["mimeType", "width", "height", "devicePixelRatio"]
    : value.kind === "video"
      ? ["mimeType", "width", "height", "devicePixelRatio", "durationMs"]
      : [];
  exactKeys(value, [...COMMON_ENTRY_KEYS, ...mediaKeys], label);
  if (!EVIDENCE_KINDS.has(value.kind) || value.kind !== expected.kind) {
    throw new Error(`${label}.kind must be ${expected.kind}.`);
  }
  if (value.viewport !== expected.viewport) throw new Error(`${label}.viewport changed from the case contract.`);
  evidencePath(value.path, `${label}.path`);
  sha256(value.sha256, `${label}.sha256`);
  validateCapture(value, label, context, value.path, value.sha256);
  if (value.kind === "screenshot") {
    if (value.mimeType !== "image/png") throw new Error(`${label} must be a PNG screenshot.`);
    const viewport = TASK41_VIEWPORTS[value.viewport];
    const dpr = finiteNumber(value.devicePixelRatio, `${label}.devicePixelRatio`, 1, 4);
    integer(value.width, `${label}.width`, 1);
    integer(value.height, `${label}.height`, 1);
    if (value.width !== viewport.width * dpr || value.height !== viewport.height * dpr) {
      throw new Error(`${label} PNG dimensions do not match its viewport and DPR.`);
    }
  } else if (value.kind === "video") {
    if (!["video/webm", "video/mp4"].includes(value.mimeType)) {
      throw new Error(`${label}.mimeType must be video/webm or video/mp4.`);
    }
    const viewport = TASK41_VIEWPORTS[value.viewport];
    const dpr = finiteNumber(value.devicePixelRatio, `${label}.devicePixelRatio`, 1, 4);
    integer(value.width, `${label}.width`, 1);
    integer(value.height, `${label}.height`, 1);
    if (value.width !== viewport.width * dpr || value.height !== viewport.height * dpr) {
      throw new Error(`${label} video dimensions do not match its viewport and DPR.`);
    }
    finiteNumber(value.durationMs, `${label}.durationMs`, 1_000, MAX_RUN_MS);
    if (Date.parse(value.completedAt) - Date.parse(value.capturedAt) !== value.durationMs) {
      throw new Error(`${label} video duration must equal its capture window.`);
    }
  }
  return value;
}

function validateObservations(observations, context) {
  if (!Array.isArray(observations) || observations.length !== TASK41_CASES.length) {
    throw new Error("observations must contain every Task 41 case exactly once.");
  }
  const uniquePaths = new Set();
  const uniqueHashes = new Set();
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
    const wanted = expected.viewports.length
      ? expected.viewports.flatMap((viewport) => expected.kinds.map((kind) => ({ kind, viewport })))
      : expected.kinds.map((kind) => ({ kind, viewport: null }));
    if (!Array.isArray(value.evidence) || value.evidence.length !== wanted.length) {
      throw new Error(`${expected.id} needs one evidence item for every required kind and viewport.`);
    }
    value.evidence.forEach((entry, entryIndex) => {
      const checked = validateEvidenceEntry(
        entry,
        `observations[${index}].evidence[${entryIndex}]`,
        wanted[entryIndex],
        context,
      );
      if (["screenshot", "video", "transcript"].includes(checked.kind)) {
        if (uniquePaths.has(checked.path) || uniqueHashes.has(checked.sha256)) {
          throw new Error("visual and transcript observations must have unique paths and hashes.");
        }
        uniquePaths.add(checked.path);
        uniqueHashes.add(checked.sha256);
      }
    });
  });
}

function validatePerformance(performance, context) {
  const wanted = Object.keys(TASK41_VIEWPORTS)
    .flatMap((viewport) => TASK41_PERFORMANCE_SCENES.map((scene) => ({ viewport, scene })));
  if (!Array.isArray(performance) || performance.length !== wanted.length) {
    throw new Error("performance must contain every scene at both viewports.");
  }
  performance.forEach((metric, index) => {
    const value = record(metric);
    if (!value) throw new Error(`performance[${index}] must be an object.`);
    exactKeys(value, [
      "viewport", "scene", "devicePixelRatio", "sampleCount", "fps", "p95FrameMs", "drawCallsPerFrameP95",
      "drawCallsPerFrameMax", "totalDrawCalls", "durationMs", "patchedContexts",
      "evidencePath", "evidenceSha256", ...CAPTURE_KEYS,
    ], `performance[${index}]`);
    if (value.viewport !== wanted[index].viewport || value.scene !== wanted[index].scene) {
      throw new Error(`performance[${index}] must be ${wanted[index].viewport}/${wanted[index].scene}.`);
    }
    finiteNumber(value.devicePixelRatio, `performance[${index}].devicePixelRatio`, 1, 4);
    integer(value.sampleCount, `performance[${index}].sampleCount`, 120, 3_600);
    finiteNumber(value.fps, `performance[${index}].fps`, 45, 240);
    finiteNumber(value.p95FrameMs, `performance[${index}].p95FrameMs`, 0.001, 33.4);
    integer(value.drawCallsPerFrameP95, `performance[${index}].drawCallsPerFrameP95`, 1);
    integer(value.drawCallsPerFrameMax, `performance[${index}].drawCallsPerFrameMax`, value.drawCallsPerFrameP95);
    integer(value.totalDrawCalls, `performance[${index}].totalDrawCalls`, value.drawCallsPerFrameMax);
    finiteNumber(value.durationMs, `performance[${index}].durationMs`, 5_000, 120_000);
    integer(value.patchedContexts, `performance[${index}].patchedContexts`, 1, 2);
    evidencePath(value.evidencePath, `performance[${index}].evidencePath`);
    sha256(value.evidenceSha256, `performance[${index}].evidenceSha256`);
    validateCapture(value, `performance[${index}]`, context, value.evidencePath, value.evidenceSha256);
  });
}

function validateStructuredSummary(value, label, keys, context) {
  const summary = record(value);
  if (!summary) throw new Error(`${label} must be an object.`);
  exactKeys(summary, [...keys, "evidencePath", "evidenceSha256", ...CAPTURE_KEYS], label);
  evidencePath(summary.evidencePath, `${label}.evidencePath`);
  sha256(summary.evidenceSha256, `${label}.evidenceSha256`);
  validateCapture(summary, label, context, summary.evidencePath, summary.evidenceSha256);
  return summary;
}

function validateConsole(value, context) {
  const summary = validateStructuredSummary(value, "console", [
    "segmentCount", "gapCount", "warningCount", "errorCount", "exceptionCount",
    "unhandledRejectionCount",
  ], context);
  if (integer(summary.segmentCount, "console.segmentCount", TASK41_MIN_INTERACTION_SEGMENTS, 32)
    < TASK41_MIN_INTERACTION_SEGMENTS
    || summary.gapCount !== summary.segmentCount - 1) {
    throw new Error("console must cover at least four measured segments with one gap between each pair.");
  }
  for (const key of ["warningCount", "errorCount", "exceptionCount", "unhandledRejectionCount"]) {
    if (integer(summary[key], `console.${key}`) !== 0) {
      throw new Error("console/CDP evidence must remain clean.");
    }
  }
}

function validateNetwork(value, context) {
  const summary = validateStructuredSummary(value, "network", [
    "segmentCount", "gapCount", "requestCount", "websocketCount",
    "lakebedRequestCount", "navigationRequestCount",
  ], context);
  if (integer(summary.segmentCount, "network.segmentCount", TASK41_MIN_INTERACTION_SEGMENTS, 32)
    < TASK41_MIN_INTERACTION_SEGMENTS
    || summary.gapCount !== summary.segmentCount - 1) {
    throw new Error("network must cover at least four measured segments with one gap between each pair.");
  }
  if (integer(summary.requestCount, "network.requestCount") !== 0
    || integer(summary.websocketCount, "network.websocketCount") !== 0
    || integer(summary.lakebedRequestCount, "network.lakebedRequestCount") !== 0
    || integer(summary.navigationRequestCount, "network.navigationRequestCount") < summary.gapCount) {
    throw new Error("the cleared Singleplayer CDP capture must contain zero requests and websockets.");
  }
}

function validateStorage(value, context) {
  const summary = validateStructuredSummary(value, "storage", ["worldCount"], context);
  if (summary.worldCount !== 3) throw new Error("storage must summarize exactly three QA worlds.");
}

function validateMultiplayer(value, context) {
  const summary = validateStructuredSummary(value, "multiplayer", [
    "status", "completionEligible", "hostedRoute", "identities", "interactions",
    "quotaStatus", "quotaObserved", "reasonCodes",
  ], context);
  if (!Array.isArray(summary.reasonCodes)
    || !Array.isArray(summary.identities)
    || !Array.isArray(summary.interactions)
    || new Set(summary.reasonCodes).size !== summary.reasonCodes.length
  ) {
    throw new Error("multiplayer reasons, identities, and interactions must be arrays.");
  }
  const orderedReasons = TASK41_MULTIPLAYER_DEFERRED_REASONS
    .filter((reason) => summary.reasonCodes.includes(reason));
  exactArray(summary.reasonCodes, orderedReasons, "multiplayer.reasonCodes");
  if (summary.status === "deferred") {
    if (summary.completionEligible !== false
      || summary.hostedRoute !== "disabled"
      || summary.quotaStatus !== "healthy"
      || summary.quotaObserved !== false
      || summary.identities.length !== 0
      || summary.interactions.length !== 0
      || summary.reasonCodes.length === 0) {
      throw new Error("deferred multiplayer must record route disabled, identities unavailable, and healthy unobserved quota.");
    }
  } else if (summary.status === "passed") {
    if (summary.completionEligible !== true
      || summary.hostedRoute !== "enabled"
      || summary.quotaStatus !== "healthy"
      || summary.quotaObserved !== true
      || summary.reasonCodes.length !== 0
      || summary.identities.length !== 2
      || summary.interactions.length !== 2) {
      throw new Error("passed multiplayer must be fully eligible with observed healthy quota.");
    }
    const identityIds = ["identity-a", "identity-b"];
    const commitments = new Set();
    const windows = [];
    summary.identities.forEach((identity, index) => {
      const item = record(identity);
      if (!item) throw new Error(`multiplayer.identities[${index}] must be an object.`);
      exactKeys(item, [
        "id", "identityCommitment", "runSaltedIdentityHash", "windowStartedAt",
        "windowCompletedAt", "proofPath", "proofSha256",
      ], `multiplayer.identities[${index}]`);
      if (item.id !== identityIds[index]) throw new Error("multiplayer identity records must use fixed ordered IDs.");
      lakebedHash(item.identityCommitment, `multiplayer.identities[${index}].identityCommitment`);
      lakebedHash(item.runSaltedIdentityHash, `multiplayer.identities[${index}].runSaltedIdentityHash`);
      const expectedSalted = `sha256:${digest(Buffer.from(`${context.runId}:${item.identityCommitment}`))}`;
      if (item.runSaltedIdentityHash !== expectedSalted || commitments.has(item.identityCommitment)) {
        throw new Error("multiplayer identities must have distinct run-salted commitments.");
      }
      commitments.add(item.identityCommitment);
      const startedAt = exactTimestamp(item.windowStartedAt, `multiplayer.identities[${index}].windowStartedAt`);
      const completedAt = exactTimestamp(item.windowCompletedAt, `multiplayer.identities[${index}].windowCompletedAt`);
      if (startedAt < context.startedAt || completedAt > context.completedAt
        || completedAt - startedAt < MULTIPLAYER_MIN_WINDOW_MS
        || completedAt - startedAt > MULTIPLAYER_MAX_WINDOW_MS) {
        throw new Error("multiplayer identity windows must be bounded within the run.");
      }
      evidencePath(item.proofPath, `multiplayer.identities[${index}].proofPath`);
      sha256(item.proofSha256, `multiplayer.identities[${index}].proofSha256`);
      registerReference(context, item.proofPath, item.proofSha256, `multiplayer identity ${item.id}`);
      windows.push({ startedAt, completedAt });
    });
    if (Math.min(...windows.map(({ completedAt }) => completedAt))
      - Math.max(...windows.map(({ startedAt }) => startedAt)) < MULTIPLAYER_MIN_WINDOW_MS) {
      throw new Error("multiplayer identity session windows must overlap for at least sixty seconds.");
    }
    const directions = [
      ["identity-a-to-b", "identity-a", "identity-b"],
      ["identity-b-to-a", "identity-b", "identity-a"],
    ];
    summary.interactions.forEach((interaction, index) => {
      const item = record(interaction);
      if (!item) throw new Error(`multiplayer.interactions[${index}] must be an object.`);
      exactKeys(item, [
        "id", "actorId", "targetId", "proofPath", "proofSha256",
      ], `multiplayer.interactions[${index}]`);
      if (item.id !== directions[index][0]
        || item.actorId !== directions[index][1]
        || item.targetId !== directions[index][2]) {
        throw new Error("multiplayer interactions must prove both fixed identity directions.");
      }
      evidencePath(item.proofPath, `multiplayer.interactions[${index}].proofPath`);
      sha256(item.proofSha256, `multiplayer.interactions[${index}].proofSha256`);
      registerReference(context, item.proofPath, item.proofSha256, `multiplayer interaction ${item.id}`);
    });
  } else {
    throw new Error("multiplayer.status must be passed or deferred.");
  }
  return summary;
}

function validateArtifact(value, context) {
  const artifact = record(value);
  if (!artifact) throw new Error("artifact must be an object.");
  exactKeys(artifact, [
    "format", "deployTarget", "reportPath", "reportSha256", "pairedReportPath", "pairedReportSha256",
    "artifactPath", "pairedArtifactPath", "artifactBytes", "maximumBytes", "headroomBytes",
    "minimumHeadroomBytes", "artifactHash", "clientBundleHash", "pairedArtifactsEqual",
    "artifactFileSha256", "stagedClientPath", "pairedStagedClientPath", "stagedClientSha256",
    "stagedServerPath", "pairedStagedServerPath", "stagedServerSha256",
    "pairedCapturedAt", "pairedCompletedAt", "pairedSequence", ...CAPTURE_KEYS,
  ], "artifact");
  for (const key of [
    "reportPath", "pairedReportPath", "artifactPath", "pairedArtifactPath",
    "stagedClientPath", "pairedStagedClientPath", "stagedServerPath", "pairedStagedServerPath",
  ]) evidencePath(artifact[key], `artifact.${key}`);
  for (const key of [
    "reportSha256", "pairedReportSha256", "artifactFileSha256", "stagedClientSha256", "stagedServerSha256",
  ]) sha256(artifact[key], `artifact.${key}`);
  if (artifact.format !== "lakebed.capsule.artifact.v1" || artifact.deployTarget !== "anonymous-source") {
    throw new Error("artifact must be the anonymous Lakebed capsule format.");
  }
  const artifactBytes = integer(artifact.artifactBytes, "artifact.artifactBytes", 1);
  const maximumBytes = integer(artifact.maximumBytes, "artifact.maximumBytes", 1);
  const minimum = integer(artifact.minimumHeadroomBytes, "artifact.minimumHeadroomBytes", 32_768);
  const headroom = integer(artifact.headroomBytes, "artifact.headroomBytes", minimum);
  if (maximumBytes !== 1_048_576 || minimum !== 32_768 || headroom !== maximumBytes - artifactBytes) {
    throw new Error("artifact reserve arithmetic is not exact.");
  }
  if (artifact.pairedArtifactsEqual !== true) throw new Error("paired compact artifacts must be identical.");
  lakebedHash(artifact.artifactHash, "artifact.artifactHash");
  lakebedHash(artifact.clientBundleHash, "artifact.clientBundleHash");
  for (const [left, right, label] of [
    ["reportPath", "pairedReportPath", "build reports"],
    ["artifactPath", "pairedArtifactPath", "artifacts"],
    ["stagedClientPath", "pairedStagedClientPath", "staged clients"],
    ["stagedServerPath", "pairedStagedServerPath", "staged servers"],
  ]) {
    if (artifact[left] === artifact[right]) throw new Error(`${label} must use distinct A/B paths.`);
  }
  validateCapture(artifact, "artifact build A", context, artifact.reportPath, artifact.reportSha256);
  validateCapture({
    taskId: artifact.taskId,
    runId: artifact.runId,
    appCommit: artifact.appCommit,
    capturedAt: artifact.pairedCapturedAt,
    completedAt: artifact.pairedCompletedAt,
    sequence: artifact.pairedSequence,
  }, "artifact build B", context, artifact.pairedReportPath, artifact.pairedReportSha256);
  if (Date.parse(artifact.pairedCapturedAt) < Date.parse(artifact.completedAt)) {
    throw new Error("artifact build B must start after build A completes.");
  }
  registerReference(context, artifact.artifactPath, artifact.artifactFileSha256, "artifact file A");
  registerReference(
    context,
    artifact.pairedArtifactPath,
    artifact.artifactFileSha256,
    "artifact file B",
    artifact.artifactPath,
  );
  registerReference(context, artifact.stagedClientPath, artifact.stagedClientSha256, "staged client A");
  registerReference(
    context,
    artifact.pairedStagedClientPath,
    artifact.stagedClientSha256,
    "staged client B",
    artifact.stagedClientPath,
  );
  registerReference(context, artifact.stagedServerPath, artifact.stagedServerSha256, "staged server A");
  registerReference(
    context,
    artifact.pairedStagedServerPath,
    artifact.stagedServerSha256,
    "staged server B",
    artifact.stagedServerPath,
  );
}

export function createTask41EvidenceTemplate() {
  const binding = () => ({
    taskId: TASK41_TASK_ID,
    runId: "PENDING_RUN_ID",
    appCommit: "PENDING_COMMIT",
    capturedAt: "PENDING_ISO_DATE",
    completedAt: "PENDING_ISO_DATE",
    sequence: 0,
  });
  const pendingEvidence = (kind, viewport = null) => ({
    kind,
    viewport,
    path: `PENDING/${kind}`,
    sha256: "PENDING_SHA256",
    ...binding(),
    ...(kind === "screenshot" ? {
      mimeType: "image/png",
      width: 0,
      height: 0,
      devicePixelRatio: 0,
    } : {}),
    ...(kind === "video" ? {
      mimeType: "PENDING_VIDEO_MIME",
      width: 0,
      height: 0,
      devicePixelRatio: 0,
      durationMs: 0,
    } : {}),
  });
  return {
    schemaVersion: TASK41_EVIDENCE_VERSION,
    taskId: TASK41_TASK_ID,
    runId: "PENDING_RUN_ID",
    appCommit: "PENDING_COMMIT",
    runStartedAt: "PENDING_ISO_DATE",
    runCompletedAt: "PENDING_ISO_DATE",
    completionEligible: false,
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
        devicePixelRatio: 0,
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
        ...binding(),
      }))),
    console: {
      segmentCount: TASK41_MIN_INTERACTION_SEGMENTS,
      gapCount: TASK41_MIN_INTERACTION_SEGMENTS - 1,
      warningCount: -1,
      errorCount: -1,
      exceptionCount: -1,
      unhandledRejectionCount: -1,
      evidencePath: "PENDING/console.json",
      evidenceSha256: "PENDING_SHA256",
      ...binding(),
    },
    network: {
      segmentCount: TASK41_MIN_INTERACTION_SEGMENTS,
      gapCount: TASK41_MIN_INTERACTION_SEGMENTS - 1,
      requestCount: -1,
      websocketCount: -1,
      lakebedRequestCount: -1,
      navigationRequestCount: -1,
      evidencePath: "PENDING/network.json",
      evidenceSha256: "PENDING_SHA256",
      ...binding(),
    },
    storage: {
      worldCount: 3,
      evidencePath: "PENDING/storage.json",
      evidenceSha256: "PENDING_SHA256",
      ...binding(),
    },
    multiplayer: {
      status: "deferred",
      completionEligible: false,
      hostedRoute: "disabled",
      identities: [],
      interactions: [],
      quotaStatus: "healthy",
      quotaObserved: false,
      reasonCodes: [
        "hosted-route-disabled",
        "authorized-identities-unavailable",
      ],
      evidencePath: "PENDING/multiplayer.json",
      evidenceSha256: "PENDING_SHA256",
      ...binding(),
    },
    artifact: {
      format: "lakebed.capsule.artifact.v1",
      deployTarget: "anonymous-source",
      reportPath: "PENDING/build-a.json",
      reportSha256: "PENDING_SHA256",
      pairedReportPath: "PENDING/build-b.json",
      pairedReportSha256: "PENDING_SHA256",
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
      stagedClientPath: "PENDING/stage-a-client.tsx",
      pairedStagedClientPath: "PENDING/stage-b-client.tsx",
      stagedClientSha256: "PENDING_SHA256",
      stagedServerPath: "PENDING/stage-a-server.ts",
      pairedStagedServerPath: "PENDING/stage-b-server.ts",
      stagedServerSha256: "PENDING_SHA256",
      pairedCapturedAt: "PENDING_ISO_DATE",
      pairedCompletedAt: "PENDING_ISO_DATE",
      pairedSequence: 0,
      ...binding(),
    },
  };
}

export function validateTask41Evidence(value, {
  expectedCommit,
  nowMs = Date.now(),
} = {}) {
  const evidence = record(value);
  if (!evidence) throw new Error("Task 41 evidence must be an object.");
  exactKeys(evidence, [
    "schemaVersion", "taskId", "runId", "appCommit", "runStartedAt", "runCompletedAt",
    "completionEligible", "browser", "worlds", "observations", "performance", "console",
    "network", "storage", "multiplayer", "artifact",
  ], "evidence");
  if (evidence.schemaVersion !== TASK41_EVIDENCE_VERSION || evidence.taskId !== TASK41_TASK_ID) {
    throw new Error("Task 41 evidence identity is invalid.");
  }
  const context = captureContext(evidence, expectedCommit, nowMs);
  const browser = record(evidence.browser);
  if (!browser) throw new Error("browser must be an object.");
  exactKeys(browser, ["name", "version"], "browser");
  nonemptyString(browser.name, "browser.name");
  nonemptyString(browser.version, "browser.version");
  validateWorlds(evidence.worlds);
  validateObservations(evidence.observations, context);
  validatePerformance(evidence.performance, context);
  validateConsole(evidence.console, context);
  validateNetwork(evidence.network, context);
  validateStorage(evidence.storage, context);
  const multiplayer = validateMultiplayer(evidence.multiplayer, context);
  if (evidence.completionEligible !== multiplayer.completionEligible) {
    throw new Error("top-level completionEligible must match multiplayer evidence.");
  }
  validateArtifact(evidence.artifact, context);
  return evidence;
}

function digest(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function runCommand(command, args, label, { cwd } = {}) {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    let settled = false;
    let timer;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      child.kill("SIGKILL");
      rejectCommand(error);
    };
    timer = setTimeout(() => fail(new Error(`${label} timed out.`)), TOOL_TIMEOUT_MS);
    const collect = (chunks) => (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_TOOL_OUTPUT_BYTES) {
        fail(new Error(`${label} emitted too much output.`));
        return;
      }
      chunks.push(chunk);
    };
    child.stdout.addListener("data", collect(stdout));
    child.stderr.addListener("data", collect(stderr));
    child.once("error", (error) =>
      fail(new Error(`${label} could not start: ${error instanceof Error ? error.message : error}`)));
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        const detail = Buffer.concat(stderr).toString("utf8").trim().slice(0, 500);
        rejectCommand(new Error(`${label} failed (${signal ?? code})${detail ? `: ${detail}` : "."}`));
        return;
      }
      resolveCommand(Buffer.concat(stdout));
    });
  });
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function inspectPng(buffer, label) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buffer.length < MIN_PNG_BYTES
    || buffer.length > MAX_PNG_BYTES
    || !buffer.subarray(0, 8).equals(signature)) {
    throw new Error(`${label} is not a substantive PNG.`);
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitsPerPixel = 0;
  let sawHeader = false;
  let sawImage = false;
  let sawEnd = false;
  const imageData = [];
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > buffer.length) throw new Error(`${label} has a truncated PNG chunk.`);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const body = buffer.subarray(offset + 8, offset + 8 + length);
    const expectedCrc = buffer.readUInt32BE(offset + 8 + length);
    if (crc32(buffer.subarray(offset + 4, offset + 8 + length)) !== expectedCrc) {
      throw new Error(`${label} has an invalid PNG CRC.`);
    }
    if (!sawHeader) {
      if (type !== "IHDR" || length !== 13) throw new Error(`${label} does not begin with PNG IHDR.`);
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const bitDepth = body[8];
      const colorType = body[9];
      const channels = new Map([[0, 1], [2, 3], [3, 1], [4, 2], [6, 4]]).get(colorType);
      if (!channels
        || !new Set([1, 2, 4, 8, 16]).has(bitDepth)
        || (colorType !== 0 && colorType !== 3 && bitDepth < 8)
        || body[10] !== 0
        || body[11] !== 0
        || body[12] !== 0) {
        throw new Error(`${label} uses an unsupported or invalid PNG IHDR.`);
      }
      bitsPerPixel = channels * bitDepth;
      sawHeader = true;
    }
    if (type === "IDAT") {
      imageData.push(body);
      sawImage = true;
    }
    if (type === "IEND") {
      if (length !== 0 || end !== buffer.length) throw new Error(`${label} has an invalid PNG ending.`);
      sawEnd = true;
      break;
    }
    offset = end;
  }
  if (!sawHeader || !sawImage || !sawEnd || width < 1 || height < 1) {
    throw new Error(`${label} is missing required PNG image data.`);
  }
  try {
    const expectedBytes = height * (1 + Math.ceil(width * bitsPerPixel / 8));
    const inflated = inflateSync(Buffer.concat(imageData), {
      maxOutputLength: expectedBytes,
    });
    if (inflated.length !== expectedBytes) throw new Error("wrong-size");
  } catch {
    throw new Error(`${label} PNG image data cannot be decompressed safely.`);
  }
  return { width, height };
}

function mp4Boxes(buffer, start, end, label) {
  const boxes = [];
  let offset = start;
  while (offset < end) {
    if (end - offset < 8) throw new Error(`${label} has a truncated MP4 box.`);
    let size = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    let headerBytes = 8;
    if (size === 1) {
      if (end - offset < 16) throw new Error(`${label} has a truncated large MP4 box.`);
      const large = buffer.readBigUInt64BE(offset + 8);
      if (large > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${label} has an oversized MP4 box.`);
      size = Number(large);
      headerBytes = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < headerBytes || offset + size > end || !/^[\x20-\x7e]{4}$/.test(type)) {
      throw new Error(`${label} has an invalid MP4 box.`);
    }
    boxes.push({
      type,
      start: offset,
      dataStart: offset + headerBytes,
      end: offset + size,
    });
    offset += size;
  }
  return boxes;
}

function mp4Duration(buffer, box, label) {
  const version = buffer[box.dataStart];
  if (version === 0 && box.end - box.dataStart >= 20) {
    const timescale = buffer.readUInt32BE(box.dataStart + 12);
    const duration = buffer.readUInt32BE(box.dataStart + 16);
    if (timescale > 0 && duration > 0) return duration * 1_000 / timescale;
  } else if (version === 1 && box.end - box.dataStart >= 32) {
    const timescale = buffer.readUInt32BE(box.dataStart + 20);
    const duration = buffer.readBigUInt64BE(box.dataStart + 24);
    if (timescale > 0 && duration > 0n && duration <= BigInt(Number.MAX_SAFE_INTEGER)) {
      return Number(duration) * 1_000 / timescale;
    }
  }
  throw new Error(`${label} has an invalid MP4 movie duration.`);
}

function inspectMp4(buffer, label) {
  const top = mp4Boxes(buffer, 0, buffer.length, label);
  if (top[0]?.type !== "ftyp") throw new Error(`${label} does not begin with MP4 ftyp.`);
  const moov = top.find(({ type }) => type === "moov");
  if (!moov || !top.some(({ type }) => type === "mdat")) {
    throw new Error(`${label} does not contain MP4 moov and mdat boxes.`);
  }
  const movieBoxes = mp4Boxes(buffer, moov.dataStart, moov.end, label);
  const mvhd = movieBoxes.find(({ type }) => type === "mvhd");
  if (!mvhd) throw new Error(`${label} does not contain an MP4 mvhd box.`);
  const dimensions = [];
  for (const trak of movieBoxes.filter(({ type }) => type === "trak")) {
    const trackBoxes = mp4Boxes(buffer, trak.dataStart, trak.end, label);
    const tkhd = trackBoxes.find(({ type }) => type === "tkhd");
    if (!tkhd || tkhd.end - tkhd.dataStart < 8) continue;
    const width = buffer.readUInt32BE(tkhd.end - 8) / 65_536;
    const height = buffer.readUInt32BE(tkhd.end - 4) / 65_536;
    if (Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0) {
      dimensions.push({ width, height });
    }
  }
  if (dimensions.length !== 1) {
    throw new Error(`${label} must contain exactly one dimensioned MP4 video track.`);
  }
  return { ...dimensions[0], durationMs: mp4Duration(buffer, mvhd, label) };
}

function ebmlVint(buffer, offset, preserveMarker, label) {
  if (offset >= buffer.length) throw new Error(`${label} has a truncated EBML integer.`);
  const first = buffer[offset];
  let length = 1;
  let marker = 0x80;
  while (length <= 8 && !(first & marker)) {
    length += 1;
    marker >>= 1;
  }
  if (length > 8 || offset + length > buffer.length) {
    throw new Error(`${label} has an invalid EBML integer.`);
  }
  let value = BigInt(preserveMarker ? first : first & (marker - 1));
  for (let index = 1; index < length; index += 1) {
    value = value * 256n + BigInt(buffer[offset + index]);
  }
  const unknown = !preserveMarker
    && value === (1n << BigInt(7 * length)) - 1n;
  return { length, value, unknown };
}

function ebmlElements(buffer, start, end, label) {
  const elements = [];
  let offset = start;
  while (offset < end) {
    const id = ebmlVint(buffer, offset, true, label);
    const size = ebmlVint(buffer, offset + id.length, false, label);
    const dataStart = offset + id.length + size.length;
    const dataEnd = size.unknown ? end : dataStart + Number(size.value);
    if ((!size.unknown && size.value > BigInt(Number.MAX_SAFE_INTEGER))
      || dataEnd < dataStart
      || dataEnd > end) {
      throw new Error(`${label} has an invalid EBML element size.`);
    }
    elements.push({ id: Number(id.value), dataStart, end: dataEnd });
    if (size.unknown) break;
    if (dataEnd === offset) throw new Error(`${label} has a zero-progress EBML element.`);
    offset = dataEnd;
  }
  return elements;
}

function ebmlUnsigned(buffer, element, label) {
  const length = element.end - element.dataStart;
  if (length < 1 || length > 8) throw new Error(`${label} has an invalid EBML unsigned integer.`);
  let value = 0n;
  for (let offset = element.dataStart; offset < element.end; offset += 1) {
    value = value * 256n + BigInt(buffer[offset]);
  }
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${label} EBML integer is too large.`);
  return Number(value);
}

function ebmlFloat(buffer, element, label) {
  const length = element.end - element.dataStart;
  const value = length === 4
    ? buffer.readFloatBE(element.dataStart)
    : length === 8 ? buffer.readDoubleBE(element.dataStart) : NaN;
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} has an invalid EBML duration.`);
  return value;
}

function inspectWebm(buffer, label) {
  const top = ebmlElements(buffer, 0, buffer.length, label);
  const header = top.find(({ id }) => id === 0x1a45dfa3);
  const segment = top.find(({ id }) => id === 0x18538067);
  if (!header || !segment) throw new Error(`${label} does not contain WebM EBML and Segment elements.`);
  const headerChildren = ebmlElements(buffer, header.dataStart, header.end, label);
  const docType = headerChildren.find(({ id }) => id === 0x4282);
  if (!docType || buffer.toString("ascii", docType.dataStart, docType.end) !== "webm") {
    throw new Error(`${label} EBML DocType is not webm.`);
  }
  const segmentChildren = ebmlElements(buffer, segment.dataStart, segment.end, label);
  const info = segmentChildren.find(({ id }) => id === 0x1549a966);
  const tracks = segmentChildren.find(({ id }) => id === 0x1654ae6b);
  if (!info || !tracks) throw new Error(`${label} lacks WebM Info or Tracks metadata.`);
  const infoChildren = ebmlElements(buffer, info.dataStart, info.end, label);
  const scaleElement = infoChildren.find(({ id }) => id === 0x2ad7b1);
  const durationElement = infoChildren.find(({ id }) => id === 0x4489);
  const timecodeScale = scaleElement ? ebmlUnsigned(buffer, scaleElement, label) : 1_000_000;
  if (timecodeScale < 1 || timecodeScale > 1_000_000_000) {
    throw new Error(`${label} has an invalid WebM TimecodeScale.`);
  }
  if (!durationElement) throw new Error(`${label} lacks a finite WebM Duration.`);
  const durationMs = ebmlFloat(buffer, durationElement, label) * timecodeScale / 1_000_000;
  const trackEntries = ebmlElements(buffer, tracks.dataStart, tracks.end, label)
    .filter(({ id }) => id === 0xae);
  const dimensions = [];
  for (const entry of trackEntries) {
    const children = ebmlElements(buffer, entry.dataStart, entry.end, label);
    const type = children.find(({ id }) => id === 0x83);
    const video = children.find(({ id }) => id === 0xe0);
    if (!type || ebmlUnsigned(buffer, type, label) !== 1 || !video) continue;
    const videoChildren = ebmlElements(buffer, video.dataStart, video.end, label);
    const widthElement = videoChildren.find(({ id }) => id === 0xb0);
    const heightElement = videoChildren.find(({ id }) => id === 0xba);
    if (!widthElement || !heightElement) throw new Error(`${label} WebM video track lacks dimensions.`);
    dimensions.push({
      width: ebmlUnsigned(buffer, widthElement, label),
      height: ebmlUnsigned(buffer, heightElement, label),
    });
  }
  if (dimensions.length !== 1 || !Number.isFinite(durationMs) || durationMs <= 0) {
    throw new Error(`${label} must contain exactly one bounded WebM video track.`);
  }
  return { ...dimensions[0], durationMs };
}

function inspectVideoStructure(buffer, entry, label) {
  if (buffer.length < MIN_VIDEO_BYTES || buffer.length > MAX_VIDEO_BYTES) {
    throw new Error(`${label} is too small or large to be a bounded substantive video.`);
  }
  const extension = extname(entry.path).toLowerCase();
  let metadata;
  if (entry.mimeType === "video/webm") {
    if (extension !== ".webm" || !buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) {
      throw new Error(`${label} does not have WebM container magic.`);
    }
    metadata = inspectWebm(buffer, label);
  } else {
    if (extension !== ".mp4" || buffer.toString("ascii", 4, 8) !== "ftyp") {
      throw new Error(`${label} does not have MP4 container magic.`);
    }
    metadata = inspectMp4(buffer, label);
  }
  const roundedDuration = Number(metadata.durationMs.toFixed(3));
  if (metadata.width !== entry.width
    || metadata.height !== entry.height
    || roundedDuration !== entry.durationMs) {
    throw new Error(`${label} container dimensions or duration do not match its manifest.`);
  }
}

async function inspectVideo(buffer, entry, label, canonicalPath) {
  inspectVideoStructure(buffer, entry, label);
  const cacheKey = [
    entry.sha256, entry.mimeType, entry.width, entry.height, entry.durationMs,
  ].join("\0");
  if (VIDEO_DECODE_CACHE.has(cacheKey)) return VIDEO_DECODE_CACHE.get(cacheKey);
  const verification = (async () => {
    const probeBuffer = await runCommand("ffprobe", [
    "-v", "error",
    "-count_frames",
    "-read_intervals", "0%+10",
    "-show_entries", "stream=index,codec_type,width,height,duration,nb_read_frames:format=duration",
    "-of", "json",
    canonicalPath,
  ], `${label} ffprobe`);
    const probe = record(parseStrictJson(probeBuffer, `${label} ffprobe output`));
    if (!probe || !Array.isArray(probe.streams)) throw new Error(`${label} ffprobe output is incomplete.`);
    const streams = probe.streams.filter(({ codec_type: codecType }) => codecType === "video");
    if (streams.length !== 1) throw new Error(`${label} must contain exactly one real video stream.`);
    const stream = record(streams[0]);
    const width = integer(stream?.width, `${label} ffprobe width`, 1, 16_384);
    const height = integer(stream?.height, `${label} ffprobe height`, 1, 16_384);
    const frames = Number(stream?.nb_read_frames);
    const streamDuration = Number(stream?.duration);
    const formatDuration = Number(probe.format?.duration);
    const duration = Number.isFinite(streamDuration) ? streamDuration : formatDuration;
    if (!Number.isSafeInteger(frames) || frames < 1
      || !Number.isFinite(duration)
      || duration * 1_000 < 1_000
      || duration * 1_000 > MAX_RUN_MS
      || width !== entry.width
      || height !== entry.height
      || Number((duration * 1_000).toFixed(3)) !== entry.durationMs) {
      throw new Error(`${label} ffprobe stream dimensions, duration, or decoded frame count do not match.`);
    }
    await runCommand("ffmpeg", [
    "-v", "error",
    "-i", canonicalPath,
    "-map", "0:v:0",
    "-frames:v", "1",
    "-f", "null",
    "-",
    ], `${label} ffmpeg frame decode`);
  })();
  VIDEO_DECODE_CACHE.set(cacheKey, verification);
  try {
    await verification;
  } catch (error) {
    VIDEO_DECODE_CACHE.delete(cacheKey);
    throw error;
  }
}

function parseStrictJson(buffer, label) {
  if (buffer.length > MAX_JSON_BYTES) throw new Error(`${label} is too large.`);
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new Error(`${label} is not strict UTF-8.`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

function verifyBindingFile(value, expected, label) {
  const keys = ["schemaVersion", ...CAPTURE_KEYS];
  for (const key of keys) {
    if (value[key] !== expected[key]) throw new Error(`${label}.${key} does not match the manifest.`);
  }
}

function verifyTranscript(buffer, entry, context, caseId, timeline) {
  const value = record(parseStrictJson(buffer, entry.path));
  if (!value) throw new Error(`${entry.path} must contain a structured transcript.`);
  exactKeys(value, ["schemaVersion", ...CAPTURE_KEYS, "caseId", "viewport", "actions"], entry.path);
  if (value.schemaVersion !== 1 || value.caseId !== caseId || value.viewport !== entry.viewport) {
    throw new Error(`${entry.path} transcript identity is invalid.`);
  }
  verifyBindingFile(value, { schemaVersion: 1, ...entry }, entry.path);
  if (!Array.isArray(value.actions) || value.actions.length !== TASK41_TRANSCRIPT_ACTIONS.length) {
    throw new Error(`${entry.path} must contain every required transcript action.`);
  }
  const captureStartedAt = Date.parse(entry.capturedAt);
  const captureCompletedAt = Date.parse(entry.completedAt);
  let priorAt = captureStartedAt - 1;
  value.actions.forEach((action, index) => {
    const item = record(action);
    if (!item) throw new Error(`${entry.path} actions must be objects.`);
    exactKeys(item, ["id", "status", "at", "detail"], `${entry.path}.actions[${index}]`);
    if (item.id !== TASK41_TRANSCRIPT_ACTIONS[index] || item.status !== "pass") {
      throw new Error(`${entry.path} transcript actions are missing, failed, or out of order.`);
    }
    const at = exactTimestamp(item.at, `${entry.path}.actions[${index}].at`);
    if (at <= priorAt || at < captureStartedAt || at > captureCompletedAt) {
      throw new Error(`${entry.path} transcript action timestamps are not ordered within its capture.`);
    }
    measuredSegmentForWindow(timeline, at, at, `${entry.path} transcript action ${item.id}`);
    priorAt = at;
    nonemptyString(item.detail, `${entry.path}.actions[${index}].detail`);
  });
}

function recomputePerformance(buffer, metric, timeline) {
  const value = record(parseStrictJson(buffer, metric.evidencePath));
  if (!value) throw new Error(`${metric.evidencePath} must contain a performance capture.`);
  exactKeys(value, [
    "schemaVersion", ...CAPTURE_KEYS, "label", "viewport", "devicePixelRatio",
    "patchedContexts", "frames",
  ], metric.evidencePath);
  verifyBindingFile(value, { schemaVersion: 2, ...metric }, metric.evidencePath);
  if (value.schemaVersion !== 2
    || value.label !== `${metric.viewport}/${metric.scene}`
    || value.viewport !== metric.viewport
    || value.devicePixelRatio !== metric.devicePixelRatio) {
    throw new Error(`${metric.evidencePath} performance identity is invalid.`);
  }
  integer(value.patchedContexts, `${metric.evidencePath}.patchedContexts`, 1, 2);
  if (!Array.isArray(value.frames) || value.frames.length < 120 || value.frames.length > 3_600) {
    throw new Error(`${metric.evidencePath} needs bounded raw frame samples.`);
  }
  const frameTimes = [];
  const drawCalls = [];
  let priorTimestamp = Date.parse(metric.capturedAt) - 1;
  for (const [index, frame] of value.frames.entries()) {
    const item = record(frame);
    if (!item) throw new Error(`${metric.evidencePath}.frames[${index}] must be an object.`);
    exactKeys(item, [
      "sequence", "timestamp", "frameMs", "drawCalls", "visible", "hasFocus",
      "viewport", "devicePixelRatio",
    ], `${metric.evidencePath}.frames[${index}]`);
    if (integer(item.sequence, `${metric.evidencePath}.frames[${index}].sequence`, 1) !== index + 1
      || item.visible !== true
      || item.hasFocus !== true
      || item.viewport !== metric.viewport
      || item.devicePixelRatio !== metric.devicePixelRatio) {
      throw new Error(`${metric.evidencePath} frames must bind visible focused viewport samples in order.`);
    }
    const timestamp = exactTimestamp(item.timestamp, `${metric.evidencePath}.frames[${index}].timestamp`);
    if (timestamp <= priorTimestamp
      || timestamp < Date.parse(metric.capturedAt)
      || timestamp > Date.parse(metric.completedAt)) {
      throw new Error(`${metric.evidencePath} frame timestamps must be ordered within the capture.`);
    }
    measuredSegmentForWindow(
      timeline,
      timestamp,
      timestamp,
      `${metric.evidencePath}.frames[${index}]`,
    );
    priorTimestamp = timestamp;
    frameTimes.push(finiteNumber(item.frameMs, `${metric.evidencePath}.frames[${index}].frameMs`, 0.001, 1_000));
    drawCalls.push(integer(item.drawCalls, `${metric.evidencePath}.frames[${index}].drawCalls`, 0, 1_000_000));
  }
  const percentile = (items) => [...items].sort((a, b) => a - b)[Math.ceil(items.length * 0.95) - 1];
  const rounded = (number) => Number(number.toFixed(3));
  const durationMs = rounded(frameTimes.reduce((total, item) => total + item, 0));
  const expected = {
    sampleCount: frameTimes.length,
    fps: rounded(frameTimes.length * 1_000 / durationMs),
    p95FrameMs: rounded(percentile(frameTimes)),
    drawCallsPerFrameP95: percentile(drawCalls),
    drawCallsPerFrameMax: Math.max(...drawCalls),
    totalDrawCalls: drawCalls.reduce((total, item) => total + item, 0),
    durationMs,
    patchedContexts: value.patchedContexts,
  };
  const wallDuration = Date.parse(metric.completedAt) - Date.parse(metric.capturedAt);
  if (wallDuration < durationMs || wallDuration > durationMs + 1_000) {
    throw new Error(`${metric.evidencePath} capture window does not bind its raw frame duration.`);
  }
  if (Object.entries(expected).some(([key, expectedValue]) => metric[key] !== expectedValue)) {
    throw new Error(`${metric.evidencePath} aggregates do not match its raw frame samples.`);
  }
}

function validateSegmentTimeline(segments, gaps, context, label) {
  if (!Array.isArray(segments)
    || segments.length < TASK41_MIN_INTERACTION_SEGMENTS
    || segments.length > 32
    || !Array.isArray(gaps)
    || gaps.length !== segments.length - 1) {
    throw new Error(`${label} must contain at least four bounded segments and one gap between each pair.`);
  }
  const timeline = [];
  const ids = new Set();
  segments.forEach((segment, index) => {
    if (typeof segment.id !== "string"
      || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(segment.id)
      || ids.has(segment.id)) {
      throw new Error(`${label} interaction segment IDs must be unique storage-safe names.`);
    }
    ids.add(segment.id);
    const startedAt = exactTimestamp(segment.startedAt, `${label}.segments[${index}].startedAt`);
    const completedAt = exactTimestamp(segment.completedAt, `${label}.segments[${index}].completedAt`);
    if (completedAt - startedAt < 1_000
      || startedAt < context.startedAt
      || completedAt > context.completedAt) {
      throw new Error(`${label} interaction segment windows must last at least one second within the run.`);
    }
    timeline.push({ type: "segment", id: segment.id, startedAt, completedAt });
    if (index < gaps.length) {
      const gap = gaps[index];
      if (typeof gap.id !== "string"
        || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(gap.id)
        || ids.has(gap.id)
        || !TASK41_INTERACTION_GAP_KINDS.includes(gap.kind)
        || gap.afterSegmentId !== segment.id
        || gap.beforeSegmentId !== segments[index + 1]?.id) {
        throw new Error(`${label} gaps must uniquely bind each adjacent segment pair.`);
      }
      ids.add(gap.id);
      const gapStartedAt = exactTimestamp(gap.startedAt, `${label}.gaps[${index}].startedAt`);
      const gapCompletedAt = exactTimestamp(gap.completedAt, `${label}.gaps[${index}].completedAt`);
      if (gapStartedAt !== completedAt || gapCompletedAt <= gapStartedAt) {
        throw new Error(`${label} gaps must start exactly when their preceding segment ends.`);
      }
      timeline.push({
        type: "gap",
        id: gap.id,
        kind: gap.kind,
        startedAt: gapStartedAt,
        completedAt: gapCompletedAt,
      });
    }
  });
  for (let index = 1; index < segments.length; index += 1) {
    const precedingGap = timeline[index * 2 - 1];
    const segment = timeline[index * 2];
    if (segment.startedAt !== precedingGap.completedAt) {
      throw new Error(`${label} interaction segments must start exactly when the preceding gap ends.`);
    }
  }
  if (timeline[0].startedAt !== context.startedAt
    || timeline.at(-1).completedAt !== context.completedAt) {
    throw new Error(`${label} timeline must cover the full run without an omitted prefix or suffix.`);
  }
  return timeline;
}

function measuredSegmentForWindow(timeline, startedAt, completedAt, label) {
  const segment = timeline.find((window) =>
    window.type === "segment"
    && startedAt >= window.startedAt
    && completedAt <= window.completedAt);
  if (!segment) throw new Error(`${label} must fall wholly within one measured interaction segment.`);
  return segment;
}

function bindManifestCapturesToTimeline(evidence, timeline) {
  const captures = [];
  evidence.observations.forEach((observation) =>
    observation.evidence.forEach((entry) => captures.push([`${observation.id}:${entry.path}`, entry])));
  evidence.performance.forEach((metric) => captures.push([`performance:${metric.evidencePath}`, metric]));
  for (const [label, summary] of [
    ["console", evidence.console],
    ["network", evidence.network],
    ["storage", evidence.storage],
    ["multiplayer", evidence.multiplayer],
    ["artifact build A", evidence.artifact],
  ]) captures.push([label, summary]);
  captures.push(["artifact build B", {
    capturedAt: evidence.artifact.pairedCapturedAt,
    completedAt: evidence.artifact.pairedCompletedAt,
  }]);
  const hitSegments = new Set();
  captures.forEach(([label, capture]) => {
    const segment = measuredSegmentForWindow(
      timeline,
      Date.parse(capture.capturedAt),
      Date.parse(capture.completedAt),
      label,
    );
    hitSegments.add(segment.id);
  });
  const segments = timeline.filter(({ type }) => type === "segment");
  if (segments.some(({ id }) => !hitSegments.has(id))) {
    throw new Error("every measured interaction segment must contain at least one bound evidence capture.");
  }
}

function countConsoleEntries(entries, window, label, counts) {
  if (!Array.isArray(entries)) throw new Error(`${label} entries must be an array.`);
  const allowed = new Set(["debug", "info", "log", "warning", "error", "exception", "unhandled-rejection"]);
  let priorAt = window.startedAt - 1;
  entries.forEach((entry, index) => {
    const item = record(entry);
    if (!item) throw new Error(`${label}.entries[${index}] must be an object.`);
    exactKeys(item, ["sequence", "timestamp", "source", "level", "text"], `${label}.entries[${index}]`);
    const sequence = integer(item.sequence, `${label}.entries[${index}].sequence`, 1);
    if (sequence !== index + 1) throw new Error("console entry sequences must be contiguous.");
    const at = exactTimestamp(item.timestamp, `${label}.entries[${index}].timestamp`);
    if (at <= priorAt || at < window.startedAt || at > window.completedAt) {
      throw new Error("console entry timestamps must be ordered within their measured window.");
    }
    priorAt = at;
    if (!["console", "cdp"].includes(item.source) || !allowed.has(item.level)) {
      throw new Error("console evidence contains an unknown source or level.");
    }
    nonemptyString(item.text, `${label}.entries[${index}].text`);
    if (item.level === "warning") counts.warningCount += 1;
    if (item.level === "error") counts.errorCount += 1;
    if (item.level === "exception") counts.exceptionCount += 1;
    if (item.level === "unhandled-rejection") counts.unhandledRejectionCount += 1;
  });
}

function recomputeConsole(buffer, summary, context) {
  const value = record(parseStrictJson(buffer, summary.evidencePath));
  if (!value) throw new Error("console evidence must be structured JSON.");
  exactKeys(value, ["schemaVersion", ...CAPTURE_KEYS, "segments", "gaps"], summary.evidencePath);
  verifyBindingFile(value, { schemaVersion: 2, ...summary }, summary.evidencePath);
  if (!Array.isArray(value.segments) || !Array.isArray(value.gaps)) {
    throw new Error("console segments and gaps must be arrays.");
  }
  value.segments.forEach((segment, index) => {
    const item = record(segment);
    if (!item) throw new Error(`console.segments[${index}] must be an object.`);
    exactKeys(item, ["id", "startedAt", "completedAt", "entries"], `console.segments[${index}]`);
  });
  value.gaps.forEach((gap, index) => {
    const item = record(gap);
    if (!item) throw new Error(`console.gaps[${index}] must be an object.`);
    exactKeys(item, [
      "id", "kind", "afterSegmentId", "beforeSegmentId", "startedAt", "completedAt", "entries",
    ], `console.gaps[${index}]`);
  });
  const timeline = validateSegmentTimeline(value.segments, value.gaps, context, "console");
  if (summary.segmentCount !== value.segments.length || summary.gapCount !== value.gaps.length) {
    throw new Error("console segment/gap counts do not match structured evidence.");
  }
  const counts = { warningCount: 0, errorCount: 0, exceptionCount: 0, unhandledRejectionCount: 0 };
  value.segments.forEach((segment, index) =>
    countConsoleEntries(segment.entries, timeline[index * 2], `console.segments[${index}]`, counts));
  value.gaps.forEach((gap, index) =>
    countConsoleEntries(gap.entries, timeline[index * 2 + 1], `console.gaps[${index}]`, counts));
  if (Object.entries(counts).some(([key, count]) => summary[key] !== count)) {
    throw new Error("console/CDP counts do not match structured entries.");
  }
  return timeline;
}

function recomputeNetwork(buffer, summary, context) {
  const value = record(parseStrictJson(buffer, summary.evidencePath));
  if (!value) throw new Error("network evidence must be structured JSON.");
  exactKeys(value, ["schemaVersion", ...CAPTURE_KEYS, "segments", "gaps"], summary.evidencePath);
  verifyBindingFile(value, { schemaVersion: 2, ...summary }, summary.evidencePath);
  if (!Array.isArray(value.segments) || !Array.isArray(value.gaps)) {
    throw new Error("network segments and gaps must be arrays.");
  }
  value.segments.forEach((segment, index) => {
    const item = record(segment);
    if (!item) throw new Error(`network.segments[${index}] must be an object.`);
    exactKeys(item, [
      "id", "startedAt", "completedAt", "requests", "newSockets",
    ], `network.segments[${index}]`);
    if (!Array.isArray(item.requests) || item.requests.length !== 0
      || !Array.isArray(item.newSockets) || item.newSockets.length !== 0) {
      throw new Error("every measured interaction segment must have zero requests and new sockets.");
    }
  });
  value.gaps.forEach((gap, index) => {
    const item = record(gap);
    if (!item) throw new Error(`network.gaps[${index}] must be an object.`);
    exactKeys(item, [
      "id", "kind", "afterSegmentId", "beforeSegmentId", "startedAt", "completedAt",
      "navigationRequests", "appRequests", "newSockets",
    ], `network.gaps[${index}]`);
    if (!Array.isArray(item.navigationRequests) || item.navigationRequests.length < 1
      || !Array.isArray(item.appRequests) || item.appRequests.length !== 0
      || !Array.isArray(item.newSockets) || item.newSockets.length !== 0) {
      throw new Error("navigation/reload gaps may contain document navigation only, never app traffic or sockets.");
    }
  });
  const timeline = validateSegmentTimeline(value.segments, value.gaps, context, "network");
  if (summary.segmentCount !== value.segments.length || summary.gapCount !== value.gaps.length) {
    throw new Error("network segment/gap counts do not match structured evidence.");
  }
  let navigationRequestCount = 0;
  value.gaps.forEach((gap, gapIndex) => {
    let priorAt = timeline[gapIndex * 2 + 1].startedAt - 1;
    gap.navigationRequests.forEach((request, requestIndex) => {
      const item = record(request);
      if (!item) throw new Error(`network.gaps[${gapIndex}].navigationRequests[${requestIndex}] must be an object.`);
      exactKeys(item, [
        "sequence", "timestamp", "url", "resourceType",
      ], `network.gaps[${gapIndex}].navigationRequests[${requestIndex}]`);
      if (integer(item.sequence, "navigation request sequence", 1) !== requestIndex + 1
        || item.resourceType !== "document") {
        throw new Error("gap navigation requests must be ordered document requests.");
      }
      const at = exactTimestamp(item.timestamp, "navigation request timestamp");
      if (at <= priorAt || at < timeline[gapIndex * 2 + 1].startedAt
        || at > timeline[gapIndex * 2 + 1].completedAt) {
        throw new Error("gap navigation requests must remain inside their explicit gap.");
      }
      priorAt = at;
      let url;
      try {
        url = new URL(item.url);
      } catch {
        throw new Error("gap navigation request URL must be absolute.");
      }
      if (!["http:", "https:"].includes(url.protocol)
        || !["localhost", "127.0.0.1"].includes(url.hostname)
        || url.pathname !== "/"
        || url.search !== ""
        || url.username !== ""
        || url.password !== "") {
        throw new Error("gap navigation requests must target the local dev origin only.");
      }
      navigationRequestCount += 1;
    });
  });
  if (summary.requestCount !== 0
    || summary.websocketCount !== 0
    || summary.lakebedRequestCount !== 0
    || summary.navigationRequestCount !== navigationRequestCount) {
    throw new Error("request/websocket counts do not match segmented CDP evidence.");
  }
  return timeline;
}

function verifyStorage(buffer, summary, evidence) {
  const value = record(parseStrictJson(buffer, summary.evidencePath));
  if (!value) throw new Error("storage evidence must be a sanitized JSON summary.");
  exactKeys(value, ["schemaVersion", ...CAPTURE_KEYS, "worlds"], summary.evidencePath);
  verifyBindingFile(value, { schemaVersion: 1, ...summary }, summary.evidencePath);
  if (!Array.isArray(value.worlds) || value.worlds.length !== 3) {
    throw new Error("storage summary must contain exactly three QA worlds.");
  }
  value.worlds.forEach((world, index) => {
    const item = record(world);
    if (!item) throw new Error(`storage.worlds[${index}] must be an object.`);
    exactKeys(
      item,
      ["role", "worldId", "registered", "uiHealth", "markers", "keys"],
      `storage.worlds[${index}]`,
    );
    if (item.role !== evidence.worlds[index].role || item.worldId !== evidence.worlds[index].worldId
      || item.registered !== true
      || !["healthy", "recovered"].includes(item.uiHealth)) {
      throw new Error("storage summary world identities do not match the three QA worlds.");
    }
    const markers = record(item.markers);
    if (!markers) throw new Error(`storage.worlds[${index}].markers must be an object.`);
    exactKeys(markers, [
      "editPersisted", "inventoryPersisted", "containerPersisted",
    ], `storage.worlds[${index}].markers`);
    if (Object.values(markers).some((present) => present !== true)) {
      throw new Error("all three sanitized persistence markers must be confirmed.");
    }
    const prefix = `lakecraft.singleplayer.world.${item.worldId}.`;
    const expectedKeys = [
      `${prefix}v1`,
      `${prefix}save.head`,
      `${prefix}save.a`,
      `${prefix}save.b`,
    ];
    if (!Array.isArray(item.keys) || item.keys.length !== expectedKeys.length) {
      throw new Error(`storage.worlds[${index}].keys must contain the four fixed namespaced keys.`);
    }
    item.keys.forEach((keySummary, keyIndex) => {
      const slot = record(keySummary);
      if (!slot) throw new Error(`storage.worlds[${index}].keys[${keyIndex}] must be an object.`);
      exactKeys(slot, ["name", "present", "length", "sha256"], `storage.worlds[${index}].keys[${keyIndex}]`);
      if (slot.name !== expectedKeys[keyIndex] || typeof slot.present !== "boolean") {
        throw new Error("storage summary keys must match the fixed per-world namespace.");
      }
      integer(slot.length, `storage.worlds[${index}].keys[${keyIndex}].length`, 0, 1_000_000);
      if (slot.present) {
        if (slot.length < 1) throw new Error("present storage keys must have a positive length.");
        sha256(slot.sha256, `storage.worlds[${index}].keys[${keyIndex}].sha256`);
      } else if (slot.length !== 0 || slot.sha256 !== null) {
        throw new Error("absent storage keys must have zero length and null hash.");
      }
    });
    if (!item.keys.slice(2).some(({ present }) => present)) {
      throw new Error("each QA world must retain at least one crash-safe save slot.");
    }
  });
}

function verifyMultiplayer(buffer, summary, files, evidence, timeline) {
  const value = record(parseStrictJson(buffer, summary.evidencePath));
  if (!value) throw new Error("multiplayer evidence must be structured JSON.");
  const baseKeys = [
    "schemaVersion", ...CAPTURE_KEYS, "status", "completionEligible", "hostedRoute",
    "identities", "interactions", "quotaStatus", "quotaObserved", "reasonCodes", "checks",
  ];
  exactKeys(value, baseKeys, summary.evidencePath);
  verifyBindingFile(value, { schemaVersion: 2, ...summary }, summary.evidencePath);
  for (const key of [
    "status", "completionEligible", "hostedRoute", "identities", "interactions",
    "quotaStatus", "quotaObserved", "reasonCodes",
  ]) {
    if (JSON.stringify(value[key]) !== JSON.stringify(summary[key])) {
      throw new Error(`multiplayer ${key} does not match the manifest.`);
    }
  }
  if (summary.status === "deferred") {
    if (!Array.isArray(value.checks) || value.checks.length !== 0) {
      throw new Error("deferred multiplayer cannot smuggle partial pass checks.");
    }
  } else {
    if (!Array.isArray(value.checks) || value.checks.length !== TASK41_MULTIPLAYER_CHECKS.length) {
      throw new Error("passed multiplayer must contain every required check.");
    }
    value.checks.forEach((check, index) => {
      const item = record(check);
      if (!item) throw new Error("multiplayer checks must be objects.");
      exactKeys(item, ["id", "status"], `multiplayer.checks[${index}]`);
      if (item.id !== TASK41_MULTIPLAYER_CHECKS[index] || item.status !== "pass") {
        throw new Error("multiplayer checks are missing, failed, or out of order.");
      }
    });
    const identityById = new Map(summary.identities.map((identity) => [identity.id, identity]));
    for (const identity of summary.identities) {
      const proof = record(parseStrictJson(files.get(identity.proofPath), identity.proofPath));
      if (!proof) throw new Error(`${identity.proofPath} must be a structured identity proof.`);
      exactKeys(proof, [
        "schemaVersion", "taskId", "runId", "appCommit", "identityId", "identityCommitment",
        "runSaltedIdentityHash", "windowStartedAt", "windowCompletedAt", "peerVisibilityIds",
        "capturedAt", "quotaTelemetry",
      ], identity.proofPath);
      if (proof.schemaVersion !== 1
        || proof.taskId !== TASK41_TASK_ID
        || proof.runId !== evidence.runId
        || proof.appCommit !== evidence.appCommit
        || proof.identityId !== identity.id
        || proof.identityCommitment !== identity.identityCommitment
        || proof.runSaltedIdentityHash !== identity.runSaltedIdentityHash
        || proof.windowStartedAt !== identity.windowStartedAt
        || proof.windowCompletedAt !== identity.windowCompletedAt) {
        throw new Error(`${identity.proofPath} is not bound to its run-salted identity summary.`);
      }
      const peerId = identity.id === "identity-a" ? "identity-b" : "identity-a";
      exactArray(proof.peerVisibilityIds, [peerId], `${identity.proofPath}.peerVisibilityIds`);
      const proofCapturedAt = exactTimestamp(proof.capturedAt, `${identity.proofPath}.capturedAt`);
      if (proofCapturedAt < Date.parse(identity.windowStartedAt)
        || proofCapturedAt > Date.parse(identity.windowCompletedAt)) {
        throw new Error(`${identity.proofPath} capture must occur within its identity session.`);
      }
      measuredSegmentForWindow(timeline, proofCapturedAt, proofCapturedAt, `${identity.proofPath} capture`);
      if (!Array.isArray(proof.quotaTelemetry)
        || proof.quotaTelemetry.length < 2
        || proof.quotaTelemetry.length > 3_600) {
        throw new Error(`${identity.proofPath} needs bounded per-identity quota telemetry.`);
      }
      let priorAt = Date.parse(identity.windowStartedAt) - 1;
      let priorAttempts = -1;
      let priorGrants = -1;
      let observedDelta = false;
      proof.quotaTelemetry.forEach((telemetry, index) => {
        const item = record(telemetry);
        if (!item) throw new Error(`${identity.proofPath}.quotaTelemetry[${index}] must be an object.`);
        exactKeys(item, [
          "sequence", "timestamp", "attempts", "grants", "paused",
        ], `${identity.proofPath}.quotaTelemetry[${index}]`);
        const attempts = integer(item.attempts, "quota attempts", 0);
        const grants = integer(item.grants, "quota grants", 0);
        const at = exactTimestamp(item.timestamp, "quota telemetry timestamp");
        if (item.sequence !== index + 1
          || item.paused !== false
          || attempts > grants
          || attempts < priorAttempts
          || grants < priorGrants
          || at <= priorAt
          || at < Date.parse(identity.windowStartedAt)
          || at > Date.parse(identity.windowCompletedAt)) {
          throw new Error("quota telemetry must be ordered, active, monotonic, and remain within grants.");
        }
        measuredSegmentForWindow(timeline, at, at, `${identity.proofPath} quota telemetry`);
        if (index > 0 && (attempts > priorAttempts || grants > priorGrants)) observedDelta = true;
        priorAt = at;
        priorAttempts = attempts;
        priorGrants = grants;
      });
      if (priorAttempts < 1 || priorGrants < 1 || !observedDelta) {
        throw new Error("quota telemetry must observe nonzero attempts/grants and a positive session delta.");
      }
    }
    for (const interaction of summary.interactions) {
      const proof = record(parseStrictJson(files.get(interaction.proofPath), interaction.proofPath));
      if (!proof) throw new Error(`${interaction.proofPath} must be a structured interaction proof.`);
      exactKeys(proof, [
        "schemaVersion", "taskId", "runId", "appCommit", "interactionId", "actorId",
        "targetId", "windowStartedAt", "windowCompletedAt", "capturedAt", "events",
      ], interaction.proofPath);
      const actor = identityById.get(interaction.actorId);
      const target = identityById.get(interaction.targetId);
      const startedAt = exactTimestamp(proof.windowStartedAt, `${interaction.proofPath}.windowStartedAt`);
      const completedAt = exactTimestamp(proof.windowCompletedAt, `${interaction.proofPath}.windowCompletedAt`);
      const proofCapturedAt = exactTimestamp(proof.capturedAt, `${interaction.proofPath}.capturedAt`);
      if (proof.schemaVersion !== 1
        || proof.taskId !== TASK41_TASK_ID
        || proof.runId !== evidence.runId
        || proof.appCommit !== evidence.appCommit
        || proof.interactionId !== interaction.id
        || proof.actorId !== interaction.actorId
        || proof.targetId !== interaction.targetId
        || startedAt < Math.max(Date.parse(actor.windowStartedAt), Date.parse(target.windowStartedAt))
        || completedAt > Math.min(Date.parse(actor.windowCompletedAt), Date.parse(target.windowCompletedAt))
        || completedAt <= startedAt) {
        throw new Error(`${interaction.proofPath} is not bound to the identities' overlapping session.`);
      }
      if (proofCapturedAt < startedAt || proofCapturedAt > completedAt) {
        throw new Error(`${interaction.proofPath} capture must occur within its interaction window.`);
      }
      measuredSegmentForWindow(timeline, proofCapturedAt, proofCapturedAt, `${interaction.proofPath} capture`);
      if (!Array.isArray(proof.events) || proof.events.length !== TASK41_MULTIPLAYER_INTERACTIONS.length) {
        throw new Error(`${interaction.proofPath} must prove every bidirectional interaction kind.`);
      }
      let priorAt = startedAt - 1;
      proof.events.forEach((event, index) => {
        const item = record(event);
        if (!item) throw new Error(`${interaction.proofPath}.events[${index}] must be an object.`);
        exactKeys(item, ["sequence", "timestamp", "kind", "status"], `${interaction.proofPath}.events[${index}]`);
        const at = exactTimestamp(item.timestamp, "interaction event timestamp");
        if (item.sequence !== index + 1
          || item.kind !== TASK41_MULTIPLAYER_INTERACTIONS[index]
          || item.status !== "pass"
          || at <= priorAt
          || at < startedAt
          || at > completedAt) {
          throw new Error("multiplayer interaction events must pass in order inside the overlap window.");
        }
        measuredSegmentForWindow(timeline, at, at, `${interaction.proofPath} interaction event`);
        priorAt = at;
      });
    }
  }
}

function recomputeArtifact(artifactBuffer, reportBuffer, summary, label) {
  const report = record(parseStrictJson(reportBuffer, `${label} report`));
  const outer = record(parseStrictJson(artifactBuffer, `${label} artifact`));
  if (!report || !outer) throw new Error(`${label} Lakebed output must be JSON objects.`);
  exactKeys(report, ["artifactHash", "artifactPath", "clientBundleHash", "format"], `${label} report`);
  exactKeys(outer, ["artifact", "artifactHash", "clientBundle", "clientBundleHash", "mediaType"], `${label} artifact`);
  const capsule = record(outer.artifact);
  if (!capsule) throw new Error(`${label} capsule artifact must be an object.`);
  exactKeys(capsule, [
    "client", "createdWith", "database", "deployTarget", "favicon", "format",
    "limits", "name", "server", "source",
  ], `${label} capsule artifact`);
  const clientDescriptor = record(capsule.client);
  const createdWith = record(capsule.createdWith);
  const database = record(capsule.database);
  const server = record(capsule.server);
  const serverSource = record(server?.source);
  const source = record(capsule.source);
  const limits = record(capsule.limits);
  const favicon = record(capsule.favicon);
  if (!clientDescriptor || !createdWith || !database || !server || !serverSource
    || !source || !limits || !favicon) {
    throw new Error(`${label} capsule artifact is missing full Lakebed descriptors.`);
  }
  exactKeys(clientDescriptor, ["bundleHash", "bytes", "entry"], `${label} client descriptor`);
  exactKeys(createdWith, ["compiler", "lakebed"], `${label} createdWith`);
  exactKeys(database, ["apiVersion", "indexCodecVersion", "schemaHash"], `${label} database`);
  exactKeys(server, [
    "actions", "endpoints", "helpers", "imports", "mutations", "queries", "schema", "source",
  ], `${label} server`);
  exactKeys(serverSource, ["bundle", "bundleHash", "bytes", "entry"], `${label} server source`);
  exactKeys(source, ["files", "snapshotHash"], `${label} source`);
  exactKeys(favicon, [
    "bodyBase64", "bytes", "contentType", "hash", "routePath", "sourcePath",
  ], `${label} favicon`);
  exactKeys(limits, [
    "instructionBudget", "maxBytesRead", "maxDirectGets", "maxIndexKeyBytes",
    "maxRowsRead", "maxRowsReturned", "maxScanCalls", "maxValueBytes", "maxWrites",
  ], `${label} limits`);
  if (report.format !== summary.format || capsule.format !== summary.format
    || capsule.deployTarget !== summary.deployTarget
    || outer.mediaType !== "application/vnd.lakebed.artifact+json"
    || !String(report.artifactPath).endsWith(".anonymous.json")
    || clientDescriptor.entry !== "/client.js"
    || serverSource.entry !== "/server.mjs"
    || !Array.isArray(server.imports)
    || typeof createdWith.compiler !== "string"
    || typeof createdWith.lakebed !== "string"
    || typeof capsule.name !== "string"
    || !capsule.name) {
    throw new Error(`${label} is not an anonymous Lakebed artifact report.`);
  }
  if (database.apiVersion !== 1
    || database.indexCodecVersion !== 1
    || lakebedHash(database.schemaHash, `${label} database.schemaHash`) !== database.schemaHash
    || lakebedHash(source.snapshotHash, `${label} source.snapshotHash`) !== source.snapshotHash
    || lakebedHash(clientDescriptor.bundleHash, `${label} client.bundleHash`) !== clientDescriptor.bundleHash
    || clientDescriptor.bytes < 1
    || favicon.sourcePath !== "favicon.svg"
    || favicon.routePath !== "/favicon.svg") {
    throw new Error(`${label} has invalid Lakebed database, source, client, or favicon metadata.`);
  }
  const faviconBody = Buffer.from(favicon.bodyBase64, "base64");
  if (faviconBody.toString("base64") !== favicon.bodyBase64
    || faviconBody.length !== favicon.bytes
    || `sha256:${digest(faviconBody)}` !== favicon.hash) {
    throw new Error(`${label} favicon content does not recompute.`);
  }
  Object.entries(limits).forEach(([key, value]) => integer(value, `${label} limits.${key}`, 1));
  if (!Array.isArray(source.files) || source.files.length < 2 || source.files.length > 16) {
    throw new Error(`${label} must contain a bounded full Lakebed source file manifest.`);
  }
  const sourcePaths = new Set();
  source.files.forEach((file, index) => {
    const item = record(file);
    if (!item) throw new Error(`${label} source.files[${index}] must be an object.`);
    exactKeys(item, ["bytes", "hash", "path"], `${label} source.files[${index}]`);
    evidencePath(item.path, `${label} source.files[${index}].path`);
    integer(item.bytes, `${label} source.files[${index}].bytes`, 1, MAX_EVIDENCE_FILE_BYTES);
    lakebedHash(item.hash, `${label} source.files[${index}].hash`);
    if (sourcePaths.has(item.path)) throw new Error(`${label} source file paths must be unique.`);
    sourcePaths.add(item.path);
  });
  if (!sourcePaths.has("client/index.tsx") || !sourcePaths.has("server/index.ts")) {
    throw new Error(`${label} source manifest must include staged client and server entrypoints.`);
  }
  if (`sha256:${digest(Buffer.from(JSON.stringify(source.files)))}` !== source.snapshotHash) {
    throw new Error(`${label} source snapshot hash does not recompute.`);
  }
  const computedArtifactHash = `sha256:${digest(Buffer.from(JSON.stringify(outer.artifact)))}`;
  let client;
  try {
    client = Buffer.from(outer.clientBundle, "base64");
  } catch {
    throw new Error(`${label} client bundle is not base64.`);
  }
  if (client.toString("base64") !== outer.clientBundle) throw new Error(`${label} client bundle base64 is not canonical.`);
  const computedClientHash = `sha256:${digest(client)}`;
  let serverBundle;
  try {
    serverBundle = Buffer.from(serverSource.bundle, "base64");
  } catch {
    throw new Error(`${label} server bundle is not base64.`);
  }
  if (serverBundle.toString("base64") !== serverSource.bundle
    || `sha256:${digest(serverBundle)}` !== serverSource.bundleHash
    || serverBundle.length !== serverSource.bytes) {
    throw new Error(`${label} server bundle hash/bytes do not recompute.`);
  }
  if (computedArtifactHash !== outer.artifactHash || computedArtifactHash !== report.artifactHash
    || computedArtifactHash !== summary.artifactHash
    || computedClientHash !== outer.clientBundleHash || computedClientHash !== report.clientBundleHash
    || computedClientHash !== clientDescriptor.bundleHash
    || computedClientHash !== summary.clientBundleHash
    || client.length !== outer.artifact?.client?.bytes) {
    throw new Error(`${label} Lakebed artifact/client hashes do not recompute.`);
  }
  return outer;
}

async function rebuildExpectedCommitStage(repoRoot, expectedCommit) {
  if (typeof repoRoot !== "string" || !repoRoot) throw new Error("A trusted --repo-root is required.");
  const info = await lstat(repoRoot);
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("--repo-root must be a real directory.");
  const canonicalRepo = await realpath(repoRoot);
  const topLevel = (await runCommand(
    "git",
    ["-C", canonicalRepo, "rev-parse", "--show-toplevel"],
    "git repository verification",
  )).toString("utf8").trim();
  if (await realpath(topLevel) !== canonicalRepo) {
    throw new Error("--repo-root must be the exact Git worktree root.");
  }
  await runCommand(
    "git",
    ["-C", canonicalRepo, "cat-file", "-e", `${expectedCommit}^{commit}`],
    "expected commit verification",
  );
  const cacheKey = `${canonicalRepo}\0${expectedCommit}`;
  if (STAGE_REBUILD_CACHE.has(cacheKey)) return STAGE_REBUILD_CACHE.get(cacheKey);
  const rebuild = (async () => {
    const temporary = await mkdtemp(join(tmpdir(), "lakecraft-task41-commit-"));
    try {
      const sourceRoot = join(temporary, "source");
      const stageRoot = join(temporary, "stage");
      const archivePath = join(temporary, "source.tar");
      await mkdir(sourceRoot);
      await runCommand(
        "git",
        ["-C", canonicalRepo, "archive", "--format=tar", `--output=${archivePath}`, expectedCommit],
        "expected commit archive",
      );
      await runCommand("tar", ["-xf", archivePath, "-C", sourceRoot], "expected commit extraction");
      const preparePath = join(sourceRoot, "scripts", "prepare-lakebed-deploy.mjs");
      const prepareInfo = await lstat(preparePath);
      if (prepareInfo.isSymbolicLink() || !prepareInfo.isFile()) {
        throw new Error("expected commit prepare-lakebed-deploy.mjs must be a regular file.");
      }
      await runCommand(
        process.execPath,
        [preparePath, stageRoot],
        "expected commit Lakebed staging",
        { cwd: sourceRoot },
      );
      const stagePaths = await listEvidenceFiles(stageRoot);
      const files = new Map();
      for (const path of stagePaths) {
        const absolute = join(stageRoot, ...path.split("/"));
        const stageInfo = await lstat(absolute);
        if (stageInfo.isSymbolicLink() || !stageInfo.isFile()
          || stageInfo.size < 1 || stageInfo.size > MAX_EVIDENCE_FILE_BYTES) {
          throw new Error(`rebuilt stage ${path} is not a bounded regular file.`);
        }
        const buffer = await readFile(absolute);
        files.set(path, {
          buffer,
          bytes: buffer.length,
          hash: `sha256:${digest(buffer)}`,
        });
      }
      if (!files.has("client/index.tsx") || !files.has("server/index.ts") || !files.has("lakebed.json")) {
        throw new Error("rebuilt expected commit stage is incomplete.");
      }
      return { repoRoot: canonicalRepo, expectedCommit, files };
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  })();
  STAGE_REBUILD_CACHE.set(cacheKey, rebuild);
  try {
    return await rebuild;
  } catch (error) {
    STAGE_REBUILD_CACHE.delete(cacheKey);
    throw error;
  }
}

function verifyArtifactStageBinding(outer, stage, artifact, evidenceFiles) {
  const sourceFiles = outer.artifact.source.files;
  const expectedPaths = [...stage.files.keys()]
    .filter((path) => path !== "lakebed.json" && path !== ".env.lakebed.server")
    .sort();
  exactArray(sourceFiles.map(({ path }) => path), expectedPaths, "Lakebed source.files paths");
  sourceFiles.forEach((sourceFile) => {
    const rebuilt = stage.files.get(sourceFile.path);
    if (!rebuilt
      || sourceFile.bytes !== rebuilt.bytes
      || sourceFile.hash !== rebuilt.hash) {
      throw new Error(`Lakebed source.files does not bind rebuilt ${sourceFile.path}.`);
    }
  });
  const rebuiltFavicon = stage.files.get("favicon.svg");
  if (!rebuiltFavicon
    || !Buffer.from(outer.artifact.favicon.bodyBase64, "base64").equals(rebuiltFavicon.buffer)
    || outer.artifact.favicon.hash !== rebuiltFavicon.hash) {
    throw new Error("Lakebed favicon decoded content does not equal the expected-commit stage.");
  }
  for (const [evidencePathKey, stagePath] of [
    ["stagedClientPath", "client/index.tsx"],
    ["pairedStagedClientPath", "client/index.tsx"],
    ["stagedServerPath", "server/index.ts"],
    ["pairedStagedServerPath", "server/index.ts"],
  ]) {
    const evidenceBuffer = evidenceFiles.get(artifact[evidencePathKey]);
    const rebuilt = stage.files.get(stagePath);
    if (!rebuilt || !evidenceBuffer.equals(rebuilt.buffer)) {
      throw new Error(`${evidencePathKey} does not equal the exact expected-commit stage.`);
    }
  }
}

async function securePath(root, relativePath, expectedHash) {
  const absoluteRoot = resolve(root);
  let current = absoluteRoot;
  for (const component of relativePath.split("/")) {
    current = resolve(current, component);
    const info = await lstat(current);
    if (info.isSymbolicLink()) throw new Error(`${relativePath} traverses a symlink.`);
  }
  const canonicalRoot = await realpath(absoluteRoot);
  const canonical = await realpath(current);
  const child = relative(canonicalRoot, canonical);
  if (!child || isAbsolute(child) || child === ".." || child.startsWith(`..${sep}`)) {
    throw new Error(`${relativePath} escapes the evidence root.`);
  }
  const handle = await open(canonical, "r");
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error(`${relativePath} must be a regular file.`);
    if (info.size < 1 || info.size > MAX_EVIDENCE_FILE_BYTES) {
      throw new Error(`${relativePath} is outside the bounded evidence file size.`);
    }
    const buffer = await handle.readFile();
    if (digest(buffer) !== expectedHash) throw new Error(`${relativePath} SHA-256 does not match.`);
    return { buffer, canonical, inode: `${info.dev}:${info.ino}` };
  } finally {
    await handle.close();
  }
}

async function listEvidenceFiles(root, directory = root, paths = [], depth = 0) {
  if (depth > MAX_PATH_COMPONENTS) throw new Error("evidence inventory is nested too deeply.");
  const entries = await opendir(directory);
  for await (const entry of entries) {
    const absolute = resolve(directory, entry.name);
    const rel = relative(resolve(root), absolute).split(sep).join("/");
    if (entry.isSymbolicLink()) throw new Error(`${rel} is an untrusted symlink.`);
    if (entry.isDirectory()) await listEvidenceFiles(root, absolute, paths, depth + 1);
    else if (entry.isFile()) {
      paths.push(rel);
      if (paths.length > MAX_EVIDENCE_FILES) {
        throw new Error(`evidence inventory exceeds ${MAX_EVIDENCE_FILES} files.`);
      }
    }
    else throw new Error(`${rel} is not a regular evidence file.`);
  }
  return paths.sort();
}

async function controlPath(root, absolutePath, label, mustExist) {
  const absoluteRoot = resolve(root);
  const absolute = resolve(absolutePath);
  const child = relative(absoluteRoot, absolute).split(sep).join("/");
  evidencePath(child, label);
  const components = child.split("/");
  let current = absoluteRoot;
  for (const component of components.slice(0, -1)) {
    current = resolve(current, component);
    const info = await lstat(current);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error(`${label} traverses a symlink or non-directory.`);
    }
  }
  const canonicalRoot = await realpath(absoluteRoot);
  const canonicalParent = await realpath(resolve(absolute, ".."));
  const parentChild = relative(canonicalRoot, canonicalParent);
  if (isAbsolute(parentChild) || parentChild === ".." || parentChild.startsWith(`..${sep}`)) {
    throw new Error(`${label} escapes the evidence root.`);
  }
  try {
    const info = await lstat(absolute);
    if (!mustExist) throw new Error(`${label} already exists; refusing to overwrite it.`);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error(`${label} must be a regular file.`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    if (mustExist) throw new Error(`${label} does not exist.`);
  }
  return child;
}

export async function verifyTask41EvidenceFiles(evidence, root, {
  expectedCommit,
  repoRoot,
  nowMs = Date.now(),
  manifestPath,
  validatorOutputPath,
} = {}) {
  validateTask41Evidence(evidence, { expectedCommit, nowMs });
  if (typeof repoRoot !== "string" || !repoRoot) throw new Error("A trusted --repo-root is required.");
  const rootInfo = await lstat(root);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new Error("evidence root must be a real directory.");
  const references = new Map();
  const add = (path, hash) => {
    const existing = references.get(path);
    if (existing && existing !== hash) throw new Error(`${path} is referenced with conflicting hashes.`);
    references.set(path, hash);
  };
  for (const observation of evidence.observations) {
    for (const item of observation.evidence) add(item.path, item.sha256);
  }
  for (const metric of evidence.performance) add(metric.evidencePath, metric.evidenceSha256);
  for (const summary of [evidence.console, evidence.network, evidence.storage, evidence.multiplayer]) {
    add(summary.evidencePath, summary.evidenceSha256);
  }
  for (const identity of evidence.multiplayer.identities) add(identity.proofPath, identity.proofSha256);
  for (const interaction of evidence.multiplayer.interactions) add(interaction.proofPath, interaction.proofSha256);
  const artifact = evidence.artifact;
  for (const [pathKey, hashKey] of [
    ["reportPath", "reportSha256"],
    ["pairedReportPath", "pairedReportSha256"],
    ["artifactPath", "artifactFileSha256"],
    ["pairedArtifactPath", "artifactFileSha256"],
    ["stagedClientPath", "stagedClientSha256"],
    ["pairedStagedClientPath", "stagedClientSha256"],
    ["stagedServerPath", "stagedServerSha256"],
    ["pairedStagedServerPath", "stagedServerSha256"],
  ]) add(artifact[pathKey], artifact[hashKey]);

  const files = new Map();
  const canonicalPaths = new Map();
  const realpaths = new Map();
  const inodes = new Map();
  for (const [path, hash] of references) {
    const file = await securePath(root, path, hash);
    if (realpaths.has(file.canonical) && realpaths.get(file.canonical) !== path) {
      throw new Error(`${path} aliases ${realpaths.get(file.canonical)}.`);
    }
    if (inodes.has(file.inode) && inodes.get(file.inode) !== path) {
      throw new Error(`${path} hard-links ${inodes.get(file.inode)}.`);
    }
    realpaths.set(file.canonical, path);
    canonicalPaths.set(path, file.canonical);
    inodes.set(file.inode, path);
    files.set(path, file.buffer);
  }

  const runContext = {
    startedAt: Date.parse(evidence.runStartedAt),
    completedAt: Date.parse(evidence.runCompletedAt),
  };
  const consoleTimeline = recomputeConsole(files.get(evidence.console.evidencePath), evidence.console, runContext);
  const networkTimeline = recomputeNetwork(files.get(evidence.network.evidencePath), evidence.network, runContext);
  if (JSON.stringify(consoleTimeline) !== JSON.stringify(networkTimeline)) {
    throw new Error("console and network measured segment/gap timelines must match exactly.");
  }
  bindManifestCapturesToTimeline(evidence, consoleTimeline);

  for (const observation of evidence.observations) {
    for (const entry of observation.evidence) {
      const buffer = files.get(entry.path);
      if (entry.kind === "screenshot") {
        const dimensions = inspectPng(buffer, entry.path);
        if (dimensions.width !== entry.width || dimensions.height !== entry.height) {
          throw new Error(`${entry.path} real PNG dimensions do not match its manifest.`);
        }
      } else if (entry.kind === "video") {
        await inspectVideo(buffer, entry, entry.path, canonicalPaths.get(entry.path));
      } else if (entry.kind === "transcript") {
        verifyTranscript(buffer, entry, {
          startedAt: Date.parse(evidence.runStartedAt),
          completedAt: Date.parse(evidence.runCompletedAt),
        }, observation.id, consoleTimeline);
      }
    }
  }
  for (const metric of evidence.performance) {
    recomputePerformance(files.get(metric.evidencePath), metric, consoleTimeline);
  }
  verifyStorage(files.get(evidence.storage.evidencePath), evidence.storage, evidence);
  verifyMultiplayer(
    files.get(evidence.multiplayer.evidencePath),
    evidence.multiplayer,
    files,
    evidence,
    consoleTimeline,
  );

  const artifactA = files.get(artifact.artifactPath);
  const artifactB = files.get(artifact.pairedArtifactPath);
  if (artifactA.length !== artifact.artifactBytes || !artifactA.equals(artifactB)
    || digest(artifactA) !== artifact.artifactFileSha256) {
    throw new Error("paired artifact bytes do not match the evidence.");
  }
  const outerArtifact = recomputeArtifact(artifactA, files.get(artifact.reportPath), artifact, "build A");
  recomputeArtifact(artifactB, files.get(artifact.pairedReportPath), artifact, "build B");
  for (const [leftKey, rightKey, hashKey] of [
    ["stagedClientPath", "pairedStagedClientPath", "stagedClientSha256"],
    ["stagedServerPath", "pairedStagedServerPath", "stagedServerSha256"],
  ]) {
    const left = files.get(artifact[leftKey]);
    const right = files.get(artifact[rightKey]);
    if (!left.equals(right) || digest(left) !== artifact[hashKey]) {
      throw new Error(`${leftKey} pair does not match the evidence.`);
    }
  }
  const rebuiltStage = await rebuildExpectedCommitStage(repoRoot, expectedCommit);
  verifyArtifactStageBinding(outerArtifact, rebuiltStage, artifact, files);

  const allowedControl = new Set();
  if (manifestPath) {
    const manifestChild = await controlPath(root, manifestPath, "manifest path", true);
    if (references.has(manifestChild)) {
      throw new Error("manifest path must be distinct from evidence files.");
    }
    allowedControl.add(manifestChild);
  }
  if (validatorOutputPath) {
    const outputChild = await controlPath(root, validatorOutputPath, "validator output path", false);
    if (allowedControl.has(outputChild) || references.has(outputChild)) {
      throw new Error("validator output path must be distinct from the manifest and evidence files.");
    }
  }
  const inventory = await listEvidenceFiles(root);
  const expectedInventory = new Set([...references.keys(), ...allowedControl]);
  const extra = inventory.filter((path) => !expectedInventory.has(path));
  const missing = [...expectedInventory].filter((path) => !inventory.includes(path));
  if (extra.length || missing.length) {
    throw new Error(`evidence inventory mismatch; unreferenced=${extra.join(",") || "none"} missing=${missing.join(",") || "none"}.`);
  }
  return evidence;
}

function parseCli(args) {
  if (args[0] === "--template") {
    if (args.length !== 1) throw new Error("--template accepts no additional arguments.");
    return { template: true };
  }
  const evidencePath = args[0];
  if (!evidencePath) throw new Error("an evidence manifest path is required.");
  const options = {};
  for (let index = 1; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!value || !["--root", "--repo-root", "--expected-commit", "--validator-output"].includes(flag)) {
      throw new Error("Usage: <evidence.json> --root <evidence-root> --repo-root <git-worktree> --expected-commit <commit> [--validator-output <path>]");
    }
    if (options[flag]) throw new Error(`${flag} may only be supplied once.`);
    options[flag] = value;
  }
  if (!options["--root"] || !options["--repo-root"] || !options["--expected-commit"]) {
    throw new Error("--root, --repo-root, and --expected-commit are required.");
  }
  return {
    evidencePath: resolve(evidencePath),
    root: resolve(options["--root"]),
    repoRoot: resolve(options["--repo-root"]),
    expectedCommit: options["--expected-commit"],
    validatorOutputPath: options["--validator-output"] ? resolve(options["--validator-output"]) : undefined,
  };
}

async function main() {
  const command = parseCli(process.argv.slice(2));
  if (command.template) {
    process.stdout.write(`${JSON.stringify(createTask41EvidenceTemplate(), null, 2)}\n`);
    return;
  }
  const manifestInfo = await lstat(command.evidencePath);
  if (manifestInfo.isSymbolicLink() || !manifestInfo.isFile()) throw new Error("evidence manifest must be a regular file.");
  if (manifestInfo.size < 1 || manifestInfo.size > MAX_JSON_BYTES) {
    throw new Error("evidence manifest is outside the bounded JSON size.");
  }
  const evidence = parseStrictJson(await readFile(command.evidencePath), command.evidencePath);
  await verifyTask41EvidenceFiles(evidence, command.root, {
    expectedCommit: command.expectedCommit,
    repoRoot: command.repoRoot,
    manifestPath: command.evidencePath,
    validatorOutputPath: command.validatorOutputPath,
  });
  const partial = evidence.multiplayer.status === "deferred";
  const result = {
    ok: !partial,
    status: partial ? "valid-partial" : "valid",
    completionEligible: evidence.completionEligible,
    taskId: evidence.taskId,
    runId: evidence.runId,
    appCommit: evidence.appCommit,
    cases: evidence.observations.length,
    artifactBytes: evidence.artifact.artifactBytes,
    headroomBytes: evidence.artifact.headroomBytes,
  };
  const output = `${JSON.stringify(result, null, 2)}\n`;
  if (command.validatorOutputPath) {
    const handle = await open(command.validatorOutputPath, "wx", 0o600);
    try {
      await handle.writeFile(output, "utf8");
    } finally {
      await handle.close();
    }
  }
  process.stdout.write(output);
  if (partial) process.exitCode = 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
