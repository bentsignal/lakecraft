import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const lobby = readFileSync(new URL("../client/lobby/LobbyScreen.tsx", import.meta.url), "utf8");
const renderer = readFileSync(new URL("../client/lobby/TitlePanorama.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../client/lobby/LobbyStyles.tsx", import.meta.url), "utf8");
const titleLogo = readFileSync(new URL("../client/lobby/TitleLogo.tsx", import.meta.url), "utf8");

assert.ok(lobby.includes("<TitlePanorama />") && lobby.includes("<TitleLogo />"),
  "the title uses the shared voxel panorama and dedicated generated Lake Bed Edition wordmark");
assert.ok(titleLogo.includes("LAKE_BED_EDITION_TITLE_WEBP_BASE64")
  && titleLogo.includes("data:image/webp;base64")
  && titleLogo.includes('alt="Minecraft — Lake Bed Edition"'),
"the generated wordmark is an accessible, deterministic embedded image asset");
assert.doesNotMatch(lobby, /Build farther|Wander together/,
  "the title screen does not include the removed tagline");
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
assert.ok(renderer.includes("rotation += elapsed * .000025") && renderer.includes("lastTick = performance.now()"),
  "returning from a hidden tab preserves the camera heading without accumulating a jump");
assert.ok(renderer.includes("gl.deleteShader(vertexShader)") && renderer.includes("gl.deleteShader(fragmentShader)"),
  "linked title shaders are released instead of waiting for context teardown");
assert.ok(renderer.includes("if (buffer) gl.deleteBuffer(buffer)") && renderer.includes("if (texture) gl.deleteTexture(texture)"),
  "partial panorama allocation failures clean up the resources already created");
assert.ok(renderer.includes('window.addEventListener("resize", resize)') && renderer.includes("if (reduced) renderer.render(.72)"),
  "the reduced-motion still frame recomputes its aspect after a resize");
assert.ok(renderer.includes("const WORLD_SIZE = 72") && renderer.includes("p-vec3(${CAMERA_CENTER},5.55,${CAMERA_CENTER})"),
  "the panorama places a fixed camera inside a horizon-filling world instead of orbiting a finite island");
assert.ok(renderer.includes("f=clamp((w.z-20.)/16.,0.,1.)"),
  "distance fog hides the bounded scene edge at the panorama horizon");
assert.ok(styles.includes(".lc-title-logo img") && styles.includes("object-fit:contain"),
  "the generated title preserves its aspect ratio across supported title-screen sizes");

console.log("Lakecraft title presentation tests passed");
