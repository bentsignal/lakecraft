import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

// Claimed Lakebed deploys currently report a 1 MiB source/artifact ceiling.
const MAX_ARTIFACT_BYTES = 1024 * 1024;
const MINIMUM_HEADROOM_BYTES = 32 * 1024;
const artifactPath = process.argv[2];

if (!artifactPath) {
  throw new Error("Pass the Lakebed artifact JSON path to check.");
}

const absolutePath = resolve(artifactPath);
const { size } = await stat(absolutePath);
let artifactBytes = size;
try {
  const metadata = JSON.parse(await readFile(absolutePath, "utf8"));
  if (metadata?.format === "lakecraft.audit-artifact-metadata.v1") {
    if (!Number.isInteger(metadata.artifactBytes) || metadata.artifactBytes < 1) {
      throw new Error("Audit artifact metadata has an invalid artifactBytes value.");
    }
    artifactBytes = metadata.artifactBytes;
  }
} catch (error) {
  if (error instanceof SyntaxError) {
    // Backward-compatible raw artifact sizing.
  } else throw error;
}
const headroomBytes = MAX_ARTIFACT_BYTES - artifactBytes;
const result = {
  artifactPath: absolutePath,
  artifactBytes,
  maximumBytes: MAX_ARTIFACT_BYTES,
  headroomBytes,
  minimumHeadroomBytes: MINIMUM_HEADROOM_BYTES,
};

console.log(JSON.stringify(result, null, 2));

if (headroomBytes < MINIMUM_HEADROOM_BYTES) {
  throw new Error(
    headroomBytes < 0
      ? `Lakebed artifact exceeds the observed ceiling by ${-headroomBytes} bytes.`
      : `Lakebed artifact has only ${headroomBytes} bytes of headroom; ${MINIMUM_HEADROOM_BYTES} are required.`,
  );
}
