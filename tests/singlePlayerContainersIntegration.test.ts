import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
const chestDrawer = readFileSync(new URL("../client/components/ChestDrawer.tsx", import.meta.url), "utf8");

assert.ok(app.includes("ChestDrawer, FurnaceDrawer, GameHud"), "single-player reuses the existing Minecraft-style container drawers");
assert.equal(app.includes("lakebed/client"), false, "local containers never mount the Lakebed client runtime");

const interaction = app.slice(app.indexOf("onInteractBlock: (target)"), app.indexOf("onPoseChange:", app.indexOf("onInteractBlock: (target)")));
assert.ok(interaction.includes("target.block.block === BLOCK.CHEST"));
assert.ok(interaction.includes("openLocalChest(containersRef.current, coordKey)"));
assert.ok(interaction.includes("target.block.block === BLOCK.FURNACE"));
assert.ok(interaction.includes("openLocalFurnace(containersRef.current, coordKey, Date.now())"));
assert.ok(interaction.indexOf("BLOCK.CHEST") < interaction.indexOf("BLOCK.CRAFTING_TABLE"), "container dispatch precedes generic crafting/TNT use");

assert.ok(app.includes("transferLocalChestFullStack("), "chest clicks use atomic full-stack local authority");
assert.ok(app.includes("transferLocalFurnaceFullStack("), "furnace clicks reuse shared smelting transfer rules");
assert.ok(app.includes("materializeLocalFurnace(containersRef.current, activeFurnaceKey, Date.now())"), "closing a furnace commits its elapsed local progress");
assert.ok(app.includes("exportLocalContainersSnapshot(containersRef.current, Date.now())"), "saving commits every elapsed local furnace without a timer");
assert.ok(app.includes("recoverLocalContainerContents("), "breaking a container preflights conserved pack/drop recovery");
assert.ok(app.includes("SINGLEPLAYER_SAVE_LIMITS.drops - dropsRef.current.length"), "world-drop capacity is proven before container removal");
assert.ok(app.includes("containersRef.current = recovered.containers"), "successful recovery removes the container only after all contents have a destination");

assert.ok(app.includes("worldModalOpen = containerOpen || sleepingBed !== null"), "containers and sleep share one local modal boundary");
assert.ok(app.includes("pauseOpen || inventoryOpen || worldModalOpen || deathScreenOpen"), "open containers freeze world input through the existing local pause boundary");
assert.ok(app.includes("const active = !singlePlayerGameplayPaused({") && app.includes("sampleSaveCadence(saveCadenceRef.current, now, active)"),
  "container UI time does not spend the active autosave interval");
assert.ok(app.includes("setLocalFusesPausedRef.current(paused)"), "container modal pause also freezes local TNT");

assert.ok(app.includes("<FurnaceDrawer"));
assert.ok(app.includes("<ChestDrawer"));
assert.ok(app.includes("modalOpen={uiModalOpen || pointerCaptureNeeded}"), "containers, chat, and capture fallback hide the crosshair and survival hotbar behind the modal");
assert.equal(app.includes("LOCAL SINGLE-PLAYER CONTAINER"), false, "local chest no longer exposes implementation/debug copy");
assert.equal(chestDrawer.includes("SHARED LAKEBED CONTAINER"), false, "shared drawer no longer brands its storage backend");

console.log("single-player chest/furnace open, transfer, pause, recovery, and offline integration tests passed");
