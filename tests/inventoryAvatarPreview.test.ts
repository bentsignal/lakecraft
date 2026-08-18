import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inventoryPreviewLook, inventoryPreviewViewProjection } from "../client/components/inventoryPreviewLook.ts";

const drawer = readFileSync(new URL("../client/components/InventoryDrawer.tsx", import.meta.url), "utf8");
const preview = readFileSync(new URL("../client/components/PlayerSkinPreview.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../client/components/HudStyles.tsx", import.meta.url), "utf8");
const multiplayer = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
const gameHud = readFileSync(new URL("../client/components/GameHud.tsx", import.meta.url), "utf8");

assert.ok(drawer.includes("<PlayerSkinPreview equipment={workspace.equipment} open={open} pointer={[pointer.x, pointer.y]} />"),
  "inventory sends live pointer coordinates to the canonical skin portrait");
assert.ok(preview.includes("loadPersistedPlayerSkin(window.localStorage)"), "portrait loads the user's selected skin");
assert.ok(preview.includes("equipment.head?.itemId") && preview.includes("renderer.setArmor({"),
  "the portrait uses the shared F5 armor renderer for the currently equipped set");
assert.ok(preview.includes('canvas?.getContext("webgl"') && preview.includes("createPlayerSkinRenderer(gl)"),
  "portrait is a real WebGL player render using the shared F5 renderer");
assert.ok(preview.includes("renderer.draw(viewProjection") && preview.includes("renderer.setSkin(selected, persisted.model)"),
  "both the default and selected skin render through the shared 3D geometry");
assert.ok(preview.includes("yaw: Math.PI - look[0] * .42") && preview.includes("headYaw: look[0] * .62")
  && preview.includes("headPitch: look[1] * .38"),
"the front-facing 3D torso and independently jointed head track the cursor naturally");
assert.equal(preview.includes('getContext("2d")'), false, "the flat 2D paper-doll path is completely removed");
assert.ok(preview.includes('gl.getExtension("WEBGL_lose_context")?.loseContext()'),
  "closing inventory explicitly retires its short-lived context instead of evicting the older world renderer");
assert.deepEqual(inventoryPreviewLook([73.5, 105], [0, 0, 147, 210]), [0, 0]);
assert.deepEqual(inventoryPreviewLook([1000, -1000], [0, 0, 147, 210]), [1, -1],
  "cursor look is bounded at the viewport extremes");
const projection = inventoryPreviewViewProjection(147 / 210);
assert.equal(projection.length, 16);
assert.ok([...projection].every(Number.isFinite) && projection[0] > projection[5]
  && projection[11] === -1 && Math.abs(projection[15] - 3.2) < 1e-6,
"portrait camera is a deterministic tall-canvas perspective centered on the full body");
assert.match(styles, /\.lc-player-preview \{[^}]*image-rendering:pixelated;[^}]*min-height:192px;/);
assert.equal(styles.includes(".lc-player-preview__head"), false, "obsolete hardcoded CSS Steve is removed");
assert.equal(drawer.includes("lc-armor-score"), false, "preview should not overlay debug-style armor text");
assert.ok(multiplayer.includes("onInventoryWorkspacePreview={(snapshot) => {")
  && multiplayer.includes("updateEquipment(snapshot.equipment);")
  && !multiplayer.includes('if (realtimeGameModeRef.current === "creative") return true;'),
"each multiplayer equipment interaction updates local/remote appearance immediately and Creative still commits on close");
assert.ok(gameHud.includes('document.documentElement.style.setProperty("--lc-hud-scale"')
  && gameHud.includes('settings.hudSize === "small" ? ".67" : settings.hudSize === "medium" ? ".83" : "1"')
  && styles.includes("height:42px;transform:translate(-3px,-3px);width:42px"),
"the three shared HUD scales retain centered Minecraft-like padding inside the survival inventory slots");

const compactMedia = styles.slice(styles.indexOf("@media (max-width: 560px)"));
assert.ok(compactMedia.includes(".lc-equipment-panel { display: none; }"), "compact inventory still hides the portrait");

console.log("inventory canonical skin preview checks passed");
