import type { PlayerPose, VoxelEngine, VoxelPerformanceStats } from "./game/types.ts";
import { copyGameScreenshot, downloadGameScreenshot, gameScreenshotFilename } from "./gameplayScreenshot.ts";

export function handleGameplayScreenshotKey(
  event: KeyboardEvent,
  engine: VoxelEngine | null,
  report: (title: string, detail: string, tone: "success" | "warning") => void,
  code = "F2",
): boolean {
  if (event.code !== "F2" && event.code !== code || event.repeat || !engine) return false;
  event.preventDefault();
  event.stopImmediatePropagation();
  const png = engine.captureScreenshot();
  const copied = copyGameScreenshot(png);
  const filename = gameScreenshotFilename();
  void png.then((blob) => {
    downloadGameScreenshot(blob, filename);
    return copied;
  }).then((didCopy) => report(
    didCopy ? "Screenshot copied" : "Screenshot saved",
    didCopy ? `${filename} also saved to Downloads.` : `${filename} saved to Downloads.`,
    "success",
  ), () => report("Screenshot failed", "The game kept running. Press F2 to try again.", "warning"));
  return true;
}

export function GameplayDiagnostics({
  pose,
  gameMode,
  stats,
  visible = false,
}: {
  pose: Pick<PlayerPose, "x" | "y" | "z">;
  gameMode: "creative" | "survival";
  stats: Pick<VoxelPerformanceStats, "fps"> | null;
  visible?: boolean;
}) {
  if (!visible) return null;
  const x = Math.floor(pose.x); const y = Math.floor(pose.y); const z = Math.floor(pose.z);
  return (
    <aside className="lc-gameplay-diagnostics" aria-label={`Coordinates X ${x}, Y ${y}, Z ${z}. ${gameMode} mode`}>
      <style>{`.lc-gameplay-diagnostics{color:#fff;font:16px/1.2 var(--lc-pixel-font,"Courier New",monospace);left:8px;letter-spacing:.01em;pointer-events:none;position:fixed;text-shadow:2px 2px #202020;top:7px;z-index:8}`}</style>
      <span>XYZ: {x} / {y} / {z} · {gameMode === "creative" ? "Creative" : "Survival"} · FPS {Math.max(0, Math.round(stats?.fps ?? 0))}</span>
    </aside>
  );
}
