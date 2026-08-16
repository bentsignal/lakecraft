import { useEffect, useRef, useState } from "preact/hooks";
import { ITEMS, type ItemId } from "../../shared/game.ts";
import {
  FIRST_PERSON_TUNING,
  currentFirstPersonTuning,
  publishFirstPersonTuning,
  type FirstPersonTuning,
  type FirstPersonVector,
} from "../game/firstPersonTuning.ts";
import { poseLabScrubValue } from "./poseLabScrub.ts";
import {
  THIRD_PERSON_TUNING,
  currentThirdPersonTuning,
  publishThirdPersonTuning,
  thirdPersonPoseGroupForItem,
  type ThirdPersonTuning,
} from "../game/thirdPersonTuning.ts";
import type { PlayerCameraMode } from "../game/playerCamera.ts";

type PoseGroup = "block" | "tool" | "bow" | "arm" | "otherItem" | "torch";
type TransformVectorField = "position" | "rotationDegrees" | "pivot";
type PosePerspective = "first_person" | "third_person";

const GROUP_LABELS: Readonly<Record<PoseGroup, string>> = {
  block: "Full block",
  tool: "Tool",
  bow: "Bow",
  arm: "Arm / empty hand",
  otherItem: "Other item",
  torch: "Torch",
};

const PREVIEW_ITEMS = Object.freeze([
  "diamond_pickaxe",
  "diamond_axe",
  "diamond_shovel",
  "diamond_sword",
  "planks",
  "bow",
  "cooked_chicken",
  "iron_ingot",
  "chest",
  "torch",
] as const satisfies readonly ItemId[]);

function poseGroupForItem(itemId: ItemId | null, perspective: PosePerspective): PoseGroup {
  if (itemId === null) return "arm";
  if (perspective === "third_person") return thirdPersonPoseGroupForItem(itemId);
  if (itemId === "bow") return "bow";
  if (ITEMS[itemId].tool) return "tool";
  if (ITEMS[itemId].category === "block" && itemId !== "torch") return "block";
  return "otherItem";
}

const POSE_LAB_CSS = `
.lc-pose-lab{--lab-ink:#e8e2d1;--lab-dim:#a9a18d;--lab-edge:#15130f;--lab-panel:#26231d;--lab-well:#11100d;background:linear-gradient(135deg,#343026,#211f1a);border:2px solid var(--lab-edge);box-shadow:inset 1px 1px #706956,inset -1px -1px #090806,4px 5px 0 rgba(0,0,0,.42);color:var(--lab-ink);font:11px/1.15 var(--lc-pixel-font,"Courier New",monospace);left:12px;max-height:calc(100dvh - 62px);overflow:auto;padding:9px;position:fixed;top:42px;width:min(332px,calc(100vw - 24px));z-index:90}
.lc-pose-lab *{box-sizing:border-box}.lc-pose-lab__head{align-items:center;display:flex;justify-content:space-between;margin-bottom:8px}.lc-pose-lab__head strong{font-size:14px;font-weight:400;letter-spacing:.07em}.lc-pose-lab__live{color:#8dff7a;font-size:9px}.lc-pose-lab label{display:grid;gap:4px}.lc-pose-lab select,.lc-pose-lab input,.lc-pose-lab button{background:var(--lab-well);border:1px solid #0a0907;box-shadow:inset 1px 1px #050504,inset -1px -1px #575143;color:var(--lab-ink);font:11px var(--lc-pixel-font,"Courier New",monospace)}.lc-pose-lab select{height:28px;padding:4px 6px;width:100%}.lc-pose-lab__row{margin-top:8px}.lc-pose-lab__row>span{color:var(--lab-dim);font-size:9px;letter-spacing:.05em;text-transform:uppercase}.lc-pose-lab__triplet{display:grid;gap:5px;grid-template-columns:repeat(3,minmax(0,1fr))}.lc-pose-lab__scrub{display:block;position:relative}.lc-pose-lab__scrub b{color:#817966;font-size:8px;font-weight:400;left:5px;pointer-events:none;position:absolute;top:8px;z-index:1}.lc-pose-lab__scrub em{color:#7f9271;font-size:11px;font-style:normal;pointer-events:none;position:absolute;right:5px;top:7px;z-index:1}.lc-pose-lab input{appearance:textfield;cursor:ns-resize;height:27px;min-width:0;padding:4px 17px 4px 16px;touch-action:none;user-select:none;width:100%}.lc-pose-lab input::-webkit-inner-spin-button,.lc-pose-lab input::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}.lc-pose-lab input[data-scrubbing="true"]{background:#252d1e;border-color:#9fbd82;cursor:ns-resize;outline:1px solid #d9ffc0}.lc-pose-lab input:focus,.lc-pose-lab select:focus,.lc-pose-lab button:focus-visible{border-color:#fff;outline:1px solid #fff}.lc-pose-lab__single{grid-template-columns:1fr}.lc-pose-lab__single input{padding-left:7px}.lc-pose-lab__socket-note{background:#1c281b;border:1px solid #43583d;color:#b9d5af;font-size:9px;line-height:1.35;margin-top:8px;padding:7px}.lc-pose-lab__preview{background:rgba(0,0,0,.2);border:1px solid #15130f;margin:8px 0;padding:6px}.lc-pose-lab__preview>span{color:var(--lab-dim);font-size:9px;letter-spacing:.05em;text-transform:uppercase}.lc-pose-lab__bow-preview{background:rgba(0,0,0,.2);border:1px solid #15130f;margin-top:8px;padding:6px}.lc-pose-lab__bow-preview>span{color:var(--lab-dim);display:block;font-size:9px;letter-spacing:.05em;margin-bottom:5px;text-transform:uppercase}.lc-pose-lab__bow-preview-controls{display:grid;gap:5px;grid-template-columns:1fr 1fr}.lc-pose-lab__bow-preview button[aria-pressed="true"]{background:#4a593c;border-color:#a5c88c;box-shadow:inset 1px 1px #788e67,inset -1px -1px #182013;color:#efffe5}.lc-pose-lab__bow-preview small{color:#928b79;display:block;font-size:8px;line-height:1.3;margin-top:5px}.lc-pose-lab__actions{display:grid;gap:6px;grid-template-columns:1fr 1fr;margin-top:9px}.lc-pose-lab button{cursor:pointer;min-height:28px;padding:5px}.lc-pose-lab button:hover{background:#474032}.lc-pose-lab__readout{background:rgba(0,0,0,.24);color:#c8c0aa;display:block;font-size:8px;line-height:1.35;margin-top:8px;overflow-wrap:anywhere;padding:6px}.lc-pose-lab__hint{color:var(--lab-dim);display:block;font-size:8px;line-height:1.35;margin-top:7px}@media(max-width:720px){.lc-pose-lab{max-height:42dvh;top:auto;bottom:10px}}
`;

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function vectorWithValue(vector: FirstPersonVector, index: number, value: number): FirstPersonVector {
  const next: [number, number, number] = [vector[0], vector[1], vector[2]];
  next[index] = finite(value, vector[index]);
  return next;
}

function ScrubNumberInput({
  axis,
  label,
  min,
  step,
  value,
  onChange,
}: {
  axis?: string;
  label: string;
  min?: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
}) {
  const drag = useRef<{ pointerId: number; startY: number; startValue: number; moved: boolean } | null>(null);
  const [scrubbing, setScrubbing] = useState(false);

  return (
    <label className="lc-pose-lab__scrub" title="Drag up or down to adjust. Click to type.">
      {axis ? <b>{axis}</b> : null}
      <input
        aria-label={label}
        data-scrubbing={scrubbing ? "true" : "false"}
        min={min}
        onDblClick={(event) => event.currentTarget.select()}
        onInput={(event) => onChange(Number(event.currentTarget.value))}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          drag.current = {
            pointerId: event.pointerId,
            startY: event.clientY,
            startValue: value,
            moved: false,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const current = drag.current;
          if (!current || current.pointerId !== event.pointerId) return;
          const deltaY = current.startY - event.clientY;
          if (!current.moved && Math.abs(deltaY) < 2) return;
          current.moved = true;
          setScrubbing(true);
          onChange(poseLabScrubValue(current.startValue, deltaY, step, min));
        }}
        onPointerUp={(event) => {
          if (drag.current?.pointerId !== event.pointerId) return;
          drag.current = null;
          setScrubbing(false);
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          drag.current = null;
          setScrubbing(false);
        }}
        step={step}
        type="number"
        value={value}
      />
      <em aria-hidden="true">↑↓</em>
    </label>
  );
}

function VectorInputs({
  label,
  step,
  value,
  onChange,
}: {
  label: string;
  step: number;
  value: FirstPersonVector;
  onChange: (index: number, value: number) => void;
}) {
  return (
    <div className="lc-pose-lab__row">
      <span>{label}</span>
      <div className="lc-pose-lab__triplet">
        {(["X", "Y", "Z"] as const).map((axis, index) => (
          <ScrubNumberInput
            axis={axis}
            key={axis}
            label={`${label} ${axis}`}
            onChange={(next) => onChange(index, next)}
            step={step}
            value={value[index]}
          />
        ))}
      </div>
    </div>
  );
}

export function FirstPersonPoseLab({
  open,
  onBowPreviewChange,
  onCameraModeChange,
  onCycleCamera,
  onHeldItemPreviewChange,
  onOpenVisualLab,
  onRigPreviewChange,
  onUsePreviewChange,
}: {
  open: boolean;
  onBowPreviewChange?: (drawn: boolean | null) => void;
  onCameraModeChange?: (mode: PlayerCameraMode) => void;
  onCycleCamera?: () => string;
  onHeldItemPreviewChange?: (itemId: ItemId | null | undefined) => void;
  onOpenVisualLab?: () => void;
  onRigPreviewChange?: (kind: "live" | "idle" | "walk" | "crouch" | "crouch_profile" | "walk_profile" | "look_up" | "look_down" | "swing" | "look_left" | "look_right") => void;
  onUsePreviewChange?: (active: boolean) => void;
}) {
  const [group, setGroup] = useState<PoseGroup>("tool");
  const [tuning, setTuning] = useState<FirstPersonTuning>(() => currentFirstPersonTuning().tuning);
  const [thirdPersonTuning, setThirdPersonTuning] = useState<ThirdPersonTuning>(() => currentThirdPersonTuning().tuning);
  const [perspective, setPerspective] = useState<PosePerspective>("first_person");
  const [copied, setCopied] = useState(false);
  const [bowDrawn, setBowDrawn] = useState(false);
  const [cameraMode, setCameraMode] = useState("first person");
  const [previewItem, setPreviewItem] = useState("actual");
  const [usePreview, setUsePreview] = useState(false);
  const [rigPreview, setRigPreview] = useState<"live" | "idle" | "walk" | "crouch" | "crouch_profile" | "walk_profile" | "look_up" | "look_down" | "swing" | "look_left" | "look_right">("live");

  useEffect(() => {
    if (open) return;
    setPreviewItem("actual");
    onHeldItemPreviewChange?.(undefined);
  }, [onHeldItemPreviewChange, open]);

  useEffect(() => {
    const active = open && perspective === "first_person" && group === "otherItem" && usePreview;
    onUsePreviewChange?.(active);
    return () => onUsePreviewChange?.(false);
  }, [group, onUsePreviewChange, open, perspective, usePreview]);

  useEffect(() => {
    if (!open || perspective !== "first_person" || group !== "bow") {
      onBowPreviewChange?.(null);
      return;
    }
    onBowPreviewChange?.(bowDrawn);
    return () => onBowPreviewChange?.(null);
  }, [bowDrawn, group, onBowPreviewChange, open, perspective]);

  useEffect(() => {
    const next = open && perspective === "third_person" ? rigPreview : "live";
    onRigPreviewChange?.(next);
    return () => onRigPreviewChange?.("live");
  }, [onRigPreviewChange, open, perspective, rigPreview]);

  if (!open) return null;

  function commit(next: FirstPersonTuning): void {
    publishFirstPersonTuning(next);
    setTuning(next);
    setCopied(false);
  }

  function commitThirdPerson(next: ThirdPersonTuning): void {
    publishThirdPersonTuning(next);
    setThirdPersonTuning(next);
    setCopied(false);
  }

  function updateTransformVector(field: TransformVectorField, index: number, value: number): void {
    if (group === "block" || group === "torch") return;
    const current = tuning[group];
    commit({
      ...tuning,
      [group]: { ...current, [field]: vectorWithValue(current[field], index, value) },
    });
  }

  function updateTransformScale(value: number): void {
    if (group === "block" || group === "torch") return;
    const current = tuning[group];
    commit({ ...tuning, [group]: { ...current, scale: Math.max(0.05, finite(value, current.scale)) } });
  }

  function updateBlockVector(field: "center" | "rotationDegrees", index: number, value: number): void {
    const current = tuning.block;
    commit({
      ...tuning,
      block: { ...current, [field]: vectorWithValue(current[field], index, value) },
    });
  }

  function updateBlockSize(value: number): void {
    commit({ ...tuning, block: { ...tuning.block, size: Math.max(0.05, finite(value, tuning.block.size)) } });
  }

  function updateThirdPersonVector(field: "position" | "rotationDegrees", index: number, value: number): void {
    if (group === "arm") return;
    const current = thirdPersonTuning[group];
    commitThirdPerson({
      ...thirdPersonTuning,
      [group]: { ...current, [field]: vectorWithValue(current[field], index, value) },
    });
  }

  function updateThirdPersonScale(value: number): void {
    if (group === "arm") return;
    const current = thirdPersonTuning[group];
    commitThirdPerson({
      ...thirdPersonTuning,
      [group]: { ...current, scale: Math.max(0.05, finite(value, current.scale)) },
    });
  }

  function resetGroup(): void {
    if (perspective === "third_person") {
      if (group !== "arm") commitThirdPerson({ ...thirdPersonTuning, [group]: THIRD_PERSON_TUNING[group] });
      return;
    }
    if (group === "torch") {
      commit({ ...tuning, otherItem: FIRST_PERSON_TUNING.otherItem });
      return;
    }
    commit({ ...tuning, [group]: FIRST_PERSON_TUNING[group] });
  }

  const active = group === "torch" ? tuning.otherItem : tuning[group];
  const thirdPersonActive = group === "arm" ? null : thirdPersonTuning[group];
  const readout = perspective === "third_person"
    ? thirdPersonActive
      ? `third person · ${group} · position delta [${thirdPersonActive.position.join(", ")}] · rotation delta [${thirdPersonActive.rotationDegrees.join(", ")}] · scale ${thirdPersonActive.scale}`
      : "third person · empty hand · articulated player rig"
    : group === "block"
    ? `item only · anchor offset [${active.center.join(", ")}] · Minecraft rotation [${active.rotationDegrees.join(", ")}] · size ${active.size}`
    : group === "arm"
      ? `empty slot only · anchor offset [${active.position.join(", ")}] · rotation delta [${active.rotationDegrees.join(", ")}] · scale ${active.scale}`
      : `item only · anchor offset [${active.position.join(", ")}] · rotation delta [${active.rotationDegrees.join(", ")}] · scale ${active.scale}`;

  async function copyValues(): Promise<void> {
    try {
      await navigator.clipboard.writeText(readout);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <aside aria-label="Pose lab" className="lc-pose-lab">
      <style>{POSE_LAB_CSS}</style>
      <header className="lc-pose-lab__head"><strong>POSE LAB</strong><span className="lc-pose-lab__live">● LIVE</span></header>
      <div className="lc-pose-lab__bow-preview">
        <span>Editing perspective</span>
        <div aria-label="Pose editing perspective" className="lc-pose-lab__bow-preview-controls" role="group">
          <button aria-pressed={perspective === "first_person"} onClick={() => {
            setPerspective("first_person");
            if (previewItem !== "actual") {
              setGroup(poseGroupForItem(previewItem === "empty" ? null : previewItem as ItemId, "first_person"));
            } else if (group === "torch") setGroup("otherItem");
            setCameraMode("first person");
            onCameraModeChange?.("first_person");
          }} type="button">First person</button>
          <button aria-pressed={perspective === "third_person"} onClick={() => {
            setPerspective("third_person");
            if (previewItem !== "actual") {
              setGroup(poseGroupForItem(previewItem === "empty" ? null : previewItem as ItemId, "third_person"));
            }
            setCameraMode("third person back");
            onCameraModeChange?.("third_person_back");
          }} type="button">Third person</button>
        </div>
      </div>
      <div className="lc-pose-lab__socket-note">{perspective === "first_person"
        ? "EXCLUSIVE VIEWMODEL · An empty slot shows the arm. Any selected item replaces it."
        : "ARTICULATED PLAYER RIG · Item edits are local offsets on the right-hand socket. Camera look drives the head while the body follows naturally."}</div>
      <label className="lc-pose-lab__preview">
        <span>Preview item</span>
        <select
          aria-label="Preview held item"
          onChange={(event) => {
            const value = event.currentTarget.value;
            setPreviewItem(value);
            const itemId = value === "actual" ? undefined : value === "empty" ? null : value as ItemId;
            onHeldItemPreviewChange?.(itemId);
            if (itemId !== undefined) setGroup(poseGroupForItem(itemId, perspective));
          }}
          value={previewItem}
        >
          <option value="actual">Actual hotbar selection</option>
          <option value="empty">Empty hand</option>
          {PREVIEW_ITEMS.map((itemId) => <option key={itemId} value={itemId}>{ITEMS[itemId].label}</option>)}
        </select>
      </label>
      <label>
        <span>What are you holding?</span>
        <select onChange={(event) => setGroup(event.currentTarget.value as PoseGroup)} value={group}>
          {(Object.keys(GROUP_LABELS) as PoseGroup[]).filter((value) => perspective === "third_person" || value !== "torch").map((value) => (
            <option key={value} value={value}>{GROUP_LABELS[value]}</option>
          ))}
        </select>
      </label>
      {perspective === "first_person" && group === "bow" ? (
        <div className="lc-pose-lab__bow-preview">
          <span>Bow preview</span>
          <div aria-label="Bow draw preview" className="lc-pose-lab__bow-preview-controls" role="group">
            <button aria-pressed={!bowDrawn} onClick={() => setBowDrawn(false)} type="button">Idle</button>
            <button aria-pressed={bowDrawn} onClick={() => setBowDrawn(true)} type="button">Full draw</button>
          </div>
          <small>Hold a bow, then switch poses here. This never fires or consumes an arrow.</small>
        </div>
      ) : null}
      {perspective === "first_person" && group === "otherItem" ? (
        <div className="lc-pose-lab__bow-preview">
          <span>Use preview</span>
          <div aria-label="Item use preview" className="lc-pose-lab__bow-preview-controls" role="group">
            <button aria-pressed={!usePreview} onClick={() => setUsePreview(false)} type="button">Idle</button>
            <button aria-pressed={usePreview} onClick={() => setUsePreview(true)} type="button">Mid-use</button>
          </div>
          <small>With food selected, Mid-use freezes the eating pose for reference comparison.</small>
        </div>
      ) : null}
      {perspective === "third_person" ? (
        <div className="lc-pose-lab__bow-preview">
          <span>Rig pose preview</span>
          <div aria-label="Third-person rig preview" className="lc-pose-lab__bow-preview-controls" role="group">
            {(["live", "idle", "walk", "crouch", "crouch_profile", "walk_profile", "look_up", "look_down", "look_left", "look_right", "swing"] as const).map((value) => (
              <button aria-pressed={rigPreview === value} key={value} onClick={() => setRigPreview(value)} type="button">
                {value.replace("_", " ")}
              </button>
            ))}
          </div>
          <small>Freeze a repeatable rig state for screenshot comparison. Live restores gameplay motion.</small>
        </div>
      ) : null}
      {perspective === "third_person" ? group === "arm" ? (
        <div className="lc-pose-lab__socket-note">The empty-hand pose follows the articulated right arm. Select an item family to tune its hand-socket transform.</div>
      ) : thirdPersonActive ? (
        <>
          <VectorInputs label="Hand socket offset" onChange={(index, value) => updateThirdPersonVector("position", index, value)} step={0.01} value={thirdPersonActive.position} />
          <VectorInputs label="Rotation delta" onChange={(index, value) => updateThirdPersonVector("rotationDegrees", index, value)} step={1} value={thirdPersonActive.rotationDegrees} />
          <div className="lc-pose-lab__row lc-pose-lab__single"><span>Scale</span><ScrubNumberInput label="Third-person scale" min={0.05} onChange={updateThirdPersonScale} step={0.01} value={thirdPersonActive.scale} /></div>
        </>
      ) : null : group === "block" ? (
        <>
          <VectorInputs label="Screen anchor offset" onChange={(index, value) => updateBlockVector("center", index, value)} step={0.01} value={active.center} />
          <VectorInputs label="Rotation degrees" onChange={(index, value) => updateBlockVector("rotationDegrees", index, value)} step={1} value={active.rotationDegrees} />
          <div className="lc-pose-lab__row lc-pose-lab__single"><span>Size</span><ScrubNumberInput label="Size" min={0.05} onChange={updateBlockSize} step={0.01} value={active.size} /></div>
        </>
      ) : group === "arm" ? (
        <>
          <div className="lc-pose-lab__socket-note">Select an empty hotbar slot to see these live arm adjustments.</div>
          <VectorInputs label="Screen anchor offset" onChange={(index, value) => updateTransformVector("position", index, value)} step={0.01} value={active.position} />
          <VectorInputs label="Rotation degrees" onChange={(index, value) => updateTransformVector("rotationDegrees", index, value)} step={1} value={active.rotationDegrees} />
          <div className="lc-pose-lab__row lc-pose-lab__single"><span>Scale</span><ScrubNumberInput label="Scale" min={0.05} onChange={updateTransformScale} step={0.01} value={active.scale} /></div>
        </>
      ) : (
        <>
          <VectorInputs label="Screen anchor offset" onChange={(index, value) => updateTransformVector("position", index, value)} step={0.01} value={active.position} />
          <VectorInputs label="Rotation degrees" onChange={(index, value) => updateTransformVector("rotationDegrees", index, value)} step={1} value={active.rotationDegrees} />
          <div className="lc-pose-lab__row lc-pose-lab__single"><span>Scale</span><ScrubNumberInput label="Scale" min={0.05} onChange={updateTransformScale} step={0.01} value={active.scale} /></div>
        </>
      )}
      <div className="lc-pose-lab__actions">
        <button onClick={resetGroup} type="button">Reset this group</button>
        <button onClick={() => void copyValues()} type="button">{copied ? "Copied" : "Copy values"}</button>
      </div>
      {onOpenVisualLab ? <button onClick={onOpenVisualLab} style={{ marginTop: "6px", width: "100%" }} type="button">Open full Visual Lab</button> : null}
      {onCycleCamera ? <button onClick={() => setCameraMode(onCycleCamera().replaceAll("_", " "))} style={{ marginTop: "6px", width: "100%" }} type="button">Cycle camera (F) · {cameraMode}</button> : null}
      <output className="lc-pose-lab__readout">{readout}</output>
      <small className="lc-pose-lab__hint">Drag rotation or scale up/down to scrub. The paused preview updates immediately.</small>
    </aside>
  );
}
