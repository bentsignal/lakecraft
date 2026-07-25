import { useEffect } from "preact/hooks";

const OPTIONS_CSS = `
.lc-options-layer{align-items:flex-start;background:rgba(0,0,0,.66);color:#fff;display:flex;font-family:var(--lc-pixel-font,"Courier New",monospace);inset:0;justify-content:center;overflow-y:auto;padding:clamp(54px,12vh,112px) 14px 24px;position:fixed;text-shadow:2px 2px #202020;z-index:95}.lc-options{max-width:620px;text-align:center;width:100%}.lc-options h2{font-size:22px;font-weight:400;margin:0 0 clamp(34px,7vh,64px)}.lc-options__grid{display:grid;gap:10px;grid-template-columns:1fr 1fr}.lc-options button,.lc-options__slider{background:#777;border:2px solid #111;box-shadow:inset 2px 2px #aaa,inset -2px -2px #555;color:#fff;font:16px/1 var(--lc-pixel-font,"Courier New",monospace);min-height:42px;padding:9px 16px;text-shadow:2px 2px #333}.lc-options button{cursor:pointer}.lc-options button:hover,.lc-options button:focus-visible{background:#6b6bb6;box-shadow:inset 2px 2px #9b9be1,inset -2px -2px #3c3c76;outline:2px solid #fff}.lc-options__slider{align-items:center;display:grid;gap:6px;grid-column:1/-1;grid-template-columns:auto 1fr}.lc-options__slider span{white-space:nowrap}.lc-options input{accent-color:#fff;cursor:pointer;width:100%}.lc-options__done{grid-column:1/-1;margin-top:clamp(26px,6vh,54px)}@media(max-width:520px){.lc-options__grid{grid-template-columns:1fr}.lc-options__slider,.lc-options__done{grid-column:1}.lc-options__slider{grid-template-columns:1fr}.lc-options h2{margin-bottom:28px}}
`;

export interface OptionsDialogProps {
  open: boolean;
  soundMuted: boolean;
  mouseSensitivity: number;
  onToggleSound: () => void;
  onSensitivityChange: (value: number) => void;
  onBack: () => void;
  returnFocusId?: string;
}

export function OptionsDialog({ open, soundMuted, mouseSensitivity, onToggleSound, onSensitivityChange, onBack, returnFocusId }: OptionsDialogProps) {
  const close = () => {
    onBack();
    if (returnFocusId) window.requestAnimationFrame(() => document.getElementById(returnFocusId)?.focus());
  };
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.repeat) {
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = [...document.querySelectorAll<HTMLElement>("#lc-options-dialog button,#lc-options-dialog input")]
        .filter((element) => !(element instanceof HTMLButtonElement) || !element.disabled);
      if (controls.length < 2) return;
      const active = controls.indexOf(document.activeElement as HTMLElement);
      const next = event.shiftKey ? (active <= 0 ? controls.length - 1 : active - 1) : (active + 1) % controls.length;
      event.preventDefault();
      controls[next].focus();
    };
    window.addEventListener("keydown", closeOnEscape, true);
    return () => window.removeEventListener("keydown", closeOnEscape, true);
  }, [open, onBack, returnFocusId]);

  if (!open) return null;
  return (
    <div className="lc-options-layer" role="presentation">
      <style>{OPTIONS_CSS}</style>
      <section aria-labelledby="lc-options-title" aria-modal="true" className="lc-options" data-testid="options-dialog" id="lc-options-dialog" role="dialog">
        <h2 id="lc-options-title">Options</h2>
        <div className="lc-options__grid">
          <button aria-pressed={soundMuted} onClick={onToggleSound} type="button">Sound: {soundMuted ? "OFF" : "ON"}</button>
          <label className="lc-options__slider">
            <span>Sensitivity: {mouseSensitivity}%</span>
            <input aria-label="Mouse sensitivity" aria-valuetext={`${mouseSensitivity}%`} max="200" min="10" onInput={(event) => onSensitivityChange(Number(event.currentTarget.value))} step="5" type="range" value={mouseSensitivity} />
          </label>
          <button autoFocus className="lc-options__done" onClick={close} type="button">Done</button>
        </div>
      </section>
    </div>
  );
}
