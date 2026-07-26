import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
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
import { runInNewContext } from "node:vm";
import { deflateSync } from "node:zlib";

import {
  TASK41_CASES,
  TASK41_CASES_END,
  TASK41_CASES_START,
  TASK41_MULTIPLAYER_CHECKS,
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
const runbook = readFileSync(new URL("../docs/live-visual-qa.md", import.meta.url), "utf8");
const probeSource = readFileSync(new URL("../scripts/task41-browser-probe.js", import.meta.url), "utf8");
const COMMIT = "b".repeat(40);
const RUN_ID = "c".repeat(32);
const MAXIMUM_BYTES = 1_048_576;
const MINIMUM_HEADROOM_BYTES = 32_768;

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

function makeWebm(width, height, durationMs, tag) {
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

function makeMp4(width, height, durationMs, tag) {
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

function createFixture({ multiplayerStatus = "passed", nowMs = Date.now() } = {}) {
  const root = mkdtempSync(join(tmpdir(), "lakecraft-task41-evidence-"));
  const evidence = createTask41EvidenceTemplate();
  const runStartedAtMs = nowMs - 10 * 60_000;
  const runCompletedAtMs = nowMs - 60_000;
  const runStartedAt = new Date(runStartedAtMs).toISOString();
  const runCompletedAt = new Date(runCompletedAtMs).toISOString();
  let sequence = 0;
  const nextBinding = () => {
    sequence += 1;
    return {
      taskId: TASK41_TASK_ID,
      runId: RUN_ID,
      appCommit: COMMIT,
      capturedAt: new Date(runStartedAtMs + sequence * 1_000).toISOString(),
      sequence,
    };
  };
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
      const binding = nextBinding();
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
        const buffer = mp4
          ? makeMp4(viewport.width, viewport.height, 5_000, slug)
          : makeWebm(viewport.width, viewport.height, 5_000, slug);
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
          at: new Date(runStartedAtMs + sequence * 1_000 + actionIndex + 1).toISOString(),
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
    const binding = nextBinding();
    const frames = Array.from({ length: 320 }, () => ({ frameMs: 16, drawCalls: 2 }));
    const path = `performance/${metric.viewport}-${metric.scene}.json`;
    const capture = {
      schemaVersion: 2,
      ...binding,
      label: `${metric.viewport}/${metric.scene}`,
      patchedContexts: 2,
      frames,
    };
    Object.assign(metric, {
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
    const binding = nextBinding();
    const path = "structured/console.json";
    const capture = writeBoundJson(path, binding, {
      entries: [{
        sequence: 1,
        timestamp: binding.capturedAt,
        source: "console",
        level: "info",
        text: "Task 41 browser probe installed.",
      }],
    });
    evidence.console = {
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
    const binding = nextBinding();
    const path = "structured/network.json";
    const capture = writeBoundJson(path, binding, { events: [] });
    evidence.network = {
      requestCount: 0,
      websocketCount: 0,
      lakebedRequestCount: 0,
      evidencePath: path,
      evidenceSha256: capture.sha256,
      ...binding,
    };
  }
  {
    const binding = nextBinding();
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
    const binding = nextBinding();
    const path = "structured/multiplayer.json";
    const passed = multiplayerStatus === "passed";
    const fields = {
      status: passed ? "passed" : "deferred",
      completionEligible: passed,
      hostedRoute: passed ? "enabled" : "disabled",
      identities: passed ? "available" : "unavailable",
      identityHashes: passed ? [`sha256:${digest("identity-a")}`, `sha256:${digest("identity-b")}`] : [],
      reasonCodes: passed ? [] : [
        "hosted-route-disabled",
        "authorized-identities-unavailable",
        "quota-observation-unavailable",
      ],
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
      identityHashes: fields.identityHashes,
      reasonCodes: fields.reasonCodes,
      quotaStatus: fields.quotaStatus,
      quotaObserved: fields.quotaObserved,
      evidencePath: path,
      evidenceSha256: capture.sha256,
      ...binding,
    };
  }

  {
    const buildA = nextBinding();
    const buildB = nextBinding();
    const client = Buffer.from("export default function LakecraftClient() { return 'task41'; }\n");
    const clientBundleHash = `sha256:${digest(client)}`;
    const artifactObject = {
      format: "lakebed.capsule.artifact.v1",
      deployTarget: "anonymous-source",
      client: { bytes: client.length, bundleHash: clientBundleHash },
      server: { bytes: 42 },
    };
    const artifactHash = `sha256:${digest(Buffer.from(JSON.stringify(artifactObject)))}`;
    const outer = {
      artifact: artifactObject,
      artifactHash,
      clientBundle: client.toString("base64"),
      clientBundleHash,
      mediaType: "application/vnd.lakebed.artifact+json",
    };
    const artifactBuffer = Buffer.from(`${JSON.stringify(outer)}\n`);
    const artifactFileSha256 = write(root, "build/a/capsule.anonymous.json", artifactBuffer);
    write(root, "build/b/capsule.anonymous.json", artifactBuffer);
    const reportA = {
      artifactHash,
      artifactPath: "build/a/capsule.anonymous.json",
      clientBundleHash,
      format: "lakebed.capsule.artifact.v1",
    };
    const reportB = {
      ...reportA,
      artifactPath: "build/b/capsule.anonymous.json",
    };
    const reportSha256 = write(root, "build/a/report.json", `${JSON.stringify(reportA)}\n`);
    const pairedReportSha256 = write(root, "build/b/report.json", `${JSON.stringify(reportB)}\n`);
    const stagedClientSha256 = write(root, "build/a/client/index.tsx", client);
    write(root, "build/b/client/index.tsx", client);
    const server = Buffer.from("export const schema = {};\n");
    const stagedServerSha256 = write(root, "build/a/server/index.ts", server);
    write(root, "build/b/server/index.ts", server);
    evidence.artifact = {
      format: "lakebed.capsule.artifact.v1",
      deployTarget: "anonymous-source",
      reportPath: "build/a/report.json",
      reportSha256,
      pairedReportPath: "build/b/report.json",
      pairedReportSha256,
      artifactPath: "build/a/capsule.anonymous.json",
      pairedArtifactPath: "build/b/capsule.anonymous.json",
      artifactBytes: artifactBuffer.length,
      maximumBytes: MAXIMUM_BYTES,
      headroomBytes: MAXIMUM_BYTES - artifactBuffer.length,
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

test("runbook exposes one canonical template command and the ordered case ledger", () => {
  assert.equal(extractTask41TemplateCommand(runbook), TASK41_TEMPLATE_COMMAND);
  assert.deepEqual(extractTask41RunbookCases(runbook), TASK41_CASES.map(({ id }) => id));
  assert.equal(TASK41_CASES.length, 18);
  assert.deepEqual(Object.values(TASK41_VIEWPORTS), [
    { width: 1280, height: 720 },
    { width: 800, height: 720 },
  ]);
  assert.equal(TASK41_PERFORMANCE_SCENES.length, 6);
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
  assert.match(runbook, /\*\*Play World\*\*/);
  assert.doesNotMatch(runbook, /Play Selected World/);
  assert.doesNotMatch(runbook, /copy all keys/i);
  assert.doesNotMatch(runbook, /localStorage\.key\(\)|Object\.keys\(localStorage\)/);
  assert.match(
    runbook,
    /Never[\s\S]{0,180}browser-storage enumeration\s+APIs[\s\S]{0,100}copy a storage prefix[\s\S]{0,100}foreign origin data/i,
  );
  assert.match(runbook, /Never record or export a raw localStorage value/i);
  assert.match(runbook, /--expected-commit "\$expected_commit"/);
  assert.match(runbook, /valid-partial[\s\S]{0,100}process exit 2/i);
  assert.match(
    runbook,
    /dev-server WebSocket[\s\S]{0,160}before\s+the\s+boundary[\s\S]{0,160}does not invalidate/i,
  );
});

test("a complete, freshly bound manifest with substantive generated files verifies", async () => {
  const fixture = createFixture();
  try {
    assert.equal(
      validateTask41Evidence(fixture.evidence, { expectedCommit: COMMIT, nowMs: fixture.nowMs }),
      fixture.evidence,
    );
    await verifyTask41EvidenceFiles(fixture.evidence, fixture.root, {
      expectedCommit: COMMIT,
      nowMs: fixture.nowMs,
    });
  } finally {
    fixture.cleanup();
  }
});

test("the CLI returns exit 0 only for complete proof and exit 2 for valid deferred multiplayer proof", () => {
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
    }, /stale/);
    invalid((value) => {
      value.runStartedAt = new Date(fixture.nowMs + 6 * 60_000).toISOString();
      value.runCompletedAt = new Date(fixture.nowMs + 16 * 60_000).toISOString();
    }, /future/);
    invalid((value) => {
      const first = value.observations[0].evidence[0];
      const second = value.observations[0].evidence[1];
      [first.sequence, second.sequence] = [second.sequence, first.sequence];
    }, /sequence|order/);
  } finally {
    fixture.cleanup();
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
  ]) {
    const fixture = createFixture();
    try {
      const entry = fixture.evidence.observations
        .flatMap(({ evidence }) => evidence)
        .find(({ kind }) => kind === "transcript");
      const value = JSON.parse(readFileSync(join(fixture.root, entry.path), "utf8"));
      mutate(value);
      replaceEntryFile(fixture, entry, Buffer.from(`${JSON.stringify(value)}\n`));
      await assertFileInvalid(fixture, /transcript|actions|timestamps|ordered/);
    } finally {
      fixture.cleanup();
    }
  }
});

test("console and CDP network summaries must exactly recompute clean zero-traffic counts", async () => {
  for (const [summaryName, mutate, pattern] of [
    ["console", (value) => value.entries.push({
      sequence: 2,
      timestamp: value.capturedAt,
      source: "cdp",
      level: "warning",
      text: "warning",
    }), /console|counts/],
    ["console", (value) => value.entries.push({
      sequence: 2,
      timestamp: value.capturedAt,
      source: "cdp",
      level: "error",
      text: "error",
    }), /console|counts/],
    ["network", (value) => value.events.push({
      sequence: 1,
      timestamp: value.capturedAt,
      type: "request",
      url: "https://craft.lakebed.app/query",
    }), /request|counts|network/],
    ["network", (value) => value.events.push({
      sequence: 1,
      timestamp: value.capturedAt,
      type: "websocket",
      url: "wss://craft.lakebed.app/socket",
    }), /request|counts|network/],
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
  ]) {
    const fixture = createFixture();
    try {
      mutate(fixture);
      await assertFileInvalid(fixture, /artifact|anonymous|paired|hash|A\/B|distinct|SHA-256/);
    } finally {
      fixture.cleanup();
    }
  }
});

test("multiplayer completion requires two distinct sanitized identities and deferred proof cannot claim completion", () => {
  const fixture = createFixture();
  try {
    const sameIdentity = clone(fixture.evidence);
    sameIdentity.multiplayer.identityHashes[1] = sameIdentity.multiplayer.identityHashes[0];
    assert.throws(
      () => validateTask41Evidence(sameIdentity, { expectedCommit: COMMIT, nowMs: fixture.nowMs }),
      /distinct|identit/,
    );
  } finally {
    fixture.cleanup();
  }
  const deferred = createFixture({ multiplayerStatus: "deferred" });
  try {
    const falseComplete = clone(deferred.evidence);
    falseComplete.completionEligible = true;
    assert.throws(
      () => validateTask41Evidence(falseComplete, { expectedCommit: COMMIT, nowMs: deferred.nowMs }),
      /completionEligible|deferred/,
    );
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
  const window = {
    WebGLRenderingContext,
    WebGL2RenderingContext,
    innerWidth: 1280,
    innerHeight: 720,
    devicePixelRatio: 1,
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
  const capture = probe.snapshot("desktop/surface-day", 1);
  assert.equal(capture.schemaVersion, 2);
  assert.equal(capture.taskId, TASK41_TASK_ID);
  assert.equal(capture.runId, RUN_ID);
  assert.equal(capture.appCommit, COMMIT);
  assert.match(capture.capturedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  assert.equal(capture.sequence, 1);
  assert.equal(capture.label, "desktop/surface-day");
  assert.equal(capture.patchedContexts, 2);
  assert.equal(capture.frames.length, 130);
  assert.deepEqual({ ...capture.frames[0] }, { frameMs: 16, drawCalls: 2 });
  assert.deepEqual({ ...capture.frames.at(-1) }, { frameMs: 16, drawCalls: 2 });
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
