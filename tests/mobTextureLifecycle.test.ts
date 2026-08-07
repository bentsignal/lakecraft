import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createMobTexture, destroyMobTexture } from "../client/game/mobRenderer.ts";

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

const imageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Image");
function setImage(value: typeof Image | undefined): void {
  Object.defineProperty(globalThis, "Image", { configurable: true, writable: true, value });
}

try {
  setImage(undefined);
  const headless = new FakeGl();
  createMobTexture(headless as unknown as WebGLRenderingContext);
  assert.equal(headless.uploads.length, 1, "headless creation synchronously uploads one valid fallback texel");
  assert.equal(headless.uploads[0]?.[3], 1);
  assert.equal(headless.uploads[0]?.[4], 1);
  assert.deepEqual([...headless.uploads[0]?.[8] as Uint8Array], [255, 255, 255, 255]);

  FakeImage.instances.length = 0;
  setImage(FakeImage as unknown as typeof Image);
  const pendingGl = new FakeGl();
  createMobTexture(pendingGl as unknown as WebGLRenderingContext);
  const pending = FakeImage.instances.at(-1)!;
  assert.equal(pendingGl.uploads.length, 1, "pending image keeps the complete fallback texture");
  assert.ok(pending.src.startsWith("data:image/png;base64,"));

  pending.dispatch("load");
  assert.equal(pendingGl.uploads.length, 2, "successful load replaces the fallback exactly once");
  assert.equal(pendingGl.uploads[1]?.length, 6, "the successful upload uses the HTML image overload");
  assert.equal(pendingGl.flips, 1);
  pending.dispatch("error");
  assert.equal(pendingGl.uploads.length, 2, "a settled success ignores later events");

  const failedGl = new FakeGl();
  createMobTexture(failedGl as unknown as WebGLRenderingContext);
  const failed = FakeImage.instances.at(-1)!;
  failed.dispatch("error");
  assert.equal(failedGl.uploads.length, 1, "failure deterministically retains the fallback");
  failed.dispatch("load");
  assert.equal(failedGl.uploads.length, 1, "failure cannot later revive the async upload");

  const destroyedGl = new FakeGl();
  const destroyedTexture = createMobTexture(destroyedGl as unknown as WebGLRenderingContext);
  const destroyed = FakeImage.instances.at(-1)!;
  const capturedLoad = [...destroyed.listeners.get("load") ?? []][0] as EventListener;
  const capturedError = [...destroyed.listeners.get("error") ?? []][0] as EventListener;
  destroyMobTexture(destroyedGl as unknown as WebGLRenderingContext, destroyedTexture);
  assert.equal(destroyedGl.deletes, 1);
  assert.equal(destroyed.listeners.get("load")?.size, 0);
  assert.equal(destroyed.listeners.get("error")?.size, 0);
  capturedLoad.call(destroyed, new Event("load"));
  capturedError.call(destroyed, new Event("error"));
  assert.equal(destroyedGl.uploads.length, 1, "callbacks captured before destruction cannot touch deleted GL state");

  const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
  const lab = readFileSync(new URL("../client/game/visualLabRenderer.ts", import.meta.url), "utf8");
  assert.match(engine, /destroyMobTexture\(gl, mobTexture\)/, "gameplay destruction cancels the atlas loader");
  assert.equal((lab.match(/destroyMobTexture\(gl, mobTexture\)/g) ?? []).length, 2,
    "Visual Lab failure and normal destruction cancel the atlas loader");
} finally {
  if (imageDescriptor) Object.defineProperty(globalThis, "Image", imageDescriptor);
  else Reflect.deleteProperty(globalThis, "Image");
}

console.log("mob texture fallback and async lifecycle tests passed");
