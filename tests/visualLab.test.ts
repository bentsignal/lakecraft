import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ITEMS } from "../shared/game.ts";

const component = readFileSync(new URL("../client/components/VisualLab.tsx", import.meta.url), "utf8");
const renderer = readFileSync(new URL("../client/game/visualLabRenderer.ts", import.meta.url), "utf8");
for (const contract of [
  "itemVisualIds()", "Visual catalog", "DRAG TO ORBIT", "Visual state", "Player + skin",
  "readPlayerSkinFile", "64×64 / 128×128 PNG", "local preview only", "Wide · 4px", "Slim · 3px",
  "Mob catalog", "Mob visual state", "production mob batch", "Use in this world",
  "First person", "PRODUCTION FIRST-PERSON", "SCREEN-SPACE CAMERA · LIVE POSE TUNING",
  "Preview lighting", "Preview background", "LIGHTING_PRESETS", "BACKGROUNDS",
  "Contact sheet", "Production asset contact sheet", "CLICK TO INSPECT IN 3D",
  "Player armor preview", "ARMOR_MATERIALS", "No armor",
  "Dropped", "PRODUCTION DROPPED-ITEM BATCH · CATALOG PIXELS",
  "savePersistedPlayerSkin", "clearPersistedPlayerSkin", "saved in this browser",
  "Player rig motion", "POSE CYCLE", "THIRD-PERSON HELD ITEM", "Empty hand",
  "createProductionContactSheetExport", "Download PNG", "downloadContactSheet",
  "itemIconFingerprint(selected)", "Fingerprint",
]) assert.ok(component.includes(contract), `Visual Lab exposes ${contract}`);
for (const contract of [
  "appendItemSpriteGeometry", "getBowIconArt", "blockGeometry", "blockTextureForFace",
  "TEXTURE_ATLAS_RGBA", "buildPlayerSkinGeometry", "setPlayerSkin",
  "createMobRenderer", "setMob(kind, state", "mobRenderer.buffer", "MOB_DEFINITIONS",
  "createFirstPersonRenderer", "createFirstPersonSkinRenderer", "setViewmodel(itemId",
  "appendSpecialBedMesh", "appendSpecialDoorMesh", "appendOakFenceMesh", "setLighting(preset)", "uLight",
  "setPlayerArmor(material)", "fullPlayerArmorAppearance",
  "createDroppedItemRenderer", "setDroppedItem(itemId)", "droppedItemRenderer.buffer",
  "setPlayerPose(motion, phase)", "playerRenderer.drawCallCount",
]) assert.ok(renderer.includes(contract), `Visual Lab renders through ${contract}`);
assert.ok(Object.keys(ITEMS).length >= 97, "the inspected production catalog remains comprehensive");
assert.doesNotMatch(component, /fetch\(|XMLHttpRequest|storage\.upload/,
  "skin inspection never transmits the selected file");
console.log("production-backed Visual Lab contract tests passed");
