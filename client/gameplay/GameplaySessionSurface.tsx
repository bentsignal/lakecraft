import { createContext, type ComponentChildren, type RefObject } from "preact";
import { useContext } from "preact/hooks";
import type { PlayerPose, VoxelPerformanceStats } from "../game/types.ts";
import { GameplayDiagnostics } from "../gameplayDiagnostics.tsx";
import type { GameplayAuthorityKind } from "./authority.ts";

const GameplayAuthorityContext = createContext<GameplayAuthorityKind | null>(null);

export function useGameplayAuthorityKind(): GameplayAuthorityKind {
  const authority = useContext(GameplayAuthorityContext);
  if (!authority) throw new Error("Gameplay UI must be mounted inside GameplaySessionSurface.");
  return authority;
}

export interface GameplaySessionSurfaceProps {
  authority: GameplayAuthorityKind;
  rootClassName: string;
  rootStyle?: string;
  canvasRef: RefObject<HTMLCanvasElement>;
  canvasClassName?: string;
  canvasLabel: string;
  canvasTestId?: string;
  diagnostics: {
    pose: Pick<PlayerPose, "x" | "y" | "z">;
    gameMode: "creative" | "survival";
    stats: Pick<VoxelPerformanceStats, "fps"> | null;
    visible?: boolean;
  };
  ready?: boolean;
  children?: ComponentChildren;
}

/** One canvas/HUD/chat composition for every authority implementation. */
export function GameplaySessionSurface({
  authority,
  rootClassName,
  rootStyle,
  canvasRef,
  canvasClassName,
  canvasLabel,
  canvasTestId,
  diagnostics,
  ready = true,
  children,
}: GameplaySessionSurfaceProps) {
  return (
    <GameplayAuthorityContext.Provider value={authority}>
      <main className={rootClassName} data-gameplay-authority={authority}>
        {rootStyle ? <style>{rootStyle}</style> : null}
        <style>{`.lc-gameplay-loading{align-items:center;background:#202020;color:#fff;display:flex;flex-direction:column;font-family:var(--lc-pixel-font,"Courier New",monospace);gap:10px;inset:0;justify-content:center;position:fixed;z-index:90}.lc-gameplay-loading strong{font-size:22px;text-shadow:2px 2px #000}.lc-gameplay-loading small{color:#bbb}`}</style>
        <canvas
          aria-label={canvasLabel}
          className={canvasClassName}
          data-testid={canvasTestId}
          ref={canvasRef}
          tabIndex={0}
        />
        <GameplayDiagnostics {...diagnostics} />
        {!ready ? <div className="lc-gameplay-loading" role="status" aria-live="polite"><strong>Loading world</strong><small>Preparing terrain…</small></div> : null}
        {children}
      </main>
    </GameplayAuthorityContext.Provider>
  );
}
