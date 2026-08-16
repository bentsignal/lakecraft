import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createMobTexture, destroyMobTexture } from "../client/game/mobRenderer.ts";
import { MOB_TEXTURE_ATLAS_PNG } from "../client/game/generated/mobTextureAtlas.ts";

type Listener = EventListenerOrEventListenerObject;

class FakeImage {
  static instances: FakeImage[] = [];
  readonly listeners = new Map<string, Set<Listener>>();
  src = "";

  constructor() { FakeImage.instances.push(this); }
  addEventListener(type: string, listener: Listener): void {
    let group = this.listeners.get(type);
    if (!group) this.listeners.set(type, group = new Set());
    group.add(listener);
  }
  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }
  dispatch(type: "load" | "error"): void {
    for (const listener of [...this.listeners.get(type) ?? []]) {
      if (typeof listener === "function") listener.call(this, new Event(type));
      else listener.handleEvent(new Event(type));
    }
  }
}

class FakeBitmap {
  closes = 0;
  close(): void { this.closes += 1; }
}

class FakeGl {
  readonly TEXTURE_2D = 0x0de1;
  readonly RGBA = 0x1908;
  readonly UNSIGNED_BYTE = 0x1401;
  readonly TEXTURE_MIN_FILTER = 0x2801;
  readonly TEXTURE_MAG_FILTER = 0x2800;
  readonly TEXTURE_WRAP_S = 0x2802;
  readonly TEXTURE_WRAP_T = 0x2803;
  readonly NEAREST = 0x2600;
  readonly CLAMP_TO_EDGE = 0x812f;
  readonly UNPACK_FLIP_Y_WEBGL = 0x9240;
  readonly texture = { kind: "mob" };
  uploads: unknown[][] = [];
  binds = 0;
  flips = 0;
  deletes = 0;
  createTexture() { return this.texture; }
  bindTexture() { this.binds += 1; }
  texImage2D(...args: unknown[]) { this.uploads.push(args); }
  texParameteri() {}
  pixelStorei() { this.flips += 1; }
  deleteTexture(texture: unknown) { assert.equal(texture, this.texture); this.deletes += 1; }
}

const bitmapDescriptor = Object.getOwnPropertyDescriptor(globalThis, "createImageBitmap");
const imageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Image");
const urlDescriptor = Object.getOwnPropertyDescriptor(globalThis, "URL");
const setGlobal = (key: string, value: unknown) =>
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

async function run(): Promise<void> {
  try {
    let decodedBlob: Blob | null = null;
    const bitmap = new FakeBitmap();
    setGlobal("Image", undefined);
    setGlobal("createImageBitmap", async (blob: Blob) => {
      decodedBlob = blob;
      return bitmap as unknown as ImageBitmap;
    });
    const gl = new FakeGl();
    const texture = createMobTexture(gl as unknown as WebGLRenderingContext);
    assert.equal(gl.uploads.length, 1, "the compact PNG gets one complete colored placeholder while it decodes");
    assert.deepEqual([gl.uploads[0]?.[3], gl.uploads[0]?.[4]], [2, 2]);
    const placeholder = [...gl.uploads[0]?.[8] as Uint8Array];
    assert.equal(placeholder.length, 16);
    assert.notDeepEqual(placeholder, new Array(16).fill(255), "the decode window cannot render all-white mobs");
    await flush();
    assert.equal(gl.uploads.length, 2, "ImageBitmap replaces the placeholder exactly once");
    assert.equal(gl.uploads[1]?.length, 6, "the exact decoded source uses the TexImageSource overload");
    assert.equal(gl.uploads[1]?.[5], bitmap);
    assert.equal(gl.flips, 1);
    assert.equal(bitmap.closes, 1);
    assert.deepEqual(
      Buffer.from(await decodedBlob!.arrayBuffer()),
      Buffer.from(MOB_TEXTURE_ATLAS_PNG, "base64"),
      "Blob decoding receives the exact hash-pinned installed atlas bytes",
    );
    destroyMobTexture(gl as unknown as WebGLRenderingContext, texture);
    assert.equal(gl.deletes, 1);

    let resolveLate!: (bitmap: ImageBitmap) => void;
    setGlobal("createImageBitmap", () => new Promise<ImageBitmap>((resolve) => { resolveLate = resolve; }));
    const racedGl = new FakeGl();
    const racedTexture = createMobTexture(racedGl as unknown as WebGLRenderingContext);
    destroyMobTexture(racedGl as unknown as WebGLRenderingContext, racedTexture);
    const lateBitmap = new FakeBitmap();
    resolveLate(lateBitmap as unknown as ImageBitmap);
    await flush();
    assert.equal(racedGl.uploads.length, 1, "a late decoder cannot upload into a destroyed texture");
    assert.equal(lateBitmap.closes, 1, "the late bitmap is still released");

    const revoked: string[] = [];
    setGlobal("createImageBitmap", undefined);
    setGlobal("Image", FakeImage);
    setGlobal("URL", {
      createObjectURL: () => "blob:mob-atlas",
      revokeObjectURL: (value: string) => revoked.push(value),
    });
    FakeImage.instances.length = 0;
    const fallbackGl = new FakeGl();
    createMobTexture(fallbackGl as unknown as WebGLRenderingContext);
    const fallbackImage = FakeImage.instances[0]!;
    assert.equal(fallbackImage.src, "blob:mob-atlas", "fallback decoding uses a Blob URL, never a data URL");
    fallbackImage.dispatch("load");
    assert.equal(fallbackGl.uploads.length, 2);
    assert.equal(fallbackGl.uploads[1]?.[5], fallbackImage);
    assert.deepEqual(revoked, ["blob:mob-atlas"]);
  } finally {
    for (const [key, descriptor] of [
      ["createImageBitmap", bitmapDescriptor], ["Image", imageDescriptor], ["URL", urlDescriptor],
    ] as const) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }

  const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
  const gameplayEngine = readFileSync(new URL("../client/gameplay/engine.ts", import.meta.url), "utf8");
  const lab = readFileSync(new URL("../client/game/visualLabRenderer.ts", import.meta.url), "utf8");
  assert.match(engine, /const mobTexture = createMobTexture\(gl\)/,
    "the canonical voxel renderer owns the mob atlas for both authority modes");
  assert.match(gameplayEngine, /return createVoxelEngine\(canvas, \{/,
    "local and Railway sessions share that exact renderer");
  assert.match(engine, /destroyMobTexture\(gl, mobTexture\)/);
  assert.equal((lab.match(/destroyMobTexture\(gl, mobTexture\)/g) ?? []).length, 2);
  console.log("mob texture Blob decode and lifecycle tests passed");
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
