import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const client = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");

const chunkResult = client.slice(
  client.indexOf("type WorldChunksQueryResult"),
  client.indexOf("type PendingChestTransfer"),
);
assert.ok(chunkResult.includes("tntFuses: Array<"), "visible TNT fuses ride the existing composite world-chunk query");
assert.ok(chunkResult.includes("serverNow: number"), "the fuse schedule is based on Lakebed time, not an untrusted client clock");
assert.ok(chunkResult.includes("claim: { eventId: string; ignitionId: string } | null"), "only the elected nearby client receives a bounded claim capability");
assert.equal(
  /useQuery[^\n]+\("(?:tnt|primedTnt|tntFuses)"/.test(client),
  false,
  "TNT must not introduce a high-frequency query beside the composite world snapshot",
);

assert.ok(client.includes('}>("igniteTnt")'), "explicit player ignition is a Lakebed mutation");
assert.ok(client.includes('}>("claimTntExplosion")'), "fuse completion is an idempotent Lakebed mutation");

const interaction = client.slice(
  client.indexOf("onInteractBlock: (target) =>"),
  client.indexOf("onPerformanceStats:", client.indexOf("onInteractBlock: (target) =>")),
);
assert.ok(interaction.includes("target.block.block === BLOCK.TNT"), "right-click dispatch recognizes TNT as an interaction");
assert.ok(interaction.includes('?.itemId !== "torch"'), "ignition requires an explicit held torch client gesture");
assert.ok(interaction.includes('row.coordKey === key && row.blockType === "tnt"'), "ignition resolves the placed authoritative TNT row at the targeted coordinate");
assert.ok(interaction.includes("blockInstanceToken: `${placed.id}:${placed.updatedAt}`"), "ignition binds to the exact authoritative block instance");
assert.ok(interaction.includes("retryExactLakebedMutation(() => igniteTnt(JSON.stringify(request)))"), "transport retry reuses the frozen ignition operation");
assert.equal(interaction.indexOf("target.block.block === BLOCK.TNT") < interaction.indexOf("exitPointerLockForUi()"), true, "lighting TNT does not open a menu or unnecessarily drop pointer lock");

const fuseEffect = client.slice(
  client.indexOf("for (const fuse of worldChunks.tntFuses)"),
  client.indexOf("useEffect(() =>", client.indexOf("for (const fuse of worldChunks.tntFuses)")),
);
assert.ok(fuseEffect.includes("tntFuseCuesRef.current.has(fuse.eventId)"), "each observed fuse plays at most one local ignition cue");
assert.ok(fuseEffect.includes("!fuse.claim || tntExplosionClaimsRef.current.has(fuse.eventId)"), "non-elected observers never claim and elected retries are fenced by event ID");
assert.ok(fuseEffect.includes("fuse.dueAt - worldChunks.serverNow"), "claim timing derives from the authoritative due time");
assert.ok(fuseEffect.includes("tntClaimTimersRef.current.set(fuse.eventId, timer)"), "at most one bounded local timer is retained per authoritative fuse");
assert.ok(fuseEffect.includes("claimTntExplosion(JSON.stringify(fuse.claim))"), "the client submits only Lakebed's event/ignition claim pair");
assert.equal(fuseEffect.includes("x: fuse.x"), false, "the explosion request cannot forge a blast center");
assert.equal(fuseEffect.includes("radius"), false, "the explosion request cannot forge blast strength");

const interactionDispatch = engine.slice(
  engine.indexOf("export function tryInteractBlock"),
  engine.indexOf("function compileShader", engine.indexOf("export function tryInteractBlock")),
);
assert.ok(interactionDispatch.includes("target.block.block !== BLOCK.TNT"), "the engine routes TNT use before placement logic");

console.log("multiplayer TNT client integration source tests passed");
