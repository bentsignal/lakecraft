import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { compactClientIdentifiers } from "../scripts/css-template-compression.mjs";
import { loadLakebedCompilerRuntime } from "../scripts/lakebed-compiler-runtime.mjs";
import { LAKEBED_VERSION } from "../scripts/lakebed-toolchain.mjs";

const { build } = await loadLakebedCompilerRuntime({ lakebedVersion: LAKEBED_VERSION });
const source = await readFile(new URL("../client/multiplayerEnvironment.ts", import.meta.url), "utf8");
const result = await build({ stdin: { contents: compactClientIdentifiers(source), loader: "ts" },
  format: "esm", write: false, minify: true });
const { permitsMultiplayerEndpoint } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
for (const host of ["lakecraft-production.up.railway.app", "lakecraft-creative-production.up.railway.app"]) {
  assert.equal(permitsMultiplayerEndpoint("https://review.lakebed.app", `wss://${host}/ws`), false);
  assert.equal(permitsMultiplayerEndpoint("https://craft.lakebed.app", `wss://${host}/ws`), true);
}
