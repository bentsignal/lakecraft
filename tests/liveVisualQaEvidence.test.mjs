import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";

import {
  TASK41_CASES,
  TASK41_CASES_END,
  TASK41_CASES_START,
  TASK41_PERFORMANCE_SCENES,
  TASK41_TEMPLATE_COMMAND,
  TASK41_TEMPLATE_END,
  TASK41_TEMPLATE_START,
  TASK41_VIEWPORTS,
  createTask41EvidenceTemplate,
  extractTask41RunbookCases,
  extractTask41TemplateCommand,
  validateTask41Evidence,
  verifyTask41EvidenceFiles,
} from "../scripts/validate-live-qa-evidence.mjs";

const repositoryRoot = new URL("../", import.meta.url);
const runbook = readFileSync(new URL("../docs/live-visual-qa.md", import.meta.url), "utf8");
const probeSource = readFileSync(new URL("../scripts/task41-browser-probe.js", import.meta.url), "utf8");
const SHA = "a".repeat(64);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function completedEvidence() {
  const evidence = createTask41EvidenceTemplate();
  evidence.appCommit = "b".repeat(40);
  evidence.runStartedAt = "2026-07-25T18:00:00.000Z";
  evidence.runCompletedAt = "2026-07-25T19:00:00.000Z";
  evidence.browser = { name: "Chromium", version: "140.0.7339.0" };
  evidence.worlds.forEach((world, index) => {
    world.worldId = `qa-world-${index + 1}`;
    world.editMarker = `edit-${index + 1}`;
    world.inventoryMarker = `inventory-${index + 1}`;
    world.containerMarker = `container-${index + 1}`;
  });
  evidence.observations.forEach((observation) => {
    observation.status = "pass";
    observation.notes = `Observed ${observation.id}.`;
    observation.evidence.forEach((item) => {
      item.path = "evidence/shared.txt";
      item.sha256 = SHA;
    });
  });
  evidence.performance.forEach((metric) => {
    Object.assign(metric, {
      sampleCount: 300,
      fps: 60,
      p95FrameMs: 16.667,
      drawCallsPerFrameP95: 12,
      drawCallsPerFrameMax: 14,
      totalDrawCalls: 3_600,
      durationMs: 5_000,
      patchedContexts: 2,
      evidencePath: "evidence/performance.json",
      evidenceSha256: SHA,
    });
  });
  evidence.console = {
    errorCount: 0,
    warningCount: 0,
    evidencePath: "evidence/console.log",
    evidenceSha256: SHA,
  };
  evidence.network = {
    lakebedRequestCount: 0,
    totalRequestCount: 0,
    evidencePath: "evidence/network.har",
    evidenceSha256: SHA,
  };
  evidence.artifact = {
    artifactPath: "artifacts/a.json",
    pairedArtifactPath: "artifacts/b.json",
    artifactBytes: 999_936,
    maximumBytes: 1_048_576,
    headroomBytes: 48_640,
    minimumHeadroomBytes: 32_768,
    artifactHash: `sha256:${SHA}`,
    clientBundleHash: `sha256:${SHA}`,
    pairedArtifactsEqual: true,
    artifactFileSha256: SHA,
    stagedClientPath: "stage-a/client/index.tsx",
    pairedStagedClientPath: "stage-b/client/index.tsx",
    stagedClientSha256: SHA,
    stagedServerPath: "stage-a/server/index.ts",
    pairedStagedServerPath: "stage-b/server/index.ts",
    stagedServerSha256: SHA,
    evidencePath: "evidence/build.json",
    evidenceSha256: SHA,
  };
  return evidence;
}

function mutateEvidence(mutator) {
  const evidence = completedEvidence();
  mutator(evidence);
  return evidence;
}

function assertInvalid(mutator, pattern) {
  assert.throws(() => validateTask41Evidence(mutateEvidence(mutator)), pattern);
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function write(root, path, value) {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, value);
  return digest(value);
}

test("runbook exposes one canonical template command and the ordered case ledger", () => {
  assert.equal(extractTask41TemplateCommand(runbook), TASK41_TEMPLATE_COMMAND);
  assert.deepEqual(
    extractTask41RunbookCases(runbook),
    TASK41_CASES.map(({ id }) => id),
  );
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
    () => extractTask41RunbookCases(runbook.replace(
      "| `world-create-search-select` |",
      "| `unknown-case` |",
    )),
    /must be exactly/,
  );
});

test("completed manifest validates only with the full strict contract", () => {
  assert.equal(validateTask41Evidence(completedEvidence()).observations.length, 18);

  assertInvalid((value) => value.observations.pop(), /every Task 41 case/);
  assertInvalid((value) => {
    value.observations[1].id = value.observations[0].id;
  }, /passing case/);
  assertInvalid((value) => {
    value.observations[0].status = "pending";
  }, /must be passing/);
  assertInvalid((value) => {
    value.observations[0].evidence.pop();
  }, /every required kind and viewport/);
  assertInvalid((value) => {
    value.observations[1].evidence[1].kind = "screenshot";
  }, /must be transcript evidence/);
  assertInvalid((value) => {
    value.observations[0].evidence[0].path = "../escape.png";
  }, /beneath the evidence root/);
  assertInvalid((value) => {
    value.worlds[1].worldId = value.worlds[0].worldId;
  }, /unique storage-safe ID/);
  assertInvalid((value) => {
    value.performance[0].sampleCount = 119;
  }, /allowed range/);
  assertInvalid((value) => {
    value.performance[0].fps = 44.99;
  }, /allowed range/);
  assertInvalid((value) => {
    value.performance[0].p95FrameMs = 33.401;
  }, /allowed range/);
  assertInvalid((value) => {
    value.console.warningCount = 1;
  }, /console must remain clean/);
  assertInvalid((value) => {
    value.network.totalRequestCount = 1;
  }, /zero requests/);
  assertInvalid((value) => {
    value.artifact.headroomBytes += 1;
  }, /reserve arithmetic/);
  assertInvalid((value) => {
    value.artifact.headroomBytes = 32_767;
    value.artifact.artifactBytes = 1_015_809;
  }, /allowed range/);
  assertInvalid((value) => {
    value.artifact.pairedArtifactsEqual = false;
  }, /must be identical/);
  assertInvalid((value) => {
    value.runCompletedAt = "2026-07-25T17:59:59.000Z";
  }, /cannot precede/);
  assertInvalid((value) => {
    value.unreviewed = true;
  }, /keys must be exactly/);
});

test("file verification checks every hash, an actually empty HAR, and byte-identical build pairs", async () => {
  const root = mkdtempSync(join(tmpdir(), "lakecraft-task41-evidence-"));
  try {
    const evidence = completedEvidence();
    const sharedHash = write(root, "evidence/shared.txt", "shared visual proof\n");
    const performanceSummaryHash = write(root, "evidence/performance-summary.json", "{}\n");
    const consoleHash = write(root, "evidence/console.log", "[probe installed]\n");
    const harHash = write(root, "evidence/network.har", '{"log":{"entries":[]}}\n');
    const buildHash = write(root, "evidence/build.json", '{"ok":true}\n');
    const artifactBytes = Buffer.alloc(128, 7);
    const artifactHash = write(root, "artifacts/a.json", artifactBytes);
    write(root, "artifacts/b.json", artifactBytes);
    const clientHash = write(root, "stage-a/client/index.tsx", "client-stage\n");
    write(root, "stage-b/client/index.tsx", "client-stage\n");
    const serverHash = write(root, "stage-a/server/index.ts", "server-stage\n");
    write(root, "stage-b/server/index.ts", "server-stage\n");

    for (const observation of evidence.observations) {
      for (const item of observation.evidence) {
        if (item.kind === "har") {
          item.path = "evidence/network.har";
          item.sha256 = harHash;
        } else if (item.kind === "console-log") {
          item.path = "evidence/console.log";
          item.sha256 = consoleHash;
        } else if (item.kind === "performance-json") {
          item.path = "evidence/performance-summary.json";
          item.sha256 = performanceSummaryHash;
        } else if (item.kind === "artifact-json") {
          item.path = "evidence/build.json";
          item.sha256 = buildHash;
        } else {
          item.path = "evidence/shared.txt";
          item.sha256 = sharedHash;
        }
      }
    }
    for (const metric of evidence.performance) {
      const snapshot = {
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
      metric.evidencePath = `evidence/performance/${metric.viewport}-${metric.scene}.json`;
      metric.evidenceSha256 = write(root, metric.evidencePath, `${JSON.stringify(snapshot)}\n`);
    }
    evidence.console.evidenceSha256 = consoleHash;
    evidence.network.evidenceSha256 = harHash;
    Object.assign(evidence.artifact, {
      artifactBytes: artifactBytes.length,
      headroomBytes: 1_048_576 - artifactBytes.length,
      artifactFileSha256: artifactHash,
      stagedClientSha256: clientHash,
      stagedServerSha256: serverHash,
      evidenceSha256: buildHash,
    });

    await verifyTask41EvidenceFiles(evidence, root);

    writeFileSync(join(root, "artifacts/b.json"), Buffer.alloc(128, 8));
    await assert.rejects(
      verifyTask41EvidenceFiles(evidence, root),
      /paired artifact bytes/,
    );
    writeFileSync(join(root, "artifacts/b.json"), artifactBytes);

    const firstMetric = evidence.performance[0];
    const mismatchedSnapshot = {
      schemaVersion: 1,
      label: `${firstMetric.viewport}/${firstMetric.scene}`,
      sampleCount: firstMetric.sampleCount,
      fps: firstMetric.fps + 1,
      p95FrameMs: firstMetric.p95FrameMs,
      drawCallsPerFrameP95: firstMetric.drawCallsPerFrameP95,
      drawCallsPerFrameMax: firstMetric.drawCallsPerFrameMax,
      totalDrawCalls: firstMetric.totalDrawCalls,
      durationMs: firstMetric.durationMs,
      patchedContexts: firstMetric.patchedContexts,
    };
    firstMetric.evidenceSha256 = write(
      root,
      firstMetric.evidencePath,
      `${JSON.stringify(mismatchedSnapshot)}\n`,
    );
    await assert.rejects(
      verifyTask41EvidenceFiles(evidence, root),
      /does not match its performance metric/,
    );
    mismatchedSnapshot.fps = firstMetric.fps;
    firstMetric.evidenceSha256 = write(
      root,
      firstMetric.evidencePath,
      `${JSON.stringify(mismatchedSnapshot)}\n`,
    );

    const nonemptyHar = '{"log":{"entries":[{"request":{"url":"https://example.invalid"}}]}}\n';
    const nonemptyHarHash = write(root, "evidence/network.har", nonemptyHar);
    evidence.network.evidenceSha256 = nonemptyHarHash;
    for (const observation of evidence.observations) {
      for (const item of observation.evidence) {
        if (item.kind === "har") item.sha256 = nonemptyHarHash;
      }
    }
    await assert.rejects(
      verifyTask41EvidenceFiles(evidence, root),
      /HAR entries do not match/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("browser probe delegates WebGL calls, samples deterministically, resets, and restores prototypes", () => {
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
  assert.deepEqual(
    { ...probe.snapshot("desktop/surface-day") },
    {
      schemaVersion: 1,
      label: "desktop/surface-day",
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

  probe.reset();
  assert.equal(probe.snapshot("reset").sampleCount, 0);
  assert.equal(probe.snapshot("reset").totalDrawCalls, 0);
  probe.stop();
  assert.equal(window.__lakecraftTask41Probe, undefined);
  assert.equal(WebGLRenderingContext.prototype.drawArrays, originals.webglArrays);
  assert.equal(WebGLRenderingContext.prototype.drawElements, originals.webglElements);
  assert.equal(WebGL2RenderingContext.prototype.drawArrays, originals.webgl2Arrays);
  assert.equal(WebGL2RenderingContext.prototype.drawElements, originals.webgl2Elements);
  assert.equal(callbacks.size, 0);
});
