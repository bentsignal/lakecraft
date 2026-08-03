import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FIRST_PERSON_TUNING } from "../client/game/firstPersonTuning.ts";

const tuningSource = readFileSync(new URL("../client/game/firstPersonTuning.ts", import.meta.url), "utf8");
const guide = readFileSync(new URL("../docs/first-person-pose-tuning.md", import.meta.url), "utf8");
const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
const singlePlayer = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");

for (const group of ["arm", "tool", "bow", "otherItem"] as const) {
  assert.deepEqual(FIRST_PERSON_TUNING[group].position, [0, 0, 0], `${group} keeps its neutral position`);
  assert.deepEqual(FIRST_PERSON_TUNING[group].rotationDegrees, [0, 0, 0], `${group} keeps its neutral rotation`);
  assert.equal(FIRST_PERSON_TUNING[group].scale, 1, `${group} keeps its neutral scale`);
  assert.match(tuningSource, new RegExp("EDIT `" + group + "` FOR", "i"),
    `${group} has a literal human-facing edit label`);
}
assert.deepEqual(FIRST_PERSON_TUNING.arm.pivot, [0.56, -0.49, -1.23]);
assert.deepEqual(FIRST_PERSON_TUNING.tool.pivot, [0.14, -0.16, -1.17]);
assert.deepEqual(FIRST_PERSON_TUNING.bow.pivot, [0.40, 0, -1.12]);
assert.deepEqual(FIRST_PERSON_TUNING.otherItem.pivot, [0.08, -0.04, -1.18]);
assert.equal(tuningSource.includes("unchanged("), false, "every user-editable group is an explicit object");
assert.match(tuningSource, /LEAVE THIS ALONE AT FIRST[^\n]*`rig`/,
  "the global rig cannot be mistaken for the first tuning target");
assert.match(tuningSource, /X: bigger moves RIGHT; smaller moves LEFT/);
assert.match(tuningSource, /position:[^\n]*change by 0\.02/);
assert.match(tuningSource, /rotationDegrees: change by 5/);

for (const target of ["block", "tool", "bow", "arm", "otherItem", "rig"]) {
  assert.match(guide, new RegExp(`\\b${target}\\b`), `the guide names ${target}`);
}
assert.match(guide, /Save the file\. Look at the paused browser/);
assert.match(guide, /press \*\*Undo\*\*/);
assert.match(guide, /do not need to unpause, click the game, or refresh the browser/i);
assert.match(guide, /tab is completely hidden[^\n]*redraw waits/i);

assert.match(engine, /if \(paused && !firstPersonFeedbackHidden && playerHealth > 0[\s\S]{0,100}document\.visibilityState === "visible"\) \{[\s\S]{0,100}render\(pausedVisualTime, 0, pausedVisualTime\)/,
  "a paused HMR remount seeds a complete visible pose frame");
assert.ok(engine.includes("now - lastPausedRenderAt >= PAUSED_RENDER_INTERVAL_MS")
  && engine.includes("render(pausedVisualTime, 0, pausedVisualTime, false)"),
"the visible paused pose continues redrawing at the bounded preview cadence");
const feedbackPredicates = [...singlePlayer.matchAll(/setFirstPersonFeedbackHidden\(([\s\S]*?)\);/g)]
  .map((match) => match[1]);
assert.ok(feedbackPredicates.length >= 2);
assert.ok(feedbackPredicates.every((predicate) => !predicate.includes("pauseOpen")),
  "Game Menu keeps the paused pose visible");
assert.ok(feedbackPredicates.every((predicate) => !predicate.includes("pointerCaptureNeeded")),
  "Click to Play keeps the paused pose visible");

console.log("first-person pose tuning guide and paused-preview contract tests passed");
