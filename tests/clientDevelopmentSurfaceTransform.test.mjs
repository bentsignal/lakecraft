import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  stripClientDevelopmentSurfaces,
  stripVoxelDevelopmentSurfaces,
} from "../scripts/client-development-surface-transform.mjs";

const source = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
for (const component of ["FirstPersonPoseLab", "VisualLab"]) {
  assert.ok(source.includes(`<${component}`), `normal local development still renders ${component}`);
}
assert.ok(source.includes("ChestDrawer, FirstPersonPoseLab, FurnaceDrawer"),
  "the paused Pose Lab is part of the production gameplay import surface");
assert.ok(source.includes("import { VisualLab }"), "normal local development still imports the full Visual Lab");
assert.ok(source.includes("SinglePlayerPerformanceBenchmark"),
  "normal local development exposes the autonomous WebGL benchmark");

const compact = stripClientDevelopmentSurfaces(source);
for (const developmentOnly of [
  "VisualLab", "visualLabOpen", "setVisualLabOpen", "SinglePlayerPerformanceBenchmark", "benchmarkDistance",
]) {
  assert.equal(compact.includes(developmentOnly), false,
    `compact anonymous source excludes development-only ${developmentOnly}`);
}
for (const retainedPoseSurface of [
  "FirstPersonPoseLab", "setPoseLabBowPreview", "setPoseLabHeldItemPreview", "setPoseLabUsePreview",
]) {
  assert.ok(compact.includes(retainedPoseSurface),
    `compact production source retains paused pose tuning through ${retainedPoseSurface}`);
}
assert.equal(compact.includes("@lakecraft-development:"), false,
  "compact source consumes every reviewed marker");
assert.ok(compact.includes("handleGameplayScreenshotKey"),
  "production retains the shared single-player screenshot workflow");
assert.ok(compact.includes("const uiModalOpen = worldModalOpen || commandOpen;"),
  "production modal semantics remain valid after the Visual Lab state is removed");
assert.throws(
  () => stripClientDevelopmentSurfaces(source.replace("onClose={() => setVisualLabOpen(false)}", "onClose={onClose}")),
  /Compact development-surface render changed/,
  "development UI changes require an explicit compact-stage review",
);
assert.throws(
  () => stripClientDevelopmentSurfaces(source.replace("/* @lakecraft-development:state:start */", "")),
  /marker state is missing/,
  "missing compact-stage markers fail closed",
);

const voxelSource = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
assert.ok(voxelSource.includes("setPoseLabRigPreview"),
  "normal local development exposes the visual rig preview");
assert.ok(voxelSource.includes("setBenchmarkLook"),
  "normal local development exposes deterministic benchmark look control");
const compactVoxel = stripVoxelDevelopmentSurfaces(voxelSource);
for (const developmentOnly of ["thirdPersonRigPreview", "setPoseLabRigPreview", "setBenchmarkLook", "@lakecraft-voxel-development:"]) {
  assert.equal(compactVoxel.includes(developmentOnly), false,
    `compact anonymous voxel source excludes development-only ${developmentOnly}`);
}
assert.ok(compactVoxel.includes("pendingScreenshot") && compactVoxel.includes("captureScreenshot"),
  "production retains next-frame capture for both gameplay modes");
assert.match(compactVoxel,
  /playerRigInputForMovement\(\s*movementMode,\s*thirdPersonRigTimeMs,\s*movementActivity > 0\.5,?\s*\)/,
  "production retains the immersion-scaled movement rig after the preview override is removed");
assert.throws(
  () => stripVoxelDevelopmentSurfaces(voxelSource.replace("previewMode,", '"idle",')),
  /Compact voxel development-surface rig-preview changed/,
  "voxel preview changes require an explicit compact-stage review",
);
assert.throws(
  () => stripVoxelDevelopmentSurfaces(voxelSource.replace(
    "/* @lakecraft-voxel-development:method:start */",
    "",
  )),
  /marker method is missing/,
  "missing voxel compact-stage markers fail closed",
);

console.log("client development-surface compact staging tests: ok");
