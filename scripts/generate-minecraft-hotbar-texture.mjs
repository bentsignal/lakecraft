import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { decodePng } from "./png-rgba.mjs";

const jarArgument = process.argv[2];
if (!jarArgument) throw new Error("Usage: node scripts/generate-minecraft-hotbar-texture.mjs minecraft-version.jar");
const jarPath = resolve(jarArgument);
const EXPECTED_JAR_SHA256 = "40896ee9f1e2bec3c934daac7e93d41e9e3d9c2f8ae0ca366d52ffbfd1afa290";
const assets = Object.freeze([
  Object.freeze({
    exportName: "MINECRAFT_HOTBAR_PNG_BASE64",
    path: "assets/minecraft/textures/gui/sprites/hud/hotbar.png",
    width: 182,
    height: 22,
    sha256: "57aad603aafc75cea079d8db04b3029c1b1b5501eb0799971ccaf858876f52a7",
  }),
  Object.freeze({
    exportName: "MINECRAFT_HOTBAR_SELECTION_PNG_BASE64",
    path: "assets/minecraft/textures/gui/sprites/hud/hotbar_selection.png",
    width: 24,
    height: 23,
    sha256: "8c1e1cd977cce0c3a2aaf04036af4904426dafd1a6f4db9665b0d8be1468e80a",
  }),
]);
const jarBytes = await readFile(jarPath);
const jarSha256 = createHash("sha256").update(jarBytes).digest("hex");
if (jarSha256 !== EXPECTED_JAR_SHA256) throw new Error(`Expected reviewed Minecraft 26.2 JAR ${EXPECTED_JAR_SHA256}; received ${jarSha256}.`);

const lines = [
  "/**",
  " * Exact Minecraft Java 26.2 hotbar sprites imported from the user's installed client.",
  ` * Source JAR SHA-256: ${jarSha256}.`,
  " */",
];
for (const asset of assets) {
  const bytes = execFileSync("unzip", ["-p", jarPath, asset.path], { maxBuffer: 1024 * 1024 });
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== asset.sha256) throw new Error(`${asset.path} hash changed: ${hash}.`);
  const decoded = decodePng(bytes);
  if (decoded.width !== asset.width || decoded.height !== asset.height) {
    throw new Error(`${asset.path} is ${decoded.width}x${decoded.height}; expected ${asset.width}x${asset.height}.`);
  }
  lines.push(`export const ${asset.exportName} = "${bytes.toString("base64")}";`);
}
const output = new URL("../client/components/generated/minecraftHotbarTextures.ts", import.meta.url);
await writeFile(output, `${lines.join("\n")}\n`);
console.log(JSON.stringify({ output: output.pathname, jarSha256, assets: assets.map(({ path, sha256 }) => ({ path, sha256 })) }));
