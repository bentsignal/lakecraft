import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { deflateSync } from "node:zlib";

import {
  TASK41_CASES,
  TASK41_CASES_END,
  TASK41_CASES_START,
  TASK41_INTERACTION_GAP_KINDS,
  TASK41_MIN_INTERACTION_SEGMENTS,
  TASK41_MULTIPLAYER_CHECKS,
  TASK41_MULTIPLAYER_DEFERRED_REASONS,
  TASK41_MULTIPLAYER_INTERACTIONS,
  TASK41_PERFORMANCE_SCENES,
  TASK41_TASK_ID,
  TASK41_TEMPLATE_COMMAND,
  TASK41_TEMPLATE_END,
  TASK41_TEMPLATE_START,
  TASK41_TRANSCRIPT_ACTIONS,
  TASK41_VIEWPORTS,
  createTask41EvidenceTemplate,
  extractTask41RunbookCases,
  extractTask41TemplateCommand,
  validateTask41Evidence,
  verifyTask41EvidenceFiles,
} from "../scripts/validate-live-qa-evidence.mjs";

const repositoryRoot = new URL("../", import.meta.url);
const validatorPath = new URL("../scripts/validate-live-qa-evidence.mjs", import.meta.url);
const runbook = [
  "quality/live-visual-qa/README.md",
  "quality/live-visual-qa/setup.md",
  "quality/live-visual-qa/worlds.md",
  "quality/live-visual-qa/routes.md",
  "quality/live-visual-qa/reports.md",
].map((name) => readFileSync(new URL(`../docs/${name}`, import.meta.url), "utf8")).join("\n");
const probeSource = readFileSync(new URL("../scripts/task41-browser-probe.js", import.meta.url), "utf8");
const PROJECT_ROOT = process.env.TASK41_TEST_REPO_ROOT ?? fileURLToPath(repositoryRoot);
const commitResult = spawnSync("git", ["-C", PROJECT_ROOT, "rev-parse", "HEAD"], { encoding: "utf8" });
assert.equal(commitResult.status, 0, commitResult.stderr);
const COMMIT = commitResult.stdout.trim();
assert.match(COMMIT, /^[0-9a-f]{40}$/);
const RUN_ID = "c".repeat(32);
const MAXIMUM_BYTES = 1_048_576;
const MINIMUM_HEADROOM_BYTES = 32_768;
const INTERACTION_SEGMENTS = [
  "desktop-before-reload",
  "desktop-after-reload",
  "narrow-before-reload",
  "narrow-after-reload",
];
const INTERACTION_GAPS = [
  {
    id: "reload-desktop",
    kind: "reload",
    afterSegmentId: "desktop-before-reload",
    beforeSegmentId: "desktop-after-reload",
  },
  {
    id: "navigation-to-narrow",
    kind: "navigation",
    afterSegmentId: "desktop-after-reload",
    beforeSegmentId: "narrow-before-reload",
  },
  {
    id: "reload-narrow",
    kind: "reload",
    afterSegmentId: "narrow-before-reload",
    beforeSegmentId: "narrow-after-reload",
  },
];
const ROUTE_SEGMENTS = [
  { startedAtOffsetMs: 0, completedAtOffsetMs: 120_000 },
  { startedAtOffsetMs: 130_000, completedAtOffsetMs: 250_000 },
  { startedAtOffsetMs: 260_000, completedAtOffsetMs: 380_000 },
  { startedAtOffsetMs: 390_000, completedAtOffsetMs: 540_000 },
];
const ROUTE_GAPS = [
  { startedAtOffsetMs: 120_000, completedAtOffsetMs: 130_000 },
  { startedAtOffsetMs: 250_000, completedAtOffsetMs: 260_000 },
  { startedAtOffsetMs: 380_000, completedAtOffsetMs: 390_000 },
];
const CAPTURE_OFFSETS_MS = ROUTE_SEGMENTS.flatMap(({ startedAtOffsetMs }) =>
  Array.from({ length: 13 }, (_, index) => startedAtOffsetMs + 5_000 + index * 8_000));

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function write(root, path, value) {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  writeFileSync(target, buffer);
  return digest(buffer);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, body) {
  const name = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(body.length + 12);
  chunk.writeUInt32BE(body.length, 0);
  name.copy(chunk, 4);
  body.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([name, body])), body.length + 8);
  return chunk;
}

function makePng(width, height, tag) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const scanlines = Buffer.alloc(height * (1 + width * 4));
  for (let row = 0; row < height; row += 1) {
    const offset = row * (1 + width * 4);
    scanlines[offset] = 0;
    scanlines[offset + 1] = row % 251;
    scanlines[offset + 2] = tag.length % 251;
    scanlines[offset + 4] = 255;
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("tEXt", Buffer.from(`Task41=${tag}${".".repeat(9_000)}`)),
    pngChunk("IDAT", deflateSync(scanlines)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function ebmlSize(value) {
  for (let length = 1; length <= 8; length += 1) {
    if (BigInt(value) < (1n << BigInt(7 * length)) - 1n) {
      let encoded = BigInt(value) | (1n << BigInt(7 * length));
      const buffer = Buffer.alloc(length);
      for (let index = length - 1; index >= 0; index -= 1) {
        buffer[index] = Number(encoded & 0xffn);
        encoded >>= 8n;
      }
      return buffer;
    }
  }
  throw new RangeError("EBML fixture element is too large.");
}

function ebmlElement(id, body) {
  return Buffer.concat([Buffer.from(id), ebmlSize(body.length), body]);
}

function unsignedBytes(value) {
  const bytes = [];
  let remaining = value;
  do {
    bytes.unshift(remaining & 0xff);
    remaining = Math.floor(remaining / 256);
  } while (remaining > 0);
  return Buffer.from(bytes);
}

function makeStructuralWebm(width, height, durationMs, tag) {
  const docType = ebmlElement([0x42, 0x82], Buffer.from("webm"));
  const header = ebmlElement([0x1a, 0x45, 0xdf, 0xa3], docType);
  const timecodeScale = ebmlElement([0x2a, 0xd7, 0xb1], unsignedBytes(1_000_000));
  const duration = Buffer.alloc(8);
  duration.writeDoubleBE(durationMs, 0);
  const info = ebmlElement(
    [0x15, 0x49, 0xa9, 0x66],
    Buffer.concat([timecodeScale, ebmlElement([0x44, 0x89], duration)]),
  );
  const video = ebmlElement(
    [0xe0],
    Buffer.concat([
      ebmlElement([0xb0], unsignedBytes(width)),
      ebmlElement([0xba], unsignedBytes(height)),
    ]),
  );
  const track = ebmlElement(
    [0xae],
    Buffer.concat([ebmlElement([0x83], Buffer.from([1])), video]),
  );
  const tracks = ebmlElement([0x16, 0x54, 0xae, 0x6b], track);
  const padding = Buffer.alloc(66_000, 0x57);
  padding.write(tag, 0, "utf8");
  const segment = Buffer.concat([
    Buffer.from([0x18, 0x53, 0x80, 0x67, 0xff]),
    info,
    tracks,
    ebmlElement([0xec], padding),
  ]);
  return Buffer.concat([header, segment]);
}

function mp4Box(type, body) {
  const box = Buffer.alloc(8 + body.length);
  box.writeUInt32BE(box.length, 0);
  box.write(type, 4, "ascii");
  body.copy(box, 8);
  return box;
}

function makeStructuralMp4(width, height, durationMs, tag) {
  const movieHeader = Buffer.alloc(20);
  movieHeader.writeUInt32BE(1_000, 12);
  movieHeader.writeUInt32BE(durationMs, 16);
  const trackHeader = Buffer.alloc(8);
  trackHeader.writeUInt32BE(width * 65_536, 0);
  trackHeader.writeUInt32BE(height * 65_536, 4);
  const ftyp = mp4Box("ftyp", Buffer.from("isom0000isom"));
  const moov = mp4Box(
    "moov",
    Buffer.concat([
      mp4Box("mvhd", movieHeader),
      mp4Box("trak", mp4Box("tkhd", trackHeader)),
    ]),
  );
  const media = Buffer.alloc(66_000, 0x4d);
  media.write(tag, 0, "utf8");
  return Buffer.concat([ftyp, moov, mp4Box("mdat", media)]);
}

const realVideoCache = new Map();
const realVideoRoot = mkdtempSync(join(tmpdir(), "lakecraft-task41-real-video-"));
process.addListener("exit", () => rmSync(realVideoRoot, { recursive: true, force: true }));

function makeRealVideo(format, width, height, durationMs, tag) {
  const key = `${format}/${width}/${height}/${durationMs}/${tag}`;
  const cached = realVideoCache.get(key);
  if (cached) return cached;
  const extension = format === "webm" ? "webm" : "mp4";
  const outputPath = join(realVideoRoot, `${digest(key)}.${extension}`);
  const codec = format === "webm"
    ? ["-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8", "-b:v", "800k"]
    : ["-c:v", "mpeg4", "-q:v", "3"];
  const result = spawnSync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    `testsrc2=size=${width}x${height}:rate=2:duration=${durationMs / 1_000}`,
    "-an",
    ...codec,
    "-metadata",
    `comment=${tag}`,
    outputPath,
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, `ffmpeg fixture generation failed: ${result.stderr}`);
  const buffer = readFileSync(outputPath);
  assert.ok(buffer.length >= 64 * 1_024, "real video fixture must be substantive");
  realVideoCache.set(key, buffer);
  return buffer;
}

const artifactFixtureRoot = mkdtempSync(join(tmpdir(), "lakecraft-task41-real-artifact-"));
process.addListener("exit", () => rmSync(artifactFixtureRoot, { recursive: true, force: true }));
let artifactFixtureCache;
let artifactFixtureRepoRoot;

function checkedCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")} failed:\n${result.stderr || result.stdout}`,
  );
  return result.stdout;
}

const SOURCE_SNAPSHOT_EXCLUDED_SEGMENTS = new Set([
  ".git",
  ".lakebed",
  ".tmp",
  "artifacts",
  "coverage",
  "dist",
  "evidence",
  "node_modules",
  "temp",
  "tmp",
]);

function sourceSnapshotPathExcluded(path) {
  const segments = path.split("/");
  const basename = segments.at(-1) ?? "";
  return (
    segments.some((segment) => SOURCE_SNAPSHOT_EXCLUDED_SEGMENTS.has(segment))
    || basename.startsWith(".codex-tmp-")
    || basename.startsWith("lakecraft-task41-")
    || basename.startsWith("task41-evidence-")
    || basename === ".env"
    || basename.startsWith(".env.")
    || basename === ".netrc"
    || basename === ".npmrc"
  );
}

function currentSourceSnapshot(sourceRoot, targetRoot) {
  const inventory = spawnSync(
    "git",
    ["-C", sourceRoot, "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { encoding: "buffer", maxBuffer: 32 * 1024 * 1024 },
  );
  assert.equal(inventory.status, 0, inventory.stderr?.toString("utf8"));
  const paths = inventory.stdout.toString("utf8").split("\0").filter(Boolean).sort();
  const includedPaths = paths.filter((path) => {
    assert.ok(
      !path.startsWith("/")
      && !path.includes("\\")
      && path.split("/").every((segment) => segment && segment !== "." && segment !== ".."),
      `unsafe current-source snapshot path: ${path}`,
    );
    return !sourceSnapshotPathExcluded(path)
      && existsSync(join(sourceRoot, ...path.split("/")));
  });
  assert.ok(includedPaths.length > 0, "current-source snapshot must contain reviewed worktree files");
  const manifest = includedPaths.map((path) => {
    const sourcePath = join(sourceRoot, ...path.split("/"));
    const info = lstatSync(sourcePath);
    assert.ok(info.isFile() && !info.isSymbolicLink(), `current-source snapshot path must be a regular file: ${path}`);
    const contents = readFileSync(sourcePath);
    write(targetRoot, path, contents);
    return { bytes: contents.length, path, sha256: digest(contents) };
  });
  return Object.freeze({
    hash: digest(Buffer.from(JSON.stringify(manifest))),
    manifest: Object.freeze(manifest),
  });
}

function assertSourceSnapshot(root, snapshot) {
  const manifest = snapshot.manifest.map(({ path }) => {
    const contents = readFileSync(join(root, ...path.split("/")));
    return { bytes: contents.length, path, sha256: digest(contents) };
  });
  assert.deepEqual(manifest, snapshot.manifest, "isolated source snapshot must retain the authoritative worktree manifest");
  assert.equal(
    digest(Buffer.from(JSON.stringify(manifest))),
    snapshot.hash,
    "isolated source snapshot hash must retain the authoritative worktree hash",
  );
}

function initializeSourceSnapshotRepository(sourceRoot) {
  checkedCommand("git", ["-C", sourceRoot, "init", "--quiet"]);
  checkedCommand("git", ["-C", sourceRoot, "add", "--all"]);
  checkedCommand(
    "git",
    [
      "-C",
      sourceRoot,
      "-c",
      "user.name=Lakecraft QA",
      "-c",
      "user.email=qa@lakecraft.invalid",
      "commit",
      "--quiet",
      "--no-gpg-sign",
      "-m",
      "Deterministic current-source test snapshot",
    ],
    {
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
        GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
      },
    },
  );
  const replacementCommit = checkedCommand("git", ["-C", sourceRoot, "rev-parse", "HEAD"]).trim();
  const expectedCommitBody = checkedCommand("git", ["-C", PROJECT_ROOT, "cat-file", "commit", COMMIT]);
  const importedCommit = checkedCommand(
    "git",
    ["-C", sourceRoot, "hash-object", "-t", "commit", "-w", "--stdin"],
    { input: expectedCommitBody },
  ).trim();
  assert.equal(importedCommit, COMMIT, "isolated repository must retain the evidence commit identity");
  checkedCommand("git", ["-C", sourceRoot, "replace", COMMIT, replacementCommit]);
  assert.equal(
    checkedCommand("git", ["-C", sourceRoot, "rev-parse", `${COMMIT}^{tree}`]).trim(),
    checkedCommand("git", ["-C", sourceRoot, "rev-parse", `${replacementCommit}^{tree}`]).trim(),
    "the evidence commit must resolve to the authoritative current-source tree in the isolated repository",
  );
}

function realArtifactFixture() {
  if (artifactFixtureCache) return artifactFixtureCache;
  const fixtureRoot = mkdtempSync(join(artifactFixtureRoot, "fixture-"));
  try {
    const sourceRoot = join(fixtureRoot, "source");
    mkdirSync(sourceRoot);
    const sourceSnapshot = currentSourceSnapshot(PROJECT_ROOT, sourceRoot);
    assertSourceSnapshot(sourceRoot, sourceSnapshot);
    initializeSourceSnapshotRepository(sourceRoot);
    artifactFixtureRepoRoot = sourceRoot;
    const builds = ["a", "b"].map((name) => {
      const stageRoot = join(fixtureRoot, `stage-${name}`);
      checkedCommand(
        process.execPath,
        [join(sourceRoot, "scripts", "build-lakebed-audit.mjs"), stageRoot],
        { cwd: sourceRoot },
      );
      assertSourceSnapshot(sourceRoot, sourceSnapshot);
      const reportText = readFileSync(join(stageRoot, "build-report.json"), "utf8");
      const report = JSON.parse(reportText);
      const metadataBuffer = readFileSync(join(stageRoot, "artifact-metadata.json"));
      return {
        report,
        reportBuffer: Buffer.from(reportText),
        metadataBuffer,
        clientBuffer: readFileSync(join(stageRoot, "staged/client-index.tsx")),
        serverBuffer: readFileSync(join(stageRoot, "staged/server-index.ts")),
      };
    });
    assert.deepEqual(builds[0].metadataBuffer, builds[1].metadataBuffer);
    assert.deepEqual(builds[0].clientBuffer, builds[1].clientBuffer);
    assert.deepEqual(builds[0].serverBuffer, builds[1].serverBuffer);
    artifactFixtureCache = builds;
    return builds;
  } catch (error) {
    rmSync(fixtureRoot, { recursive: true, force: true });
    throw error;
  }
}

function currentSourceRepoRoot() {
  realArtifactFixture();
  assert.ok(artifactFixtureRepoRoot, "current-source artifact repository must be initialized");
  return artifactFixtureRepoRoot;
}

function createFixture({ multiplayerStatus = "passed", nowMs = Date.now() } = {}) {
  const root = mkdtempSync(join(tmpdir(), "lakecraft-task41-evidence-"));
  const evidence = createTask41EvidenceTemplate();
  const runStartedAtMs = nowMs - 10 * 60_000;
  const runCompletedAtMs = nowMs - 60_000;
  const runStartedAt = new Date(runStartedAtMs).toISOString();
  const runCompletedAt = new Date(runCompletedAtMs).toISOString();
  const packagedCompletedAt = new Date(runCompletedAtMs + 25_000).toISOString();
  let sequence = 0;
  const bindingForSequence = (captureSequence, capturedAtMs, durationMs = 1_000) => ({
    taskId: TASK41_TASK_ID,
    runId: RUN_ID,
    appCommit: COMMIT,
    capturedAt: new Date(capturedAtMs).toISOString(),
    completedAt: new Date(capturedAtMs + durationMs).toISOString(),
    sequence: captureSequence,
  });
  const nextBinding = (durationMs = 1_000) => {
    sequence += 1;
    const capturedAtMs = runStartedAtMs + CAPTURE_OFFSETS_MS[sequence - 1];
    assert.ok(Number.isFinite(capturedAtMs), "capture fixture exceeds its planned measured segments");
    return bindingForSequence(sequence, capturedAtMs, durationMs);
  };
  const fixedLiveBinding = (captureSequence) => bindingForSequence(
    captureSequence,
    runStartedAtMs + CAPTURE_OFFSETS_MS[captureSequence - 1],
  );
  const derivedBinding = (captureSequence, offsetMs) =>
    bindingForSequence(captureSequence, runCompletedAtMs + offsetMs);
  const writeBoundJson = (path, binding, fields) => {
    const value = { schemaVersion: 1, ...binding, ...fields };
    return {
      value,
      sha256: write(root, path, `${JSON.stringify(value)}\n`),
    };
  };

  Object.assign(evidence, {
    runId: RUN_ID,
    appCommit: COMMIT,
    runStartedAt,
    runCompletedAt,
    packagedCompletedAt,
    completionEligible: multiplayerStatus === "passed",
    browser: { name: "Chromium", version: "140.0.7339.0" },
  });
  evidence.worlds.forEach((world, index) => {
    Object.assign(world, {
      worldId: `qa-world-${index + 1}`,
      editMarker: `edit-${index + 1}`,
      inventoryMarker: `inventory-${index + 1}`,
      containerMarker: `container-${index + 1}`,
    });
  });

  for (const observation of evidence.observations) {
    observation.status = "pass";
    observation.notes = `Observed ${observation.id}.`;
    for (const [index, entry] of observation.evidence.entries()) {
      const binding = nextBinding(entry.kind === "video" ? 5_000 : 1_000);
      Object.assign(entry, binding);
      const slug = `${observation.id}-${entry.viewport ?? "global"}-${index}`;
      if (entry.kind === "screenshot") {
        const viewport = TASK41_VIEWPORTS[entry.viewport];
        const path = `observations/${slug}.png`;
        const buffer = makePng(viewport.width, viewport.height, slug);
        Object.assign(entry, {
          path,
          sha256: write(root, path, buffer),
          mimeType: "image/png",
          width: viewport.width,
          height: viewport.height,
          devicePixelRatio: 1,
        });
      } else if (entry.kind === "video") {
        const mp4 = sequence % 2 === 0;
        const viewport = TASK41_VIEWPORTS[entry.viewport];
        const path = `observations/${slug}.${mp4 ? "mp4" : "webm"}`;
        const buffer = makeRealVideo(
          mp4 ? "mp4" : "webm",
          viewport.width,
          viewport.height,
          5_000,
          slug,
        );
        Object.assign(entry, {
          path,
          sha256: write(root, path, buffer),
          mimeType: mp4 ? "video/mp4" : "video/webm",
          width: viewport.width,
          height: viewport.height,
          devicePixelRatio: 1,
          durationMs: 5_000,
        });
      } else if (entry.kind === "transcript") {
        const path = `observations/${slug}.json`;
        const actions = TASK41_TRANSCRIPT_ACTIONS.map((id, actionIndex) => ({
          id,
          status: "pass",
          at: new Date(Date.parse(binding.capturedAt) + actionIndex + 1).toISOString(),
          detail: `${id} visibly produced the expected state.`,
        }));
        const transcript = writeBoundJson(path, binding, {
          caseId: observation.id,
          viewport: entry.viewport,
          actions,
        });
        Object.assign(entry, { path, sha256: transcript.sha256 });
      } else {
        const path = `observations/${slug}.json`;
        const summary = writeBoundJson(path, binding, {
          caseId: observation.id,
          kind: entry.kind,
          result: "pass",
        });
        Object.assign(entry, { path, sha256: summary.sha256 });
      }
    }
  }

  for (const metric of evidence.performance) {
    const binding = nextBinding(5_120);
    const frames = Array.from({ length: 320 }, (_, index) => ({
      sequence: index + 1,
      timestamp: new Date(Date.parse(binding.capturedAt) + (index + 1) * 16).toISOString(),
      frameMs: 16,
      drawCalls: 2,
      visible: true,
      hasFocus: true,
      viewport: metric.viewport,
      devicePixelRatio: 1,
    }));
    const path = `performance/${metric.viewport}-${metric.scene}.json`;
    const capture = {
      schemaVersion: 2,
      ...binding,
      label: `${metric.viewport}/${metric.scene}`,
      viewport: metric.viewport,
      devicePixelRatio: 1,
      patchedContexts: 2,
      frames,
    };
    Object.assign(metric, {
      devicePixelRatio: 1,
      sampleCount: 320,
      fps: 62.5,
      p95FrameMs: 16,
      drawCallsPerFrameP95: 2,
      drawCallsPerFrameMax: 2,
      totalDrawCalls: 640,
      durationMs: 5_120,
      patchedContexts: 2,
      evidencePath: path,
      evidenceSha256: write(root, path, `${JSON.stringify(capture)}\n`),
      ...binding,
    });
  }

  {
    const binding = derivedBinding(49, 5_000);
    const path = "structured/console.json";
    const segments = INTERACTION_SEGMENTS.map((id, index) => {
      const route = ROUTE_SEGMENTS[index];
      return {
        id,
        startedAt: new Date(runStartedAtMs + route.startedAtOffsetMs).toISOString(),
        completedAt: new Date(runStartedAtMs + route.completedAtOffsetMs).toISOString(),
        entries: index === 0 ? [{
          sequence: 1,
          timestamp: new Date(runStartedAtMs + route.startedAtOffsetMs + 1_000).toISOString(),
          source: "console",
          level: "info",
          text: "Task 41 browser probe installed.",
        }] : [],
      };
    });
    const gaps = INTERACTION_GAPS.map((gap, index) => {
      const route = ROUTE_GAPS[index];
      return {
        ...gap,
        startedAt: new Date(runStartedAtMs + route.startedAtOffsetMs).toISOString(),
        completedAt: new Date(runStartedAtMs + route.completedAtOffsetMs).toISOString(),
        entries: [],
      };
    });
    const capture = writeBoundJson(path, binding, {
      schemaVersion: 2,
      segments,
      gaps,
    });
    evidence.console = {
      segmentCount: INTERACTION_SEGMENTS.length,
      gapCount: INTERACTION_GAPS.length,
      warningCount: 0,
      errorCount: 0,
      exceptionCount: 0,
      unhandledRejectionCount: 0,
      evidencePath: path,
      evidenceSha256: capture.sha256,
      ...binding,
    };
  }
  {
    const binding = derivedBinding(50, 10_000);
    const path = "structured/network.json";
    const segments = INTERACTION_SEGMENTS.map((id, index) => {
      const route = ROUTE_SEGMENTS[index];
      return {
        id,
        startedAt: new Date(runStartedAtMs + route.startedAtOffsetMs).toISOString(),
        completedAt: new Date(runStartedAtMs + route.completedAtOffsetMs).toISOString(),
        requests: [],
        newSockets: [],
      };
    });
    const gaps = INTERACTION_GAPS.map((gap, index) => {
      const route = ROUTE_GAPS[index];
      const startedAt = runStartedAtMs + route.startedAtOffsetMs;
      return {
        ...gap,
        startedAt: new Date(startedAt).toISOString(),
        completedAt: new Date(runStartedAtMs + route.completedAtOffsetMs).toISOString(),
        navigationRequests: [{
          sequence: 1,
          timestamp: new Date(startedAt + 1_000).toISOString(),
          url: "http://localhost:3000/",
          resourceType: "document",
        }],
        appRequests: [],
        newSockets: [],
      };
    });
    const capture = writeBoundJson(path, binding, { schemaVersion: 2, segments, gaps });
    evidence.network = {
      segmentCount: INTERACTION_SEGMENTS.length,
      gapCount: INTERACTION_GAPS.length,
      requestCount: 0,
      websocketCount: 0,
      lakebedRequestCount: 0,
      navigationRequestCount: INTERACTION_GAPS.length,
      evidencePath: path,
      evidenceSha256: capture.sha256,
      ...binding,
    };
  }
  {
    const binding = fixedLiveBinding(47);
    const path = "structured/storage.json";
    const worlds = evidence.worlds.map((world, index) => {
      const prefix = `lakecraft.singleplayer.world.${world.worldId}.`;
      return {
        role: world.role,
        worldId: world.worldId,
        registered: true,
        uiHealth: index === 2 ? "recovered" : "healthy",
        markers: {
          editPersisted: true,
          inventoryPersisted: true,
          containerPersisted: true,
        },
        keys: [
          `${prefix}v1`,
          `${prefix}save.head`,
          `${prefix}save.a`,
          `${prefix}save.b`,
        ].map((name, keyIndex) => ({
          name,
          present: keyIndex !== 3 || index !== 2,
          length: keyIndex !== 3 || index !== 2 ? 100 + index * 10 + keyIndex : 0,
          sha256: keyIndex !== 3 || index !== 2 ? digest(`${name}-${index}`) : null,
        })),
      };
    });
    const capture = writeBoundJson(path, binding, { worlds });
    evidence.storage = {
      worldCount: 3,
      evidencePath: path,
      evidenceSha256: capture.sha256,
      ...binding,
    };
  }
  {
    const binding = fixedLiveBinding(48);
    const path = "structured/multiplayer.json";
    const passed = multiplayerStatus === "passed";
    const identities = [];
    const interactions = [];
    if (passed) {
      const windows = [
        [runStartedAtMs + 400_000, runStartedAtMs + 520_000],
        [runStartedAtMs + 410_000, runStartedAtMs + 530_000],
      ];
      for (const [index, id] of ["identity-a", "identity-b"].entries()) {
        const identityCommitment = `sha256:${digest(`authorized-account-${index + 1}`)}`;
        const runSaltedIdentityHash =
          `sha256:${digest(Buffer.from(`${RUN_ID}:${identityCommitment}`))}`;
        const proofPath = `multiplayer/${id}.json`;
        const proof = {
          schemaVersion: 1,
          taskId: TASK41_TASK_ID,
          runId: RUN_ID,
          appCommit: COMMIT,
          capturedAt: binding.capturedAt,
          identityId: id,
          identityCommitment,
          runSaltedIdentityHash,
          windowStartedAt: new Date(windows[index][0]).toISOString(),
          windowCompletedAt: new Date(windows[index][1]).toISOString(),
          peerVisibilityIds: [index === 0 ? "identity-b" : "identity-a"],
          quotaTelemetry: [
            {
              sequence: 1,
              timestamp: new Date(windows[index][0] + 5_000).toISOString(),
              attempts: 1,
              grants: 10,
              paused: false,
            },
            {
              sequence: 2,
              timestamp: new Date(windows[index][1] - 5_000).toISOString(),
              attempts: 5,
              grants: 10,
              paused: false,
            },
          ],
        };
        identities.push({
          id,
          identityCommitment,
          runSaltedIdentityHash,
          windowStartedAt: proof.windowStartedAt,
          windowCompletedAt: proof.windowCompletedAt,
          proofPath,
          proofSha256: write(root, proofPath, `${JSON.stringify(proof)}\n`),
        });
      }
      const overlapStartedAt = runStartedAtMs + 430_000;
      const overlapCompletedAt = runStartedAtMs + 490_000;
      for (const [index, [id, actorId, targetId]] of [
        ["identity-a-to-b", "identity-a", "identity-b"],
        ["identity-b-to-a", "identity-b", "identity-a"],
      ].entries()) {
        const proofPath = `multiplayer/${id}.json`;
        const proof = {
          schemaVersion: 1,
          taskId: TASK41_TASK_ID,
          runId: RUN_ID,
          appCommit: COMMIT,
          capturedAt: binding.capturedAt,
          interactionId: id,
          actorId,
          targetId,
          windowStartedAt: new Date(overlapStartedAt).toISOString(),
          windowCompletedAt: new Date(overlapCompletedAt).toISOString(),
          events: TASK41_MULTIPLAYER_INTERACTIONS.map((kind, eventIndex) => ({
            sequence: eventIndex + 1,
            timestamp: new Date(
              overlapStartedAt + (index * TASK41_MULTIPLAYER_INTERACTIONS.length + eventIndex + 1) * 2_000,
            ).toISOString(),
            kind,
            status: "pass",
          })),
        };
        interactions.push({
          id,
          actorId,
          targetId,
          proofPath,
          proofSha256: write(root, proofPath, `${JSON.stringify(proof)}\n`),
        });
      }
    }
    const fields = {
      schemaVersion: 2,
      status: passed ? "passed" : "deferred",
      completionEligible: passed,
      hostedRoute: passed ? "enabled" : "disabled",
      identities,
      interactions,
      reasonCodes: passed ? [] : [...TASK41_MULTIPLAYER_DEFERRED_REASONS],
      quotaStatus: "healthy",
      quotaObserved: passed,
      checks: passed
        ? TASK41_MULTIPLAYER_CHECKS.map((id) => ({ id, status: "pass" }))
        : [],
    };
    const capture = writeBoundJson(path, binding, fields);
    evidence.multiplayer = {
      status: fields.status,
      completionEligible: fields.completionEligible,
      hostedRoute: fields.hostedRoute,
      identities: fields.identities,
      interactions: fields.interactions,
      reasonCodes: fields.reasonCodes,
      quotaStatus: fields.quotaStatus,
      quotaObserved: fields.quotaObserved,
      evidencePath: path,
      evidenceSha256: capture.sha256,
      ...binding,
    };
  }

  {
    const buildA = derivedBinding(51, 15_000);
    const buildB = derivedBinding(52, 20_000);
    const [realBuildA, realBuildB] = realArtifactFixture();
    const metadata = JSON.parse(realBuildA.metadataBuffer);
    const artifactHash = metadata.artifactHash;
    const clientBundleHash = metadata.clientBundleHash;
    const artifactFileSha256 = write(root, "build/a/artifact-metadata.json", realBuildA.metadataBuffer);
    write(root, "build/b/artifact-metadata.json", realBuildB.metadataBuffer);
    const reportSha256 = write(root, "build/a/report.json", realBuildA.reportBuffer);
    const pairedReportSha256 = write(root, "build/b/report.json", realBuildB.reportBuffer);
    const stagedClientSha256 = write(root, "build/a/client/index.tsx", realBuildA.clientBuffer);
    write(root, "build/b/client/index.tsx", realBuildB.clientBuffer);
    const stagedServerSha256 = write(root, "build/a/server/index.ts", realBuildA.serverBuffer);
    write(root, "build/b/server/index.ts", realBuildB.serverBuffer);
    evidence.artifact = {
      format: metadata.lakebedFormat,
      deployTarget: metadata.deployTarget,
      reportPath: "build/a/report.json",
      reportSha256,
      pairedReportPath: "build/b/report.json",
      pairedReportSha256,
      artifactPath: "build/a/artifact-metadata.json",
      pairedArtifactPath: "build/b/artifact-metadata.json",
      artifactBytes: metadata.artifactBytes,
      maximumBytes: MAXIMUM_BYTES,
      headroomBytes: MAXIMUM_BYTES - metadata.artifactBytes,
      minimumHeadroomBytes: MINIMUM_HEADROOM_BYTES,
      artifactHash,
      clientBundleHash,
      pairedArtifactsEqual: true,
      artifactFileSha256,
      stagedClientPath: "build/a/client/index.tsx",
      pairedStagedClientPath: "build/b/client/index.tsx",
      stagedClientSha256,
      stagedServerPath: "build/a/server/index.ts",
      pairedStagedServerPath: "build/b/server/index.ts",
      stagedServerSha256,
      pairedCapturedAt: buildB.capturedAt,
      pairedCompletedAt: buildB.completedAt,
      pairedSequence: buildB.sequence,
      ...buildA,
    };
  }

  return {
    root,
    evidence,
    nowMs,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

async function assertFileInvalid(fixture, pattern) {
  await assert.rejects(
    verifyTask41EvidenceFiles(fixture.evidence, fixture.root, {
      expectedCommit: COMMIT,
      repoRoot: currentSourceRepoRoot(),
      nowMs: fixture.nowMs,
    }),
    pattern,
  );
}

function replaceEntryFile(fixture, entry, buffer) {
  entry.sha256 = write(fixture.root, entry.path, buffer);
}

function replaceBoundJson(fixture, summary, value) {
  summary.evidenceSha256 = write(
    fixture.root,
    summary.evidencePath,
    `${JSON.stringify(value)}\n`,
  );
}

function mutateStructuredTimelines(fixture, mutator) {
  for (const summaryName of ["console", "network"]) {
    const summary = fixture.evidence[summaryName];
    const value = JSON.parse(readFileSync(join(fixture.root, summary.evidencePath), "utf8"));
    mutator(value, summaryName);
    replaceBoundJson(fixture, summary, value);
  }
}

function rewriteStructuredCaptureWindow(fixture, summaryName, capturedAt, completedAt) {
  const summary = fixture.evidence[summaryName];
  const value = JSON.parse(readFileSync(join(fixture.root, summary.evidencePath), "utf8"));
  summary.capturedAt = capturedAt;
  summary.completedAt = completedAt;
  value.capturedAt = capturedAt;
  value.completedAt = completedAt;
  replaceBoundJson(fixture, summary, value);
}

function rewriteArtifactMetadataPair(fixture, mutator) {
  const artifact = fixture.evidence.artifact;
  const artifactPath = join(fixture.root, artifact.artifactPath);
  const metadata = JSON.parse(readFileSync(artifactPath, "utf8"));
  mutator(metadata);
  if (typeof metadata.artifactHash === "string") artifact.artifactHash = metadata.artifactHash;
  if (typeof metadata.clientBundleHash === "string") artifact.clientBundleHash = metadata.clientBundleHash;
  if (Number.isInteger(metadata.artifactBytes)) {
    artifact.artifactBytes = metadata.artifactBytes;
    artifact.headroomBytes = artifact.maximumBytes - metadata.artifactBytes;
  }
  const buffer = Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`);
  artifact.artifactFileSha256 = write(fixture.root, artifact.artifactPath, buffer);
  write(fixture.root, artifact.pairedArtifactPath, buffer);
  for (const [pathKey, hashKey] of [
    ["reportPath", "reportSha256"],
    ["pairedReportPath", "pairedReportSha256"],
  ]) {
    const report = JSON.parse(readFileSync(join(fixture.root, artifact[pathKey]), "utf8"));
    report.artifactHash = artifact.artifactHash;
    artifact[hashKey] = write(
      fixture.root,
      artifact[pathKey],
      `${JSON.stringify(report, null, 2)}\n`,
    );
  }
}

test("runbook exposes one canonical template command and the ordered case ledger", () => {
  assert.equal(extractTask41TemplateCommand(runbook), TASK41_TEMPLATE_COMMAND);
  assert.deepEqual(extractTask41RunbookCases(runbook), TASK41_CASES.map(({ id }) => id));
  assert.equal(TASK41_CASES.length, 18);
  assert.deepEqual(Object.values(TASK41_VIEWPORTS), [
    { width: 1280, height: 720 },
    { width: 800, height: 720 },
  ]);
  assert.equal(TASK41_PERFORMANCE_SCENES.length, 6);
  assert.equal(TASK41_MIN_INTERACTION_SEGMENTS, 4);
  assert.deepEqual(TASK41_INTERACTION_GAP_KINDS, ["navigation", "reload"]);
  assert.equal(repositoryRoot.protocol, "file:");
});

test("runbook marker parsers reject ambiguity, reordering, and command drift", () => {
  assert.throws(
    () => extractTask41TemplateCommand(runbook.replace(
      TASK41_TEMPLATE_END,
      `${TASK41_TEMPLATE_END}\n${TASK41_TEMPLATE_START}\n${TASK41_TEMPLATE_END}`,
    )),
    /exactly once/,
  );
  assert.throws(
    () => extractTask41TemplateCommand(runbook.replace(TASK41_TEMPLATE_COMMAND, "node stale-script.mjs")),
    /canonical command/,
  );
  assert.throws(
    () => extractTask41RunbookCases(runbook.replace(TASK41_CASES_START, TASK41_CASES_END)),
    /out of order|exactly/,
  );
  assert.throws(
    () => extractTask41RunbookCases(runbook.replace("| `world-create-search-select` |", "| `unknown-case` |")),
    /must be exactly/,
  );
});

test("runbook documents trusted validation, sanitized storage, current UI labels, and capture boundaries", () => {
  assert.match(runbook, /double-click[\s\S]{0,80}play it/i);
  assert.match(runbook, /\*\*Create New World\*\*/);
  assert.match(runbook, /\*\*Delete World\*\*/);
  assert.match(runbook, /yes, I want to delete this world/);
  assert.doesNotMatch(runbook, /Play Selected World/);
  assert.doesNotMatch(runbook, /\*\*Reset World/);
  assert.doesNotMatch(runbook, /copy all keys/i);
  assert.doesNotMatch(runbook, /localStorage\.key\(\)|Object\.keys\(localStorage\)/);
  assert.doesNotMatch(runbook, /retain both full Lakebed JSON reports, artifacts/i);
  assert.match(
    runbook,
    /Never[\s\S]{0,80}retain the full artifact envelope or client bundle/i,
  );
  assert.match(
    runbook,
    /transaction must delete each full artifact envelope[\s\S]{0,80}rather than export/i,
  );
  assert.match(
    runbook,
    /Never[\s\S]{0,180}browser-storage enumeration\s+APIs[\s\S]{0,100}copy a storage prefix[\s\S]{0,100}foreign origin data/i,
  );
  assert.match(runbook, /Never record or export a raw localStorage value/i);
  assert.equal(
    [...runbook.matchAll(/node scripts\/build-lakebed-audit\.mjs/g)].length,
    2,
    "both compact builds use the anonymous-only transaction wrapper",
  );
  assert.match(runbook, /--expected-commit "\$expected_commit"/);
  assert.match(runbook, /--repo-root "\$repo_root"/);
  assert.match(runbook, /command -v ffprobe[\s\S]{0,80}command -v ffmpeg/);
  assert.match(runbook, /ffprobe[\s\S]{0,120}real video stream[\s\S]{0,180}ffmpeg[\s\S]{0,100}decode at least one frame/i);
  assert.match(runbook, /4–32 uniquely named[\s\S]{0,180}`navigation` or `reload` gap/i);
  assert.match(runbook, /No unclassified time may hide traffic/i);
  assert.match(runbook, /Console and Network reports[\s\S]{0,100}identical IDs, kinds, and timestamps/i);
  assert.match(runbook, /segments\[0\]\.startedAt === runStartedAt[\s\S]{0,80}no unmeasured prefix/i);
  assert.match(runbook, /segments\.at\(-1\)\.completedAt === runCompletedAt[\s\S]{0,140}no unmeasured[\s\S]{0,20}suffix/i);
  assert.match(
    runbook,
    /Every live screenshot, video, transcript, performance capture,[\s\S]{0,240}capturedAt[\s\S]{0,40}completedAt[\s\S]{0,120}one measured segment/i,
  );
  assert.match(
    runbook,
    /nested[\s\S]{0,30}action, frame, telemetry, or event timestamp[\s\S]{0,100}(?:wholly )?inside a[\s\S]{0,20}measured segment/i,
  );
  assert.match(runbook, /Every measured segment[\s\S]{0,30}contain at least one bound live evidence capture/i);
  assert.match(
    runbook,
    /After `runCompletedAt`, serialize the complete Console and Network reports[\s\S]{0,180}timelines still cover exactly[\s\S]{0,100}`runStartedAt` through `runCompletedAt`/i,
  );
  assert.match(runbook, /manifest[\s\S]{0,20}`packagedCompletedAt` after build B and all packaging finish/i);
  assert.match(
    runbook,
    /Derived intervals[\s\S]{0,30}nonoverlapping and ordered:[\s\S]{0,100}Console report[\s\S]{0,80}Network report[\s\S]{0,80}artifact build A[\s\S]{0,80}artifact build B/i,
  );
  assert.match(runbook, /packagedCompletedAt - runCompletedAt` (?:is |of )?at most six hours/i);
  assert.match(runbook, /git -C "\$repo_root" archive "\$expected_commit"/);
  assert.match(runbook, /mismatched CSS viewport\/device-pixel ratio[\s\S]{0,100}hidden or unfocused/i);
  assert.match(runbook, /valid-partial[\s\S]{0,100}process exit 2/i);
  assert.match(
    runbook,
    /dev-server WebSocket[\s\S]{0,160}before\s+the\s+boundary[\s\S]{0,160}does not invalidate/i,
  );
});

test("a complete, freshly bound manifest with substantive generated files verifies", { timeout: 60_000 }, async () => {
  const fixture = createFixture();
  try {
    const runCompletedAt = Date.parse(fixture.evidence.runCompletedAt);
    const packagedCompletedAt = Date.parse(fixture.evidence.packagedCompletedAt);
    const derivedWindows = [
      [fixture.evidence.console.capturedAt, fixture.evidence.console.completedAt],
      [fixture.evidence.network.capturedAt, fixture.evidence.network.completedAt],
      [fixture.evidence.artifact.capturedAt, fixture.evidence.artifact.completedAt],
      [fixture.evidence.artifact.pairedCapturedAt, fixture.evidence.artifact.pairedCompletedAt],
    ].map(([startedAt, completedAt]) => [Date.parse(startedAt), Date.parse(completedAt)]);
    assert.equal(
      Date.parse(JSON.parse(readFileSync(
        join(fixture.root, fixture.evidence.console.evidencePath),
        "utf8",
      )).segments.at(-1).completedAt),
      runCompletedAt,
    );
    assert.equal(
      Date.parse(JSON.parse(readFileSync(
        join(fixture.root, fixture.evidence.network.evidencePath),
        "utf8",
      )).segments.at(-1).completedAt),
      runCompletedAt,
    );
    assert.ok(derivedWindows[0][0] >= runCompletedAt);
    derivedWindows.forEach(([startedAt, completedAt], index) => {
      assert.ok(completedAt >= startedAt);
      assert.ok(completedAt <= packagedCompletedAt);
      if (index > 0) assert.ok(startedAt >= derivedWindows[index - 1][1]);
    });
    assert.equal(
      validateTask41Evidence(fixture.evidence, { expectedCommit: COMMIT, nowMs: fixture.nowMs }),
      fixture.evidence,
    );
    await verifyTask41EvidenceFiles(fixture.evidence, fixture.root, {
      expectedCommit: COMMIT,
      repoRoot: currentSourceRepoRoot(),
      nowMs: fixture.nowMs,
    });
  } finally {
    fixture.cleanup();
  }
});

test("the CLI returns exit 0 only for complete proof and exit 2 for valid deferred multiplayer proof", { timeout: 30_000 }, () => {
  for (const [status, expectedExit, expectedStatus] of [
    ["passed", 0, "valid"],
    ["deferred", 2, "valid-partial"],
  ]) {
    const fixture = createFixture({ multiplayerStatus: status });
    try {
      const manifestPath = join(fixture.root, "task41-evidence.json");
      const validatorOutputPath = join(fixture.root, "validator-output.json");
      writeFileSync(manifestPath, `${JSON.stringify(fixture.evidence, null, 2)}\n`);
      const result = spawnSync(process.execPath, [
        validatorPath.pathname,
        manifestPath,
        "--root",
        fixture.root,
        "--expected-commit",
        COMMIT,
        "--repo-root",
        currentSourceRepoRoot(),
        "--validator-output",
        validatorOutputPath,
      ], { encoding: "utf8" });
      assert.equal(result.status, expectedExit, result.stderr);
      assert.equal(JSON.parse(result.stdout).status, expectedStatus);
      const persistedOutput = JSON.parse(readFileSync(validatorOutputPath, "utf8"));
      assert.equal(persistedOutput.status, expectedStatus);
      assert.equal(persistedOutput.appCommit, COMMIT);
      assert.equal(persistedOutput.runId, RUN_ID);
    } finally {
      fixture.cleanup();
    }
  }
});

test("manifest provenance rejects wrong identity, commit, run, timing, and capture order", () => {
  const fixture = createFixture();
  try {
    const valid = fixture.evidence;
    const invalid = (mutator, pattern) => {
      const candidate = clone(valid);
      mutator(candidate);
      assert.throws(
        () => validateTask41Evidence(candidate, { expectedCommit: COMMIT, nowMs: fixture.nowMs }),
        pattern,
      );
    };
    invalid((value) => { value.taskId = "foreign-task"; }, /identity/);
    invalid((value) => { value.appCommit = "d".repeat(40); }, /expected-commit/);
    invalid((value) => { value.runId = "d".repeat(32); }, /bound|run/);
    invalid((value) => { value.observations[0].evidence[0].taskId = "foreign-task"; }, /bound/);
    invalid((value) => { value.observations[0].evidence[0].runId = "d".repeat(32); }, /bound/);
    invalid((value) => { value.observations[0].evidence[0].appCommit = "d".repeat(40); }, /bound/);
    invalid((value) => {
      value.runCompletedAt = new Date(fixture.nowMs - 25 * 60 * 60_000).toISOString();
      value.runStartedAt = new Date(fixture.nowMs - 26 * 60 * 60_000).toISOString();
    }, /stale|packaging|six hours/);
    invalid((value) => {
      value.runStartedAt = new Date(fixture.nowMs + 6 * 60_000).toISOString();
      value.runCompletedAt = new Date(fixture.nowMs + 16 * 60_000).toISOString();
    }, /future|packaging|runCompletedAt/);
    invalid((value) => {
      const first = value.observations[0].evidence[0];
      const second = value.observations[0].evidence[1];
      [first.sequence, second.sequence] = [second.sequence, first.sequence];
    }, /sequence|order/);
    invalid((value) => {
      value.packagedCompletedAt =
        new Date(Date.parse(value.runCompletedAt) - 1_000).toISOString();
    }, /packaging|packagedCompletedAt|runCompletedAt/);
    invalid((value) => {
      value.packagedCompletedAt =
        new Date(Date.parse(value.runCompletedAt) + 6 * 60 * 60_000 + 1).toISOString();
    }, /packaging|packagedCompletedAt|future|six hours/);
  } finally {
    fixture.cleanup();
  }
});

test("performance proof rejects hidden, unfocused, reordered, or viewport/DPR-mismatched frames", async () => {
  for (const mutate of [
    (value) => { value.frames[0].visible = false; },
    (value) => { value.frames[0].hasFocus = false; },
    (value) => { value.frames[0].viewport = "narrow"; },
    (value) => { value.frames[0].devicePixelRatio = 2; },
    (value) => { value.frames[1].sequence = value.frames[0].sequence; },
    (value) => { value.viewport = "narrow"; },
    (value) => { value.devicePixelRatio = 2; },
    (value, fixture) => {
      value.frames.at(-1).timestamp =
        new Date(Date.parse(fixture.evidence.runStartedAt) + 385_000).toISOString();
    },
    (value, fixture) => {
      value.frames.at(-1).timestamp =
        new Date(Date.parse(fixture.evidence.runCompletedAt) + 1_000).toISOString();
    },
  ]) {
    const fixture = createFixture();
    try {
      const metric = fixture.evidence.performance[0];
      const value = JSON.parse(readFileSync(join(fixture.root, metric.evidencePath), "utf8"));
      mutate(value, fixture);
      metric.evidenceSha256 = write(
        fixture.root,
        metric.evidencePath,
        `${JSON.stringify(value)}\n`,
      );
      await assertFileInvalid(
        fixture,
        /performance|frames|visible|focused|viewport|devicePixelRatio|order|timestamp|measured interaction segment/,
      );
    } finally {
      fixture.cleanup();
    }
  }
});

test("media verification rejects text files, wrong PNG dimensions, and invalid or undersized containers", async () => {
  for (const mutation of [
    (fixture, entry) => replaceEntryFile(fixture, entry, Buffer.from(`not a PNG${"x".repeat(2_000)}`)),
    (fixture, entry) => replaceEntryFile(fixture, entry, makePng(entry.width - 1, entry.height, "wrong-width")),
  ]) {
    const fixture = createFixture();
    try {
      const screenshot = fixture.evidence.observations[0].evidence[0];
      mutation(fixture, screenshot);
      await assertFileInvalid(fixture, /PNG|dimensions/);
    } finally {
      fixture.cleanup();
    }
  }
  for (const buffer of [
    Buffer.from("tiny"),
    Buffer.alloc(70_000, 0x78),
  ]) {
    const fixture = createFixture();
    try {
      const video = fixture.evidence.observations
        .flatMap(({ evidence }) => evidence)
        .find(({ kind }) => kind === "video");
      replaceEntryFile(fixture, video, buffer);
      await assertFileInvalid(fixture, /video|WebM|MP4|small/);
    } finally {
      fixture.cleanup();
    }
  }
  for (const [mimeType, makeStructural] of [
    ["video/webm", makeStructuralWebm],
    ["video/mp4", makeStructuralMp4],
  ]) {
    const fixture = createFixture();
    try {
      const video = fixture.evidence.observations
        .flatMap(({ evidence }) => evidence)
        .find((entry) => entry.mimeType === mimeType);
      replaceEntryFile(
        fixture,
        video,
        makeStructural(video.width, video.height, video.durationMs, "padding-only"),
      );
      await assertFileInvalid(fixture, /decode|ffmpeg|ffprobe|video frame|stream/);
    } finally {
      fixture.cleanup();
    }
  }
  for (const mutate of [
    (entry) => { entry.width -= 1; },
    (entry) => { entry.durationMs = 0; },
  ]) {
    const fixture = createFixture();
    try {
      const video = fixture.evidence.observations
        .flatMap(({ evidence }) => evidence)
        .find(({ kind }) => kind === "video");
      mutate(video);
      assert.throws(
        () => validateTask41Evidence(fixture.evidence, {
          expectedCommit: COMMIT,
          nowMs: fixture.nowMs,
        }),
        /video|dimensions|durationMs/,
      );
    } finally {
      fixture.cleanup();
    }
  }
});

test("the CLI fails closed when ffprobe or ffmpeg is unavailable", () => {
  const ffprobeResult = spawnSync("/usr/bin/which", ["ffprobe"], { encoding: "utf8" });
  assert.equal(ffprobeResult.status, 0, ffprobeResult.stderr);
  const ffprobePath = ffprobeResult.stdout.trim();

  for (const [missingTool, pathSetup, pattern] of [
    ["ffprobe", () => "/nonexistent-task41-tool-path", /ffprobe.*could not start|ENOENT/i],
    ["ffmpeg", (fixture) => {
      const toolPath = join(fixture.root, "ffprobe-only");
      mkdirSync(toolPath);
      symlinkSync(ffprobePath, join(toolPath, "ffprobe"));
      return toolPath;
    }, /ffmpeg.*could not start|ENOENT/i],
  ]) {
    const fixture = createFixture();
    try {
      const video = fixture.evidence.observations
        .flatMap(({ evidence }) => evidence)
        .find(({ kind }) => kind === "video");
      replaceEntryFile(
        fixture,
        video,
        makeRealVideo(
          video.mimeType === "video/webm" ? "webm" : "mp4",
          video.width,
          video.height,
          video.durationMs,
          `missing-${missingTool}`,
        ),
      );
      const manifestPath = join(fixture.root, "task41-evidence.json");
      writeFileSync(manifestPath, `${JSON.stringify(fixture.evidence, null, 2)}\n`);
      const result = spawnSync(process.execPath, [
        validatorPath.pathname,
        manifestPath,
        "--root",
        fixture.root,
        "--expected-commit",
        COMMIT,
        "--repo-root",
        currentSourceRepoRoot(),
      ], {
        encoding: "utf8",
        env: { ...process.env, PATH: pathSetup(fixture) },
      });
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, pattern);
    } finally {
      fixture.cleanup();
    }
  }
});

test("visual and transcript captures cannot reuse a path or content hash", () => {
  const fixture = createFixture();
  try {
    const entries = fixture.evidence.observations
      .flatMap(({ evidence }) => evidence)
      .filter(({ kind }) => ["screenshot", "video", "transcript"].includes(kind));
    const duplicatePath = clone(fixture.evidence);
    const duplicatePathEntries = duplicatePath.observations
      .flatMap(({ evidence }) => evidence)
      .filter(({ kind }) => ["screenshot", "video", "transcript"].includes(kind));
    duplicatePathEntries[1].path = duplicatePathEntries[0].path;
    assert.throws(
      () => validateTask41Evidence(duplicatePath, { expectedCommit: COMMIT, nowMs: fixture.nowMs }),
      /reuses evidence path|unique paths and hashes/,
    );
    const duplicateHash = clone(fixture.evidence);
    const duplicateHashEntries = duplicateHash.observations
      .flatMap(({ evidence }) => evidence)
      .filter(({ kind }) => ["screenshot", "video", "transcript"].includes(kind));
    duplicateHashEntries[1].sha256 = entries[0].sha256;
    assert.throws(
      () => validateTask41Evidence(duplicateHash, { expectedCommit: COMMIT, nowMs: fixture.nowMs }),
      /reuses evidence hash|unique paths and hashes/,
    );
  } finally {
    fixture.cleanup();
  }
});

test("secure inventory rejects traversal, symlinks, hard-to-audit aliases, and unreferenced dumps", async () => {
  {
    const fixture = createFixture();
    try {
      fixture.evidence.observations[0].evidence[0].path = "../escape.png";
      await assertFileInvalid(fixture, /beneath|canonical path/);
    } finally {
      fixture.cleanup();
    }
  }
  {
    const fixture = createFixture();
    const entry = fixture.evidence.observations[0].evidence[0];
    try {
      const outside = join(tmpdir(), `lakecraft-task41-outside-${RUN_ID}.png`);
      writeFileSync(outside, makePng(entry.width, entry.height, "outside"));
      unlinkSync(join(fixture.root, entry.path));
      symlinkSync(outside, join(fixture.root, entry.path));
      await assertFileInvalid(fixture, /symlink/);
      rmSync(outside, { force: true });
    } finally {
      fixture.cleanup();
    }
  }
  {
    const fixture = createFixture();
    try {
      write(fixture.root, "raw-local-storage-dump.txt", "lakecraft.singleplayer.world.secret=raw-value");
      await assertFileInvalid(fixture, /inventory mismatch|unreferenced/);
    } finally {
      fixture.cleanup();
    }
  }
});

test("structured transcripts reject missing, failed, reordered, or cross-bound actions", async () => {
  for (const mutate of [
    (value) => value.actions.pop(),
    (value) => { value.actions[4].status = "fail"; },
    (value) => { [value.actions[0], value.actions[1]] = [value.actions[1], value.actions[0]]; },
    (value) => { value.actions[2].at = value.actions[1].at; },
    (value, fixture) => {
      value.actions.at(-1).at =
        new Date(Date.parse(fixture.evidence.runStartedAt) + 125_000).toISOString();
    },
    (value, fixture) => {
      value.actions.at(-1).at =
        new Date(Date.parse(fixture.evidence.runCompletedAt) + 1_000).toISOString();
    },
  ]) {
    const fixture = createFixture();
    try {
      const entry = fixture.evidence.observations
        .flatMap(({ evidence }) => evidence)
        .find(({ kind }) => kind === "transcript");
      const value = JSON.parse(readFileSync(join(fixture.root, entry.path), "utf8"));
      mutate(value, fixture);
      replaceEntryFile(fixture, entry, Buffer.from(`${JSON.stringify(value)}\n`));
      await assertFileInvalid(fixture, /transcript|actions|timestamps|ordered|measured interaction segment/);
    } finally {
      fixture.cleanup();
    }
  }
});

test("segmented console and network proof allows navigation gaps but rejects in-segment activity", async () => {
  for (const [summaryName, mutate, pattern] of [
    ["console", (value) => value.segments[0].entries.push({
      sequence: value.segments[0].entries.length + 1,
      timestamp: new Date(Date.parse(value.segments[0].startedAt) + 2_000).toISOString(),
      source: "cdp",
      level: "warning",
      text: "warning",
    }), /console|counts/],
    ["console", (value) => value.segments[1].entries.push({
      sequence: 1,
      timestamp: new Date(Date.parse(value.segments[1].startedAt) + 2_000).toISOString(),
      source: "cdp",
      level: "error",
      text: "error",
    }), /console|counts/],
    ["network", (value) => value.segments[0].requests.push({
      timestamp: value.segments[0].startedAt,
      url: "https://craft.lakebed.app/query",
    }), /request|segment|network/],
    ["network", (value) => value.segments[3].newSockets.push({
      timestamp: value.segments[3].startedAt,
      url: "wss://craft.lakebed.app/socket",
    }), /socket|segment|network/],
    ["network", (value) => value.gaps[1].appRequests.push({
      timestamp: value.gaps[1].startedAt,
      url: "https://craft.lakebed.app/query",
    }), /gap|app traffic|network/],
    ["network", (value) => value.gaps[0].newSockets.push({
      timestamp: value.gaps[0].startedAt,
      url: "wss://localhost:3000/socket",
    }), /gap|socket|network/],
    ["network", (value) => { [value.gaps[0], value.gaps[1]] = [value.gaps[1], value.gaps[0]]; }, /gap|order/],
  ]) {
    const fixture = createFixture();
    try {
      const summary = fixture.evidence[summaryName];
      const value = JSON.parse(readFileSync(join(fixture.root, summary.evidencePath), "utf8"));
      mutate(value);
      replaceBoundJson(fixture, summary, value);
      await assertFileInvalid(fixture, pattern);
    } finally {
      fixture.cleanup();
    }
  }
  for (const [mutate, pattern] of [
    [(value) => {
      value.segments[0].startedAt =
        new Date(Date.parse(value.segments[0].startedAt) + 1_000).toISOString();
    }, /full run|prefix|timeline/],
    [(value) => {
      value.segments.at(-1).completedAt =
        new Date(Date.parse(value.segments.at(-1).completedAt) - 1_000).toISOString();
    }, /full run|suffix|timeline/],
    [(value, summaryName) => {
      const routeStartedAt = Date.parse(value.segments[0].startedAt) + 100_000;
      const segmentOffsets = [[0, 10_000], [20_000, 30_000], [40_000, 50_000], [60_000, 80_000]];
      const gapOffsets = [[10_000, 20_000], [30_000, 40_000], [50_000, 60_000]];
      value.segments.forEach((segment, index) => {
        segment.startedAt = new Date(routeStartedAt + segmentOffsets[index][0]).toISOString();
        segment.completedAt = new Date(routeStartedAt + segmentOffsets[index][1]).toISOString();
        if (summaryName === "console") {
          segment.entries = index === 0 ? [{
            sequence: 1,
            timestamp: new Date(routeStartedAt + 1_000).toISOString(),
            source: "console",
            level: "info",
            text: "Generic sliced capture.",
          }] : [];
        }
      });
      value.gaps.forEach((gap, index) => {
        gap.startedAt = new Date(routeStartedAt + gapOffsets[index][0]).toISOString();
        gap.completedAt = new Date(routeStartedAt + gapOffsets[index][1]).toISOString();
        if (summaryName === "network") {
          gap.navigationRequests[0].timestamp =
            new Date(routeStartedAt + gapOffsets[index][0] + 1_000).toISOString();
        }
      });
    }, /full run|prefix|suffix|timeline|evidence capture/],
  ]) {
    const fixture = createFixture();
    try {
      mutateStructuredTimelines(fixture, mutate);
      await assertFileInvalid(fixture, pattern);
    } finally {
      fixture.cleanup();
    }
  }
  for (const [location, offsetMs] of [
    ["gap", 125_000],
    ["outside", 541_000],
  ]) {
    const fixture = createFixture();
    try {
      const entry = fixture.evidence.observations
        .flatMap(({ evidence }) => evidence)[12];
      entry.capturedAt =
        new Date(Date.parse(fixture.evidence.runStartedAt) + offsetMs).toISOString();
      entry.completedAt =
        new Date(Date.parse(entry.capturedAt) + entry.durationMs).toISOString();
      await assertFileInvalid(
        fixture,
        /capture window|measured interaction segment|outside the run|canonical manifest order/,
      );
    } finally {
      fixture.cleanup();
    }
  }
  for (const [summaryName, startedAt, completedAt] of [
    ["console", 450_000, 451_000],
    ["network", 538_000, 539_000],
  ]) {
    const fixture = createFixture();
    try {
      const runStartedAt = Date.parse(fixture.evidence.runStartedAt);
      rewriteStructuredCaptureWindow(
        fixture,
        summaryName,
        new Date(runStartedAt + startedAt).toISOString(),
        new Date(runStartedAt + completedAt).toISOString(),
      );
      await assertFileInvalid(
        fixture,
        /derived capture|runCompletedAt|post-run|packaging|order/,
      );
    } finally {
      fixture.cleanup();
    }
  }
  {
    const fixture = createFixture();
    try {
      const packagedCompletedAt = Date.parse(fixture.evidence.packagedCompletedAt);
      rewriteStructuredCaptureWindow(
        fixture,
        "network",
        new Date(packagedCompletedAt + 1_000).toISOString(),
        new Date(packagedCompletedAt + 2_000).toISOString(),
      );
      await assertFileInvalid(fixture, /packaging|derived capture|order/);
    } finally {
      fixture.cleanup();
    }
  }
});

test("raw storage values, base64 payloads, and foreign key inventories are rejected", async () => {
  for (const mutate of [
    (value) => { value.worlds[0].keys[0].rawValue = "{\"inventory\":\"secret\"}"; },
    (value) => { value.worlds[0].keys[0].sha256 = Buffer.from("raw save").toString("base64"); },
    (value) => { value.localStorageKeys = ["unrelated.origin.secret"]; },
    (value) => { value.worlds[0].keys[0].name = "foreign.origin.secret"; },
    (value) => { value.worlds[0].markers.inventoryPersisted = false; },
  ]) {
    const fixture = createFixture();
    try {
      const summary = fixture.evidence.storage;
      const value = JSON.parse(readFileSync(join(fixture.root, summary.evidencePath), "utf8"));
      mutate(value);
      replaceBoundJson(fixture, summary, value);
      await assertFileInvalid(fixture, /storage|keys|SHA-256|markers/);
    } finally {
      fixture.cleanup();
    }
  }
});

test("Lakebed reports are parsed and hashes, format, target, and independent A/B files are recomputed", async () => {
  for (const mutate of [
    (fixture) => { fixture.evidence.artifact.artifactHash = `sha256:${"d".repeat(64)}`; },
    (fixture) => { fixture.evidence.artifact.format = "foreign.artifact.v9"; },
    (fixture) => { fixture.evidence.artifact.deployTarget = "claimed-production"; },
    (fixture) => {
      fixture.evidence.artifact.pairedArtifactPath = fixture.evidence.artifact.artifactPath;
    },
    (fixture) => {
      const path = join(fixture.root, fixture.evidence.artifact.pairedArtifactPath);
      const value = JSON.parse(readFileSync(path, "utf8"));
      value.clientBundle = Buffer.from("different client").toString("base64");
      writeFileSync(path, `${JSON.stringify(value)}\n`);
    },
    (fixture) => rewriteArtifactMetadataPair(fixture, (metadata) => {
      delete metadata.serverBundleHash;
    }),
    (fixture) => rewriteArtifactMetadataPair(fixture, (metadata) => {
      metadata.sourceSnapshotHash = `sha256:${"d".repeat(64)}`;
    }),
    (fixture) => rewriteArtifactMetadataPair(fixture, (metadata) => {
      metadata.artifactFileSha256 = "d".repeat(64);
    }),
    (fixture) => {
      const oldStage = Buffer.from("/* staged from a different commit */\n");
      const artifact = fixture.evidence.artifact;
      artifact.stagedClientSha256 = write(fixture.root, artifact.stagedClientPath, oldStage);
      write(fixture.root, artifact.pairedStagedClientPath, oldStage);
    },
    (fixture) => {
      const artifact = fixture.evidence.artifact;
      artifact.capturedAt =
        new Date(Date.parse(fixture.evidence.runCompletedAt) - 1_000).toISOString();
      artifact.completedAt = fixture.evidence.runCompletedAt;
    },
    (fixture) => {
      const artifact = fixture.evidence.artifact;
      artifact.pairedCapturedAt = artifact.capturedAt;
      artifact.pairedCompletedAt = artifact.completedAt;
    },
    (fixture) => {
      const artifact = fixture.evidence.artifact;
      artifact.pairedCompletedAt =
        new Date(Date.parse(fixture.evidence.packagedCompletedAt) + 1_000).toISOString();
    },
  ]) {
    const fixture = createFixture();
    try {
      mutate(fixture);
      await assertFileInvalid(
        fixture,
        /artifact|anonymous|paired|hash|A\/B|distinct|SHA-256|descriptor|source\.files|expected-commit|stage|derived capture|packaging|order/,
      );
    } finally {
      fixture.cleanup();
    }
  }
});

test("passed multiplayer requires two active reciprocal identities and bidirectional proof", async () => {
  for (const [mutate, pattern] of [
    [(value) => { value.multiplayer.identities.pop(); }, /multiplayer|identity/],
    [(value) => {
      value.multiplayer.identities[1].runSaltedIdentityHash =
        value.multiplayer.identities[0].runSaltedIdentityHash;
    }, /salted|identity|distinct/],
    [(value) => {
      value.multiplayer.identities[1].runSaltedIdentityHash = `sha256:${"d".repeat(64)}`;
    }, /salted|identity/],
    [(value) => {
      value.multiplayer.identities[1].windowStartedAt =
        new Date(Date.parse(value.multiplayer.identities[0].windowCompletedAt) + 1_000).toISOString();
      value.multiplayer.identities[1].windowCompletedAt =
        new Date(Date.parse(value.multiplayer.identities[1].windowStartedAt) + 120_000).toISOString();
    }, /overlap|window/],
    [(value) => {
      value.multiplayer.identities[1].proofPath = value.multiplayer.identities[0].proofPath;
      value.multiplayer.identities[1].proofSha256 = value.multiplayer.identities[0].proofSha256;
    }, /reuses|path|identity/],
    [(value) => { value.multiplayer.interactions.pop(); }, /multiplayer|interaction/],
    [(value) => {
      value.multiplayer.interactions[1].actorId = "identity-a";
      value.multiplayer.interactions[1].targetId = "identity-b";
    }, /direction|interaction/],
  ]) {
    const fixture = createFixture();
    try {
      const candidate = clone(fixture.evidence);
      mutate(candidate);
      assert.throws(
        () => validateTask41Evidence(candidate, { expectedCommit: COMMIT, nowMs: fixture.nowMs }),
        pattern,
      );
    } finally {
      fixture.cleanup();
    }
  }
  for (const [recordName, mutate, pattern] of [
    ["identities", (value) => { value.peerVisibilityIds = []; }, /peerVisibility|peer/],
    ["identities", (value) => { value.quotaTelemetry[1].paused = true; }, /paused|quota|active/],
    ["identities", (value) => {
      value.quotaTelemetry[1].attempts = 11;
      value.quotaTelemetry[1].grants = 10;
    }, /quota|grants/],
    ["identities", (value) => {
      value.quotaTelemetry.forEach((item) => {
        item.attempts = 0;
        item.grants = 0;
      });
    }, /positive|quota|attempt|grant/],
    ["interactions", (value) => { value.events.pop(); }, /interaction|bidirectional|every/],
    ["interactions", (value) => { value.events[0].status = "fail"; }, /interaction|pass/],
    ["identities", (value, fixture) => {
      const identity = fixture.evidence.multiplayer.identities[0];
      identity.windowStartedAt =
        new Date(Date.parse(fixture.evidence.runStartedAt) + 350_000).toISOString();
      value.windowStartedAt = identity.windowStartedAt;
      value.capturedAt =
        new Date(Date.parse(fixture.evidence.runStartedAt) + 385_000).toISOString();
    }, /measured interaction segment/],
    ["identities", (value, fixture) => {
      value.capturedAt =
        new Date(Date.parse(fixture.evidence.runCompletedAt) + 1_000).toISOString();
    }, /identity session|measured interaction segment|outside/],
    ["identities", (value, fixture) => {
      const identity = fixture.evidence.multiplayer.identities[0];
      const runStartedAt = Date.parse(fixture.evidence.runStartedAt);
      identity.windowStartedAt = new Date(runStartedAt + 370_000).toISOString();
      value.windowStartedAt = identity.windowStartedAt;
      assert.equal(value.windowStartedAt, identity.windowStartedAt);
      assert.ok(Date.parse(value.capturedAt) >= runStartedAt + 390_000);
      assert.ok(value.quotaTelemetry.every(({ timestamp }) =>
        Date.parse(timestamp) >= runStartedAt + 390_000));
    }, /identity session.*wholly within one measured interaction segment/],
    ["interactions", (value, fixture) => {
      const runStartedAt = Date.parse(fixture.evidence.runStartedAt);
      value.windowStartedAt = new Date(runStartedAt + 370_000).toISOString();
      assert.ok(Date.parse(value.capturedAt) >= runStartedAt + 390_000);
      assert.ok(value.events.every(({ timestamp }) =>
        Date.parse(timestamp) >= runStartedAt + 390_000));
    }, /interaction window.*wholly within one measured interaction segment|overlapping session/],
  ]) {
    const fixture = createFixture();
    try {
      const record = fixture.evidence.multiplayer[recordName][0];
      const value = JSON.parse(readFileSync(join(fixture.root, record.proofPath), "utf8"));
      mutate(value, fixture);
      record.proofSha256 = write(
        fixture.root,
        record.proofPath,
        `${JSON.stringify(value)}\n`,
      );
      const multiplayerCapture = JSON.parse(readFileSync(
        join(fixture.root, fixture.evidence.multiplayer.evidencePath),
        "utf8",
      ));
      multiplayerCapture[recordName][0] = clone(record);
      replaceBoundJson(fixture, fixture.evidence.multiplayer, multiplayerCapture);
      await assertFileInvalid(fixture, pattern);
    } finally {
      fixture.cleanup();
    }
  }
});

test("deferred multiplayer remains valid-partial and cannot claim completion", () => {
  const deferred = createFixture({ multiplayerStatus: "deferred" });
  try {
    const template = createTask41EvidenceTemplate();
    const raw = JSON.parse(readFileSync(
      join(deferred.root, deferred.evidence.multiplayer.evidencePath),
      "utf8",
    ));
    assert.deepEqual(
      template.multiplayer.reasonCodes,
      [...TASK41_MULTIPLAYER_DEFERRED_REASONS],
    );
    assert.deepEqual(
      deferred.evidence.multiplayer.reasonCodes,
      [...TASK41_MULTIPLAYER_DEFERRED_REASONS],
    );
    assert.deepEqual(raw.reasonCodes, [...TASK41_MULTIPLAYER_DEFERRED_REASONS]);

    const falseComplete = clone(deferred.evidence);
    falseComplete.completionEligible = true;
    assert.throws(
      () => validateTask41Evidence(falseComplete, { expectedCommit: COMMIT, nowMs: deferred.nowMs }),
      /completionEligible|deferred/,
    );
    const invalidReasons = [
      ...TASK41_MULTIPLAYER_DEFERRED_REASONS.map((omitted) =>
        TASK41_MULTIPLAYER_DEFERRED_REASONS.filter((reason) => reason !== omitted)),
      [TASK41_MULTIPLAYER_DEFERRED_REASONS[0]],
      [...TASK41_MULTIPLAYER_DEFERRED_REASONS].reverse(),
      [...TASK41_MULTIPLAYER_DEFERRED_REASONS, "unapproved-deferral"],
    ];
    invalidReasons.forEach((reasonCodes) => {
      const candidate = clone(deferred.evidence);
      candidate.multiplayer.reasonCodes = reasonCodes;
      assert.throws(
        () => validateTask41Evidence(candidate, {
          expectedCommit: COMMIT,
          nowMs: deferred.nowMs,
        }),
        /reasonCodes|reason|deferred/,
      );
    });
  } finally {
    deferred.cleanup();
  }
});

test("browser probe binds raw frame captures to this run and restores WebGL prototypes", () => {
  class WebGLRenderingContext {
    drawArrays(...args) {
      return ["webgl-arrays", ...args];
    }

    drawElements(...args) {
      return ["webgl-elements", ...args];
    }
  }
  class WebGL2RenderingContext {
    drawArrays(...args) {
      return ["webgl2-arrays", ...args];
    }

    drawElements(...args) {
      return ["webgl2-elements", ...args];
    }
  }
  const originals = {
    webglArrays: WebGLRenderingContext.prototype.drawArrays,
    webglElements: WebGLRenderingContext.prototype.drawElements,
    webgl2Arrays: WebGL2RenderingContext.prototype.drawArrays,
    webgl2Elements: WebGL2RenderingContext.prototype.drawElements,
  };
  let nextAnimationFrame = 1;
  const callbacks = new Map();
  const messages = [];
  let focused = true;
  const document = {
    visibilityState: "visible",
    hasFocus: () => focused,
  };
  const window = {
    WebGLRenderingContext,
    WebGL2RenderingContext,
    innerWidth: 1280,
    innerHeight: 720,
    devicePixelRatio: 1,
    document,
    console: { info: (...args) => messages.push(args) },
    requestAnimationFrame(callback) {
      const id = nextAnimationFrame;
      nextAnimationFrame += 1;
      callbacks.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      callbacks.delete(id);
    },
  };

  runInNewContext(probeSource, { window });
  const probe = window.__lakecraftTask41Probe;
  assert.ok(probe);
  assert.equal(messages.length, 1);
  assert.throws(() => probe.snapshot("desktop/surface-day", 1), /bind|run/i);
  assert.throws(
    () => probe.bind({ runId: "not-a-run-id", appCommit: COMMIT }),
    /runId|128 bits/i,
  );
  probe.bind({ runId: RUN_ID, appCommit: COMMIT });
  assert.throws(() => probe.snapshot("desktop/surface-day", 1), /reset|capture/i);
  document.visibilityState = "hidden";
  assert.throws(() => probe.reset(), /visible|hidden/i);
  document.visibilityState = "visible";
  focused = false;
  assert.throws(() => probe.reset(), /focus/i);
  focused = true;
  probe.reset();
  const tick = (now) => {
    const [id, callback] = callbacks.entries().next().value;
    callbacks.delete(id);
    callback(now);
  };
  tick(0);
  const gl = new WebGLRenderingContext();
  const gl2 = new WebGL2RenderingContext();
  for (let frame = 1; frame <= 130; frame += 1) {
    assert.deepEqual(gl.drawArrays(4, 0, 3), ["webgl-arrays", 4, 0, 3]);
    assert.deepEqual(gl2.drawElements(4, 6, 5123, 0), ["webgl2-elements", 4, 6, 5123, 0]);
    tick(frame * 16);
  }
  assert.throws(() => probe.snapshot("wide/surface-day", 1), /label|viewport/i);
  assert.throws(() => probe.snapshot("narrow/surface-day", 1), /viewport|800/i);
  document.visibilityState = "hidden";
  assert.throws(() => probe.snapshot("desktop/surface-day", 1), /visible|hidden/i);
  document.visibilityState = "visible";
  focused = false;
  assert.throws(() => probe.snapshot("desktop/surface-day", 1), /focus/i);
  focused = true;
  window.devicePixelRatio = 2;
  assert.throws(() => probe.snapshot("desktop/surface-day", 1), /DPR|pixel/i);
  window.devicePixelRatio = 1;
  window.innerWidth = 1279;
  assert.throws(() => probe.snapshot("desktop/surface-day", 1), /viewport|1280/i);
  window.innerWidth = 1280;
  const capture = probe.snapshot("desktop/surface-day", 1);
  assert.equal(capture.schemaVersion, 2);
  assert.equal(capture.taskId, TASK41_TASK_ID);
  assert.equal(capture.runId, RUN_ID);
  assert.equal(capture.appCommit, COMMIT);
  assert.match(capture.capturedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  assert.match(capture.completedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  assert.ok(Date.parse(capture.completedAt) >= Date.parse(capture.capturedAt));
  assert.equal(capture.sequence, 1);
  assert.equal(capture.label, "desktop/surface-day");
  assert.equal(capture.viewport, "desktop");
  assert.equal(capture.devicePixelRatio, 1);
  assert.equal(capture.patchedContexts, 2);
  assert.equal(capture.frames.length, 130);
  const { timestamp: firstFrameTimestamp, ...firstFrame } = { ...capture.frames[0] };
  assert.match(firstFrameTimestamp, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  assert.ok(Date.parse(firstFrameTimestamp) >= Date.parse(capture.capturedAt));
  assert.ok(Date.parse(firstFrameTimestamp) <= Date.parse(capture.completedAt));
  assert.deepEqual(
    firstFrame,
    {
      sequence: 1,
      frameMs: 16,
      drawCalls: 2,
      visible: true,
      hasFocus: true,
      viewport: "desktop",
      devicePixelRatio: 1,
    },
  );
  assert.equal(capture.frames.at(-1).sequence, 130);
  assert.deepEqual(
    { ...probe.summarize(capture) },
    {
      sampleCount: 130,
      fps: 62.5,
      p95FrameMs: 16,
      drawCallsPerFrameP95: 2,
      drawCallsPerFrameMax: 2,
      totalDrawCalls: 260,
      durationMs: 2_080,
      patchedContexts: 2,
    },
  );
  assert.throws(() => probe.snapshot("desktop/surface-day", 1), /sequence|duplicate/i);
  probe.reset();
  const resetCapture = probe.snapshot("desktop/surface-day", 2);
  assert.equal(resetCapture.frames.length, 0);
  assert.equal(probe.summarize(resetCapture).sampleCount, 0);
  assert.equal(probe.summarize(resetCapture).totalDrawCalls, 0);
  probe.stop();
  assert.equal(window.__lakecraftTask41Probe, undefined);
  assert.equal(WebGLRenderingContext.prototype.drawArrays, originals.webglArrays);
  assert.equal(WebGLRenderingContext.prototype.drawElements, originals.webglElements);
  assert.equal(WebGL2RenderingContext.prototype.drawArrays, originals.webgl2Arrays);
  assert.equal(WebGL2RenderingContext.prototype.drawElements, originals.webgl2Elements);
  assert.equal(callbacks.size, 0);
});
