export type SurvivalHudProps = {
  health?: number;
  maxHealth?: number;
  hunger?: number;
  maxHunger?: number;
  armor?: number;
  maxArmor?: number;
};

export type SurvivalIconState = "full" | "half" | "empty";
type SurvivalIconKind = "health" | "hunger" | "armor";

const SURVIVAL_ICON_ART: Record<SurvivalIconKind, { outline: string; inset: string; highlight: string }> = {
  health: {
    outline: "M1 1h2v1h1V1h2v1h1v1h1v3H7v1H6v1H5v1H4V8H3V7H2V6H1V5H0V2h1z",
    inset: "M1 2h2v1h1V2h2v1h1v3H6v1H5v1H4v1H3V6H2V5H1z",
    highlight: "M1 2h2v1H2v2H1z",
  },
  hunger: {
    outline: "M5 0h2v1h1v1h1v3H8v1H7v1H6v1H5v1H3v1H1V8H0V6h1V5h2V3h1V1h1z",
    inset: "M5 1h2v1h1v3H7v1H6v1H5v1H4V7H3V6H2V5h2V3h1z",
    highlight: "M6 1h1v1h1v2H7V3H6z",
  },
  armor: {
    outline: "M1 1h2v1h3V1h2v1h1v3H8v4H7v1H2V8H1V5H0V2h1z",
    inset: "M1 2h2v1h3V2h2v3H7v3H2V5H1z",
    highlight: "M1 2h2v1H2v2H1z",
  },
};

export function survivalIconStates(value = 0, max = 20) {
  const safeMax = Math.max(2, max);
  const safeValue = Math.max(0, Math.min(safeMax, value));
  return Array.from({ length: Math.ceil(safeMax / 2) }, (_, index) => {
    const remaining = safeValue - index * 2;
    return remaining >= 2 ? "full" : remaining >= 1 ? "half" : "empty";
  });
}

function SurvivalIcon({ kind, state }: { kind: SurvivalIconKind; state: SurvivalIconState }) {
  const art = SURVIVAL_ICON_ART[kind];
  const fillWidth = state === "full" ? 9 : state === "half" ? 5 : 0;
  return (
    <span className="lc-meter__icon" data-state={state} aria-hidden="true">
      <svg viewBox="0 0 9 9" shape-rendering="crispEdges" focusable="false">
        <path className="lc-meter__outline" d={art.outline} />
        <path className="lc-meter__empty" d={art.inset} />
        <svg className="lc-meter__fill-layer" height="9" width={fillWidth}>
          <path className="lc-meter__fill" d={art.inset} />
          <path className="lc-meter__highlight" d={art.highlight} />
        </svg>
      </svg>
    </span>
  );
}

function Meter({ kind, value, max }: { kind: SurvivalIconKind; value: number; max: number }) {
  const states = survivalIconStates(value, max);
  const safeValue = Math.max(0, Math.min(Math.max(2, max), value));
  return (
    <div className={`lc-meter lc-meter--${kind}`} aria-label={`${safeValue} of ${Math.max(2, max)} ${kind}`} role="meter" aria-valuemin={0} aria-valuemax={Math.max(2, max)} aria-valuenow={safeValue}>
      {states.map((state, index) => <SurvivalIcon kind={kind} state={state} key={index} />)}
    </div>
  );
}

export function SurvivalHud({ health = 20, maxHealth = 20, hunger = 20, maxHunger = 20, armor = 0, maxArmor = 20 }: SurvivalHudProps) {
  return (
    <div className="lc-survival" aria-label="Survival status">
      {armor > 0 ? <Meter kind="armor" max={maxArmor} value={armor} /> : <span />}
      <span />
      <Meter kind="health" max={maxHealth} value={health} />
      <Meter kind="hunger" max={maxHunger} value={hunger} />
    </div>
  );
}

/** @deprecated Use SurvivalHud. Retained as a source-compatible, unbranded alias. */
export type StatusStripProps = SurvivalHudProps;
export function StatusStrip(props: StatusStripProps) {
  return <SurvivalHud {...props} />;
}
