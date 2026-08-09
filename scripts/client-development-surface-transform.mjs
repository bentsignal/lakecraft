const REVIEWED_DEVELOPMENT_SURFACES = Object.freeze({
  imports: "4f53eb9c",
  state: "718cded6",
  modal: "b6b7c1c8",
  guard: "cfe8bf8b",
  dependency: "55faebb2",
  callback: "e3de66dc",
  render: "86b20f0f",
});

const REVIEWED_VOXEL_DEVELOPMENT_SURFACES = Object.freeze({
  state: "94313898",
  "rig-preview": "16419334",
  method: "47244734",
});

function fingerprint(source) {
  let hash = 2_166_136_261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Removes only explicitly reviewed development UI from the compact anonymous stage. */
export function stripClientDevelopmentSurfaces(source) {
  let transformed = source;
  for (const [name, expectedFingerprint] of Object.entries(REVIEWED_DEVELOPMENT_SURFACES)) {
    const jsx = name === "render";
    const start = jsx
      ? `{/* @lakecraft-development:${name}:start */}`
      : `/* @lakecraft-development:${name}:start */`;
    const end = jsx
      ? `{/* @lakecraft-development:${name}:end */}`
      : `/* @lakecraft-development:${name}:end */`;
    const startAt = transformed.indexOf(start);
    const endAt = transformed.indexOf(end);
    if (startAt < 0 || endAt < startAt || transformed.indexOf(start, startAt + start.length) >= 0
      || transformed.indexOf(end, endAt + end.length) >= 0) {
      throw new Error(`Compact development-surface marker ${name} is missing, duplicated, or out of order.`);
    }
    const body = transformed.slice(startAt + start.length, endAt);
    const actualFingerprint = fingerprint(body);
    if (actualFingerprint !== expectedFingerprint) {
      throw new Error(
        `Compact development-surface ${name} changed (expected ${expectedFingerprint}, found ${actualFingerprint}).`,
      );
    }
    transformed = transformed.slice(0, startAt) + transformed.slice(endAt + end.length);
  }
  if (transformed.includes("@lakecraft-development:")) {
    throw new Error("Compact development-surface transform left an unreviewed marker behind.");
  }
  return transformed;
}

/** Removes only the reviewed Pose Lab rig hooks from the compact voxel engine. */
export function stripVoxelDevelopmentSurfaces(source) {
  let transformed = source;
  for (const [name, expectedFingerprint] of Object.entries(REVIEWED_VOXEL_DEVELOPMENT_SURFACES)) {
    const start = `/* @lakecraft-voxel-development:${name}:start */`;
    const end = `/* @lakecraft-voxel-development:${name}:end */`;
    const startAt = transformed.indexOf(start);
    const endAt = transformed.indexOf(end);
    if (startAt < 0 || endAt < startAt || transformed.indexOf(start, startAt + start.length) >= 0
      || transformed.indexOf(end, endAt + end.length) >= 0) {
      throw new Error(`Compact voxel development-surface marker ${name} is missing, duplicated, or out of order.`);
    }
    const body = transformed.slice(startAt + start.length, endAt);
    const actualFingerprint = fingerprint(body);
    if (actualFingerprint !== expectedFingerprint) {
      throw new Error(
        `Compact voxel development-surface ${name} changed (expected ${expectedFingerprint}, found ${actualFingerprint}).`,
      );
    }
    transformed = transformed.slice(0, startAt) + transformed.slice(endAt + end.length);
  }
  if (transformed.includes("@lakecraft-voxel-development:")) {
    throw new Error("Compact voxel development-surface transform left an unreviewed marker behind.");
  }
  return transformed;
}
