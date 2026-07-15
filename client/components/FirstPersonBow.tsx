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
  chargeMs: number;
  charging: boolean;
  hidden?: boolean;
};

const BOW_FEEDBACK_CSS = `
.lc-first-person-bow{position:fixed;right:2.5vmin;bottom:-2vmin;width:min(37vmin,360px);height:min(37vmin,360px);z-index:16;pointer-events:none;filter:drop-shadow(0 5px 0 rgba(0,0,0,.38));transform-origin:82% 76%;animation:lc-bow-ready 90ms steps(2,end)}
.lc-first-person-bow svg{display:block;width:100%;height:100%;overflow:visible;shape-rendering:crispEdges}
.lc-first-person-bow__wood{fill:none;stroke:#7c431c;stroke-width:5;stroke-linecap:square;stroke-linejoin:miter}
.lc-first-person-bow__highlight{fill:none;stroke:#b87632;stroke-width:2;stroke-linecap:square}
.lc-first-person-bow__string{fill:none;stroke:#ded9c9;stroke-width:1.5;stroke-linecap:square}
.lc-first-person-bow__arrow{stroke:#8b572a;stroke-width:2;stroke-linecap:square}
.lc-first-person-bow__arrowhead{fill:#aeb4b0}
.lc-first-person-bow__fletching{fill:#dfd8ca}
.lc-first-person-bow[data-charge-stage="2"]{filter:drop-shadow(0 5px 0 rgba(0,0,0,.38)) drop-shadow(0 0 5px rgba(255,255,255,.16))}
@keyframes lc-bow-ready{from{transform:translate(3px,4px) rotate(1deg)}to{transform:none}}
`;

/** Pixel-stepped first-person bow pose; combat timing remains server-authoritative. */
export function FirstPersonBow({ chargeMs, charging, hidden = false }: FirstPersonBowProps) {
  if (hidden) return null;
  const progress = charging ? bowChargeProgress(chargeMs) : 0;
  const stage = bowChargeStage(progress);
  const nockX = 46 + stage * 5;
  const arrowTailX = 56 + stage * 5;
  return (
    <>
      <style>{BOW_FEEDBACK_CSS}</style>
      <span
        aria-hidden="true"
        className="lc-first-person-bow"
        data-bow-charge-stage={stage}
        data-bow-charging={charging ? "true" : "false"}
      >
        <svg viewBox="0 0 80 80">
          <path className="lc-first-person-bow__wood" d="M65 10 L72 22 L74 38 L72 54 L64 69" />
          <path className="lc-first-person-bow__highlight" d="M64 11 L69 23 M70 55 L63 68" />
          <path className="lc-first-person-bow__string" d={`M65 10 L${nockX} 39 L64 69`} />
          {charging ? (
            <g>
              <path className="lc-first-person-bow__arrow" d={`M${arrowTailX} 39 L15 39`} />
              <path className="lc-first-person-bow__arrowhead" d="M10 39 L18 34 L18 44 Z" />
              <path className="lc-first-person-bow__fletching" d={`M${arrowTailX} 39 L${arrowTailX + 7} 34 L${arrowTailX + 5} 39 L${arrowTailX + 7} 44 Z`} />
            </g>
          ) : null}
        </svg>
      </span>
    </>
  );
}
