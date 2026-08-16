import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const source = new URL("../client/lobby/generated/lakeBedEditionTitle.webp", import.meta.url);
const output = new URL("../client/lobby/generated/lakeBedEditionTitle.ts", import.meta.url);
const EXPECTED_SHA256 = "f3a68a4cce10f87240488fbe405f2796d3e75904f1f0ff1ba53d39283c36950b";
const bytes = await readFile(source);
const sha256 = createHash("sha256").update(bytes).digest("hex");
if (sha256 !== EXPECTED_SHA256) {
  throw new Error(`Lake Bed Edition title asset hash changed: ${sha256}.`);
}
if (bytes.subarray(0, 4).toString("ascii") !== "RIFF" || bytes.subarray(8, 12).toString("ascii") !== "WEBP") {
  throw new Error("Lake Bed Edition title asset must remain WebP.");
}
await writeFile(output, `/**\n * OpenAI ImageGen title art, generated from the user-supplied composition reference.\n * Source WebP SHA-256: ${sha256}; transparent 1400x302 production derivative.\n */\nexport const LAKE_BED_EDITION_TITLE_WEBP_BASE64 = "${bytes.toString("base64")}";\n`);
console.log(JSON.stringify({ output: output.pathname, bytes: bytes.length, sha256 }));
