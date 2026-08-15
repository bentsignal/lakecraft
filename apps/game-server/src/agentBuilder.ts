import type { AgentBatchResult } from "./agentBuilderPersistence";
import type { BlockEdit, ServerGameMode } from "./protocol";

export const AGENT_API_PREFIX = "/agent/v1";
export const AGENT_MAX_BATCH_EDITS = 512;
export const AGENT_MAX_REGION_CELLS = 4_096;
export const AGENT_MAX_REQUEST_BYTES = 64 * 1024;

export const AGENT_BLOCK_NAMES = [
  "air", "grass", "dirt", "stone", "wood", "leaves", "planks", "crafting_table",
  "torch", "chest", "door_closed", "door_open", "bed", "coal_ore", "iron_ore",
  "furnace", "ladder", "cobblestone", "sand", "glass", "gold_ore", "diamond_ore",
  "tnt", "gravel", "wool", "sapling", "stone_bricks", "oak_fence",
  "oak_fence_gate_closed", "oak_fence_gate_open", "stone_brick_slab", "clay", "bricks",
  "bedrock",
] as const;

export interface AgentWorldMetadata {
  serverId: string;
  name: string;
  description: string;
  revision: number;
  persistedBlocks: number;
  maxPersistedBlocks: number;
  worldPreset: string;
  groundY?: number;
  defaultGameMode: ServerGameMode;
  connectedPlayers: number;
  spawn: { x: number; y: number; z: number; yaw: number };
}

export interface AgentRegionBounds {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export interface AgentRegionResult {
  revision: number;
  bounds: AgentRegionBounds;
  size: { x: number; y: number; z: number };
  /** X changes fastest, then Z, then Y. */
  order: "x,z,y";
  blocks: number[];
}

/** Narrow authority surface exposed to the HTTP builder API. */
export interface AgentBuilderWorld {
  agentMetadata(): AgentWorldMetadata;
  agentEditsSince(sinceRevision: number, limit: number): BlockEdit[];
  agentReadRegion(bounds: AgentRegionBounds): AgentRegionResult;
  agentBlockAt(x: number, y: number, z: number): number;
  agentApplyBatch(input: {
    operationId: string;
    editorId: string;
    edits: Array<{ x: number; y: number; z: number; block: number }>;
    editedAt: number;
  }): AgentBatchResult;
}

export class AgentApiRateLimiter {
  private tokens: number;
  private updatedAt: number;

  constructor(
    readonly capacity = 120,
    readonly refillPerSecond = 2,
    now = Date.now(),
  ) {
    this.tokens = capacity;
    this.updatedAt = now;
  }

  consume(weight: number, now = Date.now()): { ok: true; remaining: number } | { ok: false; retryAfterMs: number } {
    const elapsed = Math.max(0, now - this.updatedAt);
    this.updatedAt = now;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSecond / 1_000);
    if (this.tokens < weight) {
      return { ok: false, retryAfterMs: Math.ceil((weight - this.tokens) / this.refillPerSecond * 1_000) };
    }
    this.tokens -= weight;
    return { ok: true, remaining: Math.floor(this.tokens) };
  }
}

export interface AgentRequestOptions {
  now?: number;
  limiter?: AgentApiRateLimiter;
}

const defaultLimiter = new AgentApiRateLimiter();

/** Returns null when a request does not target the builder API. */
export async function handleAgentBuilderRequest(
  request: Request,
  url: URL,
  agentToken: string | undefined,
  world: AgentBuilderWorld,
  options: AgentRequestOptions = {},
): Promise<Response | null> {
  if (url.pathname !== AGENT_API_PREFIX && !url.pathname.startsWith(`${AGENT_API_PREFIX}/`)) return null;
  if (!agentToken) return responseText("Not found", 404);
  if (!bearerAuthorized(request.headers.get("authorization"), agentToken)) {
    return responseJson({ ok: false, error: "unauthorized" }, 401, { "www-authenticate": "Bearer" });
  }

  const weight = url.pathname === `${AGENT_API_PREFIX}/camera` ? 20
    : request.method === "POST" ? 5 : 1;
  const limit = (options.limiter ?? defaultLimiter).consume(weight, options.now);
  if (!limit.ok) {
    return responseJson({ ok: false, error: "rate_limited", retryAfterMs: limit.retryAfterMs }, 429, {
      "retry-after": String(Math.max(1, Math.ceil(limit.retryAfterMs / 1_000))),
    });
  }

  if (request.method === "GET" && url.pathname === `${AGENT_API_PREFIX}/status`) {
    return responseJson({
      ok: true,
      server: world.agentMetadata(),
      blockPalette: AGENT_BLOCK_NAMES,
      limits: {
        batchEdits: AGENT_MAX_BATCH_EDITS,
        regionCells: AGENT_MAX_REGION_CELLS,
        coordinateXZ: 1_000_000,
        coordinateY: [1, 192],
        camera: { maxWidth: 320, maxHeight: 200, maxDistance: 128 },
      },
    });
  }

  if (request.method === "GET" && url.pathname === `${AGENT_API_PREFIX}/block`) {
    const point = pointFromSearch(url.searchParams);
    if (!point.ok) return responseJson({ ok: false, error: point.error }, 400);
    const metadata = world.agentMetadata();
    const block = world.agentBlockAt(point.x, point.y, point.z);
    return responseJson({
      ok: true,
      revision: metadata.revision,
      x: point.x,
      y: point.y,
      z: point.z,
      block,
      blockName: AGENT_BLOCK_NAMES[block] ?? "unknown",
    });
  }

  if (request.method === "GET" && url.pathname === `${AGENT_API_PREFIX}/region`) {
    const bounds = boundsFromSearch(url.searchParams);
    if (!bounds.ok) return responseJson({ ok: false, error: bounds.error }, 400);
    return responseJson({ ok: true, region: world.agentReadRegion(bounds.bounds) });
  }

  if (request.method === "GET" && url.pathname === `${AGENT_API_PREFIX}/edits`) {
    const sinceRevision = optionalInteger(url.searchParams.get("sinceRevision"), 0, 0, Number.MAX_SAFE_INTEGER);
    const limitValue = optionalInteger(url.searchParams.get("limit"), 256, 1, 512);
    if (sinceRevision === null || limitValue === null) {
      return responseJson({ ok: false, error: "sinceRevision or limit is invalid" }, 400);
    }
    const metadata = world.agentMetadata();
    return responseJson({
      ok: true,
      revision: metadata.revision,
      edits: world.agentEditsSince(sinceRevision, limitValue),
    });
  }

  if (request.method === "POST" && url.pathname === `${AGENT_API_PREFIX}/edits`) {
    const parsed = await parseJsonBody(request);
    if (!parsed.ok) return responseJson({ ok: false, error: parsed.error }, parsed.status);
    const batch = parseBatch(parsed.value);
    if (!batch.ok) return responseJson({ ok: false, error: batch.error }, 400);
    const result = world.agentApplyBatch({ ...batch.value, editedAt: options.now ?? Date.now() });
    return batchResponse(result);
  }

  if (request.method === "POST" && url.pathname === `${AGENT_API_PREFIX}/fill`) {
    const parsed = await parseJsonBody(request);
    if (!parsed.ok) return responseJson({ ok: false, error: parsed.error }, parsed.status);
    const fill = parseFill(parsed.value);
    if (!fill.ok) return responseJson({ ok: false, error: fill.error }, 400);
    const result = world.agentApplyBatch({ ...fill.value, editedAt: options.now ?? Date.now() });
    return batchResponse(result);
  }

  if (request.method === "POST" && url.pathname === `${AGENT_API_PREFIX}/camera`) {
    const parsed = await parseJsonBody(request);
    if (!parsed.ok) return responseJson({ ok: false, error: parsed.error }, parsed.status);
    const camera = parseCamera(parsed.value);
    if (!camera.ok) return responseJson({ ok: false, error: camera.error }, 400);
    const metadata = world.agentMetadata();
    const png = renderAgentCamera(world, camera.value);
    return new Response(png, {
      status: 200,
      headers: secureHeaders({
        "content-type": "image/png",
        "content-length": String(png.byteLength),
        "x-lakecraft-world-revision": String(metadata.revision),
        "x-lakecraft-camera": JSON.stringify(camera.value),
      }),
    });
  }

  return responseJson({ ok: false, error: "not_found" }, 404);
}

function batchResponse(result: AgentBatchResult): Response {
  if (result.ok) return responseJson(result);
  return responseJson(result, result.reason === "operation_id_reused" ? 409 : 507);
}

function parseBatch(value: unknown):
  | { ok: true; value: { operationId: string; editorId: string; edits: Array<{ x: number; y: number; z: number; block: number }> } }
  | { ok: false; error: string } {
  const body = record(value);
  if (!body) return { ok: false, error: "body must be an object" };
  const operationId = operationIdValue(body.operationId);
  const editorId = editorIdValue(body.agent);
  if (!operationId) return { ok: false, error: "operationId must be 12-96 URL-safe characters" };
  if (!editorId) return { ok: false, error: "agent must be 1-32 letters, numbers, underscore, dot, or dash" };
  if (!Array.isArray(body.edits) || body.edits.length < 1 || body.edits.length > AGENT_MAX_BATCH_EDITS) {
    return { ok: false, error: `edits must contain 1-${AGENT_MAX_BATCH_EDITS} entries` };
  }
  const edits: Array<{ x: number; y: number; z: number; block: number }> = [];
  const coordinates = new Set<string>();
  for (const candidate of body.edits) {
    const edit = record(candidate);
    if (!edit) return { ok: false, error: "each edit must be an object" };
    const point = validatedPoint(edit.x, edit.y, edit.z);
    const block = blockValue(edit.block);
    if (!point || block === null) return { ok: false, error: "an edit coordinate or block is invalid" };
    const key = `${point.x}:${point.y}:${point.z}`;
    if (coordinates.has(key)) return { ok: false, error: "a batch cannot edit the same coordinate twice" };
    coordinates.add(key);
    edits.push({ ...point, block });
  }
  return { ok: true, value: { operationId, editorId, edits } };
}

function parseFill(value: unknown):
  | { ok: true; value: { operationId: string; editorId: string; edits: Array<{ x: number; y: number; z: number; block: number }> } }
  | { ok: false; error: string } {
  const body = record(value);
  if (!body) return { ok: false, error: "body must be an object" };
  const operationId = operationIdValue(body.operationId);
  const editorId = editorIdValue(body.agent);
  const from = record(body.from);
  const to = record(body.to);
  const start = from && validatedPoint(from.x, from.y, from.z);
  const end = to && validatedPoint(to.x, to.y, to.z);
  const block = blockValue(body.block);
  if (!operationId) return { ok: false, error: "operationId must be 12-96 URL-safe characters" };
  if (!editorId) return { ok: false, error: "agent is invalid" };
  if (!start || !end || block === null) return { ok: false, error: "from, to, or block is invalid" };
  const bounds = normalizeBounds(start, end);
  const cells = regionCellCount(bounds);
  if (cells > AGENT_MAX_BATCH_EDITS) {
    return { ok: false, error: `fill contains ${cells} cells; maximum is ${AGENT_MAX_BATCH_EDITS}` };
  }
  const edits: Array<{ x: number; y: number; z: number; block: number }> = [];
  for (let y = bounds.minY; y <= bounds.maxY; y++) {
    for (let z = bounds.minZ; z <= bounds.maxZ; z++) {
      for (let x = bounds.minX; x <= bounds.maxX; x++) edits.push({ x, y, z, block });
    }
  }
  return { ok: true, value: { operationId, editorId, edits } };
}

interface CameraInput {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  width: number;
  height: number;
  fov: number;
  maxDistance: number;
}

function parseCamera(value: unknown): { ok: true; value: CameraInput } | { ok: false; error: string } {
  const body = record(value);
  if (!body) return { ok: false, error: "body must be an object" };
  const x = finiteNumber(body.x, -1_000_000, 1_000_000);
  const y = finiteNumber(body.y, -64, 256);
  const z = finiteNumber(body.z, -1_000_000, 1_000_000);
  const yaw = finiteNumber(body.yaw, -1_000_000, 1_000_000);
  const pitch = finiteNumber(body.pitch, -Math.PI / 2, Math.PI / 2);
  const width = optionalBodyInteger(body.width, 160, 64, 320);
  const height = optionalBodyInteger(body.height, 100, 48, 200);
  const fov = optionalBodyNumber(body.fov, 60, 30, 100);
  const maxDistance = optionalBodyNumber(body.maxDistance, 96, 8, 128);
  if (x === null || y === null || z === null || yaw === null || pitch === null
    || width === null || height === null || fov === null || maxDistance === null) {
    return { ok: false, error: "camera coordinates, angles, or dimensions are invalid" };
  }
  return { ok: true, value: { x, y, z, yaw, pitch, width, height, fov, maxDistance } };
}

export function renderAgentCamera(world: Pick<AgentBuilderWorld, "agentBlockAt">, camera: CameraInput): Uint8Array {
  const pixels = new Uint8Array(camera.width * camera.height * 3);
  const aspect = camera.width / camera.height;
  const scale = Math.tan(camera.fov * Math.PI / 360);
  const cosPitch = Math.cos(camera.pitch);
  const forward = normalize3(Math.sin(camera.yaw) * cosPitch, Math.sin(camera.pitch), -Math.cos(camera.yaw) * cosPitch);
  const right = normalize3(Math.cos(camera.yaw), 0, Math.sin(camera.yaw));
  const up = cross(right, forward);
  for (let py = 0; py < camera.height; py++) {
    for (let px = 0; px < camera.width; px++) {
      const sx = (2 * (px + 0.5) / camera.width - 1) * aspect * scale;
      const sy = (1 - 2 * (py + 0.5) / camera.height) * scale;
      const direction = normalize3(
        forward.x + right.x * sx + up.x * sy,
        forward.y + right.y * sx + up.y * sy,
        forward.z + right.z * sx + up.z * sy,
      );
      const hit = castVoxelRay(world, camera.x, camera.y, camera.z, direction, camera.maxDistance);
      const offset = (py * camera.width + px) * 3;
      if (!hit) {
        const sky = Math.max(0, Math.min(1, direction.y * 0.5 + 0.5));
        pixels[offset] = Math.round(126 + sky * 22);
        pixels[offset + 1] = Math.round(177 + sky * 25);
        pixels[offset + 2] = Math.round(222 + sky * 25);
        continue;
      }
      const color = BLOCK_COLORS[hit.block] ?? BLOCK_COLORS[0];
      const faceLight = hit.faceY > 0 ? 1 : hit.faceY < 0 ? 0.52 : hit.faceX !== 0 ? 0.78 : 0.66;
      const fog = Math.max(0.28, 1 - hit.distance / (camera.maxDistance * 1.22));
      const checker = ((hit.x * 17 + hit.y * 31 + hit.z * 13) & 1) ? 0.96 : 1.04;
      pixels[offset] = clampByte(color[0] * faceLight * fog * checker);
      pixels[offset + 1] = clampByte(color[1] * faceLight * fog * checker);
      pixels[offset + 2] = clampByte(color[2] * faceLight * fog * checker);
    }
  }
  return encodePngRgb(camera.width, camera.height, pixels);
}

function castVoxelRay(
  world: Pick<AgentBuilderWorld, "agentBlockAt">,
  ox: number,
  oy: number,
  oz: number,
  direction: { x: number; y: number; z: number },
  maxDistance: number,
): { block: number; x: number; y: number; z: number; distance: number; faceX: number; faceY: number; faceZ: number } | null {
  let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
  const stepX = direction.x < 0 ? -1 : 1, stepY = direction.y < 0 ? -1 : 1, stepZ = direction.z < 0 ? -1 : 1;
  const deltaX = direction.x === 0 ? Infinity : Math.abs(1 / direction.x);
  const deltaY = direction.y === 0 ? Infinity : Math.abs(1 / direction.y);
  const deltaZ = direction.z === 0 ? Infinity : Math.abs(1 / direction.z);
  let maxX = direction.x === 0 ? Infinity : ((stepX > 0 ? x + 1 - ox : ox - x) * deltaX);
  let maxY = direction.y === 0 ? Infinity : ((stepY > 0 ? y + 1 - oy : oy - y) * deltaY);
  let maxZ = direction.z === 0 ? Infinity : ((stepZ > 0 ? z + 1 - oz : oz - z) * deltaZ);
  let distance = 0, faceX = 0, faceY = 0, faceZ = 0;
  for (let steps = 0; steps < 512 && distance <= maxDistance; steps++) {
    if (y >= 1 && y <= 192) {
      const block = world.agentBlockAt(x, y, z);
      if (block !== 0) return { block, x, y, z, distance, faceX, faceY, faceZ };
    }
    if (maxX <= maxY && maxX <= maxZ) {
      x += stepX; distance = maxX; maxX += deltaX; faceX = -stepX; faceY = faceZ = 0;
    } else if (maxY <= maxZ) {
      y += stepY; distance = maxY; maxY += deltaY; faceY = -stepY; faceX = faceZ = 0;
    } else {
      z += stepZ; distance = maxZ; maxZ += deltaZ; faceZ = -stepZ; faceX = faceY = 0;
    }
  }
  return null;
}

const BLOCK_COLORS: ReadonlyArray<readonly [number, number, number]> = [
  [145, 197, 239], [93, 151, 58], [126, 88, 55], [127, 127, 127], [102, 81, 51], [62, 126, 54],
  [171, 133, 79], [141, 107, 65], [244, 189, 61], [128, 89, 55], [129, 91, 54], [129, 91, 54],
  [180, 42, 39], [92, 92, 92], [205, 153, 124], [105, 105, 105], [156, 119, 69], [113, 113, 113],
  [218, 207, 158], [191, 220, 220], [225, 192, 74], [97, 219, 214], [183, 54, 51], [133, 128, 120],
  [224, 224, 224], [74, 126, 53], [122, 117, 110], [111, 79, 46], [115, 79, 45], [115, 79, 45],
  [128, 123, 116], [150, 161, 167], [150, 76, 59], [43, 43, 43],
];

function encodePngRgb(width: number, height: number, pixels: Uint8Array): Uint8Array {
  const stride = width * 3;
  const raw = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y++) raw.set(pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  const ihdr = new Uint8Array(13);
  writeU32(ihdr, 0, width); writeU32(ihdr, 4, height);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const signature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return concatBytes(signature, pngChunk("IHDR", ihdr), pngChunk("IDAT", zlibStore(raw)), pngChunk("IEND", new Uint8Array()));
}

function zlibStore(data: Uint8Array): Uint8Array {
  const blocks = Math.ceil(data.length / 65_535);
  const output = new Uint8Array(2 + data.length + blocks * 5 + 4);
  output[0] = 0x78; output[1] = 0x01;
  let inputOffset = 0, outputOffset = 2;
  while (inputOffset < data.length) {
    const length = Math.min(65_535, data.length - inputOffset);
    output[outputOffset++] = inputOffset + length === data.length ? 1 : 0;
    output[outputOffset++] = length & 0xff; output[outputOffset++] = length >>> 8;
    const inverse = (~length) & 0xffff;
    output[outputOffset++] = inverse & 0xff; output[outputOffset++] = inverse >>> 8;
    output.set(data.subarray(inputOffset, inputOffset + length), outputOffset);
    outputOffset += length; inputOffset += length;
  }
  writeU32(output, outputOffset, adler32(data));
  return output;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const result = new Uint8Array(12 + data.length);
  writeU32(result, 0, data.length); result.set(typeBytes, 4); result.set(data, 8);
  writeU32(result, 8 + data.length, crc32(concatBytes(typeBytes, data)));
  return result;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function adler32(data: Uint8Array): number {
  let a = 1, b = 0;
  for (const byte of data) { a = (a + byte) % 65_521; b = (b + a) % 65_521; }
  return ((b << 16) | a) >>> 0;
}

function writeU32(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value >>> 24; target[offset + 1] = value >>> 16;
  target[offset + 2] = value >>> 8; target[offset + 3] = value;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

function pointFromSearch(params: URLSearchParams):
  | ({ ok: true } & { x: number; y: number; z: number })
  | { ok: false; error: string } {
  const point = validatedPoint(params.get("x"), params.get("y"), params.get("z"));
  return point ? { ok: true, ...point } : { ok: false, error: "x, y, or z is invalid" };
}

function boundsFromSearch(params: URLSearchParams):
  | { ok: true; bounds: AgentRegionBounds }
  | { ok: false; error: string } {
  const start = validatedPoint(params.get("minX"), params.get("minY"), params.get("minZ"));
  const end = validatedPoint(params.get("maxX"), params.get("maxY"), params.get("maxZ"));
  if (!start || !end) return { ok: false, error: "region bounds are invalid" };
  const bounds = normalizeBounds(start, end);
  const cells = regionCellCount(bounds);
  if (cells > AGENT_MAX_REGION_CELLS) {
    return { ok: false, error: `region contains ${cells} cells; maximum is ${AGENT_MAX_REGION_CELLS}` };
  }
  return { ok: true, bounds };
}

function normalizeBounds(
  left: { x: number; y: number; z: number },
  right: { x: number; y: number; z: number },
): AgentRegionBounds {
  return {
    minX: Math.min(left.x, right.x), minY: Math.min(left.y, right.y), minZ: Math.min(left.z, right.z),
    maxX: Math.max(left.x, right.x), maxY: Math.max(left.y, right.y), maxZ: Math.max(left.z, right.z),
  };
}

function regionCellCount(bounds: AgentRegionBounds): number {
  return (bounds.maxX - bounds.minX + 1) * (bounds.maxY - bounds.minY + 1) * (bounds.maxZ - bounds.minZ + 1);
}

function validatedPoint(x: unknown, y: unknown, z: unknown): { x: number; y: number; z: number } | null {
  const px = integerValue(x, -1_000_000, 1_000_000);
  const py = integerValue(y, 1, 192);
  const pz = integerValue(z, -1_000_000, 1_000_000);
  return px === null || py === null || pz === null ? null : { x: px, y: py, z: pz };
}

function blockValue(value: unknown): number | null {
  if (typeof value === "string" && !/^-?\d+$/.test(value)) {
    const index = (AGENT_BLOCK_NAMES as readonly string[]).indexOf(value.toLowerCase().replaceAll("-", "_"));
    return index < 0 ? null : index;
  }
  return integerValue(value, 0, AGENT_BLOCK_NAMES.length - 1);
}

function operationIdValue(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{11,95}$/.test(value) ? value : null;
}

function editorIdValue(value: unknown): string | null {
  const name = value === undefined ? "builder" : value;
  return typeof name === "string" && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,31}$/.test(name) ? `agent:${name}` : null;
}

async function parseJsonBody(request: Request): Promise<
  { ok: true; value: unknown } | { ok: false; error: string; status: number }
> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > AGENT_MAX_REQUEST_BYTES)) {
    return { ok: false, error: "request_too_large", status: 413 };
  }
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return { ok: false, error: "content_type_must_be_application_json", status: 415 };
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > AGENT_MAX_REQUEST_BYTES) {
    return { ok: false, error: "request_too_large", status: 413 };
  }
  try { return { ok: true, value: JSON.parse(text) }; }
  catch { return { ok: false, error: "invalid_json", status: 400 }; }
}

function bearerAuthorized(header: string | null, expected: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const actual = header.slice(7);
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index++) difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  return difference === 0;
}

function responseJson(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(value, { status, headers: secureHeaders(headers) });
}

function responseText(value: string, status: number): Response {
  return new Response(value, { status, headers: secureHeaders({ "content-type": "text/plain; charset=utf-8" }) });
}

function secureHeaders(headers: Record<string, string>): Headers {
  return new Headers({ "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers });
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function integerValue(value: unknown, min: number, max: number): number | null {
  const number = typeof value === "string" && /^-?\d+$/.test(value) ? Number(value) : value;
  return typeof number === "number" && Number.isInteger(number) && number >= min && number <= max ? number : null;
}

function optionalInteger(value: string | null, fallback: number, min: number, max: number): number | null {
  return value === null ? fallback : integerValue(value, min, max);
}

function finiteNumber(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : null;
}

function optionalBodyInteger(value: unknown, fallback: number, min: number, max: number): number | null {
  return value === undefined ? fallback : integerValue(value, min, max);
}

function optionalBodyNumber(value: unknown, fallback: number, min: number, max: number): number | null {
  return value === undefined ? fallback : finiteNumber(value, min, max);
}

function normalize3(x: number, y: number, z: number): { x: number; y: number; z: number } {
  const length = Math.hypot(x, y, z) || 1;
  return { x: x / length, y: y / length, z: z / length };
}

function cross(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}
