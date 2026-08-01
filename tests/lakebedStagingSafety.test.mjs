import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  RELEASE_STAGING_FLAG,
  cleanupStagingSafetyPlan,
  createOwnedStageDirectory,
  createStagingSafetyPlan,
  finalizeStagingSafetyPlan,
  parseLakebedConfig,
  parseStagingArguments,
  writeOwnedStageFile,
  writeStagingControlFiles,
} from "../scripts/lakebed-staging-safety.mjs";

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

test("staging mode is safe by default and release intent is explicit and unambiguous", () => {
  assert.deepEqual(parseStagingArguments(["/tmp/stage"]), {
    release: false,
    stagePath: "/tmp/stage",
  });
  assert.deepEqual(parseStagingArguments(["/tmp/stage", RELEASE_STAGING_FLAG]), {
    release: true,
    stagePath: "/tmp/stage",
  });
  assert.throws(() => parseStagingArguments([]), /Usage/);
  assert.throws(() => parseStagingArguments(["a", "b"]), /Usage/);
  assert.throws(() => parseStagingArguments(["a", "--release"]), /Unknown staging option/);
  assert.throws(
    () => parseStagingArguments(["a", RELEASE_STAGING_FLAG, RELEASE_STAGING_FLAG]),
    /only once/,
  );
});

test("default staging strips a deploy-only binding and never copies the server environment", async (t) => {
  const { sourceRoot, stageRoot } = await fixture(
    t,
    '{\n  "deployId": "dep_GeGTYPSk0TrcWk9E"\n}\n',
    { serverEnv: "PRIVATE_TOKEN=do-not-copy\n" },
  );
  const plan = await createStagingSafetyPlan({ args: [stageRoot], sourceRoot });
  await writeStagingControlFiles(plan);
  await finalizeStagingSafetyPlan(plan);

  assert.deepEqual(JSON.parse(await readFile(join(stageRoot, "lakebed.json"), "utf8")), {});
  assert.equal(existsSync(join(stageRoot, ".env.lakebed.server")), false);
  assert.equal(existsSync(join(stageRoot, ".lakebed")), false);
  assert.equal(existsSync(join(stageRoot, ".lakecraft-stage-owner")), false);
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
  await finalizeStagingSafetyPlan(plan);

  assert.deepEqual(JSON.parse(await readFile(join(stageRoot, "lakebed.json"), "utf8")), {
    name: config.name,
    runtime: config.runtime,
  });
});

test("explicit release staging preserves the exact binding and server environment bytes", async (t) => {
  const configSource = '{ "name": "lakecraft", "deployId": "dep_GeGTYPSk0TrcWk9E" }\n';
  const serverEnv = Buffer.from("PRIVATE_TOKEN=release-only\nBINARY_SAFE=\u00e9\n", "utf8");
  const { sourceRoot, stageRoot } = await fixture(t, configSource, { serverEnv });
  const plan = await createStagingSafetyPlan({
    args: [stageRoot, RELEASE_STAGING_FLAG],
    sourceRoot,
  });
  await writeStagingControlFiles(plan);
  await finalizeStagingSafetyPlan(plan);

  assert.equal(await readFile(join(stageRoot, "lakebed.json"), "utf8"), configSource);
  assert.deepEqual(await readFile(join(stageRoot, ".env.lakebed.server")), serverEnv);
  assert.equal(existsSync(join(stageRoot, ".lakebed")), false);
  assert.equal(existsSync(join(stageRoot, ".lakecraft-stage-owner")), false);
});

test("malformed configuration and invalid modes fail before creating a partial stage", async (t) => {
  const malformed = await fixture(t, '{ "deployId": ');
  await assert.rejects(
    createStagingSafetyPlan({ args: [malformed.stageRoot], sourceRoot: malformed.sourceRoot }),
    /valid JSON/,
  );
  assert.equal(existsSync(malformed.stageRoot), false);

  const anonymous = await fixture(t, '{ "name": "anonymous" }\n');
  await assert.rejects(
    createStagingSafetyPlan({
      args: [anonymous.stageRoot, RELEASE_STAGING_FLAG],
      sourceRoot: anonymous.sourceRoot,
    }),
    /requires an explicit deployId/,
  );
  assert.equal(existsSync(anonymous.stageRoot), false);

  assert.throws(() => parseStagingArguments([anonymous.stageRoot, "--unexpected-mode"]), /Unknown/);
  assert.equal(existsSync(anonymous.stageRoot), false);
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
    const path = join(injected.stageRoot, ...relativePath.split("/"));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "INJECTED=1\n");

    await assert.rejects(writeStagingControlFiles(plan), /Unexpected credential path/);
    assert.equal(existsSync(join(injected.stageRoot, "lakebed.json")), false);
    assert.equal(await cleanupStagingSafetyPlan(plan), true);
    assert.equal(existsSync(path), true, "cleanup preserves the unexpected injected path");
  }
});

test("finalization catches credentials injected after safe control output and removes owned files", async (t) => {
  const injected = await fixture(t, '{ "deployId": "dep_GeGTYPSk0TrcWk9E" }\n');
  const plan = await createStagingSafetyPlan({ args: [injected.stageRoot], sourceRoot: injected.sourceRoot });
  await writeStagingControlFiles(plan);
  const lateEnv = join(injected.stageRoot, ".env.lakebed.server");
  await writeFile(lateEnv, "LATE=1\n");

  await assert.rejects(finalizeStagingSafetyPlan(plan), /Unexpected credential path/);
  assert.equal(await cleanupStagingSafetyPlan(plan), true);
  assert.equal(existsSync(join(injected.stageRoot, "lakebed.json")), false);
  assert.equal(existsSync(join(injected.stageRoot, ".lakecraft-stage-owner")), false);
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
  await rename(join(swapped.stageRoot, "client"), parked);
  await symlink(victim, join(swapped.stageRoot, "client"));

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
  await rename(join(swapped.stageRoot, "client/generated"), parked);
  await symlink(victim, join(swapped.stageRoot, "client/generated"));

  assert.equal(await cleanupStagingSafetyPlan(plan), false);
  assert.equal(await readFile(join(victim, "index.tsx"), "utf8"), "external nested victim\n");
  assert.equal(await readFile(join(parked, "index.tsx"), "utf8"), "owned nested bundle\n");
});

test("cleanup refuses an owned file replacement and preserves both replacement and parked original", async (t) => {
  const replaced = await fixture(t, '{ "deployId": "dep_GeGTYPSk0TrcWk9E" }\n');
  const plan = await createStagingSafetyPlan({ args: [replaced.stageRoot], sourceRoot: replaced.sourceRoot });
  await writeStagingControlFiles(plan);
  const configPath = join(replaced.stageRoot, "lakebed.json");
  const parked = join(replaced.stageRoot, "lakebed-owned.json");
  await rename(configPath, parked);
  await writeFile(configPath, '{ "replacement": true }\n');

  assert.equal(await cleanupStagingSafetyPlan(plan), false);
  assert.equal(await readFile(configPath, "utf8"), '{ "replacement": true }\n');
  assert.deepEqual(JSON.parse(await readFile(parked, "utf8")), {});
});

test("the executable preflights staging safety before loading or patching the compiler", async () => {
  const source = await readFile(new URL("../scripts/prepare-lakebed-deploy.mjs", import.meta.url), "utf8");
  assert.ok(source.indexOf("await createStagingSafetyPlan") < source.indexOf("await loadLakebedCompilerRuntime"));
  assert.doesNotMatch(source, /\.lakebed\/deploy\.json/);
  assert.doesNotMatch(source, /for \(const relativePath of \["lakebed\.json"/);
});
