import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const component = readFileSync(new URL("../client/components/StatusStrip.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../client/components/HudStyles.tsx", import.meta.url), "utf8");
const meterStyles = styles.slice(styles.indexOf(".lc-meter {"), styles.indexOf(".lc-hotbar {"));

const stateFunctionSource = component.match(/export function survivalIconStates\([\s\S]*?^}/m)?.[0];
assert.ok(stateFunctionSource, "survival state function remains directly testable");
const executableStateFunction = stateFunctionSource.replace("export ", "");
const survivalIconStates = Function(`${executableStateFunction}; return survivalIconStates;`)() as
  (value?: number, max?: number) => Array<"full" | "half" | "empty">;

assert.deepEqual(survivalIconStates(20, 20), Array(10).fill("full"));
assert.deepEqual(survivalIconStates(19, 20), [...Array(9).fill("full"), "half"]);
assert.deepEqual(survivalIconStates(1, 20), ["half", ...Array(9).fill("empty")]);
assert.deepEqual(survivalIconStates(0, 20), Array(10).fill("empty"));

assert.match(component, /viewBox="0 0 9 9"[^>]*shape-rendering="crispEdges"/, "icons use one crisp 9x9 pixel grid");
assert.match(component, /health:[\s\S]*hunger:[\s\S]*armor:/, "all three survival silhouettes have authored path art");
assert.equal(/[\u2665\u25cf\u2662]/u.test(`${component}${meterStyles}`), false, "meter art has no Unicode glyph fallback");
assert.equal(/Arial/i.test(meterStyles), false, "meter art has no browser-font dependency");
assert.match(styles, /\.lc-meter--hunger \{ flex-direction: row-reverse; justify-content: flex-start; \}/,
  "hunger index zero stays against the right edge so missing food appears from the left");
assert.match(styles, /flex: 0 0 18px; height: 18px; width: 18px;/, "ten icons retain the existing 180px row footprint");
assert.match(component, /state === "full" \? 9 : state === "half" \? 5 : 0/, "half states end at the fifth authored pixel column");
assert.match(component, /<svg className="lc-meter__fill-layer" height="9" width=\{fillWidth\}>/, "fill layers use exact nested SVG viewport clipping");
assert.equal(meterStyles.includes("background-clip: text"), false, "pixel fills do not reuse text-gradient rendering");

console.log("survival HUD pixel-art state, silhouette, direction, and footprint checks passed");
