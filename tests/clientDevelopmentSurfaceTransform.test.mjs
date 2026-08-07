import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripClientDevelopmentSurfaces } from "../scripts/client-development-surface-transform.mjs";

const source = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
for (const component of ["FirstPersonPoseLab", "VisualLab"]) {
  assert.ok(source.includes(`<${component}`), `normal local development still renders ${component}`);
  assert.ok(source.includes(`import { FirstPersonPoseLab, VisualLab }`),
    "normal local development still imports both inspection surfaces");
}

const compact = stripClientDevelopmentSurfaces(source);
for (const developmentOnly of [
  "FirstPersonPoseLab", "VisualLab", "visualLabOpen", "setVisualLabOpen", "setPoseLabBowPreview",
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

console.log("client development-surface compact staging tests: ok");
