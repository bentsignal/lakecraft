import { useEffect, useRef } from "preact/hooks";
import {
  createLakecraftDefaultSkinPixels,
  loadPersistedPlayerSkin,
  type PlayerSkinModel,
} from "../game/playerSkin.ts";
import { inventoryPreviewLook } from "./inventoryPreviewLook.ts";

function paintSkin(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sourceSize: number,
  model: PlayerSkinModel,
  look: readonly [number, number] = [0, 0],
): void {
  const ratio = sourceSize / 64;
  const scale = Math.min(context.canvas.width / 80, context.canvas.height / 144);
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, context.canvas.width, context.canvas.height);
  context.setTransform(scale, 0, 0, scale, (context.canvas.width - 80 * scale) / 2, 0);
  const sample = (u: number, v: number, width: number, height: number, x: number, y: number) => {
    context.drawImage(source, u * ratio, v * ratio, width * ratio, height * ratio, x, y, width * 4, height * 4);
  };
  const armWidth = model === "slim" ? 3 : 4;
  const leftArmX = 24 - armWidth * 4;
  context.imageSmoothingEnabled = false;
  // Modern-skin front UVs. Transparent overlays preserve the exact hat,
  // sleeves, jacket, and trouser details selected for the canonical F5 rig.
  const parts = [
    8,8,8,8,24,4, 40,8,8,8,24,4, 20,20,8,12,24,36, 20,36,8,12,24,36,
    44,20,armWidth,12,leftArmX,36, 44,36,armWidth,12,leftArmX,36,
    36,52,armWidth,12,56,36, 52,52,armWidth,12,56,36,
    4,20,4,12,24,84, 4,36,4,12,24,84, 20,52,4,12,40,84, 4,52,4,12,40,84,
  ];
  const paintParts = (start: number, end: number) => {
    for (let index = start; index < end; index += 6) {
      sample(parts[index], parts[index + 1], parts[index + 2], parts[index + 3], parts[index + 4], parts[index + 5]);
    }
  };
  // Minecraft's inventory portrait follows the pointer. A small body yaw and
  // a stronger independent head turn retain the pixel-art UVs while making the
  // selected skin visibly look toward the cursor.
  context.save();
  context.translate(40, 84);
  context.transform(1, 0, look[0] * .08, 1, look[0] * 2, 0);
  context.translate(-40, -84);
  paintParts(12, parts.length);
  context.restore();
  context.save();
  context.translate(40 + look[0] * 5, 20 + look[1] * 3);
  context.rotate(look[0] * .1);
  context.scale(1 - Math.abs(look[0]) * .12, 1);
  context.translate(-40, -20);
  paintParts(0, 12);
  context.restore();
}

type SkinSource = readonly [CanvasImageSource, number, PlayerSkinModel];

function repaint(
  canvas: HTMLCanvasElement | null,
  skin: SkinSource | null,
  pointer: readonly [number, number],
): void {
  const context = canvas?.getContext("2d");
  if (!canvas || !context || !skin) return;
  const bounds = canvas.getBoundingClientRect();
  paintSkin(context, skin[0], skin[1], skin[2],
    inventoryPreviewLook(pointer, [bounds.left, bounds.top, bounds.width, bounds.height]));
}

/** Lightweight inventory portrait drawn from the exact locally selected skin. */
export function PlayerSkinPreview({ open, pointer }: { open: boolean; pointer: readonly [number, number] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const skinRef = useRef<SkinSource | null>(null);
  const pointerRef = useRef(pointer);
  pointerRef.current = pointer;
  useEffect(() => {
    let active = true;
    const context = canvasRef.current?.getContext("2d");
    if (!context) return;
    const fallback = document.createElement("canvas");
    fallback.width = 64;
    fallback.height = 64;
    const fallbackContext = fallback.getContext("2d");
    if (!fallbackContext) return;
    const image = fallbackContext.createImageData(64, 64);
    image.data.set(createLakecraftDefaultSkinPixels());
    fallbackContext.putImageData(image, 0, 0);
    skinRef.current = [fallback, 64, "wide"];
    repaint(canvasRef.current, skinRef.current, pointerRef.current);
    const persisted = loadPersistedPlayerSkin(window.localStorage);
    if (!persisted) return () => { active = false; };
    const selected = new Image();
    selected.onload = () => {
      if (!active) return;
      skinRef.current = [selected, persisted.width, persisted.model];
      repaint(canvasRef.current, skinRef.current, pointerRef.current);
    };
    selected.src = persisted.dataUrl;
    return () => { active = false; };
  }, [open]);
  useEffect(() => {
    repaint(canvasRef.current, skinRef.current, pointer);
  }, [pointer[0], pointer[1]]);
  return <canvas aria-label="Your current player skin follows the pointer" className="lc-player-preview" height={210} ref={canvasRef} role="img" width={147} />;
}
