import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const component = readFileSync(new URL("../client/components/StatusStrip.tsx", import.meta.url), "utf8");
const sprites = readFileSync(new URL("../client/components/generated/survivalHudSprites.ts", import.meta.url), "utf8");
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

assert.match(sprites, /Minecraft 26\.2 HUD sprites imported from the user's local game installation/,
  "HUD art retains auditable local-game provenance");
assert.match(sprites, /health:[\s\S]*hunger:[\s\S]*armor:[\s\S]*air:/, "all four survival meter families ship exact sprites");
assert.equal((sprites.match(/data:image\/png;base64/g) ?? []).length, 1, "one compact shared data prefix backs all sprites");
assert.equal((sprites.match(/empty: PNG/g) ?? []).length, 4);
assert.equal((sprites.match(/full: PNG/g) ?? []).length, 4);
assert.equal((sprites.match(/half: PNG/g) ?? []).length, 4);
assert.equal(/[\u2665\u25cf\u2662]/u.test(`${component}${meterStyles}`), false, "meter art has no Unicode glyph fallback");
assert.equal(/Arial/i.test(meterStyles), false, "meter art has no browser-font dependency");
assert.match(styles, /\.lc-meter--hunger,\.lc-meter--air \{ flex-direction: row-reverse; justify-content: flex-start; \}/,
  "hunger and air index zero stay against the right edge like Minecraft");
assert.match(styles, /flex: 0 0 16px; height: 18px;[^}]*width: 18px;/,
  "9px art advances by 8px, preserving Minecraft's icon overlap and center separation");
assert.match(styles, /\.lc-survival \{[^}]*height: 18px;[^}]*margin: 0 2px 2px;[^}]*position: relative;/,
  "without an experience bar, health and hunger sit one two-pixel gap above the hotbar");
assert.match(styles, /\.lc-survival__air \{ bottom: 18px;[^}]*right: 0;[^}]*width: 180px; \}/,
  "air bubbles occupy the canonical row immediately above hunger");
assert.match(component, /armor > 0 \? <div className="lc-survival__armor">/,
  "armor alone occupies the optional row above health instead of reserving empty vertical space");
assert.match(component, /state !== "empty" \? <img[\s\S]*src=\{sprites\[state\]\}/,
  "full and half states use their canonical source sprite over the empty container");
assert.match(styles, /\.lc-meter__sprite \{[^}]*height: 18px;[^}]*image-rendering: pixelated;[^}]*width: 18px;/,
  "9px source sprites scale to the canonical 18px HUD footprint without smoothing");
assert.equal(meterStyles.includes("background-clip: text"), false, "pixel fills do not reuse text-gradient rendering");

console.log("survival HUD pixel-art state, silhouette, direction, and footprint checks passed");
