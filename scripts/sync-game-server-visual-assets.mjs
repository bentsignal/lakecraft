import { copyFile, mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const assets = [
  ["../client/game/generated/texture-atlas-v1.png", "block-texture-atlas-9a3b9f30.png", "242bbf5316677c49565d829adfd5cadcc2830d5682ce95a80b7add3bbd4effa3"],
  ["../client/game/generated/mob-texture-atlas-v1.png", "mob-texture-atlas-204e2b83.png", "204e2b831ffd3716b9a1c04fab27fc832f0f0ce686c20896364a91d1b553e9f3"],
];
const output = new URL("../apps/game-server/assets/", import.meta.url);
await mkdir(output, { recursive: true });
for (const [source, name, expected] of assets) {
  const input = new URL(source, import.meta.url);
  const bytes = await readFile(input);
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expected) throw new Error(`${name} changed; review and version the immutable Railway asset path.`);
  await copyFile(input, new URL(name, output));
}
console.log(JSON.stringify({ assets: assets.map(([, name]) => name) }));
