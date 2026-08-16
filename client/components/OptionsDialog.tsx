import { useEffect, useState } from "preact/hooks";
import { RENDER_DISTANCE_MAX, RENDER_DISTANCE_MIN } from "../settings";
import {
  DEFAULT_GAMEPLAY_CONTROL_BINDINGS,
  GAMEPLAY_CONTROL_ACTIONS,
  GAMEPLAY_CONTROL_LABELS,
  assignGameplayControlBinding,
  gameplayControlCodeLabel,
  gameplayControlConflicts,
  GAMEPLAY_CONTROL_RESERVED_INPUT_NOTE,
  type GameplayControlAction,
  type GameplayControlBindings,
} from "../gameplay/controlBindings.ts";

const OPTIONS_CSS = `
.lc-options-layer{align-items:flex-start;background:rgba(0,0,0,.66);color:#fff;display:flex;font-family:var(--lc-pixel-font,"Courier New",monospace);inset:0;justify-content:center;overflow-y:auto;padding:clamp(38px,7vh,72px) 14px 24px;position:fixed;text-shadow:2px 2px #202020;z-index:95}.lc-options{max-width:720px;text-align:center;width:100%}.lc-options h2{font-size:22px;font-weight:400;margin:0 0 28px}.lc-options h3{font-size:16px;font-weight:400;grid-column:1/-1;margin:12px 0 0}.lc-options__grid{display:grid;gap:10px;grid-template-columns:1fr 1fr}.lc-options button,.lc-options__slider{background:#777;border:2px solid #111;box-shadow:inset 2px 2px #aaa,inset -2px -2px #555;color:#fff;font:16px/1 var(--lc-pixel-font,"Courier New",monospace);min-height:42px;padding:9px 16px;text-shadow:2px 2px #333}.lc-options button{cursor:pointer}.lc-options button:hover,.lc-options button:focus-visible{background:#6b6bb6;box-shadow:inset 2px 2px #9b9be1,inset -2px -2px #3c3c76;outline:2px solid #fff}.lc-options__slider{align-items:center;display:grid;gap:6px;grid-column:1/-1;grid-template-columns:190px 1fr}.lc-options__slider span{white-space:nowrap}.lc-options input{accent-color:#fff;cursor:pointer;width:100%}.lc-options__done{grid-column:1/-1;margin-top:20px}.lc-options__controls{display:grid;gap:5px;grid-column:1/-1}.lc-options__control{align-items:center;display:grid;gap:8px;grid-template-columns:minmax(160px,1fr) minmax(150px,.7fr);text-align:left}.lc-options__control button{font-size:14px;min-height:36px;padding:7px}.lc-options__control button.is-capturing{background:#8888c8}.lc-options__control button.is-conflict{color:#ff8b8b}.lc-options__control small{grid-column:1/-1;text-align:right}.lc-options__note{color:#bfbfbf;font-size:11px;grid-column:1/-1;line-height:1.4;text-align:left}.lc-options__tabs{display:grid;gap:10px;grid-column:1/-1;grid-template-columns:repeat(3,1fr)}@media(max-width:520px){.lc-options__grid{grid-template-columns:1fr}.lc-options__slider,.lc-options__done,.lc-options h3{grid-column:1}.lc-options__slider{grid-template-columns:1fr}.lc-options__tabs{grid-template-columns:1fr}.lc-options__control{grid-template-columns:1fr}.lc-options h2{margin-bottom:20px}}
`;

export interface OptionsDialogProps {
  open: boolean;
  soundMuted: boolean;
  mouseSensitivity: number;
  fovDegrees: number;
  onToggleSound: () => void;
  onSensitivityChange: (value: number) => void;
  onFovChange: (value: number) => void;
  renderDistance?: number;
  onRenderDistanceChange?: (value: number) => void;
  onBack: () => void;
  returnFocusId?: string;
  masterVolume: number;
  musicVolume: number;
  blocksVolume: number;
  hostileVolume: number;
  passiveVolume: number;
  playersVolume: number;
  uiVolume: number;
  onVolumeChange: (category: "masterVolume" | "musicVolume" | "blocksVolume" | "hostileVolume" | "passiveVolume" | "playersVolume" | "uiVolume", value: number) => void;
  keyBindings: GameplayControlBindings;
  onKeyBindingsChange: (bindings: GameplayControlBindings) => void;
}

export function OptionsDialog({ open, soundMuted, mouseSensitivity, fovDegrees, renderDistance, onToggleSound, onSensitivityChange, onFovChange, onRenderDistanceChange, onBack, returnFocusId, masterVolume, musicVolume, blocksVolume, hostileVolume, passiveVolume, playersVolume, uiVolume, onVolumeChange, keyBindings, onKeyBindingsChange }: OptionsDialogProps) {
  const [panel, setPanel] = useState<"video" | "sound" | "controls">("video");
  const [captureAction, setCaptureAction] = useState<GameplayControlAction | null>(null);
  const close = () => {
    onBack();
    if (returnFocusId) window.requestAnimationFrame(() => document.getElementById(returnFocusId)?.focus());
  };
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (captureAction) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!event.repeat) {
          if (event.code !== "Escape") onKeyBindingsChange(assignGameplayControlBinding(keyBindings, captureAction, event.code));
          setCaptureAction(null);
        }
        return;
      }
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
    const captureMouse = (event: MouseEvent) => {
      if (captureAction !== "attack" && captureAction !== "use") return;
      event.preventDefault(); event.stopImmediatePropagation();
      onKeyBindingsChange(assignGameplayControlBinding(keyBindings, captureAction, `Mouse${event.button}`));
      setCaptureAction(null);
    };
    window.addEventListener("mousedown", captureMouse, true);
    return () => { window.removeEventListener("keydown", closeOnEscape, true); window.removeEventListener("mousedown", captureMouse, true); };
  }, [open, onBack, returnFocusId, captureAction, keyBindings, onKeyBindingsChange]);

  if (!open) return null;
  return (
    <div className="lc-options-layer" role="presentation">
      <style>{OPTIONS_CSS}</style>
      <section aria-labelledby="lc-options-title" aria-modal="true" className="lc-options" data-testid="options-dialog" id="lc-options-dialog" role="dialog">
        <h2 id="lc-options-title">Options</h2>
        <div className="lc-options__grid">
          <div className="lc-options__tabs">
            <button aria-pressed={panel === "video"} onClick={() => setPanel("video")} type="button">Video</button>
            <button aria-pressed={panel === "sound"} onClick={() => setPanel("sound")} type="button">Music & Sounds</button>
            <button aria-pressed={panel === "controls"} onClick={() => setPanel("controls")} type="button">Controls</button>
          </div>
          {panel === "video" ? <>
            <label className="lc-options__slider">
            <span>Sensitivity: {mouseSensitivity}%</span>
            <input aria-label="Mouse sensitivity" aria-valuetext={`${mouseSensitivity}%`} max="200" min="10" onInput={(event) => onSensitivityChange(Number(event.currentTarget.value))} step="5" type="range" value={mouseSensitivity} />
          </label>
          <label className="lc-options__slider">
            <span>FOV: {fovDegrees}°</span>
            <input aria-label="Field of view" aria-valuetext={`${fovDegrees} degrees`} max="110" min="30" onInput={(event) => onFovChange(Number(event.currentTarget.value))} step="1" type="range" value={fovDegrees} />
          </label>
          {renderDistance !== undefined && onRenderDistanceChange ? (
            <label className="lc-options__slider">
              <span>Render Distance: {renderDistance} chunks</span>
              <input aria-label="Render distance" aria-valuetext={`${renderDistance} chunks`} max={RENDER_DISTANCE_MAX} min={RENDER_DISTANCE_MIN} onInput={(event) => onRenderDistanceChange(Number(event.currentTarget.value))} step="1" type="range" value={renderDistance} />
            </label>
          ) : null}
          </> : null}
          {panel === "sound" ? <>
            <button aria-pressed={soundMuted} onClick={onToggleSound} type="button">Sound: {soundMuted ? "OFF" : "ON"}</button>
            {([
              ["masterVolume", "Master Volume", masterVolume], ["musicVolume", "Music", musicVolume], ["blocksVolume", "Blocks", blocksVolume],
              ["hostileVolume", "Hostile Creatures", hostileVolume], ["passiveVolume", "Friendly Creatures", passiveVolume],
              ["playersVolume", "Players", playersVolume], ["uiVolume", "UI", uiVolume],
            ] as const).map(([category, label, value]) => <label className="lc-options__slider" key={category}>
              <span>{label}: {value === 0 ? "OFF" : `${value}%`}</span>
              <input aria-label={label} max="100" min="0" onInput={(event) => onVolumeChange(category, Number(event.currentTarget.value))} step="1" type="range" value={value} />
            </label>)}
          </> : null}
          {panel === "controls" ? <>
            <h3>Key Binds</h3>
            <div className="lc-options__controls">
              {GAMEPLAY_CONTROL_ACTIONS.map((action) => {
                const conflict = gameplayControlConflicts(keyBindings).has(action);
                return <label className="lc-options__control" key={action}>
                  <span>{GAMEPLAY_CONTROL_LABELS[action]}</span>
                  <button className={`${captureAction === action ? "is-capturing" : ""}${conflict ? " is-conflict" : ""}`} onClick={() => setCaptureAction(action)} type="button">
                    {captureAction === action ? "> Press a key <" : gameplayControlCodeLabel(keyBindings[action])}
                  </button>
                </label>;
              })}
            </div>
            <button onClick={() => onKeyBindingsChange({ ...DEFAULT_GAMEPLAY_CONTROL_BINDINGS })} type="button">Reset Keys</button>
            <small className="lc-options__note">{GAMEPLAY_CONTROL_RESERVED_INPUT_NOTE}</small>
          </> : null}
          <button autoFocus className="lc-options__done" onClick={close} type="button">Done</button>
        </div>
      </section>
    </div>
  );
}
