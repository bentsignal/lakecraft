import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { writeFileSync } from "node:fs";

const jar = process.env.LAKECRAFT_MINECRAFT_JAR
  ?? join(homedir(), "Library/Application Support/minecraft/versions/26.2/26.2.jar");
const entry = "assets/minecraft/textures/gui/container/inventory.png";
const png = execFileSync("unzip", ["-p", jar, entry], { maxBuffer: 1024 * 1024 });
const hash = createHash("sha256").update(png).digest("hex");
if (hash !== "c2f850076ad7ebd7a1b27d017fe5f66ac388f54de374de988cb79f86b1d59a65") {
  throw new Error(`Unexpected Minecraft 26.2 inventory texture hash: ${hash}`);
}
const output = new URL("../client/components/generated/minecraftInventoryTexture.ts", import.meta.url);
writeFileSync(output, `/**
 * Minecraft 26.2 survival-inventory chrome from the user's local installation.
 * The 256x256 PNG contains the canonical 176x166 panel in its top-left corner.
 * Keeping the tiny lossless source intact avoids a second CSS approximation.
 */
export const MINECRAFT_INVENTORY_PNG_BASE64 = "${png.toString("base64")}";
`);
console.log(`generated ${output.pathname} (${png.length} bytes, sha256:${hash})`);
