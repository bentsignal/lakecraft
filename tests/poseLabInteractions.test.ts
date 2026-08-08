import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { poseLabScrubValue } from "../client/components/poseLabScrub.ts";
import { resolvePoseLabDrawPreview } from "../client/game/voxelEngine.ts";

assert.equal(poseLabScrubValue(1, 20, 0.01), 1.05, "dragging up increases by one step per four pixels");
assert.equal(poseLabScrubValue(1, -12, 0.01), 0.97, "dragging down decreases the value");
assert.equal(poseLabScrubValue(12, 10, 1), 15, "rotation scrubbing rounds to discrete whole degrees");
assert.equal(poseLabScrubValue(0.06, -100, 0.01, 0.05), 0.05, "size and scale cannot scrub below visibility");
assert.equal(poseLabScrubValue(1, 1, 0.01), 1, "tiny pointer jitter does not alter a value");

assert.equal(resolvePoseLabDrawPreview(true, true, false), false, "paused preview can force the idle bow");
assert.equal(resolvePoseLabDrawPreview(true, true, true), true, "paused preview can force a full draw");
assert.equal(resolvePoseLabDrawPreview(false, true, true), null, "resuming always restores gameplay bow state");
assert.equal(resolvePoseLabDrawPreview(true, false, true), null, "preview cannot affect another held item");

const component = readFileSync(new URL("../client/components/FirstPersonPoseLab.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
const types = readFileSync(new URL("../client/game/types.ts", import.meta.url), "utf8");
assert.match(component, /setPointerCapture\(event\.pointerId\)/, "scrubbing retains the pointer outside a tiny input");
assert.match(component, /Drag rotation or scale up\/down to scrub/);
assert.match(component, /EXCLUSIVE VIEWMODEL/, "Pose Lab identifies the mutually exclusive hand and item modes");
assert.doesNotMatch(component, /label="Position"|label="Pivot"|label="Center"/,
  "Pose Lab keeps each presentation on its reviewed screen anchor");
assert.match(component, /aria-label="Bow draw preview"/);
assert.match(component, /aria-pressed=\{bowDrawn\}/);
assert.match(component, /This never fires or consumes an arrow/);
assert.match(component, /Editing perspective/);
assert.match(component, /publishThirdPersonTuning\(next\)/,
  "third-person controls publish directly into the retained renderer");
assert.match(component, /thirdPersonPoseGroupForItem\(itemId\)/,
  "third-person previews edit the same item-family transform used by the renderer");
assert.match(component, /Hand socket offset/);
assert.match(component, /Rotation delta/);
assert.match(component, /onCameraModeChange\?\.\("third_person_back"\)/,
  "selecting third-person editing switches to the rear inspection camera");
assert.match(app, /onBowPreviewChange=\{setPoseLabBowPreview\}/);
assert.match(app, /onCameraModeChange=\{\(mode\) => engineRef\.current\?\.setCameraMode\(mode\)\}/);
assert.match(types, /setPoseLabDrawPreview\(drawn: boolean \| null\): void/);
assert.match(types, /setCameraMode\(mode: PlayerCameraMode\): void/);

console.log("Pose Lab scrubbing and paused bow preview tests passed");
