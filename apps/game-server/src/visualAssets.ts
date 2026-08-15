export const VISUAL_ASSET_PATHS = Object.freeze({
  "/assets/block-texture-atlas-a607e4c6.png": "block-texture-atlas-a607e4c6.png",
  "/assets/block-texture-atlas-d94c19f9.png": "block-texture-atlas-d94c19f9.png",
  "/assets/mob-texture-atlas-204e2b83.png": "mob-texture-atlas-204e2b83.png",
} as const);

/** Immutable, public visual data shared by the single- and multiplayer renderer. */
export function handleVisualAssetRequest(request: Request, url = new URL(request.url)): Response | null {
  const name = VISUAL_ASSET_PATHS[url.pathname as keyof typeof VISUAL_ASSET_PATHS];
  if (!name) return null;
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: {
      "access-control-allow-origin": "*", "access-control-allow-methods": "GET, OPTIONS",
    } });
  }
  if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
  return new Response(Bun.file(new URL(`../assets/${name}`, import.meta.url)), {
    headers: {
      "access-control-allow-origin": "*",
      "cache-control": "public, max-age=31536000, immutable",
      "content-type": "image/png",
      etag: `"${name.slice(0, -4)}"`,
    },
  });
}
