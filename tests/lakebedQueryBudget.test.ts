import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const client = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
const server = readFileSync(new URL("../server/index.ts", import.meta.url), "utf8");

test("lobby hydrates through one positional Lakebed query and then unmounts it", () => {
  const bridge = client.slice(
    client.indexOf("function LobbyBootstrapQuery"),
    client.indexOf("function RailwayMultiplayerSession"),
  );
  assert.equal((bridge.match(/useQuery</g) ?? []).length, 1);
  assert.match(bridge, /useQuery<ClientBootstrap>\("clientBootstrap"\)/);
  assert.match(client, /transportForeground && lakebedIdentity !== "" && !bootstrapReady/);
  assert.match(client, /setBootstrapIdentity\(identity\)/);
  assert.match(client, /<ErrorBoundary fallback=\{\(error, retry\) => <LobbyBootstrapRecovery/,
    "only the lobby bootstrap query is allowed to enter Lakebed recovery UI");
  const appBoundary = client.slice(client.indexOf("function LakebedMultiplayerApp"), client.indexOf("export function App"));
  assert.doesNotMatch(appBoundary, /<ErrorBoundary/,
    "a Lakebed lobby failure cannot replace an active Railway gameplay session");

  const bootstrap = server.slice(
    server.indexOf("clientBootstrap: query"),
    server.indexOf("externalMultiplayerServers: query"),
  );
  assert.match(bootstrap, /return \[presence, inventory, profile, servers\] as const/);
  assert.doesNotMatch(bootstrap, /return \{/);
  assert.match(bootstrap, /const authenticated = hasAuthenticatedUser\(ctx\)/);
  for (const table of ["playerPresence", "inventories", "profiles"]) {
    assert.match(bootstrap, new RegExp(`const [^=]+ = authenticated[\\s\\S]+?ctx\\.db\\.${table}`),
      `${table} is never queried with a guest identity`);
  }
});

test("retired shared-world recovery copy cannot return", () => {
  assert.doesNotMatch(client, /shared world query|RECONNECTING TO LAKEBED/);
  assert.match(client, /A running Railway world is never disconnected by this lobby request\./);
});

test("Railway gameplay has no Lakebed world or inventory polling bridge", () => {
  assert.doesNotMatch(client, /function (?:InventoryQuery|LakebedWorldQueries)/);
  assert.doesNotMatch(client, /useQuery<[^\n]+?>\("(?:myInventory|chestAt|droppedItems|myPresence|playerCombatStates|worldChunks|worldClock|worldEdits|furnaceAt)"/);
  assert.match(client, /if \(!inWorld \|\| !inventoryReady \|\| !realtimeSession \|\| !realtimeTerrain\) return/,
    "the gameplay engine waits for Railway to provide its terrain authority descriptor");
  assert.match(client, /terrain: realtimeTerrain/,
    "the Railway terrain descriptor is passed into the shared gameplay engine");
  assert.match(client, /const realtimeSink = realtimeSession \? realtimeInventorySinkRef\.current : null/);
  assert.match(client, /realtimeSink[\s\S]*?await realtimeSink\(pending\.requestJson\)[\s\S]*?: await applyInventoryActionMutation/,
    "ordinary multiplayer inventory actions are kept off the Lakebed mutation quota");
});

test("RailwayMultiplayerSession no longer mounts Lakebed reads unconditionally", () => {
  const body = client.slice(client.indexOf("function RailwayMultiplayerSession"), client.indexOf("const editWorldBlock"));
  assert.doesNotMatch(body, /useQuery</);
});
