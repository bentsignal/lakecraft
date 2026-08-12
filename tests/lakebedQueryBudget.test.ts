import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const client = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
const server = readFileSync(new URL("../server/index.ts", import.meta.url), "utf8");

test("lobby hydrates through one positional Lakebed query and then unmounts it", () => {
  const bridge = client.slice(
    client.indexOf("function LobbyBootstrapQuery"),
    client.indexOf("function InventoryQuery"),
  );
  assert.equal((bridge.match(/useQuery</g) ?? []).length, 1);
  assert.match(bridge, /useQuery<ClientBootstrap>\("clientBootstrap"\)/);
  assert.match(client, /transportForeground && lakebedIdentity !== "" && !bootstrapReady/);
  assert.match(client, /setBootstrapIdentity\(identity\)/);

  const bootstrap = server.slice(
    server.indexOf("clientBootstrap: query"),
    server.indexOf("externalMultiplayerServers: query"),
  );
  assert.match(bootstrap, /return \[presence, inventory, profile, servers\] as const/);
  assert.doesNotMatch(bootstrap, /return \{/);
});

test("Railway multiplayer keeps only inventory subscribed while world queries are legacy-only", () => {
  const bridge = client.slice(
    client.indexOf("function LakebedWorldQueries"),
    client.indexOf("function GameApp"),
  );
  assert.deepEqual(
    [...bridge.matchAll(/useQuery<[^\n]+?\>\("([^"]+)"/g)].map((match) => match[1]).sort(),
    ["chestAt", "droppedItems", "myPresence", "playerCombatStates", "worldChunks", "worldClock", "worldEdits"].sort(),
  );
  assert.match(bridge, /"furnaceAt"/);
  assert.match(client, /transportForeground && !realtimeSession \? \(/);
  assert.match(client, /transportForeground \? <InventoryQuery onResult=\{setSavedInventory\} \/> : null/);
});

test("GameApp no longer mounts Lakebed reads unconditionally", () => {
  const body = client.slice(client.indexOf("function GameApp"), client.indexOf("const editWorldBlock"));
  assert.doesNotMatch(body, /useQuery</);
});
