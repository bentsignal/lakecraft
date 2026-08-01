import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  auditProductionDeploy,
  parseAuditArguments,
  validateProductionTarget,
} from "../scripts/audit-lakebed-production.mjs";

const target = {
  schemaVersion: 1,
  name: "lakecraft",
  deployId: "dep_GeGTYPSk0TrcWk9E",
  ownerId: "github:54612739",
  publicUrl: "https://craft.lakebed.app",
  canonicalUrl: "https://quiet-garden-75f6fe48fb.lakebed.app",
  minimumLimits: {
    artifactBytes: 1_048_576,
    stateBytes: 1_048_576,
    stateRows: 16_384,
    requestsPerDay: 10_000,
    mutationsPerDay: 1_000,
  },
  minimumRemaining: { requests: 1_000, mutations: 100 },
};

function deploy(overrides = {}) {
  return {
    artifactHash: "sha256:" + "a".repeat(64),
    archivedAt: null,
    claimedAt: "2026-07-15T00:40:25.756Z",
    clientBundleHash: "sha256:" + "b".repeat(64),
    createdAt: "2026-07-14T11:03:24.680Z",
    deployId: target.deployId,
    expiresAt: null,
    inspectPolicy: "private",
    limits: {
      artifactBytes: 1_048_576,
      stateBytes: 1_048_576,
      stateRows: 16_384,
      requestsPerDay: 10_000,
      mutationsPerDay: 1_000,
    },
    name: "lakecraft",
    ownerId: "github:54612739",
    status: "active",
    updatedAt: "2026-07-17T01:21:03.988Z",
    url: target.canonicalUrl,
    usage: { mutationsToday: 20, requestsToday: 400 },
    ...overrides,
  };
}

test("valid production control-plane state yields an exact sanitized report", () => {
  const report = auditProductionDeploy(
    { deploys: [deploy()], user: { token: "must-not-leak" } },
    target,
    { capturedAt: "2026-07-26T12:00:00.000Z", expectedArtifactHash: "sha256:" + "a".repeat(64) },
  );
  assert.equal(report.ok, true);
  assert.deepEqual(report.failures, []);
  assert.equal(report.quota.requestsRemaining, 9_600);
  assert.equal(report.quota.mutationsRemaining, 980);
  assert.equal(report.target.configuredPublicUrl, target.publicUrl);
  assert.equal(report.target.observedCanonicalUrl, target.canonicalUrl);
  assert.equal(report.release.expiresAt, null);
  assert.equal(JSON.stringify(report).includes("must-not-leak"), false);
  assert.equal(Object.isFrozen(report), true);
});

test("identity is singular and structurally bound to checked-in configuration", () => {
  assert.throws(() => auditProductionDeploy({ deploys: [] }, target), /exactly one/);
  assert.throws(
    () => auditProductionDeploy({ deploys: [deploy(), deploy()] }, target),
    /unique/,
  );
  assert.throws(
    () => validateProductionTarget({ ...target, publicUrl: "http://craft.lakebed.app" }),
    /credential-free HTTPS/,
  );
  assert.throws(
    () => validateProductionTarget({ ...target, schemaVersion: 2 }),
    /schemaVersion/,
  );
});

test("ownership, lifecycle, target, inspection, and artifact mismatches fail closed", () => {
  const report = auditProductionDeploy({
    deploys: [deploy({
      archivedAt: "2026-07-27T00:00:00.000Z",
      inspectPolicy: "public",
      name: "other",
      ownerId: "github:other",
      status: "archived",
      url: "https://other.lakebed.app",
    })],
  }, target, { expectedArtifactHash: "sha256:" + "c".repeat(64) });
  assert.equal(report.ok, false);
  assert.deepEqual(report.failures, [
    "active",
    "claimedOwner",
    "currentTarget",
    "privateInspection",
    "artifactMatch",
  ]);
});

test("any additional non-archived or incompletely archived deployment fails closed", () => {
  const variants = [
    deploy({ deployId: "dep_active", ownerId: "github:other" }),
    deploy({ deployId: "dep_pending", status: "pending", archivedAt: null }),
    deploy({ deployId: "dep_unknown", status: "unknown", archivedAt: "2026-07-25T00:00:00.000Z" }),
    deploy({ deployId: "dep_incompletearchive", status: "archived", archivedAt: null }),
    deploy({ deployId: "dep_invalidarchive", status: "archived", archivedAt: "not-a-date" }),
  ];
  for (const unexpected of variants) {
    const report = auditProductionDeploy(
      { deploys: [deploy(), unexpected], user: { token: "must-not-leak" } },
      target,
      { capturedAt: "2026-07-26T12:00:00.000Z" },
    );
    assert.equal(report.ok, false);
    assert.deepEqual(report.failures, ["noUnexpectedActiveDeploy"]);
    assert.equal(JSON.stringify(report).includes(unexpected.deployId), false);
    assert.equal(JSON.stringify(report).includes("must-not-leak"), false);
  }
});

test("explicitly archived historical deployments are allowed", () => {
  const report = auditProductionDeploy({
    deploys: [
      deploy(),
      deploy({
        archivedAt: "2026-07-25T00:00:00.000Z",
        deployId: "dep_historical",
        ownerId: "github:former-owner",
        status: "archived",
      }),
    ],
  }, target, { capturedAt: "2026-07-26T12:00:00.000Z" });
  assert.equal(report.ok, true);
  assert.deepEqual(report.failures, []);
  assert.equal(JSON.stringify(report).includes("dep_historical"), false);
});

test("archived history requires valid unique deploy IDs without leaking rejected values", () => {
  const invalidIds = [undefined, null, "", " ", "not-a-deploy", "dep_invalid-id"];
  for (const invalidId of invalidIds) {
    const historical = deploy({
      archivedAt: "2026-07-25T00:00:00.000Z",
      deployId: invalidId,
      status: "archived",
    });
    if (invalidId === undefined) delete historical.deployId;
    assert.throws(
      () => auditProductionDeploy({ deploys: [deploy(), historical] }, target),
      (error) => {
        assert.match(error.message, /deploy ID/);
        if (typeof invalidId === "string" && invalidId.trim()) {
          assert.equal(error.message.includes(invalidId), false);
        }
        return true;
      },
    );
  }
  assert.throws(
    () => auditProductionDeploy({
      deploys: [
        deploy(),
        deploy({
          archivedAt: "2026-07-24T00:00:00.000Z",
          deployId: "dep_duplicate",
          status: "archived",
        }),
        deploy({
          archivedAt: "2026-07-25T00:00:00.000Z",
          deployId: "dep_duplicate",
          status: "archived",
        }),
      ],
    }, target),
    /unique/,
  );
});

test("production target must explicitly remain non-expiring", () => {
  const variants = [
    { label: "missing", value: undefined },
    { label: "past", value: "2026-07-25T00:00:00.000Z" },
    { label: "future", value: "2027-07-25T00:00:00.000Z" },
    { label: "malformed", value: "not-a-date" },
  ];
  for (const variant of variants) {
    const candidate = deploy({ expiresAt: variant.value });
    if (variant.label === "missing") delete candidate.expiresAt;
    const report = auditProductionDeploy({ deploys: [candidate] }, target);
    assert.equal(report.ok, false);
    assert.deepEqual(report.failures, ["nonExpiringTarget"]);
  }
});

test("an unclaimed deployment is reported as a failed gate without hiding the audit", () => {
  const report = auditProductionDeploy({
    deploys: [deploy({ claimedAt: null, ownerId: null })],
  }, target);
  assert.equal(report.ok, false);
  assert.equal(report.release.claimedAt, null);
  assert.deepEqual(report.failures, ["claimedOwner"]);
});

test("quota reserve, usage bounds, and platform limit floors are independent gates", () => {
  const report = auditProductionDeploy({
    deploys: [deploy({
      limits: {
        artifactBytes: 1,
        stateBytes: 1,
        stateRows: 1,
        requestsPerDay: 10_000,
        mutationsPerDay: 1_000,
      },
      usage: { requestsToday: 10_001, mutationsToday: 950 },
    })],
  }, target);
  assert.equal(report.ok, false);
  assert.deepEqual(report.failures, [
    "limitsMeetFloor",
    "usageWithinLimits",
    "requestReserve",
    "mutationReserve",
  ]);
  assert.equal(report.quota.requestsRemaining, -1);
  assert.equal(report.quota.mutationsRemaining, 50);
  assert.deepEqual(Object.keys(report.limits), [
    "artifactBytes",
    "stateBytes",
    "stateRows",
    "requestsPerDay",
    "mutationsPerDay",
  ]);
});

test("malformed counters, non-canonical timestamps, and hashes are rejected", () => {
  assert.throws(
    () => auditProductionDeploy({ deploys: [deploy({ usage: { requestsToday: 1.5, mutationsToday: 0 } })] }, target),
    /integer/,
  );
  assert.throws(
    () => auditProductionDeploy({ deploys: [deploy({ artifactHash: "nope" })] }, target),
    /sha256/,
  );
  const invalidTimestamps = [
    "not-a-date",
    "0",
    "July 25, 2026",
    "2026-02-30T00:00:00.000Z",
    "2026-07-25T00:00:00Z",
    "2026-07-25T00:00:00.000+00:00",
  ];
  for (const timestamp of invalidTimestamps) {
    assert.throws(
      () => auditProductionDeploy({ deploys: [deploy({ claimedAt: timestamp })] }, target),
      /canonical UTC timestamp/,
    );
    const historical = deploy({
      archivedAt: timestamp,
      deployId: "dep_badarchive",
      status: "archived",
    });
    const report = auditProductionDeploy({ deploys: [deploy(), historical] }, target);
    assert.equal(report.ok, false);
    assert.deepEqual(report.failures, ["noUnexpectedActiveDeploy"]);
  }
  for (const field of ["createdAt", "updatedAt"]) {
    assert.throws(
      () => auditProductionDeploy({ deploys: [deploy({ [field]: "2026-02-30T00:00:00.000Z" })] }, target),
      /canonical UTC timestamp/,
    );
  }
});

test("CLI arguments reject ambiguity and missing values", () => {
  assert.deepEqual(parseAuditArguments([]), {
    deployListPath: undefined,
    expectedArtifactHash: undefined,
  });
  assert.deepEqual(parseAuditArguments(["--deploy-list", "capture.json", "--expected-artifact", "sha256:" + "a".repeat(64)]), {
    deployListPath: "capture.json",
    expectedArtifactHash: "sha256:" + "a".repeat(64),
  });
  assert.throws(() => parseAuditArguments(["--deploy-list"]), /requires a path/);
  assert.throws(
    () => parseAuditArguments(["--deploy-list", "a.json", "--deploy-list", "b.json"]),
    /only once/,
  );
  assert.throws(() => parseAuditArguments(["--unknown"]), /Unknown argument/);
});

test("checked-in target, Lakebed binding, audit transaction, README, and runbook remain aligned", async () => {
  const [targetSource, lakebedSource, readme, runbook, script, transaction, prepare] = await Promise.all([
    readFile(new URL("../docs/production-target.json", import.meta.url), "utf8"),
    readFile(new URL("../lakebed.json", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/production-operations.md", import.meta.url), "utf8"),
    readFile(new URL("../scripts/audit-lakebed-production.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/lakebed-build-transaction.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/prepare-lakebed-deploy.mjs", import.meta.url), "utf8"),
  ]);
  const checkedIn = validateProductionTarget(JSON.parse(targetSource));
  assert.equal(JSON.parse(lakebedSource).deployId, checkedIn.deployId);
  assert.ok(readme.includes(checkedIn.publicUrl));
  assert.ok(runbook.includes(checkedIn.publicUrl));
  assert.ok(runbook.includes("32,768 bytes"));
  assert.ok(runbook.includes("does not prove that the public alias"));
  assert.ok(readme.includes("scripts/build-lakebed-audit.mjs"));
  assert.ok(runbook.includes("scripts/build-lakebed-audit.mjs"));
  assert.match(readme, /never returns a runnable stage/);
  assert.match(readme, /intentionally unsupported by this\s+helper/);
  assert.match(runbook, /no release flag or\s+deploy invocation/);
  assert.match(runbook, /same-UID process/);
  assert.doesNotMatch(runbook, /\.lakebed\/deploy\.json` contains the claim binding/);
  assert.match(script, /\["lakebed", "deploy", "list", "--json"\]/);
  assert.doesNotMatch(script, /\["lakebed", "deploy", "[^l]/);
  assert.doesNotMatch(transaction, /"lakebed",\s*"deploy"/);
  assert.match(prepare, /Direct staging is disabled/);
});
