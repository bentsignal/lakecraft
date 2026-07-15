export type SurvivalHudProps = {
  health?: number;
  maxHealth?: number;
  hunger?: number;
  maxHunger?: number;
  armor?: number;
  maxArmor?: number;
};

function iconState(value: number, index: number): "full" | "half" | "empty" {
  const remaining = value - index * 2;
  return remaining >= 2 ? "full" : remaining >= 1 ? "half" : "empty";
}

function Meter({ kind, value, max }: { kind: "health" | "hunger" | "armor"; value: number; max: number }) {
  const safeMax = Math.max(2, max);
  const safeValue = Math.max(0, Math.min(safeMax, value));
  const count = Math.ceil(safeMax / 2);
  return (
    <div className={`lc-meter lc-meter--${kind}`} aria-label={`${safeValue} of ${safeMax} ${kind}`} role="meter" aria-valuemin={0} aria-valuemax={safeMax} aria-valuenow={safeValue}>
      {Array.from({ length: count }, (_, index) => (
        <span className="lc-meter__icon" data-state={iconState(safeValue, index)} key={index} aria-hidden="true"><i /></span>
      ))}
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
