import { useEffect, useRef } from "preact/hooks";
import { loadPersistedPlayerSkin } from "../game/playerSkin.ts";
import { createPlayerSkinRenderer, type PlayerSkinRenderer } from "../game/playerSkinRenderer.ts";
import { inventoryPreviewLook, inventoryPreviewViewProjection } from "./inventoryPreviewLook.ts";

type Preview = readonly [WebGLRenderingContext, PlayerSkinRenderer, Float32Array];

function repaint(canvas: HTMLCanvasElement | null, preview: Preview | null, pointer: readonly [number, number]): void {
  if (!canvas || !preview) return;
  const bounds = canvas.getBoundingClientRect();
  const look = inventoryPreviewLook(pointer, [bounds.left, bounds.top, bounds.width, bounds.height]);
  const [gl, renderer, viewProjection] = preview;
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
  // The shared world renderer's yaw zero faces away from this fixed portrait
  // camera. Rotate the base pose half a turn, then subtract screen-space look
  // so the model's authored +Z front turns toward the cursor.
  renderer.draw(viewProjection, { x: 0, y: 0, z: 0, yaw: Math.PI - look[0] * .42, pitch: 0 }, [1,1,1], {
    motion: "idle", phase: 0, headYaw: look[0] * .62, headPitch: look[1] * .38,
  });
}

/** True 3D inventory portrait using the exact F5 skin geometry and rig. */
export function PlayerSkinPreview({ open, pointer }: { open: boolean; pointer: readonly [number, number] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<Preview | null>(null);
  const pointerRef = useRef(pointer);
  pointerRef.current = pointer;
  useEffect(() => {
    let active = true;
    const canvas = canvasRef.current;
    const gl = canvas?.getContext("webgl", { alpha: false, antialias: false, depth: true });
    if (!canvas || !gl) return;
    const renderer = createPlayerSkinRenderer(gl);
    previewRef.current = [gl, renderer, inventoryPreviewViewProjection(canvas.width / canvas.height)];
    repaint(canvas, previewRef.current, pointerRef.current);
    const persisted = loadPersistedPlayerSkin(window.localStorage);
    if (persisted) {
      const selected = new Image();
      selected.onload = () => {
        if (!active) return;
        renderer.setSkin(selected, persisted.model);
        repaint(canvas, previewRef.current, pointerRef.current);
      };
      selected.src = persisted.dataUrl;
    }
    return () => {
      active = false;
      renderer.destroy();
      // Inventory mounts a fresh canvas while the world keeps its own WebGL
      // context alive. Explicitly retire this short-lived context so repeated
      // opens cannot make the browser evict the older world renderer.
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      previewRef.current = null;
    };
  }, [open]);
  useEffect(() => {
    repaint(canvasRef.current, previewRef.current, pointer);
  }, [pointer[0], pointer[1]]);
  return <canvas aria-label="Your current 3D player follows the pointer" className="lc-player-preview" height={210} ref={canvasRef} role="img" width={147} />;
}
