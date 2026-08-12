import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createLocalGameplayAuthority,
  createRailwayGameplayAuthority,
} from "../client/gameplay/authority.ts";
import { createGameplayPresentationOptions } from "../client/gameplay/presentation.ts";
import { createEmptyEquipment, createStarterInventory } from "../shared/game.ts";

test("local and Railway worlds enter through one gameplay session boundary", () => {
  const local = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
  const railway = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
  for (const source of [local, railway]) {
    assert.match(source, /<GameplaySessionSurface/);
    assert.match(source, /createGameplaySessionEngine\(/);
    assert.match(source, /createGameplayPresentationOptions\(/);
    assert.doesNotMatch(source, /createVoxelEngine\(/);
  }
  assert.match(local, /createLocalGameplayAuthority\(/);
  assert.match(railway, /createRailwayGameplayAuthority\(/);
  assert.match(local, /authority="local"/);
  assert.match(railway, /authority="railway"/);
});

test("Railway gameplay cannot split world authority back into Lakebed", () => {
  const railway = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
  for (const retired of [
    "editWorldBlock", "growOakTree", "heartbeatPlayer", "authorizeRespawn",
    "startPresenceSession", "leavePlayer", "transferChest", "operateFurnace",
    "sleepInBed", "attackMob", "shearMob", "checkpointMobWorld",
    "claimMobPlayerDamage", "claimCreeperExplosion", "igniteTnt",
    "claimTntExplosion", "attackPlayer", "rangedCombat", "dropItemMutation",
    "pickupDroppedItemMutation", "MultiplayerSegmentTransport",
  ]) assert.doesNotMatch(railway, new RegExp(`\\b${retired}\\b`), `${retired} must not re-enter Railway gameplay`);
  assert.match(railway, /useMutation<[\s\S]*?>\("applyInventoryAction"\)/,
    "Lakebed remains the account inventory authority");
  assert.match(railway, /createExternalMultiplayerJoinTicket/,
    "Lakebed remains the directory and ticket issuer");
});

test("authority adapters fail closed around incompatible ownership", () => {
  const onBlockEdit = () => undefined;
  const local = createLocalGameplayAuthority({ acceptWorldEdits: () => true, onBlockEdit });
  assert.equal(local.kind, "local");
  assert.equal(local.capabilities.localSimulation, true);
  assert.equal(local.capabilities.realtimePeers, false);
  assert.throws(() => createLocalGameplayAuthority({ onBlockEdit }), /synchronous edit reservation/);

  const railway = createRailwayGameplayAuthority({ canEditBlock: () => true, onBlockEdit });
  assert.equal(railway.kind, "railway");
  assert.equal(railway.capabilities.authoritativeDrops, true);
  assert.equal(railway.capabilities.localSimulation, false);
  assert.equal(railway.engineOptions.simulateMobs, undefined,
    "the engine boundary, not individual callers, selects simulation ownership");
  assert.throws(() => createRailwayGameplayAuthority({
    canEditBlock: () => true,
    onBlockEdit,
    onSimulationStep: () => undefined,
  }), /offline world ownership/);
});

test("presentation rules are authority-independent", () => {
  const inventory = createStarterInventory();
  const equipment = createEmptyEquipment();
  const selected: number[] = [];
  const options = createGameplayPresentationOptions({
    getSettings: () => ({ fovDegrees: 90, mouseSensitivity: 100 }),
    getInventory: () => inventory,
    getEquipment: () => equipment,
    getSelectedHotbar: () => 2,
    getGameMode: () => "survival",
    getHunger: () => 20,
    selectHotbar: (index) => selected.push(index),
    audio: { play: () => true },
    footstepSeedPrefix: "test",
    onPerformanceStats: () => undefined,
  });
  assert.equal(options.canSprint?.(), true);
  assert.equal(options.canCreativeFly?.(), false);
  assert.equal(options.canTakePlayerDamage?.(), true);
  options.onHotbarCycle?.(1);
  assert.deepEqual(selected, [3]);
});
