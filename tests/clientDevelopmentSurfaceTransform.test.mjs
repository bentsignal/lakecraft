import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  stripClientDevelopmentSurfaces,
  stripVoxelDevelopmentSurfaces,
} from "../scripts/client-development-surface-transform.mjs";

const source = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
for (const component of ["FirstPersonPoseLab", "VisualLab"]) {
  assert.ok(source.includes(`<${component}`), `normal local development still renders ${component}`);
  assert.ok(source.includes(`import { FirstPersonPoseLab, VisualLab }`),
    "normal local development still imports both inspection surfaces");
}

const compact = stripClientDevelopmentSurfaces(source);
for (const developmentOnly of [
  "FirstPersonPoseLab", "VisualLab", "visualLabOpen", "setVisualLabOpen", "setPoseLabBowPreview",
  "setPoseLabHeldItemPreview", "setPoseLabUsePreview",
]) {
  assert.equal(compact.includes(developmentOnly), false,
    `compact anonymous source excludes development-only ${developmentOnly}`);
}
assert.equal(compact.includes("@lakecraft-development:"), false,
  "compact source consumes every reviewed marker");
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
const compactVoxel = stripVoxelDevelopmentSurfaces(voxelSource);
for (const developmentOnly of ["thirdPersonRigPreview", "setPoseLabRigPreview", "@lakecraft-voxel-development:"]) {
  assert.equal(compactVoxel.includes(developmentOnly), false,
    `compact anonymous voxel source excludes development-only ${developmentOnly}`);
}
assert.ok(compactVoxel.includes("playerRigInputForMovement(movementMode, now, movementActivity > 0)"),
  "production movement-driven rig behavior remains after the preview override is removed");
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
