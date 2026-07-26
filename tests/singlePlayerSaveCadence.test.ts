import assert from "node:assert/strict";
import {
  SINGLEPLAYER_AUTOSAVE_ACTIVE_MS,
  SINGLEPLAYER_MAX_ACTIVE_SAMPLE_GAP_MS,
  commitSaveCadence,
  createSaveCadenceState,
  markSaveCadenceDirty,
  sampleSaveCadence,
} from "../client/singleplayer/saveCadence.ts";

let state = createSaveCadenceState(0);
state = markSaveCadenceDirty(state);
let sample = sampleSaveCadence(state, 1_000, true);
assert.equal(sample.state.activePlayMsSinceSave, 0, "the inactive interval before play starts is ignored");
for (let elapsed = SINGLEPLAYER_MAX_ACTIVE_SAMPLE_GAP_MS;
  elapsed < SINGLEPLAYER_AUTOSAVE_ACTIVE_MS;
  elapsed += SINGLEPLAYER_MAX_ACTIVE_SAMPLE_GAP_MS) {
  sample = sampleSaveCadence(sample.state, 1_000 + elapsed, true);
}
assert.equal(sample.autosaveDue, false);
sample = sampleSaveCadence(sample.state, 1_000 + SINGLEPLAYER_AUTOSAVE_ACTIVE_MS, true);
assert.equal(sample.autosaveDue, true, "one minute of active dirty play requests one autosave");

state = commitSaveCadence(sample.state, 1_000 + SINGLEPLAYER_AUTOSAVE_ACTIVE_MS, true);
assert.equal(state.activePlayMsSinceSave, 0);
assert.equal(sampleSaveCadence(state, 1_000 + 2 * SINGLEPLAYER_AUTOSAVE_ACTIVE_MS, true).autosaveDue, false,
  "unchanged play never writes another snapshot");

state = createSaveCadenceState(0);
state = markSaveCadenceDirty(state);
state = sampleSaveCadence(state, 0, true).state;
const halfWindow = SINGLEPLAYER_AUTOSAVE_ACTIVE_MS / 2;
for (let elapsed = SINGLEPLAYER_MAX_ACTIVE_SAMPLE_GAP_MS; elapsed <= halfWindow; elapsed += SINGLEPLAYER_MAX_ACTIVE_SAMPLE_GAP_MS) {
  state = sampleSaveCadence(state, elapsed, true).state;
}
assert.equal(state.activePlayMsSinceSave, halfWindow);
state = sampleSaveCadence(state, halfWindow, false).state;
state = sampleSaveCadence(state, 9_000_000, false).state;
assert.equal(state.activePlayMsSinceSave, halfWindow, "paused/background wall time is not active play");
state = sampleSaveCadence(state, 9_000_001, true).state;
sample = sampleSaveCadence(state, 9_000_001 + halfWindow, true);
assert.equal(sample.autosaveDue, false);
assert.equal(sample.state.activePlayMsSinceSave, halfWindow + SINGLEPLAYER_MAX_ACTIVE_SAMPLE_GAP_MS,
  "one huge wall-clock jump contributes only the bounded active sample gap");
for (let elapsed = SINGLEPLAYER_MAX_ACTIVE_SAMPLE_GAP_MS;
  sample.state.activePlayMsSinceSave < SINGLEPLAYER_AUTOSAVE_ACTIVE_MS;
  elapsed += SINGLEPLAYER_MAX_ACTIVE_SAMPLE_GAP_MS) {
  sample = sampleSaveCadence(sample.state, 9_000_001 + halfWindow + elapsed, true);
}
assert.equal(sample.autosaveDue, true, "regular active samples eventually complete the one-minute window");

state = createSaveCadenceState(100);
state = markSaveCadenceDirty(state);
state = sampleSaveCadence(state, 100, true).state;
state = sampleSaveCadence(state, 50, true).state;
assert.equal(state.activePlayMsSinceSave, 0, "backward clocks cannot subtract or mint active time");

state = createSaveCadenceState(10.25);
state = sampleSaveCadence(state, 10.25, true).state;
state = sampleSaveCadence(state, 26.9, true).state;
assert.equal(state.activePlayMsSinceSave, 16, "high-resolution browser clocks are stored as integer save milliseconds");

console.log("single-player active autosave cadence tests passed");
