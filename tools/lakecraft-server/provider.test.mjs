import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { connectionInfo, inspectEnvironment, validateTemplatePlan } from "./provider.mjs";
import plan from "./railway-template-plan.json" with { type: "json" };

test("turns a Railway public domain into health and Direct Connect URLs", () => {
  assert.deepEqual(connectionInfo({
    env: { RAILWAY_PUBLIC_DOMAIN: "lakecraft.example.up.railway.app", PUBLIC_SERVER_NAME: "Friends" },
  }), {
    directConnectUrl: "wss://lakecraft.example.up.railway.app/ws",
    healthUrl: "https://lakecraft.example.up.railway.app/status",
    provider: "railway",
    serverName: "Friends",
  });
});

test("accepts a full websocket URL without duplicating its path", () => {
  const result = connectionInfo({ explicitUrl: "ws://127.0.0.1:3001/ws", env: {} });
  assert.equal(result.directConnectUrl, "ws://127.0.0.1:3001/ws");
  assert.equal(result.healthUrl, "http://127.0.0.1:3001/status");
});

test("refuses token-bearing URLs", () => {
  assert.throws(
    () => connectionInfo({ explicitUrl: "https://example.test?token=do-not-leak", env: {} }),
    /share access tokens separately/,
  );
});

test("doctor validates Railway persistence and demo auth without exposing secrets", () => {
  const valid = inspectEnvironment({
    ALLOWED_ORIGINS: "https://craft.lakebed.app",
    ADMIN_TOKEN: "a-private-admin-token-with-enough-entropy",
    AUTH_MODE: "local-demo",
    DATA_DIR: "/data",
    LOCAL_DEMO_TOKEN: "secret-value",
    RAILWAY_ENVIRONMENT_ID: "environment",
    RAILWAY_PUBLIC_DOMAIN: "example.up.railway.app",
    RAILWAY_VOLUME_MOUNT_PATH: "/data",
    SERVER_ID: "friends",
  });
  assert.deepEqual(valid.errors, []);
  assert.deepEqual(valid.warnings, []);
  assert.doesNotMatch(JSON.stringify(valid), /secret-value/);

  const missingVolume = inspectEnvironment({
    AUTH_MODE: "local-demo",
    LOCAL_DEMO_TOKEN: "secret-value",
    RAILWAY_ENVIRONMENT_ID: "environment",
    SERVER_ID: "friends",
  });
  assert.match(missingVolume.errors.join("\n"), /volume at \/data/);
});

test("checked-in Railway template handoff preserves the stateful service constraints", () => {
  assert.deepEqual(validateTemplatePlan(plan), []);
});

test("Railway config enforces the single-volume topology and a dependency-free image", async () => {
  const railway = JSON.parse(await readFile(new URL("../../apps/game-server/railway.json", import.meta.url), "utf8"));
  assert.equal(railway.build.builder, "DOCKERFILE");
  assert.equal(railway.deploy.numReplicas, 1);
  assert.equal(railway.deploy.requiredMountPath, "/data");
  assert.equal(railway.deploy.healthcheckPath, "/status");
  assert.equal(railway.deploy.sleepApplication, false);

  const dockerfile = await readFile(new URL("../../apps/game-server/Dockerfile", import.meta.url), "utf8");
  assert.match(dockerfile, /FROM oven\/bun:1\.3\.3-alpine@sha256:[a-f\d]{64}/);
  assert.match(dockerfile, /COPY apps\/game-server\/src \.\/src/);
  assert.match(dockerfile, /COPY shared \/app\/shared/);
  assert.doesNotMatch(dockerfile, /\b(?:npm|pnpm|yarn|bun)\s+install\b/);
});
