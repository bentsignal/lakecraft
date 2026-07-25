import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyMouseLookDelta, MAX_LOOK_PITCH } from "../client/game/voxelEngine.ts";

const right = applyMouseLookDelta(0, 0, 100, 0);
assert.ok(right.yaw > 0, "moving the mouse right increases yaw toward world +X");

const left = applyMouseLookDelta(0, 0, -100, 0);
assert.ok(left.yaw < 0, "moving the mouse left decreases yaw toward world -X");

const defaultScaled = applyMouseLookDelta(0, 0, 100, 20);
const halfScaled = applyMouseLookDelta(0, 0, 100, 20, 0.0011);
assert.equal(halfScaled.yaw, defaultScaled.yaw / 2, "custom sensitivity scales horizontal look immediately");
assert.equal(halfScaled.pitch, defaultScaled.pitch / 2, "custom sensitivity scales vertical look immediately");

const down = applyMouseLookDelta(0, 0, 0, 100);
assert.ok(down.pitch < 0, "moving the mouse down keeps Minecraft-style downward pitch");
assert.equal(
  applyMouseLookDelta(0, MAX_LOOK_PITCH, 0, -10_000).pitch,
  MAX_LOOK_PITCH,
  "pitch remains clamped at the engine look limit",
);

const engineSource = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
assert.equal(
  engineSource.includes("Crosshair in clip space"),
  false,
  "the renderer no longer draws a second WebGL crosshair",
);
assert.equal(
  engineSource.match(/gl\.drawArrays\(gl\.LINES, 0, 4\)/g)?.length ?? 0,
  0,
  "the obsolete four-vertex crosshair draw is absent",
);
assert.ok(engineSource.includes("Promise.resolve(canvas.requestPointerLock()).catch"), "denied pointer lock cannot surface an unhandled browser rejection");

const hudSource = readFileSync(new URL("../client/components/GameHud.tsx", import.meta.url), "utf8");
assert.equal(
  hudSource.match(/<Crosshair\s*\/>/g)?.length ?? 0,
  1,
  "the HUD renders exactly one centered reticle",
);
assert.equal(
  hudSource.includes("<ControlsCard"),
  false,
  "the in-game HUD never renders the controls tutorial",
);

const controlsSource = readFileSync(new URL("../client/components/ControlsCard.tsx", import.meta.url), "utf8");
assert.ok(
  /export function ControlsCard[\s\S]*?return null;/.test(controlsSource),
  "the compatibility ControlsCard export cannot reintroduce tutorial chrome",
);

const stylesSource = readFileSync(new URL("../client/components/HudStyles.tsx", import.meta.url), "utf8");
assert.ok(stylesSource.includes("height: 100dvh"), "HUD height follows the dynamic browser viewport");
assert.ok(stylesSource.includes("calc(100dvh - 56px)"), "desktop drawers stay inside the dynamic viewport");
assert.equal(stylesSource.includes(".lc-controls {"), false, "dead tutorial styling is removed");

const appSource = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
assert.ok(
  appSource.indexOf('const [activeBedKey, setActiveBedKey] = useState("")')
    < appSource.indexOf("authorityTrafficPausedRef.current ="),
  "multiplayer state is initialized before the traffic-pause effect reads it",
);

console.log("immediate gameplay blocker tests passed");
