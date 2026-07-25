import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const toast = source("../client/components/ToastSurface.tsx");
const gameHud = source("../client/components/GameHud.tsx");
const styles = source("../client/components/HudStyles.tsx");

const selectorSource = toast.match(/export function visibleHudMessages\([\s\S]*?^}/m)?.[0];
assert.ok(selectorSource, "the visible-message selector remains directly behavior-testable");
const visibleHudMessages = Function(`${selectorSource
  .replace("export ", "")
  .replace(/messages: readonly HudMessage\[\]/g, "messages")
  .replace(/\): readonly HudMessage\[\]/, ")")}; return visibleHudMessages;`)() as
  <T>(messages: readonly T[]) => readonly T[];

const messages = ["oldest", "older", "recent", "newest"].map((id) => ({ id }));
assert.deepEqual(visibleHudMessages(messages).map(({ id }) => id), ["older", "recent", "newest"], "only the last three messages render in original order");
assert.deepEqual(visibleHudMessages(messages.slice(0, 2)), messages.slice(0, 2), "short queues retain every message and their order");
assert.deepEqual(visibleHudMessages([]), [], "an empty queue remains empty");

assert.ok(toast.includes('role="status"') && toast.includes('aria-live="polite"') && toast.includes('aria-atomic="false"'), "the stable polite live region is preserved");
assert.ok(toast.includes("onClick={() => onDismiss?.(message.id)}"), "each banner remains directly dismissible by message id");
assert.ok(toast.includes("message.detail ? <small>{message.detail}</small> : null"), "optional detail retains its separate semantics");
assert.equal(toast.includes("lc-toast__pin"), false, "paper-pin decoration is removed from the toast markup");
assert.ok(gameHud.includes("!deathScreenOpen ? <ToastSurface"), "death-screen suppression remains at the shared HUD boundary");

const toastCss = styles.slice(styles.indexOf(".lc-toasts {"), styles.indexOf("@keyframes lc-toast-in"));
assert.ok(toastCss.includes("background: rgba(16,16,16,.88)") && toastCss.includes("color: #fff"), "banners use readable white text on a compact dark surface");
assert.ok(toastCss.includes("border-left: 5px solid var(--lc-toast-edge)"), "each banner uses one narrow pixel tone rail");
for (const tone of ["#55a7d8", "#55c653", "#f5c542"]) assert.ok(toastCss.includes(tone), `tone edge ${tone} remains authored`);
for (const paperToken of ["var(--lc-paper)", "rotate(", "box-shadow", "border-radius"]) assert.equal(toastCss.includes(paperToken), false, `toast CSS excludes legacy paper treatment: ${paperToken}`);
assert.ok(styles.includes("@media (prefers-reduced-motion: reduce) { .lc-toast"), "reduced-motion users still bypass toast animation");

console.log("Minecraft-style toast surface behavior and visual contract tests passed");
