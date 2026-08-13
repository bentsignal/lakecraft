import { useEffect, useRef } from "preact/hooks";
import {
  createLakecraftDefaultSkinPixels,
  loadPersistedPlayerSkin,
  type PlayerSkinModel,
} from "../game/playerSkin.ts";

function paintSkin(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sourceSize: number,
  model: PlayerSkinModel,
): void {
  const ratio = sourceSize / 64;
  const sample = (u: number, v: number, width: number, height: number, x: number, y: number) => {
    context.drawImage(source, u * ratio, v * ratio, width * ratio, height * ratio, x, y, width * 4, height * 4);
  };
  const armWidth = model === "slim" ? 3 : 4;
  const leftArmX = 24 - armWidth * 4;
  context.clearRect(0, 0, 80, 144);
  context.imageSmoothingEnabled = false;
  // Modern-skin front UVs. Transparent overlays preserve the exact hat,
  // sleeves, jacket, and trouser details selected for the canonical F5 rig.
  const parts = [
    8,8,8,8,24,4, 40,8,8,8,24,4, 20,20,8,12,24,36, 20,36,8,12,24,36,
    44,20,armWidth,12,leftArmX,36, 44,36,armWidth,12,leftArmX,36,
    36,52,armWidth,12,56,36, 52,52,armWidth,12,56,36,
    4,20,4,12,24,84, 4,36,4,12,24,84, 20,52,4,12,40,84, 4,52,4,12,40,84,
  ];
  for (let index = 0; index < parts.length; index += 6) {
    sample(parts[index], parts[index + 1], parts[index + 2], parts[index + 3], parts[index + 4], parts[index + 5]);
  }
}

/** Lightweight inventory portrait drawn from the exact locally selected skin. */
export function PlayerSkinPreview({ open }: { open: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
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
    paintSkin(context, fallback, 64, "wide");
    const persisted = loadPersistedPlayerSkin(window.localStorage);
    if (!persisted) return;
    const selected = new Image();
    selected.onload = () => paintSkin(context, selected, persisted.width, persisted.model);
    selected.src = persisted.dataUrl;
  }, [open]);
  return <canvas aria-label="Your current player skin" className="lc-player-preview" height={144} ref={canvasRef} role="img" width={80} />;
}
