export const LAKEBED_VERSION = "0.0.33";
export const TYPESCRIPT_VERSION = "5.9.3";
export const LAKEBED_ARTIFACT_FORMAT = "lakebed.capsule.artifact.v2";

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
export const LAKEBED_NPX_ARGS = Object.freeze([
  "--yes", "--package", `lakebed@${LAKEBED_VERSION}`,
  "--package", `typescript@${TYPESCRIPT_VERSION}`, "lakebed",
]);
