import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { handleVisualAssetRequest, VISUAL_ASSET_PATHS } from "../src/visualAssets";

const EXPECTED = {
  "/assets/block-texture-atlas-9a3b9f30.png": "242bbf5316677c49565d829adfd5cadcc2830d5682ce95a80b7add3bbd4effa3",
  "/assets/block-texture-atlas-a607e4c6.png": "e2129f5f77e252a155d8163371485e8279dae0056de5048f5afe44092ae7139e",
  "/assets/block-texture-atlas-d94c19f9.png": "1ac5805312f699ef1afd78a0038ccc6f2596e290dd4e6050b5ab1cd6b649ef89",
  "/assets/mob-texture-atlas-204e2b83.png": "204e2b831ffd3716b9a1c04fab27fc832f0f0ce686c20896364a91d1b553e9f3",
} as const;

describe("shared visual asset delivery", () => {
  test("serves exact hash-versioned PNGs with immutable cross-origin caching", async () => {
    expect(Object.keys(VISUAL_ASSET_PATHS)).toEqual(Object.keys(EXPECTED));
    for (const [path, expected] of Object.entries(EXPECTED)) {
      const response = handleVisualAssetRequest(new Request(`https://server.test${path}`));
      expect(response?.status).toBe(200);
      expect(response?.headers.get("access-control-allow-origin")).toBe("*");
      expect(response?.headers.get("cache-control")).toContain("immutable");
      expect(response?.headers.get("content-type")).toBe("image/png");
      const bytes = new Uint8Array(await response!.arrayBuffer());
      expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(expected);
    }
  });

  test("answers preflight, rejects mutation methods, and ignores unrelated routes", () => {
    const path = Object.keys(EXPECTED)[0];
    expect(handleVisualAssetRequest(new Request(`https://server.test${path}`, { method: "OPTIONS" }))?.status).toBe(204);
    expect(handleVisualAssetRequest(new Request(`https://server.test${path}`, { method: "POST" }))?.status).toBe(405);
    expect(handleVisualAssetRequest(new Request("https://server.test/assets/not-versioned.png"))).toBeNull();
  });
});
