#!/usr/bin/env bun

import { AGENT_BLOCK_NAMES } from "../../apps/game-server/src/agentBuilder.ts";

interface Point { x: number; y: number; z: number }
interface Edit extends Point { block: number }

const BLOCK_BY_NAME = new Map<string, number>(AGENT_BLOCK_NAMES.map((name, index) => [name, index]));

export function createObservatoryBuild(origin: Point): Edit[] {
  const edits = new Map<string, Edit>();
  const put = (x: number, y: number, z: number, block: number) => edits.set(`${x}:${y}:${z}`, { x, y, z, block });
  const x0 = origin.x - 5, x1 = origin.x + 5, z0 = origin.z - 5, z1 = origin.z + 5;

  // Raised wood floor with a stone-brick rim.
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) put(x, origin.y, z, 6);
  for (let x = x0; x <= x1; x++) { put(x, origin.y, z0, 26); put(x, origin.y, z1, 26); }
  for (let z = z0 + 1; z < z1; z++) { put(x0, origin.y, z, 26); put(x1, origin.y, z, 26); }

  // Four columns, glass walls, and a two-cell north entrance.
  for (let y = origin.y + 1; y <= origin.y + 4; y++) {
    for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]] as const) put(x, y, z, 26);
    for (let x = x0 + 1; x < x1; x++) {
      if (!(z0 === origin.z - 5 && (x === origin.x || x === origin.x + 1) && y <= origin.y + 2)) put(x, y, z0, 19);
      put(x, y, z1, 19);
    }
    for (let z = z0 + 1; z < z1; z++) { put(x0, y, z, 19); put(x1, y, z, 19); }
  }

  // Framed glass roof and a small central telescope silhouette.
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    const rim = x === x0 || x === x1 || z === z0 || z === z1;
    put(x, origin.y + 5, z, rim ? 26 : 19);
  }
  put(origin.x, origin.y + 1, origin.z, 27);
  put(origin.x, origin.y + 2, origin.z, 3);
  put(origin.x, origin.y + 3, origin.z - 1, 3);
  put(origin.x, origin.y + 3, origin.z - 2, 21);
  put(origin.x - 2, origin.y + 1, origin.z + 2, 8);
  put(origin.x + 2, origin.y + 1, origin.z + 2, 8);
  return [...edits.values()];
}

export function summarizeMutationResult(value: unknown, includeEdits = false): unknown {
  if (includeEdits || value === null || typeof value !== "object" || Array.isArray(value)) return value;
  const result = value as Record<string, unknown>;
  if (!Array.isArray(result.edits)) return value;
  const { edits, ...summary } = result;
  return { ...summary, editCount: edits.length };
}

async function main(argv: string[]): Promise<void> {
  const args = [...argv];
  const json = takeBooleanFlag(args, "--json");
  const verbose = takeBooleanFlag(args, "--verbose") || takeBooleanFlag(args, "--include-edits");
  const serverArgument = takeValueFlag(args, "--server");
  const tokenFile = takeValueFlag(args, "--token-file");
  const agent = takeValueFlag(args, "--agent") ?? "codex";
  const server = normalizeServer(serverArgument ?? Bun.env.LAKECRAFT_AGENT_URL ?? "");
  const token = tokenFile
    ? (await Bun.file(tokenFile).text()).trim()
    : (Bun.env.LAKECRAFT_AGENT_TOKEN ?? "").trim();
  if (!server) fail("Set LAKECRAFT_AGENT_URL or pass --server https://your-server.example");
  if (!token) fail("Set LAKECRAFT_AGENT_TOKEN or pass --token-file /path/to/token");
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,31}$/.test(agent)) fail("--agent is invalid");
  const command = args.shift() ?? "help";
  const client = new AgentClient(server, token);

  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }
  if (command === "status") return output(await client.json("GET", "/status"), json);
  if (command === "get") {
    const [x, y, z] = takeIntegers(args, 3);
    return output(await client.json("GET", `/block?x=${x}&y=${y}&z=${z}`), json);
  }
  if (command === "region") {
    const [minX, minY, minZ, maxX, maxY, maxZ] = takeIntegers(args, 6);
    return output(await client.json("GET", `/region?minX=${minX}&minY=${minY}&minZ=${minZ}&maxX=${maxX}&maxY=${maxY}&maxZ=${maxZ}`), true);
  }
  if (command === "edits") {
    const since = takeOptionalInteger(args.shift(), 0);
    const limit = takeOptionalInteger(takeValueFlag(args, "--limit"), 256);
    return output(await client.json("GET", `/edits?sinceRevision=${since}&limit=${limit}`), true);
  }
  if (command === "set") {
    const [x, y, z] = takeIntegers(args, 3);
    const block = parseBlock(args.shift());
    const operationId = operationFlag(args, "set");
    return output(summarizeMutationResult(await client.json("POST", "/edits", {
      operationId, agent, edits: [{ x, y, z, block }],
    }), verbose), json);
  }
  if (command === "fill") {
    const [x1, y1, z1, x2, y2, z2] = takeIntegers(args, 6);
    const block = parseBlock(args.shift());
    const operationId = operationFlag(args, "fill");
    return output(summarizeMutationResult(await client.json("POST", "/fill", {
      operationId, agent, from: { x: x1, y: y1, z: z1 }, to: { x: x2, y: y2, z: z2 }, block,
    }), verbose), json);
  }
  if (command === "camera") {
    const [x, y, z] = takeNumbers(args, 3);
    const yaw = degrees(takeRequiredNumber(takeValueFlag(args, "--yaw"), "--yaw"));
    const pitch = degrees(takeRequiredNumber(takeValueFlag(args, "--pitch"), "--pitch"));
    const width = takeOptionalInteger(takeValueFlag(args, "--width"), 160);
    const height = takeOptionalInteger(takeValueFlag(args, "--height"), 100);
    const fov = takeOptionalNumber(takeValueFlag(args, "--fov"), 60);
    const maxDistance = takeOptionalNumber(takeValueFlag(args, "--distance"), 96);
    const out = takeValueFlag(args, "--out");
    if (!out) fail("camera requires --out view.png");
    assertNoExtra(args);
    const response = await client.raw("POST", "/camera", { x, y, z, yaw, pitch, width, height, fov, maxDistance });
    if ((response.headers.get("content-type") ?? "") !== "image/png") fail("server did not return a PNG camera image");
    const bytes = new Uint8Array(await response.arrayBuffer());
    await Bun.write(out, bytes);
    return output({
      ok: true,
      out,
      bytes: bytes.byteLength,
      revision: Number(response.headers.get("x-lakecraft-world-revision") ?? 0),
      camera: { x, y, z, yawDegrees: yaw * 180 / Math.PI, pitchDegrees: pitch * 180 / Math.PI, width, height, fov, maxDistance },
    }, json);
  }
  if (command === "example") {
    const status = await client.json("GET", "/status") as { server?: { groundY?: number } };
    const originX = takeOptionalInteger(takeValueFlag(args, "--x"), 0);
    const originY = takeOptionalInteger(takeValueFlag(args, "--y"), (status.server?.groundY ?? 68) + 1);
    const originZ = takeOptionalInteger(takeValueFlag(args, "--z"), 0);
    const operationId = takeValueFlag(args, "--operation") ?? `example.observatory.${originX}.${originY}.${originZ}.v1`;
    assertNoExtra(args);
    const edits = createObservatoryBuild({ x: originX, y: originY, z: originZ });
    return output(summarizeMutationResult(
      await client.json("POST", "/edits", { operationId, agent, edits }),
      verbose,
    ), json);
  }
  fail(`Unknown command: ${command}`);
}

class AgentClient {
  constructor(private readonly server: string, private readonly token: string) {}

  async raw(method: string, path: string, body?: unknown): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(`${this.server}/agent/v1${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.token}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      fail(`Could not reach ${this.server}: ${error instanceof Error ? error.message : "network error"}`);
    }
    if (!response.ok) {
      const contentType = response.headers.get("content-type") ?? "";
      const detail = contentType.includes("application/json")
        ? JSON.stringify(await response.json())
        : (await response.text()).slice(0, 500);
      fail(`Server returned HTTP ${response.status}: ${detail}`);
    }
    return response;
  }

  async json(method: string, path: string, body?: unknown): Promise<unknown> {
    const response = await this.raw(method, path, body);
    return response.json();
  }
}

function normalizeServer(value: string): string {
  if (!value) return "";
  let url: URL;
  try { url = new URL(value); } catch { fail("Agent server URL is invalid"); }
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) fail("Agent server must use HTTPS (HTTP is allowed on loopback)");
  if (url.username || url.password || url.search || url.hash) fail("Agent server URL cannot contain credentials, query parameters, or fragments");
  return url.toString().replace(/\/$/, "");
}

function parseBlock(value: string | undefined): number {
  if (!value) fail("A block name or numeric ID is required");
  if (/^\d+$/.test(value)) {
    const block = Number(value);
    if (block >= 0 && block < AGENT_BLOCK_NAMES.length) return block;
  }
  const block = BLOCK_BY_NAME.get(value.toLowerCase().replaceAll("-", "_"));
  if (block === undefined) fail(`Unknown block '${value}'. Run status for the palette.`);
  return block;
}

function operationFlag(args: string[], prefix: string): string {
  const operation = takeValueFlag(args, "--operation") ?? `${prefix}.${crypto.randomUUID()}`;
  assertNoExtra(args);
  return operation;
}

function takeIntegers(args: string[], count: number): number[] {
  const values = args.splice(0, count);
  if (values.length !== count) fail(`Expected ${count} integer coordinates`);
  return values.map((value) => {
    if (!/^-?\d+$/.test(value)) fail(`Invalid integer: ${value}`);
    return Number(value);
  });
}

function takeNumbers(args: string[], count: number): number[] {
  const values = args.splice(0, count);
  if (values.length !== count) fail(`Expected ${count} coordinates`);
  return values.map((value) => takeRequiredNumber(value, "coordinate"));
}

function takeRequiredNumber(value: string | undefined, label: string): number {
  const number = Number(value);
  if (value === undefined || !Number.isFinite(number)) fail(`${label} must be a number`);
  return number;
}

function takeOptionalInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!/^-?\d+$/.test(value)) fail(`Invalid integer: ${value}`);
  return Number(value);
}

function takeOptionalNumber(value: string | undefined, fallback: number): number {
  return value === undefined ? fallback : takeRequiredNumber(value, "value");
}

function takeBooleanFlag(args: string[], name: string): boolean {
  const index = args.indexOf(name);
  if (index < 0) return false;
  args.splice(index, 1);
  return true;
}

function takeValueFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  if (index + 1 >= args.length) fail(`${name} requires a value`);
  const value = args[index + 1];
  args.splice(index, 2);
  return value;
}

function assertNoExtra(args: string[]): void {
  if (args.length) fail(`Unexpected arguments: ${args.join(" ")}`);
}

function degrees(value: number): number { return value * Math.PI / 180; }

function output(value: unknown, json: boolean): void {
  if (json) process.stdout.write(`${JSON.stringify(value)}\n`);
  else process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function fail(message: string): never { throw new Error(message); }

function printHelp(): void {
  process.stdout.write(`Lakecraft Agent Builder

Authentication is read only from LAKECRAFT_AGENT_TOKEN or --token-file. Tokens are never accepted in URLs.

Usage: bun run tools/lakecraft-agent/cli.ts [--server URL] [--token-file PATH] [--agent NAME] [--json] [--verbose] COMMAND

Commands:
  status
  get X Y Z
  region MIN_X MIN_Y MIN_Z MAX_X MAX_Y MAX_Z
  edits [SINCE_REVISION] [--limit N]
  set X Y Z BLOCK [--operation ID]
  fill X1 Y1 Z1 X2 Y2 Z2 BLOCK [--operation ID]
  camera X Y Z --yaw DEGREES --pitch DEGREES --out view.png [--width N --height N --fov N --distance N]
  example [--x X --y Y --z Z --operation ID]

Mutation output is a compact receipt by default. Pass --verbose (or --include-edits) to include every authoritative edit revision.
`);
}

if (import.meta.main) {
  main(Bun.argv.slice(2)).catch((error) => {
    process.stderr.write(`lakecraft-agent: ${error instanceof Error ? error.message : "command failed"}\n`);
    process.exitCode = 1;
  });
}
