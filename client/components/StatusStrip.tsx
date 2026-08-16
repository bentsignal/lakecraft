import { SURVIVAL_HUD_SPRITES } from "./generated/survivalHudSprites.ts";

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

export function survivalIconStates(value = 0, max = 20) {
  const safeMax = Math.max(2, max);
  const safeValue = Math.max(0, Math.min(safeMax, value));
  return Array.from({ length: Math.ceil(safeMax / 2) }, (_, index) => {
    const remaining = safeValue - index * 2;
    return remaining >= 2 ? "full" : remaining >= 1 ? "half" : "empty";
  });
}

function SurvivalIcon({ kind, state }: { kind: SurvivalIconKind; state: SurvivalIconState }) {
  const sprites = SURVIVAL_HUD_SPRITES[kind];
  return (
    <span className="lc-meter__icon" data-state={state} aria-hidden="true">
      <img alt="" className="lc-meter__sprite lc-meter__sprite--empty" draggable={false} src={sprites.empty} />
      {state !== "empty" ? <img alt="" className="lc-meter__sprite lc-meter__sprite--fill" draggable={false} src={sprites[state]} /> : null}
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
      {armor > 0 ? <div className="lc-survival__armor"><Meter kind="armor" max={maxArmor} value={armor} /></div> : null}
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
