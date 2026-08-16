import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const lobby = readFileSync(new URL("../client/lobby/LobbyScreen.tsx", import.meta.url), "utf8");
const renderer = readFileSync(new URL("../client/lobby/TitlePanorama.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../client/lobby/LobbyStyles.tsx", import.meta.url), "utf8");

assert.ok(lobby.includes("<TitlePanorama />") && lobby.includes('aria-label="Lakecraft" data-title="LAKECRAFT"'),
  "the title uses the shared voxel panorama and an original dimensional Lakecraft word treatment");
assert.equal(lobby.includes("lc-title-hills"), false, "the retired disconnected CSS landscape is not rendered");
assert.ok(renderer.includes("TEXTURE_ATLAS_RGBA") && renderer.includes("textureAtlasUv"),
  "the title scene reuses the exact gameplay block atlas and UV contract");
assert.ok(renderer.includes('canvas.getContext("webgl"') && renderer.includes("gl.drawArrays(gl.TRIANGLES"),
  "the background is an actual depth-tested textured 3D scene");
assert.ok(renderer.includes("powerPreference: \"low-power\"") && renderer.includes("Math.min(devicePixelRatio || 1, 1.5)"),
  "the always-visible title renderer caps resolution and requests the efficient GPU path");
assert.ok(renderer.includes("prefers-reduced-motion: reduce") && renderer.includes("document.hidden"),
  "motion pauses for reduced-motion users and background tabs");
assert.ok(renderer.includes("now - lastDraw >= 33"),
  "the low-power panorama caps GPU redraws at roughly 30fps instead of rendering every display frame");
assert.ok(styles.includes("content:attr(data-title)") && styles.includes("rotateX(8deg)"),
  "Lakecraft receives its own layered dimensional lettering without copying a bitmap wordmark");

console.log("Lakecraft title presentation tests passed");
