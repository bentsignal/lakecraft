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
  pointerCapture?: {
    visible: boolean;
    onRequest(): void;
  };
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
  pointerCapture,
  children,
}: GameplaySessionSurfaceProps) {
  return (
    <GameplayAuthorityContext.Provider value={authority}>
      <main className={rootClassName} data-gameplay-authority={authority}>
        {rootStyle ? <style>{rootStyle}</style> : null}
        <style>{`.lc-gameplay-capture{align-items:center;background:rgba(0,0,0,.34);display:flex;font-family:var(--lc-pixel-font,"Courier New",monospace);inset:0;justify-content:center;position:fixed;z-index:75}.lc-gameplay-capture[role=status]{background:#202020;color:#fff;flex-direction:column;gap:10px;z-index:90}.lc-gameplay-capture[role=status] strong{font-size:22px;text-shadow:2px 2px #000}.lc-gameplay-capture[role=status] small{color:#bbb}.lc-gameplay-capture button{background:#777;border:2px solid #111;box-shadow:inset 2px 2px #aaa,inset -2px -2px #555;color:#fff;cursor:pointer;font:18px/1 var(--lc-pixel-font,"Courier New",monospace);min-width:min(360px,calc(100vw - 32px));padding:16px 24px;text-shadow:2px 2px #333}.lc-gameplay-capture button:hover,.lc-gameplay-capture button:focus-visible{background:#6b6bb6;box-shadow:inset 2px 2px #9b9be1,inset -2px -2px #3c3c76;outline:2px solid #fff}.lc-gameplay-capture small{display:block;font-size:12px;margin-top:8px}`}</style>
        <canvas
          aria-label={canvasLabel}
          className={canvasClassName}
          data-testid={canvasTestId}
          ref={canvasRef}
          tabIndex={0}
        />
        <GameplayDiagnostics {...diagnostics} />
        {!ready ? <div className="lc-gameplay-capture" role="status" aria-live="polite"><strong>Loading world</strong><small>Preparing terrain…</small></div> : null}
        {ready && pointerCapture?.visible ? (
          <div className="lc-gameplay-capture" role="presentation">
            <button autoFocus onClick={pointerCapture.onRequest} type="button">
              Click to Play
              <small>Capture the mouse · Escape opens Game Menu</small>
            </button>
          </div>
        ) : null}
        {children}
      </main>
    </GameplayAuthorityContext.Provider>
  );
}
