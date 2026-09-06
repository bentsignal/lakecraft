import { pathToFileURL } from "node:url";
import { resolveLakebedCompilerRuntime } from "./lakebed-compiler-runtime.mjs";
import { LAKEBED_VERSION } from "./lakebed-toolchain.mjs";

const runtime = await resolveLakebedCompilerRuntime({ lakebedVersion: LAKEBED_VERSION });
const { buildCapsule } = await import(pathToFileURL(runtime.lakebedBuildPath).href);
// Compile the full source, without packaging its deliberately oversized assets.
// Only the separately verified compact capsule is eligible for deployment.
await buildCapsule({ capsuleDir: process.cwd(), mode: "production" });
console.log("Ordinary Lakebed client and server compiled successfully.");
