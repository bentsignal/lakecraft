import assert from "node:assert/strict";
import { test } from "node:test";
import { requirePersonalRailwaySession, reviewOrigin, railwayWorldVariables, validateRailwayBinding } from "../scripts/railway-multiplayer.mjs";

const id = number => `00000000-0000-0000-0000-${String(number).padStart(12, "0")}`;
const edges = values => ({ edges: values.map(node => ({ node })) });
function fixture() {
  const binding = {
    format: "lakecraft.railway-review.v1", channel: "development", account: "developer@example.test",
    workspaceId: id(1), projectId: id(2), environmentId: id(3), serviceId: id(4), volumeId: id(5),
    projectName: "lakecraft-test-1234567890", lakebedOrigin: "https://review-example.lakebed.app", lakebedDeployId: "dep_example",
    railwayUrl: "https://world-development.up.railway.app",
  };
  const identity = { email: binding.account, workspaces: [{ id: id(1) }] };
  const environment = { id: id(3), name: "development", canAccess: true,
    serviceInstances: edges([{ serviceId: id(4), source: {} }]),
    volumeInstances: edges([{ volume: { id: id(5) }, serviceId: id(4), mountPath: "/data" }]),
  };
  const project = { id: id(2), name: binding.projectName, workspaceId: id(1), environments: edges([environment]) };
  return { binding, identity, environment, project };
}

test("contributor provisioning rejects CI and inherited Railway tokens", () => {
  requirePersonalRailwaySession({});
  for (const name of ["CI", "GITHUB_ACTIONS", "RAILWAY_TOKEN", "RAILWAY_API_TOKEN"]) {
    assert.throws(() => requirePersonalRailwaySession({ [name]: "present" }), /personal Railway CLI/);
  }
});

test("non-production destinations are exact origins, never credentials or URL suffix tricks", () => {
  assert.equal(reviewOrigin("https://review-example.lakebed.app/"), "https://review-example.lakebed.app");
  for (const url of ["https://craft.lakebed.app", "http://review-example.lakebed.app", "https://x.lakebed.app.evil.test",
    "https://token@x.lakebed.app", "https://x.lakebed.app/path", "https://x.lakebed.app/?production=1"]) {
    assert.throws(() => reviewOrigin(url));
  }
});

test("binding checks account, project, service, volume and environment isolation", () => {
  const good = fixture();
  assert.equal(validateRailwayBinding(good.binding, good.identity, good.project), good.binding);
  for (const change of [
    f => { f.identity.email = "someone-else@example.test"; },
    f => { f.identity.workspaces = []; },
    f => { f.project.id = id(20); },
    f => { f.project.name = "lakecraft-production"; },
    f => { f.environment.name = "production"; },
    f => { f.environment.serviceInstances.edges[0].node.source.repo = "someone/repo"; },
    f => { f.environment.volumeInstances.edges[0].node.serviceId = id(40); },
    f => { f.environment.volumeInstances.edges[0].node.mountPath = "/production-data"; },
    f => { f.project.environments.edges.push({ node: { id: id(8), serviceInstances: edges([{}]) } }); },
  ]) {
    const changed = fixture(); change(changed);
    assert.throws(() => validateRailwayBinding(changed.binding, changed.identity, changed.project));
  }
});

test("world uses the matching review ticket issuer and never demo identity", () => {
  const { binding } = fixture();
  const registration = { url: binding.lakebedOrigin, deployId: binding.lakebedDeployId,
    serverId: "registered-server", serverCredential: "x".repeat(48), canonicalWssUrl: "wss://world-development.up.railway.app/ws" };
  const variables = railwayWorldVariables(binding, registration);
  assert.equal(variables.AUTH_MODE, "lakebed");
  assert.equal(variables.ALLOWED_ORIGINS, binding.lakebedOrigin);
  assert.equal(variables.LAKEBED_TICKET_REDEEM_URL, `${binding.lakebedOrigin}/api/multiplayer/redeem-join-ticket`);
  assert.equal(variables.LOCAL_DEMO_TOKEN, undefined);
  assert.equal(variables.RAILWAY_DEPLOYMENT_OVERLAP_SECONDS, "0");
  assert.throws(() => railwayWorldVariables(binding, { ...registration, deployId: "production" }));
  assert.throws(() => railwayWorldVariables(binding, { ...registration, url: "https://craft.lakebed.app" }));
  assert.throws(() => railwayWorldVariables(binding, { ...registration, canonicalWssUrl: "wss://another-world.up.railway.app/ws" }));
});
