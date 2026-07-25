import { useRef } from "preact/hooks";
import { shouldAnimateFirstPersonAction } from "./firstPersonAction";

export const BOW_FULL_CHARGE_MS = 1_000;

export function bowChargeProgress(chargeMs: number): number {
  if (!Number.isFinite(chargeMs) || chargeMs <= 0) return 0;
  return Math.min(1, chargeMs / BOW_FULL_CHARGE_MS);
}

export function bowChargeStage(progress: number): 0 | 1 | 2 {
  const bounded = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
  if (bounded >= 0.9) return 2;
  if (bounded >= 0.55) return 1;
  return 0;
}

export type FirstPersonBowProps = {
  actionToken?: number;
  chargeMs: number;
  charging: boolean;
  hidden?: boolean;
};

const BOW_FEEDBACK_CSS = `
.lc-first-person-bow{position:fixed;right:2.5vmin;bottom:-2vmin;width:min(37vmin,360px);height:min(37vmin,360px);z-index:16;pointer-events:none;filter:drop-shadow(0 5px 0 rgba(0,0,0,.38));transform-origin:82% 76%;animation:lc-bow-ready 90ms steps(2,end)}
.lc-first-person-bow svg{display:block;width:100%;height:100%;overflow:visible;shape-rendering:crispEdges}
.lc-first-person-bow__wood-depth{fill:none;stroke:#3b210f;stroke-width:6;stroke-linecap:square;stroke-linejoin:miter}
.lc-first-person-bow__wood-edge{fill:none;stroke:#5b3015;stroke-width:3;stroke-linecap:square}
.lc-first-person-bow__wood{fill:none;stroke:#7c431c;stroke-width:5;stroke-linecap:square;stroke-linejoin:miter}
.lc-first-person-bow__highlight{fill:none;stroke:#b87632;stroke-width:2;stroke-linecap:square}
.lc-first-person-bow__string{fill:none;stroke:#ded9c9;stroke-width:1.5;stroke-linecap:square}
.lc-first-person-bow__arrow{stroke:#8b572a;stroke-width:2;stroke-linecap:square}
.lc-first-person-bow__arrowhead{fill:#aeb4b0}
.lc-first-person-bow__fletching{fill:#dfd8ca}
.lc-first-person-bow__projectile-depth{filter:brightness(.35)}
.lc-first-person-bow[data-bow-charge-stage="2"]{filter:drop-shadow(0 5px 0 rgba(0,0,0,.38)) drop-shadow(0 0 5px rgba(255,255,255,.16))}
.lc-first-person-bow.is-acting{animation:lc-bow-release .18s steps(2)}
@keyframes lc-bow-ready{from{transform:translate(3px,4px) rotate(1deg)}to{transform:none}}
@keyframes lc-bow-release{50%{transform:translate(-8px,7px) rotate(-5deg)}}
@media(prefers-reduced-motion:reduce){.lc-first-person-bow{animation:none}}
`;

/** Pixel-stepped first-person bow pose; combat timing remains server-authoritative. */
export function FirstPersonBow({ actionToken = 0, chargeMs, charging, hidden = false }: FirstPersonBowProps) {
  const lastActionToken = useRef(actionToken);
  const animatedActionToken = useRef<number | null>(null);
  const actionChanged = shouldAnimateFirstPersonAction(lastActionToken.current, actionToken, hidden);
  lastActionToken.current = actionToken;
  if (hidden) animatedActionToken.current = null;
  else if (actionChanged) animatedActionToken.current = actionToken;
  if (hidden) return null;
  const progress = charging ? bowChargeProgress(chargeMs) : 0;
  const stage = bowChargeStage(progress);
  const nockX = 62 - stage * 8;
  const arrowTailX = nockX + 2;
  const arrowShaft = `M${arrowTailX} 39 L15 39`;
  const fletching = `M${arrowTailX} 39 L${arrowTailX + 7} 34 L${arrowTailX + 5} 39 L${arrowTailX + 7} 44 Z`;
  return (
    <>
      <style>{BOW_FEEDBACK_CSS}</style>
      <span
        aria-hidden="true"
        className={`lc-first-person-bow${animatedActionToken.current === actionToken ? " is-acting" : ""}`}
        data-bow-charge-stage={stage}
        data-bow-charging={charging ? "true" : "false"}
        key={`bow-action-${actionToken}`}
      >
        <svg viewBox="0 0 80 80">
          <path className="lc-first-person-bow__wood-depth" d="M69 13 L76 25 L78 41 L76 57 L68 72" />
          <path className="lc-first-person-bow__wood-edge" d="M65 10L69 13 M72 22L76 25 M74 38L78 41 M72 54L76 57 M64 69L68 72" />
          <path className="lc-first-person-bow__wood" d="M65 10 L72 22 L74 38 L72 54 L64 69" />
          <path className="lc-first-person-bow__highlight" d="M64 11 L69 23 M70 55 L63 68" />
          <path className="lc-first-person-bow__string" d={`M65 10 L${nockX} 39 L64 69`} />
          {charging ? (
            <>
              <g className="lc-first-person-bow__projectile-depth" transform="translate(2 2)">
                <path className="lc-first-person-bow__arrow" d={arrowShaft} />
                <path className="lc-first-person-bow__arrowhead" d="M10 39 L18 34 L18 44 Z" />
                <path className="lc-first-person-bow__fletching" d={fletching} />
              </g>
              <g>
                <path className="lc-first-person-bow__arrow" d={arrowShaft} />
                <path className="lc-first-person-bow__arrowhead" d="M10 39 L18 34 L18 44 Z" />
                <path className="lc-first-person-bow__fletching" d={fletching} />
              </g>
            </>
          ) : null}
        </svg>
      </span>
    </>
  );
}
