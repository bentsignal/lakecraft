import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  cleanupStagingSafetyPlan,
  createLakebedWorkspace,
  createOwnedStageDirectory,
  createStagingSafetyPlan,
  parseLakebedConfig,
  parseStagingArguments,
  sealStagingSafetyPlan,
  writeOwnedStageFile,
  writeStagingControlFiles,
} from "../scripts/lakebed-staging-safety.mjs";
import { runStagedTransaction, verifyLakebedBuild } from "../scripts/lakebed-build-transaction.mjs";

const payload = (stageRoot, ...parts) => join(stageRoot, "payload", ...parts);
const lakebedHash = (buffer) => `sha256:${createHash("sha256").update(buffer).digest("hex")}`;

async function fixture(t, configSource, { serverEnv } = {}) {
  const root = await mkdtemp(join(tmpdir(), "lakecraft-stage-safety-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceRoot = join(root, "source");
  const stageRoot = join(root, "stage");
  await mkdir(sourceRoot);
  if (configSource !== undefined) await writeFile(join(sourceRoot, "lakebed.json"), configSource);
  if (serverEnv !== undefined) await writeFile(join(sourceRoot, ".env.lakebed.server"), serverEnv);
  return { root, sourceRoot, stageRoot };
}

test("staging arguments expose audit-only destination selection", () => {
  assert.deepEqual(parseStagingArguments(["/tmp/stage"]), {
    stagePath: "/tmp/stage",
  });
  assert.throws(() => parseStagingArguments([]), /Usage/);
  assert.throws(() => parseStagingArguments(["a", "b"]), /Usage/);
  assert.throws(() => parseStagingArguments(["a", "--release"]), /Unknown staging option/);
  assert.throws(() => parseStagingArguments(["a", "--release-with-binding-and-server-env"]), /Unknown/);
});

test("default staging strips a deploy-only binding and never copies the server environment", async (t) => {
  const { sourceRoot, stageRoot } = await fixture(
    t,
    '{\n  "deployId": "dep_GeGTYPSk0TrcWk9E"\n}\n',
    { serverEnv: "PRIVATE_TOKEN=do-not-copy\n" },
  );
  const plan = await createStagingSafetyPlan({ args: [stageRoot], sourceRoot });
  await writeStagingControlFiles(plan);
  await createLakebedWorkspace(plan);
  await sealStagingSafetyPlan(plan);

  assert.deepEqual(JSON.parse(await readFile(payload(stageRoot, "lakebed.json"), "utf8")), {});
  assert.equal(existsSync(payload(stageRoot, ".env.lakebed.server")), false);
  assert.equal(existsSync(join(stageRoot, ".lakebed")), true);
  assert.equal(existsSync(join(stageRoot, ".lakecraft-stage-owner")), true);
  assert.equal(await cleanupStagingSafetyPlan(plan), true);
});

test("default staging preserves every non-sensitive Lakebed configuration key", async (t) => {
  const config = {
    deployId: "dep_GeGTYPSk0TrcWk9E",
    name: "lakecraft",
    runtime: { region: "local", flags: ["compact"] },
  };
  const { sourceRoot, stageRoot } = await fixture(t, `${JSON.stringify(config, null, 2)}\n`);
  const plan = await createStagingSafetyPlan({ args: [stageRoot], sourceRoot });
  await writeStagingControlFiles(plan);
  await createLakebedWorkspace(plan);
  await sealStagingSafetyPlan(plan);

  assert.deepEqual(JSON.parse(await readFile(payload(stageRoot, "lakebed.json"), "utf8")), {
    name: config.name,
    runtime: config.runtime,
  });
  assert.equal(await cleanupStagingSafetyPlan(plan), true);
});

test("malformed configuration and invalid modes fail before creating a partial stage", async (t) => {
  const malformed = await fixture(t, '{ "deployId": ');
  await assert.rejects(
    createStagingSafetyPlan({ args: [malformed.stageRoot], sourceRoot: malformed.sourceRoot }),
    /valid JSON/,
  );
  assert.equal(existsSync(malformed.stageRoot), false);

  assert.throws(() => parseStagingArguments([malformed.stageRoot, "--unexpected-mode"]), /Unknown/);
});

test("unsafe source, destination, and credential paths fail closed", async (t) => {
  const same = await fixture(t, '{ "deployId": "dep_GeGTYPSk0TrcWk9E" }\n');
  await assert.rejects(
    createStagingSafetyPlan({ args: [same.sourceRoot], sourceRoot: same.sourceRoot }),
    /outside the capsule/,
  );
  await assert.rejects(
    createStagingSafetyPlan({ args: [join(same.sourceRoot, "nested")], sourceRoot: same.sourceRoot }),
    /outside the capsule/,
  );

  const occupied = await fixture(t, '{ "deployId": "dep_GeGTYPSk0TrcWk9E" }\n');
  await mkdir(occupied.stageRoot);
  await writeFile(join(occupied.stageRoot, ".env.lakebed.server"), "INHERITED=unsafe\n");
  await assert.rejects(
    createStagingSafetyPlan({ args: [occupied.stageRoot], sourceRoot: occupied.sourceRoot }),
    /must be empty/,
  );

  const legacy = await fixture(t, '{ "deployId": "dep_GeGTYPSk0TrcWk9E" }\n');
  await mkdir(join(legacy.sourceRoot, ".lakebed"));
  await writeFile(join(legacy.sourceRoot, ".lakebed", "deploy.json"), "{}\n");
  await assert.rejects(
    createStagingSafetyPlan({ args: [legacy.stageRoot], sourceRoot: legacy.sourceRoot }),
    /Unexpected credential path \.lakebed\/deploy\.json/,
  );
  assert.equal(existsSync(legacy.stageRoot), false);

  const alternateEnv = await fixture(t, '{ "deployId": "dep_GeGTYPSk0TrcWk9E" }\n');
  await writeFile(join(alternateEnv.sourceRoot, ".env.lakebed.server.local"), "TOKEN=unsafe\n");
  await assert.rejects(
    createStagingSafetyPlan({ args: [alternateEnv.stageRoot], sourceRoot: alternateEnv.sourceRoot }),
    /Unexpected credential path \.env\.lakebed\.server\.local/,
  );
  assert.equal(existsSync(alternateEnv.stageRoot), false);
});

test("credential-like config fields cannot survive the default scrub", () => {
  assert.throws(
    () => parseLakebedConfig('{ "deployId": "dep_GeGTYPSk0TrcWk9E", "nested": { "apiToken": "x" } }'),
    /Unexpected credential field at lakebed\.json\.nested\.apiToken/,
  );
  assert.throws(() => parseLakebedConfig("[]"), /JSON object/);
  assert.throws(() => parseLakebedConfig('{ "deployId": "production" }'), /valid Lakebed deployment ID/);
});

test("canonical destination resolution rejects an outside symlink ancestor that re-enters source", async (t) => {
  const escaped = await fixture(t, '{ "deployId": "dep_GeGTYPSk0TrcWk9E" }\n');
  const outsideAlias = join(escaped.root, "outside-alias");
  await symlink(escaped.sourceRoot, outsideAlias);
  const requestedStage = join(outsideAlias, "nested-stage");

  await assert.rejects(
    createStagingSafetyPlan({ args: [requestedStage], sourceRoot: escaped.sourceRoot }),
    /outside the capsule after canonical path resolution/,
  );
  assert.equal(existsSync(join(escaped.sourceRoot, "nested-stage")), false);
  assert.equal(
    await readFile(join(escaped.sourceRoot, "lakebed.json"), "utf8"),
    '{ "deployId": "dep_GeGTYPSk0TrcWk9E" }\n',
  );
});

test("post-plan stage replacement with a symlink is refused without writing through it", async (t) => {
  const swapped = await fixture(t, '{ "deployId": "dep_GeGTYPSk0TrcWk9E" }\n');
  const plan = await createStagingSafetyPlan({ args: [swapped.stageRoot], sourceRoot: swapped.sourceRoot });
  const parked = `${swapped.stageRoot}-parked`;
  const victim = join(swapped.root, "victim");
  await mkdir(victim);
  await rename(swapped.stageRoot, parked);
  await symlink(victim, swapped.stageRoot);

  await assert.rejects(writeStagingControlFiles(plan), /staging directory identity changed/i);
  assert.equal(existsSync(join(victim, "lakebed.json")), false);
  assert.equal(await cleanupStagingSafetyPlan(plan), false, "cleanup refuses a replaced root");
});

test("late credential injection is rejected before control writes and owned partials are cleaned", async (t) => {
  for (const relativePath of [
    ".lakebed/deploy.json",
    ".env.lakebed.server",
    ".env.lakebed.server.local",
  ]) {
    const injected = await fixture(t, '{ "deployId": "dep_GeGTYPSk0TrcWk9E" }\n');
    const plan = await createStagingSafetyPlan({ args: [injected.stageRoot], sourceRoot: injected.sourceRoot });
    const path = payload(injected.stageRoot, ...relativePath.split("/"));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "INJECTED=1\n");

    await assert.rejects(writeStagingControlFiles(plan), /Unexpected credential path/);
    assert.equal(existsSync(payload(injected.stageRoot, "lakebed.json")), false);
    assert.equal(await cleanupStagingSafetyPlan(plan), false);
    assert.equal(existsSync(path), true, "cleanup preserves the unexpected injected path");
  }
});

test("sealing catches credentials injected after safe control output without deleting them", async (t) => {
  const injected = await fixture(t, '{ "deployId": "dep_GeGTYPSk0TrcWk9E" }\n');
  const plan = await createStagingSafetyPlan({ args: [injected.stageRoot], sourceRoot: injected.sourceRoot });
  await writeStagingControlFiles(plan);
  const lateEnv = payload(injected.stageRoot, ".env.lakebed.server");
  await writeFile(lateEnv, "LATE=1\n");

  await assert.rejects(createLakebedWorkspace(plan), /Unexpected credential path/);
  assert.equal(await cleanupStagingSafetyPlan(plan), false);
  assert.equal(existsSync(payload(injected.stageRoot, "lakebed.json")), false);
  assert.equal(existsSync(join(injected.stageRoot, ".lakecraft-stage-owner")), true);
  assert.equal(existsSync(lateEnv), true, "cleanup never deletes an injected credential");
});

test("cleanup never traverses a replaced owned directory into an external victim", async (t) => {
  const swapped = await fixture(t, '{ "deployId": "dep_GeGTYPSk0TrcWk9E" }\n');
  const plan = await createStagingSafetyPlan({ args: [swapped.stageRoot], sourceRoot: swapped.sourceRoot });
  await createOwnedStageDirectory(plan, "client");
  await writeOwnedStageFile(plan, "client/index.tsx", "owned bundle\n");
  const parked = join(swapped.root, "parked-client");
  const victim = join(swapped.root, "victim-client");
  await mkdir(victim);
  await writeFile(join(victim, "index.tsx"), "external victim\n");
  await rename(payload(swapped.stageRoot, "client"), parked);
  await symlink(victim, payload(swapped.stageRoot, "client"));

  assert.equal(await cleanupStagingSafetyPlan(plan), false);
  assert.equal(await readFile(join(victim, "index.tsx"), "utf8"), "external victim\n");
  assert.equal(await readFile(join(parked, "index.tsx"), "utf8"), "owned bundle\n");
});

test("cleanup refuses nested owned-directory swaps before resolving their children", async (t) => {
  const swapped = await fixture(t, '{ "deployId": "dep_GeGTYPSk0TrcWk9E" }\n');
  const plan = await createStagingSafetyPlan({ args: [swapped.stageRoot], sourceRoot: swapped.sourceRoot });
  await createOwnedStageDirectory(plan, "client");
  await createOwnedStageDirectory(plan, "client/generated");
  await writeOwnedStageFile(plan, "client/generated/index.tsx", "owned nested bundle\n");
  const parked = join(swapped.root, "parked-generated");
  const victim = join(swapped.root, "victim-generated");
  await mkdir(victim);
  await writeFile(join(victim, "index.tsx"), "external nested victim\n");
  await rename(payload(swapped.stageRoot, "client/generated"), parked);
  await symlink(victim, payload(swapped.stageRoot, "client/generated"));

  assert.equal(await cleanupStagingSafetyPlan(plan), false);
  assert.equal(await readFile(join(victim, "index.tsx"), "utf8"), "external nested victim\n");
  assert.equal(await readFile(join(parked, "index.tsx"), "utf8"), "owned nested bundle\n");
});

test("cleanup refuses an owned file replacement and preserves both replacement and parked original", async (t) => {
  const replaced = await fixture(t, '{ "deployId": "dep_GeGTYPSk0TrcWk9E" }\n');
  const plan = await createStagingSafetyPlan({ args: [replaced.stageRoot], sourceRoot: replaced.sourceRoot });
  await writeStagingControlFiles(plan);
  const configPath = payload(replaced.stageRoot, "lakebed.json");
  const parked = payload(replaced.stageRoot, "lakebed-owned.json");
  await rename(configPath, parked);
  await writeFile(configPath, '{ "replacement": true }\n');

  assert.equal(await cleanupStagingSafetyPlan(plan), false);
  assert.equal(await readFile(configPath, "utf8"), '{ "replacement": true }\n');
  assert.deepEqual(JSON.parse(await readFile(parked, "utf8")), {});
});

test("pre-existing stages must be current-user owned and not group- or other-writable", async (t) => {
  const unsafe = await fixture(t, '{ "name": "audit" }\n');
  await mkdir(unsafe.stageRoot, { mode: 0o777 });
  await chmod(unsafe.stageRoot, 0o777);
  await assert.rejects(
    createStagingSafetyPlan({ args: [unsafe.stageRoot], sourceRoot: unsafe.sourceRoot }),
    /must not be group- or other-writable/,
  );
  assert.deepEqual(await readFile(join(unsafe.sourceRoot, "lakebed.json"), "utf8"), '{ "name": "audit" }\n');
});

test("owned file bytes are revalidated before sealing even when inode identity is unchanged", async (t) => {
  const changed = await fixture(t, '{ "deployId": "dep_GeGTYPSk0TrcWk9E" }\n');
  const plan = await createStagingSafetyPlan({ args: [changed.stageRoot], sourceRoot: changed.sourceRoot });
  await writeStagingControlFiles(plan);
  await writeFile(payload(changed.stageRoot, "lakebed.json"), '{ "deployId": "dep_injected" }\n');
  await assert.rejects(createLakebedWorkspace(plan), /changed bytes/);
  assert.equal(await cleanupStagingSafetyPlan(plan), false);
});

test("transaction owns a fresh private root, seals only the payload, consumes it once, and removes it", async (t) => {
  const owned = await fixture(t, '{ "deployId": "dep_GeGTYPSk0TrcWk9E" }\n');
  let observedRoot;
  const result = await runStagedTransaction({
    sourceRoot: owned.sourceRoot,
    stageParent: owned.root,
    prepare: async (plan) => {
      await createOwnedStageDirectory(plan, "client");
      await writeOwnedStageFile(plan, "client/index.tsx", "export default 1;\n");
      await writeStagingControlFiles(plan);
    },
    consume: async (plan) => {
      observedRoot = plan.stageRoot;
      assert.equal((await stat(plan.stageRoot)).mode & 0o777, 0o500);
      assert.equal((await stat(plan.capsuleRoot)).mode & 0o777, 0o500);
      assert.equal((await stat(payload(plan.stageRoot, "client"))).mode & 0o777, 0o500);
      assert.equal((await stat(payload(plan.stageRoot, "client/index.tsx"))).mode & 0o777, 0o400);
      assert.equal((await stat(join(plan.stageRoot, ".lakebed"))).mode & 0o777, 0o700);
      assert.equal(existsSync(payload(plan.stageRoot, ".lakecraft-stage-owner")), false);
      await assert.rejects(
        writeFile(join(plan.stageRoot, "unexpected-root-sibling"), "blocked\n"),
        /EACCES|permission denied/,
      );
      return "consumed";
    },
  });
  assert.equal(result, "consumed");
  assert.match(observedRoot, /lakecraft-audit-/);
  assert.equal(existsSync(observedRoot), false);
});

test("transaction rejects an unprotected shared-writable parent before acquisition", async (t) => {
  const unsafe = await fixture(t, '{ "name": "audit" }\n');
  const sharedParent = join(unsafe.root, "shared-parent");
  await mkdir(sharedParent, { mode: 0o777 });
  await chmod(sharedParent, 0o777);
  await assert.rejects(runStagedTransaction({
    sourceRoot: unsafe.sourceRoot,
    stageParent: sharedParent,
    prepare: writeStagingControlFiles,
    consume: async () => assert.fail("unsafe parent must fail before consumption"),
  }), /must not be group- or other-writable unless sticky-bit protected/);
  assert.deepEqual(await readdir(sharedParent), []);
});

test("transaction permits a sticky shared temporary parent and still owns cleanup", async (t) => {
  const safe = await fixture(t, '{ "name": "audit" }\n');
  const stickyParent = join(safe.root, "sticky-parent");
  await mkdir(stickyParent, { mode: 0o700 });
  // Bun 1.3 masks the sticky bit from fs.chmod on macOS; exercise the actual
  // filesystem boundary through the platform chmod executable instead.
  execFileSync("chmod", ["1777", stickyParent]);
  const result = await runStagedTransaction({
    sourceRoot: safe.sourceRoot,
    stageParent: stickyParent,
    prepare: writeStagingControlFiles,
    consume: async () => "consumed",
  });
  assert.equal(result, "consumed");
  assert.deepEqual(await readdir(stickyParent), []);
});

test("transaction rejects credentials injected into the writable Lakebed workspace", async (t) => {
  const injected = await fixture(t, '{ "deployId": "dep_GeGTYPSk0TrcWk9E" }\n');
  let observedRoot;
  await assert.rejects(runStagedTransaction({
    sourceRoot: injected.sourceRoot,
    stageParent: injected.root,
    prepare: writeStagingControlFiles,
    consume: async (plan) => {
      observedRoot = plan.stageRoot;
      await writeFile(join(plan.stageRoot, ".lakebed", "deploy.json"), "{}\n");
    },
  }), /Unexpected staging path \.lakebed\/deploy\.json/);
  assert.equal(existsSync(observedRoot), false);
});

test("artifact verification rejects alternate targets even when every hash is recomputed", async (t) => {
  for (const target of ["claimed-production", "anonymous", "preview-source"]) {
    const forged = await fixture(t, '{ "name": "audit" }\n');
    const transaction = runStagedTransaction({
      sourceRoot: forged.sourceRoot,
      stageParent: forged.root,
      prepare: async (plan) => {
        await createOwnedStageDirectory(plan, "client");
        await createOwnedStageDirectory(plan, "server");
        await writeOwnedStageFile(plan, "client/index.tsx", "export default 1;\n");
        await writeOwnedStageFile(plan, "server/index.ts", "export default 2;\n");
        await writeOwnedStageFile(plan, "favicon.svg", "<svg/>\n");
        await writeStagingControlFiles(plan);
      },
      consume: async (plan) => {
        const sourceFiles = [...plan.ownedEntries.entries()]
          .filter(([path, entry]) => entry.kind === "file"
            && path.startsWith("payload/") && path !== "payload/lakebed.json")
          .map(([path, entry]) => ({
            bytes: entry.bytes,
            hash: `sha256:${entry.digest}`,
            path: path.slice("payload/".length),
          }))
          .sort((a, b) => a.path.localeCompare(b.path));
        const clientBundle = Buffer.from("client bundle\n");
        const serverBundle = Buffer.from("server bundle\n");
        const artifact = {
          client: {
            bundleHash: lakebedHash(clientBundle),
            bytes: clientBundle.length,
          },
          deployTarget: target,
          format: "lakebed.capsule.artifact.v1",
          server: {
            source: {
              bundle: serverBundle.toString("base64"),
              bundleHash: lakebedHash(serverBundle),
              bytes: serverBundle.length,
            },
          },
          source: {
            files: sourceFiles,
            snapshotHash: lakebedHash(Buffer.from(JSON.stringify(sourceFiles))),
          },
        };
        const artifactHash = lakebedHash(Buffer.from(JSON.stringify(artifact)));
        const artifactPath = join(plan.stageRoot, ".lakebed", "artifacts", "audit.anonymous.json");
        await mkdir(dirname(artifactPath));
        await writeFile(artifactPath, JSON.stringify({
          artifact,
          artifactHash,
          clientBundle: clientBundle.toString("base64"),
          clientBundleHash: lakebedHash(clientBundle),
          mediaType: "application/vnd.lakebed.artifact+json",
        }));
        return verifyLakebedBuild(plan, Buffer.from(JSON.stringify({
          artifactHash,
          artifactPath,
          clientBundleHash: lakebedHash(clientBundle),
          format: "lakebed.capsule.artifact.v1",
        })));
      },
    });
    await assert.rejects(transaction, /not an anonymous-source audit artifact/);
  }
});

test("public audit helper cannot stage or deploy a production binding", async () => {
  const [prepareSource, auditSource, transactionSource, safetySource] = await Promise.all([
    readFile(new URL("../scripts/prepare-lakebed-deploy.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/build-lakebed-audit.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/lakebed-build-transaction.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/lakebed-staging-safety.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(prepareSource, /Direct staging is disabled/);
  assert.doesNotMatch(prepareSource, /LAKECRAFT_BUNDLE_METAFILE_DIR/);
  assert.match(auditSource, /runAuditBuild/);
  assert.doesNotMatch(auditSource, /deploy/);
  assert.doesNotMatch(transactionSource, /lakebed",\s*"deploy/);
  assert.doesNotMatch(transactionSource, /RELEASE_STAGING_FLAG/);
  assert.doesNotMatch(safetySource, /RELEASE_STAGING_FLAG|finalizeStagingSafetyPlan|serverEnvSource/);
});
