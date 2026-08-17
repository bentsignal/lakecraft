import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { ITEMS, type ItemId } from "../../shared/game.ts";
import { itemVisual, itemVisualIds } from "../../shared/visualCatalog.ts";
import {
  createVisualLabRenderer,
  type VisualLabLighting,
  type VisualLabMobState,
  type VisualLabRenderer,
  type VisualLabSilhouette,
  type VisualLabViewmodelStrategy,
} from "../game/visualLabRenderer.ts";
import {
  clearPersistedPlayerSkin,
  loadPersistedPlayerSkin,
  readPlayerSkinFile,
  savePersistedPlayerSkin,
  type PlayerSkinModel,
  type PlayerSkinStorageAdapter,
} from "../game/playerSkin.ts";
import type { MobKind } from "../game/mobs.ts";
import type { PlayerArmorMaterial } from "../game/playerArmorGeometry.ts";
import type { PlayerRigMotion } from "../game/playerRig.ts";
import { createProductionContactSheetExport } from "../game/contactSheetExport.ts";
import { itemIconFingerprint } from "../game/visualAssetFingerprint.ts";
import { ItemIcon } from "./ItemGlyph.tsx";

type VisualLabProps = {
  open: boolean;
  onClose: () => void;
  onApplySkin?: (source: TexImageSource | null, model: PlayerSkinModel) => void;
  skinStorage?: PlayerSkinStorageAdapter;
};

type CatalogFilter = "all" | "block" | "tool" | "material" | "armor" | "food";
type VisualLabMode = "catalog" | "sheet" | "viewmodel" | "dropped" | "player" | "mobs";
type VisualLabBackground = "workbench" | "checker" | "light" | "dark";
type ReferenceBlend = "ghost" | "difference";

const FILTERS: readonly CatalogFilter[] = ["all", "block", "tool", "material", "armor", "food"];
const MOB_KINDS: readonly MobKind[] = ["pig", "cow", "sheep", "chicken", "zombie", "skeleton", "creeper", "spider"];
const MOB_STATES: readonly VisualLabMobState[] = ["idle", "walk", "hurt", "fallen", "special"];
const LIGHTING_PRESETS: readonly VisualLabLighting[] = ["day", "night", "torch", "unlit"];
const BACKGROUNDS: readonly VisualLabBackground[] = ["workbench", "checker", "light", "dark"];
const ARMOR_MATERIALS: readonly PlayerArmorMaterial[] = ["leather", "iron", "golden", "diamond"];
const VIEWMODEL_STRATEGIES: readonly Readonly<{
  id: VisualLabViewmodelStrategy;
  label: string;
  note: string;
}>[] = [
  { id: "production", label: "Current", note: "The current in-game renderer and arm, preserved as the control." },
  { id: "transform", label: "Model transform", note: "Item-only composition based on a conventional handheld transform." },
  { id: "grip", label: "Skin grip", note: "A smaller screen-fit sprite paired with the standard-skin arm." },
];

const VISUAL_LAB_CSS = `
.lc-visual-lab{--vl-ink:#e8e4d8;--vl-dim:#96988f;--vl-line:#3c4039;--vl-panel:#181b18;--vl-work:#232720;align-items:stretch;background:#0d100edb;box-sizing:border-box;color:var(--vl-ink);display:grid;font-family:var(--lc-pixel-font,"Courier New",monospace);inset:0;padding:18px;position:fixed;z-index:110}
.lc-visual-lab *{box-sizing:border-box;text-shadow:none}.lc-visual-lab__shell{background:#111411;border:2px solid #050605;box-shadow:0 24px 80px #000b,inset 0 0 0 1px #454a41;display:grid;grid-template-rows:auto minmax(0,1fr);height:100%;min-height:0;overflow:hidden}
.lc-visual-lab__head{align-items:center;background:#20251f;border-bottom:1px solid var(--vl-line);display:flex;gap:18px;justify-content:space-between;padding:12px 16px}.lc-visual-lab__title{align-items:baseline;display:flex;gap:13px}.lc-visual-lab__title strong{font-size:16px;letter-spacing:.08em}.lc-visual-lab__title small{color:#8ea77b;font-size:9px;letter-spacing:.1em}.lc-visual-lab__close{background:#33382f;border:1px solid #5b6254;color:#fff;cursor:pointer;font:11px/1 var(--lc-pixel-font);padding:9px 12px}.lc-visual-lab__close:hover,.lc-visual-lab__close:focus-visible{background:#555f49;outline:2px solid #fff;outline-offset:2px}
.lc-visual-lab__mode{display:flex;gap:4px;margin-left:auto}.lc-visual-lab__mode button{background:#151815;border:1px solid #4c5348;color:#aeb2a8;cursor:pointer;font:9px/1 var(--lc-pixel-font);padding:8px 10px;text-transform:uppercase}.lc-visual-lab__mode button[aria-pressed="true"]{background:#697759;border-color:#c0d2aa;color:#fff}
.lc-visual-lab__body{display:grid;grid-template-columns:292px minmax(0,1fr) 290px;min-height:0}.lc-visual-lab__catalog{background:#171a17;border-right:1px solid var(--vl-line);display:grid;grid-template-rows:auto auto minmax(0,1fr);min-height:0;padding:13px}.lc-visual-lab__catalog label{color:var(--vl-dim);display:grid;font-size:9px;gap:6px;letter-spacing:.08em}.lc-visual-lab__search{background:#090b09;border:1px solid #545a50;color:#fff;font:12px/1.2 var(--lc-pixel-font);outline:0;padding:9px}.lc-visual-lab__search:focus{border-color:#b8c7a5;box-shadow:0 0 0 2px #71805e}
.lc-visual-lab__filters{display:flex;flex-wrap:wrap;gap:4px;padding:10px 0}.lc-visual-lab__filters button,.lc-visual-lab__views button{background:#292e28;border:1px solid #4c5348;color:#c8cbc3;cursor:pointer;font:9px/1 var(--lc-pixel-font);padding:7px 8px;text-transform:uppercase}.lc-visual-lab__filters button[aria-pressed="true"],.lc-visual-lab__views button[aria-pressed="true"]{background:#697759;border-color:#b2c49c;color:#fff}.lc-visual-lab__filters button:focus-visible,.lc-visual-lab__views button:focus-visible{outline:2px solid #fff;outline-offset:1px}
.lc-visual-lab__list{align-content:start;display:grid;gap:3px;grid-template-columns:repeat(4,minmax(0,1fr));list-style:none;margin:0;min-height:0;overflow:auto;padding:2px 3px 16px 0}.lc-visual-lab__item{aspect-ratio:1;background:#222620;border:1px solid #454b42;cursor:pointer;display:grid;padding:4px;place-items:center;position:relative;width:100%}.lc-visual-lab__item:hover{background:#30362d}.lc-visual-lab__item[aria-pressed="true"]{background:#4e5943;border-color:#d6e8bc;box-shadow:inset 0 0 0 1px #9bae82}.lc-visual-lab__item:focus-visible{outline:2px solid #fff;outline-offset:1px}.lc-visual-lab__item .lc-item-glyph{height:100%;min-height:0;width:100%}.lc-visual-lab__item .lc-item-icon__svg{height:100%;width:100%}
.lc-visual-lab__stage{background:#0d100e;display:grid;grid-template-rows:minmax(0,1fr) auto;min-width:0;overflow:hidden;position:relative}.lc-visual-lab__stage::before{content:"";inset:0;pointer-events:none;position:absolute}.lc-visual-lab__stage[data-background="workbench"]{background:radial-gradient(circle at 50% 43%,#30362d 0 20%,#191d19 56%,#0d100e 100%)}.lc-visual-lab__stage[data-background="workbench"]::before{background-image:linear-gradient(#ffffff08 1px,transparent 1px),linear-gradient(90deg,#ffffff08 1px,transparent 1px);background-size:32px 32px}.lc-visual-lab__stage[data-background="checker"]{background-color:#666}.lc-visual-lab__stage[data-background="checker"]::before{background-image:linear-gradient(45deg,#8a8a8a 25%,transparent 25%),linear-gradient(-45deg,#8a8a8a 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#8a8a8a 75%),linear-gradient(-45deg,transparent 75%,#8a8a8a 75%);background-position:0 0,0 16px,16px -16px,-16px 0;background-size:32px 32px}.lc-visual-lab__stage[data-background="light"]{background:#d9dbd4}.lc-visual-lab__stage[data-background="dark"]{background:#030403}.lc-visual-lab__canvas-wrap{cursor:grab;min-height:280px;position:relative}.lc-visual-lab__canvas-wrap:active{cursor:grabbing}.lc-visual-lab__canvas{display:block;height:100%;image-rendering:pixelated;inset:0;position:absolute;width:100%}.lc-visual-lab__stage-label{left:16px;pointer-events:none;position:absolute;top:14px}.lc-visual-lab__stage-label strong{display:block;font-size:15px}.lc-visual-lab__stage-label small{color:var(--vl-dim);display:block;font-size:9px;margin-top:5px}.lc-visual-lab__axis{bottom:15px;color:#9ba092;font:9px/1 var(--lc-pixel-font);position:absolute;right:16px}.lc-visual-lab__states{display:flex;gap:4px;position:absolute;right:14px;top:14px}.lc-visual-lab__states button{background:#242924;border:1px solid #4c5348;color:#c8cbc3;cursor:pointer;font:8px/1 var(--lc-pixel-font);padding:6px}.lc-visual-lab__states button[aria-pressed="true"]{background:#697759;border-color:#b2c49c;color:#fff}
.lc-visual-lab__environment{background:#111511e8;border:1px solid #4b5148;bottom:36px;display:grid;gap:6px;padding:7px;position:absolute;right:14px}.lc-visual-lab__environment-row{align-items:center;display:flex;gap:4px}.lc-visual-lab__environment-row>span{color:#8f9689;font-size:7px;letter-spacing:.08em;margin-right:3px;text-transform:uppercase;width:58px}.lc-visual-lab__environment button{background:#242924;border:1px solid #4c5348;color:#c8cbc3;cursor:pointer;font:7px/1 var(--lc-pixel-font);padding:5px 6px;text-transform:uppercase}.lc-visual-lab__environment button[aria-pressed="true"]{background:#697759;border-color:#c0d2aa;color:#fff}.lc-visual-lab__environment button:focus-visible{outline:2px solid #fff;outline-offset:1px}
.lc-visual-lab__reference{height:100%;inset:0;object-fit:contain;pointer-events:none;position:absolute;width:100%;z-index:1}.lc-visual-lab__stage-label,.lc-visual-lab__axis,.lc-visual-lab__states,.lc-visual-lab__environment{z-index:2}
.lc-visual-lab__canvas-wrap[data-mode="sheet"]{cursor:default}.lc-visual-lab__canvas-wrap[data-mode="sheet"] .lc-visual-lab__canvas{visibility:hidden}.lc-visual-lab__sheet{align-content:start;background:#111511;display:grid;gap:8px;grid-template-columns:repeat(auto-fill,minmax(88px,1fr));inset:0;overflow:auto;padding:54px 18px 24px;position:absolute}.lc-visual-lab__sheet-item{align-items:center;background:#171b17;border:1px solid #4b5148;color:#d9ddd3;cursor:pointer;display:grid;font:8px/1.35 var(--lc-pixel-font);gap:5px;justify-items:center;min-height:104px;padding:8px;text-align:center}.lc-visual-lab__sheet-item:hover{background:#292f28;border-color:#89977c}.lc-visual-lab__sheet-item:focus-visible{outline:2px solid #fff;outline-offset:1px}.lc-visual-lab__sheet-item .lc-item-glyph{height:58px;min-height:0;width:58px}.lc-visual-lab__sheet-item .lc-item-icon__svg{height:58px;width:58px}
.lc-visual-lab__views{align-items:center;background:#151815d9;border-top:1px solid var(--vl-line);display:flex;flex-wrap:wrap;gap:5px;padding:10px 13px;position:relative}.lc-visual-lab__views>small{color:var(--vl-dim);font-size:8px;margin-left:auto}
.lc-visual-lab__strategy-label{color:var(--vl-dim);font-size:8px;margin-right:3px}.lc-visual-lab__reference-controls{align-items:center;display:grid;gap:7px}.lc-visual-lab__reference-file{background:#293027;border:1px solid #5b6654;color:#fff;cursor:pointer;font:inherit;padding:9px;text-align:center}.lc-visual-lab__reference-file input{height:1px;opacity:0;position:absolute;width:1px}.lc-visual-lab__reference-opacity{align-items:center;display:grid;font-size:8px;gap:5px;grid-template-columns:1fr auto}.lc-visual-lab__reference-opacity span{color:var(--vl-dim);grid-column:1/-1}.lc-visual-lab__reference-opacity input{accent-color:#91a77d;width:100%}.lc-visual-lab__reference-clear{background:#272c26;border:1px solid #4c5348;color:#c8cbc3;cursor:pointer;font:inherit;padding:8px}
.lc-visual-lab__inspector{background:#171a17;border-left:1px solid var(--vl-line);min-height:0;overflow:auto;padding:15px}.lc-visual-lab__icon-preview{align-items:center;background:#0b0d0b;border:1px solid #454b42;display:grid;grid-template-columns:84px minmax(0,1fr);margin-bottom:17px;min-height:94px;padding:10px}.lc-visual-lab__icon-preview .lc-item-glyph{height:70px;min-height:0;width:70px}.lc-visual-lab__icon-preview .lc-item-icon__svg{height:70px;width:70px}.lc-visual-lab__icon-preview strong{font-size:12px}.lc-visual-lab__icon-preview small{color:var(--vl-dim);display:block;font-size:8px;line-height:1.5;margin-top:6px}
.lc-visual-lab__section{border-top:1px solid var(--vl-line);padding:13px 0}.lc-visual-lab__section h3{color:#aab89a;font-size:9px;font-weight:400;letter-spacing:.1em;margin:0 0 9px;text-transform:uppercase}.lc-visual-lab__facts{display:grid;font-size:9px;gap:7px;grid-template-columns:auto minmax(0,1fr);margin:0}.lc-visual-lab__facts dt{color:var(--vl-dim)}.lc-visual-lab__facts dd{margin:0;overflow-wrap:anywhere;text-align:right}.lc-visual-lab__transform{background:#0d0f0d;border:1px solid #343a33;color:#bdc2b6;font:8px/1.6 var(--lc-pixel-font);margin:0;overflow:auto;padding:9px;white-space:pre-wrap}.lc-visual-lab__note{color:#8f948a;font-size:8px;line-height:1.6;margin:0}
.lc-visual-lab__skin-controls{align-content:start;display:grid;gap:16px;padding:4px}.lc-visual-lab__skin-controls h2{font-size:13px;line-height:1.5;margin:0}.lc-visual-lab__skin-controls p{color:var(--vl-dim);font-size:8px;line-height:1.7;margin:0}.lc-visual-lab__skin-import{background:#293027;border:1px solid #5b6654;color:#fff;cursor:pointer;display:block;font:9px/1.4 var(--lc-pixel-font);padding:12px;text-align:center}.lc-visual-lab__skin-import:focus-within{outline:2px solid #fff;outline-offset:2px}.lc-visual-lab__skin-import input{height:1px;opacity:0;position:absolute;width:1px}.lc-visual-lab__model{display:grid;gap:5px;grid-template-columns:1fr 1fr}.lc-visual-lab__model button{background:#272c26;border:1px solid #4c5348;color:#c8cbc3;cursor:pointer;font:9px/1 var(--lc-pixel-font);padding:10px}.lc-visual-lab__model button[aria-pressed="true"]{background:#697759;border-color:#c0d2aa;color:#fff}.lc-visual-lab__skin-select{background:#0d0f0d;border:1px solid #545a50;color:#fff;font:9px/1.4 var(--lc-pixel-font);padding:9px;width:100%}.lc-visual-lab__cycle{align-items:center;display:grid!important;grid-template-columns:minmax(0,1fr) auto}.lc-visual-lab__cycle span{grid-column:1/-1}.lc-visual-lab__cycle input{accent-color:#91a77d;width:100%}.lc-visual-lab__cycle output{color:#dce8d1;font-size:8px}.lc-visual-lab__skin-file{background:#0d0f0d;border:1px solid #343a33;font-size:8px;line-height:1.6;overflow-wrap:anywhere;padding:9px}.lc-visual-lab__skin-error{color:#ff9c92!important}
.lc-visual-lab__skin-apply{background:#647956;border:1px solid #b9d09f;color:#fff;cursor:pointer;font:9px/1.4 var(--lc-pixel-font);padding:12px}.lc-visual-lab__skin-apply:focus-visible{outline:2px solid #fff;outline-offset:2px}
.lc-visual-lab__mob-list{align-content:start;display:grid;gap:5px;grid-template-columns:1fr 1fr;list-style:none;margin:0;padding:4px}.lc-visual-lab__mob-list button{background:#272c26;border:1px solid #4c5348;color:#c8cbc3;cursor:pointer;font:9px/1 var(--lc-pixel-font);padding:13px 7px;text-transform:uppercase;width:100%}.lc-visual-lab__mob-list button[aria-pressed="true"]{background:#697759;border-color:#c0d2aa;color:#fff}.lc-visual-lab__mob-list button:focus-visible{outline:2px solid #fff;outline-offset:1px}
@media(max-width:980px){.lc-visual-lab{padding:8px}.lc-visual-lab__body{grid-template-columns:218px minmax(0,1fr)}.lc-visual-lab__inspector{display:none}.lc-visual-lab__list{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(max-width:650px){.lc-visual-lab__body{grid-template-columns:1fr;grid-template-rows:190px minmax(0,1fr)}.lc-visual-lab__catalog{border-bottom:1px solid var(--vl-line);border-right:0;grid-template-columns:minmax(0,1fr);grid-template-rows:auto auto minmax(0,1fr);padding:8px}.lc-visual-lab__list{grid-template-columns:repeat(8,54px);overflow-x:auto;overflow-y:hidden}.lc-visual-lab__title small{display:none}.lc-visual-lab__canvas-wrap{min-height:220px}}
`;

function displayTransformText(itemId: ItemId): string {
  const transform = itemVisual(itemId).display.firstPersonRight;
  return [
    `rotation    [${transform.rotationDegrees.join(", ")}]`,
    `translation [${transform.translation.join(", ")}]`,
    `scale       [${transform.scale.join(", ")}]`,
  ].join("\n");
}

export function VisualLab({ open, onApplySkin, onClose, skinStorage }: VisualLabProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<VisualLabRenderer | null>(null);
  const dragRef = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null);
  const skinHydratedRef = useRef(false);
  const referenceUrlRef = useRef<string | null>(null);
  const [mode, setMode] = useState<VisualLabMode>("catalog");
  const [selected, setSelected] = useState<ItemId>("diamond_pickaxe");
  const [visualState, setVisualState] = useState(0);
  const [filter, setFilter] = useState<CatalogFilter>("all");
  const [search, setSearch] = useState("");
  const [yaw, setYaw] = useState(-22);
  const [pitch, setPitch] = useState(12);
  const [zoom, setZoom] = useState(1.65);
  const [vertices, setVertices] = useState(0);
  const [drawCalls, setDrawCalls] = useState(0);
  const [skinModel, setSkinModel] = useState<PlayerSkinModel>("wide");
  const [skinImage, setSkinImage] = useState<HTMLImageElement | null>(null);
  const [skinDataUrl, setSkinDataUrl] = useState<string | null>(null);
  const [skinFile, setSkinFile] = useState("Installed standard player skin");
  const [skinError, setSkinError] = useState("");
  const [playerHeldItem, setPlayerHeldItem] = useState<ItemId | null>("diamond_pickaxe");
  const [playerRigMotion, setPlayerRigMotion] = useState<PlayerRigMotion>("idle");
  const [playerRigPhase, setPlayerRigPhase] = useState(0.25);
  const [playerArmor, setPlayerArmor] = useState<PlayerArmorMaterial | null>(null);
  const [selectedMob, setSelectedMob] = useState<MobKind>("zombie");
  const [mobState, setMobState] = useState<VisualLabMobState>("idle");
  const [lighting, setLighting] = useState<VisualLabLighting>("day");
  const [background, setBackground] = useState<VisualLabBackground>("workbench");
  const [viewmodelStrategy, setViewmodelStrategy] = useState<VisualLabViewmodelStrategy>("production");
  const [silhouette, setSilhouette] = useState<VisualLabSilhouette | null>(null);
  const [referenceUrl, setReferenceUrl] = useState<string | null>(null);
  const [referenceName, setReferenceName] = useState("No reference loaded");
  const [referenceOpacity, setReferenceOpacity] = useState(0.5);
  const [referenceBlend, setReferenceBlend] = useState<ReferenceBlend>("ghost");
  const item = ITEMS[selected];
  const visual = itemVisual(selected);
  const strategy = VIEWMODEL_STRATEGIES.find((candidate) => candidate.id === viewmodelStrategy)
    ?? VIEWMODEL_STRATEGIES[0];
  const catalogMode = mode === "catalog" || mode === "sheet" || mode === "viewmodel" || mode === "dropped";

  function renderSelection(renderer: VisualLabRenderer): void {
    if (mode === "player") {
      renderer.setPlayerSkin(skinImage, skinModel);
      renderer.setPlayerHeldItem(playerHeldItem);
      renderer.setPlayerArmor(playerArmor);
      renderer.setPlayerPose(playerRigMotion, playerRigPhase);
    }
    else if (mode === "mobs") renderer.setMob(selectedMob, mobState);
    else if (mode === "viewmodel") renderer.setViewmodel(selected, visualState, viewmodelStrategy);
    else if (mode === "dropped") renderer.setDroppedItem(selected);
    else renderer.setItem(selected, visualState);
  }

  const visibleItems = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return itemVisualIds().filter((itemId) => {
      const candidate = ITEMS[itemId];
      return (filter === "all" || candidate.category === filter)
        && (!query || candidate.label.toLocaleLowerCase().includes(query) || itemId.includes(query));
    });
  }, [filter, search]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.code !== "Escape" || event.repeat) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener("keydown", closeOnEscape, true);
    return () => window.removeEventListener("keydown", closeOnEscape, true);
  }, [onClose, open]);

  useEffect(() => {
    if (!open || !skinStorage || skinHydratedRef.current) return;
    skinHydratedRef.current = true;
    const persisted = loadPersistedPlayerSkin(skinStorage);
    if (!persisted) return;
    const image = new Image();
    image.onload = () => {
      if (image.naturalWidth !== persisted.width || image.naturalHeight !== persisted.height) {
        clearPersistedPlayerSkin(skinStorage);
        return;
      }
      setSkinImage(image);
      setSkinDataUrl(persisted.dataUrl);
      setSkinModel(persisted.model);
      setSkinFile(`${persisted.name} · ${persisted.width}×${persisted.height} · saved in this browser`);
    };
    image.onerror = () => clearPersistedPlayerSkin(skinStorage);
    image.src = persisted.dataUrl;
  }, [open, skinStorage]);

  useEffect(() => {
    if (!open || !canvasRef.current) return;
    const renderer = createVisualLabRenderer(canvasRef.current);
    rendererRef.current = renderer;
    renderSelection(renderer);
    renderer.setLighting(lighting);
    renderer.setOrbit(yaw, pitch, zoom);
    const initialStats = renderer.stats();
    setVertices(initialStats.vertices); setDrawCalls(initialStats.drawCalls);
    setSilhouette(initialStats.states);
    const resize = () => renderer.resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      renderer.destroy();
      rendererRef.current = null;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !rendererRef.current) return;
    renderSelection(rendererRef.current);
    const nextStats = rendererRef.current.stats();
    setVertices(nextStats.vertices); setDrawCalls(nextStats.drawCalls);
    setSilhouette(nextStats.states);
  }, [mobState, mode, open, playerArmor, playerHeldItem, playerRigMotion, playerRigPhase, selected, selectedMob, skinImage, skinModel, viewmodelStrategy, visualState]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.setOrbit(yaw, pitch, zoom);
    const nextStats = renderer.stats();
    setVertices(nextStats.vertices); setDrawCalls(nextStats.drawCalls);
    setSilhouette(nextStats.states);
  }, [pitch, yaw, zoom]);

  useEffect(() => {
    rendererRef.current?.setLighting(lighting);
  }, [lighting]);

  useEffect(() => () => {
    if (referenceUrlRef.current) URL.revokeObjectURL(referenceUrlRef.current);
  }, []);

  if (!open) return null;

  function setView(nextYaw: number, nextPitch: number, nextZoom = zoom): void {
    setYaw(nextYaw);
    setPitch(nextPitch);
    setZoom(nextZoom);
  }

  function downloadContactSheet(): void {
    const exported = createProductionContactSheetExport({
      category: filter,
      search,
      columns: 8,
      iconScale: 5,
    });
    const link = document.createElement("a");
    link.download = exported.filename;
    link.href = exported.dataUrl;
    link.click();
  }

  function importReference(file: File | undefined): void {
    if (!file) return;
    if (referenceUrlRef.current) URL.revokeObjectURL(referenceUrlRef.current);
    const nextUrl = URL.createObjectURL(file);
    referenceUrlRef.current = nextUrl;
    setReferenceUrl(nextUrl);
    setReferenceName(`${file.name} · local overlay only`);
  }

  function clearReference(): void {
    if (referenceUrlRef.current) URL.revokeObjectURL(referenceUrlRef.current);
    referenceUrlRef.current = null;
    setReferenceUrl(null);
    setReferenceName("No reference loaded");
  }

  async function importSkin(file: File | undefined): Promise<void> {
    if (!file) return;
    try {
      const { dataUrl, info } = await readPlayerSkinFile(file);
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => image.naturalWidth === info.width && image.naturalHeight === info.height
          ? resolve()
          : reject(new Error("The decoded PNG dimensions did not match its header."));
        image.onerror = () => reject(new Error("The browser could not decode this PNG."));
        image.src = dataUrl;
      });
      setSkinImage(image);
      setSkinDataUrl(dataUrl);
      setSkinFile(`${file.name} · ${info.width}×${info.height} · local preview only`);
      setSkinError("");
    } catch (error) {
      setSkinError(error instanceof Error ? error.message : "That skin could not be opened.");
    }
  }

  function applySkin(): void {
    let persisted = true;
    if (skinStorage) {
      persisted = skinImage && skinDataUrl
        ? savePersistedPlayerSkin(skinStorage, {
          version: 1,
          name: skinFile.split(" · ")[0].slice(0, 160),
          width: skinImage.naturalWidth as 64 | 128,
          height: skinImage.naturalHeight as 64 | 128,
          model: skinModel,
          dataUrl: skinDataUrl,
        })
        : clearPersistedPlayerSkin(skinStorage);
    }
    onApplySkin?.(skinImage, skinModel);
    setSkinError(persisted ? "" : "Skin applied for this session, but browser storage could not save it.");
    if (persisted && skinImage) {
      setSkinFile(`${skinFile.split(" · ")[0]} · ${skinImage.naturalWidth}×${skinImage.naturalHeight} · saved in this browser`);
    }
  }

  function restoreBuiltInSkin(): void {
    const cleared = !skinStorage || clearPersistedPlayerSkin(skinStorage);
    setSkinImage(null);
    setSkinDataUrl(null);
    setSkinModel("wide");
    setSkinFile("Installed standard player skin");
    setSkinError(cleared ? "" : "Built-in skin restored for this session, but browser storage could not clear the saved skin.");
    onApplySkin?.(null, "wide");
  }

  return (
    <section aria-label="Lakecraft Visual Lab" aria-modal="true" className="lc-visual-lab" data-testid="visual-lab" role="dialog">
      <style>{VISUAL_LAB_CSS}</style>
      <div className="lc-visual-lab__shell">
        <header className="lc-visual-lab__head">
          <div className="lc-visual-lab__title"><strong>VISUAL LAB</strong><small>PRODUCTION PIXELS · STANDARD SKIN UV</small></div>
          <div aria-label="Visual Lab mode" className="lc-visual-lab__mode" role="group">
            <button aria-pressed={mode === "catalog"} onClick={() => { setMode("catalog"); setView(-22, 12, 1.65); }} type="button">Catalog</button>
            <button aria-pressed={mode === "sheet"} onClick={() => setMode("sheet")} type="button">Contact sheet</button>
            <button aria-pressed={mode === "viewmodel"} onClick={() => setMode("viewmodel")} type="button">First person</button>
            <button aria-pressed={mode === "dropped"} onClick={() => { setMode("dropped"); setView(-22, 10, 2.2); }} type="button">Dropped</button>
            <button aria-pressed={mode === "player"} onClick={() => { setMode("player"); setView(156, 5, 0.6); }} type="button">Player + skin</button>
            <button aria-pressed={mode === "mobs"} onClick={() => { setMode("mobs"); setView(-24, 4, 0.88); }} type="button">Mobs</button>
          </div>
          <button className="lc-visual-lab__close" onClick={onClose} type="button">Close <kbd>Esc</kbd></button>
        </header>
        <div className="lc-visual-lab__body">
          <aside className="lc-visual-lab__catalog">
            {catalogMode ? <>
            <label><span>SEARCH CATALOG</span><input className="lc-visual-lab__search" onInput={(event) => setSearch(event.currentTarget.value)} placeholder="pickaxe, ore, food…" style="--lc-input-vpad:9px" type="search" value={search} /></label>
            <div aria-label="Catalog category" className="lc-visual-lab__filters" role="group">
              {FILTERS.map((value) => <button aria-pressed={filter === value} key={value} onClick={() => setFilter(value)} type="button">{value}</button>)}
            </div>
            <ul aria-label="Visual catalog" className="lc-visual-lab__list">
              {visibleItems.map((itemId) => (
                <li key={itemId}>
                  <button aria-label={ITEMS[itemId].label} aria-pressed={selected === itemId} className="lc-visual-lab__item" onClick={() => { setSelected(itemId); setVisualState(0); setZoom(itemVisual(itemId).family === "block" ? 0.9 : 1.65); }} title={ITEMS[itemId].label} type="button">
                    <ItemIcon compact stack={{ itemId, count: 1 }} />
                  </button>
                </li>
              ))}
            </ul>
            </> : mode === "player" ? <div className="lc-visual-lab__skin-controls">
              <h2>PLAYER SKIN</h2>
              <p>Preview a standard skin. The original PNG stays in this browser; realtime multiplayer relays a reduced 64×64 appearance to connected players.</p>
              <label className="lc-visual-lab__skin-import">Choose skin PNG<input accept="image/png,.png" onChange={(event) => { void importSkin(event.currentTarget.files?.[0]); }} type="file" /></label>
              <div aria-label="Player arm model" className="lc-visual-lab__model" role="group">
                <button aria-pressed={skinModel === "wide"} onClick={() => setSkinModel("wide")} type="button">Wide · 4px</button>
                <button aria-pressed={skinModel === "slim"} onClick={() => setSkinModel("slim")} type="button">Slim · 3px</button>
              </div>
              <div className="lc-visual-lab__skin-file">{skinFile}</div>
              <label><span>THIRD-PERSON HELD ITEM</span><select className="lc-visual-lab__skin-select" onChange={(event) => setPlayerHeldItem(event.currentTarget.value ? event.currentTarget.value as ItemId : null)} value={playerHeldItem ?? ""}>
                <option value="">Empty hand</option>
                {itemVisualIds().map((itemId) => <option key={itemId} value={itemId}>{ITEMS[itemId].label}</option>)}
              </select></label>
              <div aria-label="Player rig motion" className="lc-visual-lab__model" role="group">
                <button aria-pressed={playerRigMotion === "idle"} onClick={() => setPlayerRigMotion("idle")} type="button">Idle</button>
                <button aria-pressed={playerRigMotion === "walk"} onClick={() => setPlayerRigMotion("walk")} type="button">Walk</button>
              </div>
              <label className="lc-visual-lab__cycle"><span>POSE CYCLE</span><input aria-label="Player pose cycle" max="1" min="0" onInput={(event) => setPlayerRigPhase(Number(event.currentTarget.value))} step="0.01" type="range" value={playerRigPhase} /><output>{Math.round(playerRigPhase * 100)}%</output></label>
              <p>Wear a complete original armor set to inspect shell fit, skin clipping, material readability, and lighting.</p>
              <div aria-label="Player armor preview" className="lc-visual-lab__model" role="group">
                <button aria-pressed={playerArmor === null} onClick={() => setPlayerArmor(null)} type="button">No armor</button>
                {ARMOR_MATERIALS.map((material) => <button aria-pressed={playerArmor === material} key={material} onClick={() => setPlayerArmor(material)} type="button">{material}</button>)}
              </div>
              {skinError ? <p className="lc-visual-lab__skin-error" role="alert">{skinError}</p> : null}
              <button className="lc-visual-lab__skin-apply" onClick={applySkin} type="button">Use in this world</button>
              {skinImage ? <button className="lc-visual-lab__skin-import" onClick={restoreBuiltInSkin} type="button">Restore built-in skin</button> : null}
            </div> : <ul aria-label="Mob catalog" className="lc-visual-lab__mob-list">
              {MOB_KINDS.map((kind) => <li key={kind}><button aria-pressed={selectedMob === kind} onClick={() => { setSelectedMob(kind); setMobState("idle"); }} type="button">{kind}</button></li>)}
            </ul>}
          </aside>
          <div className="lc-visual-lab__stage" data-background={background}>
            <div
              className="lc-visual-lab__canvas-wrap"
              data-mode={mode}
              onPointerDown={(event) => {
                if (mode === "sheet") return;
                event.currentTarget.setPointerCapture(event.pointerId);
                dragRef.current = { x: event.clientX, y: event.clientY, yaw, pitch };
              }}
              onPointerMove={(event) => {
                if (mode === "sheet") return;
                const drag = dragRef.current;
                if (!drag) return;
                setYaw(drag.yaw + (event.clientX - drag.x) * 0.45);
                setPitch(drag.pitch + (event.clientY - drag.y) * 0.45);
              }}
              onPointerUp={(event) => {
                if (mode === "sheet") return;
                event.currentTarget.releasePointerCapture(event.pointerId);
                dragRef.current = null;
              }}
              onWheel={(event) => {
                if (mode === "sheet") return;
                event.preventDefault();
                setZoom((current) => Math.max(0.35, Math.min(2.4, current - event.deltaY * 0.002)));
              }}
            >
              <canvas aria-hidden={mode === "sheet"} aria-label={`${mode === "player" ? "Player rig" : mode === "mobs" ? selectedMob : mode === "viewmodel" ? `${item.label} first-person viewmodel` : mode === "dropped" ? `${item.label} dropped item` : item.label} three-dimensional preview`} className="lc-visual-lab__canvas" ref={canvasRef} />
              {referenceUrl && mode !== "sheet" ? <img alt="Locally loaded visual reference overlay" className="lc-visual-lab__reference" src={referenceUrl} style={{ mixBlendMode: referenceBlend === "difference" ? "difference" : "normal", opacity: referenceOpacity }} /> : null}
              {mode === "sheet" ? <div aria-label="Production asset contact sheet" className="lc-visual-lab__sheet">{visibleItems.map((itemId) => <button className="lc-visual-lab__sheet-item" key={itemId} onClick={() => { setSelected(itemId); setVisualState(0); setMode("catalog"); setZoom(itemVisual(itemId).family === "block" ? 0.9 : 1.65); }} title={`Inspect ${ITEMS[itemId].label}`} type="button"><ItemIcon stack={{ itemId, count: 1 }} /><span>{ITEMS[itemId].label}</span></button>)}</div> : null}
              <div className="lc-visual-lab__stage-label"><strong>{mode === "sheet" ? "Production contact sheet" : mode === "player" ? "Player rig" : mode === "mobs" ? selectedMob : item.label}</strong><small>{mode === "sheet" ? `${visibleItems.length} ORIGINAL ASSETS · CLICK TO INSPECT IN 3D` : mode === "player" ? `${skinModel.toUpperCase()} ARMS · ${playerRigMotion.toUpperCase()} ${Math.round(playerRigPhase * 100)}%` : mode === "mobs" ? `PRODUCTION MOB BATCH · ${mobState === "fallen" ? "DEATH" : mobState.toUpperCase()}` : mode === "viewmodel" ? `${strategy.label.toUpperCase()} · ${visual.variants[visualState].toUpperCase()} · EXPERIMENT` : mode === "dropped" ? "PRODUCTION DROPPED-ITEM BATCH · CATALOG PIXELS" : `${visual.parent.toUpperCase()} · DRAG TO ORBIT · WHEEL TO ZOOM`}</small></div>
              {(mode === "catalog" || mode === "viewmodel") && visual.variants.length > 1 ? <div aria-label="Visual state" className="lc-visual-lab__states" role="group">{visual.variants.map((variant, index) => <button aria-pressed={visualState === index} key={variant} onClick={() => setVisualState(index)} type="button">{variant}</button>)}</div> : null}
              {mode === "mobs" ? <div aria-label="Mob visual state" className="lc-visual-lab__states" role="group">{MOB_STATES.map((state) => <button aria-pressed={mobState === state} key={state} onClick={() => setMobState(state)} type="button">{state === "fallen" ? <>death</> : state}</button>)}</div> : null}
              {mode !== "sheet" ? <div className="lc-visual-lab__environment">
                <div aria-label="Preview lighting" className="lc-visual-lab__environment-row" role="group"><span>Lighting</span>{LIGHTING_PRESETS.map((preset) => <button aria-pressed={lighting === preset} key={preset} onClick={() => setLighting(preset)} type="button">{preset === "unlit" ? "Neutral" : preset}</button>)}</div>
                <div aria-label="Preview background" className="lc-visual-lab__environment-row" role="group"><span>Backdrop</span>{BACKGROUNDS.map((preset) => <button aria-pressed={background === preset} key={preset} onClick={() => setBackground(preset)} type="button">{preset === "workbench" ? "Work" : preset}</button>)}</div>
              </div> : null}
              {mode !== "sheet" ? <span className="lc-visual-lab__axis">{mode === "viewmodel" ? "SCREEN-SPACE CAMERA · LIVE POSE TUNING" : `YAW ${Math.round(yaw)}° · PITCH ${Math.round(pitch)}° · ${zoom.toFixed(2)}×`}</span> : null}
            </div>
            <div aria-label="Preview angle" className="lc-visual-lab__views" role="group">
              {mode === "sheet" ? <><button onClick={() => setMode("catalog")} type="button">Inspect selected asset</button><button onClick={downloadContactSheet} type="button">Download PNG</button><small>Exports this exact filtered catalog as one deterministic nearest-neighbor image.</small></> : mode === "viewmodel" ? <>
                <span className="lc-visual-lab__strategy-label">METHOD</span>
                {VIEWMODEL_STRATEGIES.map((candidate) => <button aria-pressed={viewmodelStrategy === candidate.id} key={candidate.id} onClick={() => setViewmodelStrategy(candidate.id)} type="button">{candidate.label}</button>)}
                <small>These are comparison candidates, not accepted production changes. Choose by reference fit.</small>
              </> : <>
                <button onClick={() => setView(mode === "player" ? 180 : 0, 0)} type="button">Front</button>
                <button onClick={() => setView(90, 0)} type="button">Edge</button>
                <button onClick={() => setView(mode === "player" ? 0 : 180, 0)} type="button">Back</button>
                <button onClick={() => setView(mode === "player" ? 156 : -22, mode === "player" ? 5 : 12, mode === "player" ? 0.6 : mode === "mobs" ? 0.88 : visual.family === "block" ? 0.9 : 1.65)} type="button">Reset orbit</button>
                <small>{mode === "player" ? "Standard skin UVs shared by every player camera." : mode === "mobs" ? "Exact production mob geometry, colors, gait, damage, and death transforms." : mode === "dropped" ? "Exact production drop batch, with the same catalog pixels used by inventory and held items." : visual.family === "block" ? "Production atlas faces shared by world and held block cubes." : "The same pixel runs used by inventory and first-person held items."}</small>
              </>}
            </div>
          </div>
          <aside className="lc-visual-lab__inspector">
            {mode !== "sheet" ? <section className="lc-visual-lab__section"><h3>Reference overlay</h3><div className="lc-visual-lab__reference-controls"><label className="lc-visual-lab__reference-file">Choose screenshot or reference<input accept="image/*" onChange={(event) => importReference(event.currentTarget.files?.[0])} type="file" /></label><div className="lc-visual-lab__reference-opacity"><span>{referenceName}</span><input aria-label="Reference opacity" disabled={!referenceUrl} max="1" min="0" onInput={(event) => setReferenceOpacity(Number(event.currentTarget.value))} step="0.05" type="range" value={referenceOpacity} /><output>{Math.round(referenceOpacity * 100)}%</output></div><div aria-label="Reference comparison mode" className="lc-visual-lab__model" role="group"><button aria-pressed={referenceBlend === "ghost"} onClick={() => setReferenceBlend("ghost")} type="button">Ghost</button><button aria-pressed={referenceBlend === "difference"} onClick={() => setReferenceBlend("difference")} type="button">Difference</button></div>{referenceUrl ? <button className="lc-visual-lab__reference-clear" onClick={clearReference} type="button">Clear reference</button> : null}</div><p className="lc-visual-lab__note">The image stays on this computer. Ghost overlays the fixed camera; Difference emphasizes pixels that do not align.</p></section> : null}
            {catalogMode ? <>
            <div className="lc-visual-lab__icon-preview"><ItemIcon stack={{ itemId: selected, count: 1 }} /><div><strong>Inventory sprite</strong><small>One source image. Nearest-neighbor. No alternate held illustration.</small></div></div>
            <section className="lc-visual-lab__section"><h3>Resolved model</h3><dl className="lc-visual-lab__facts"><dt>ID</dt><dd>{selected}</dd><dt>Family</dt><dd>{visual.family}</dd><dt>Parent</dt><dd>{visual.parent}</dd><dt>States</dt><dd>{visual.variants.length}</dd><dt>Fingerprint</dt><dd>{itemIconFingerprint(selected)}</dd><dt>Vertices</dt><dd>{vertices}</dd><dt>Draw calls</dt><dd>{drawCalls}</dd>{silhouette ? <><dt>Silhouette</dt><dd>{silhouette[2]}% × {silhouette[3]}%</dd><dt>Frame position</dt><dd>{silhouette[0]}% left · {silhouette[1]}% top</dd><dt>Coverage</dt><dd>{silhouette[4]}%</dd></> : null}</dl></section>
            {mode === "viewmodel" ? <section className="lc-visual-lab__section"><h3>Candidate method</h3><p className="lc-visual-lab__note"><strong>{strategy.label}.</strong> {strategy.note} No candidate is marked correct until it survives the same reference overlay and your in-game review.</p></section> : null}
            <section className="lc-visual-lab__section"><h3>First-person display</h3><pre className="lc-visual-lab__transform">{displayTransformText(selected)}</pre></section>
            <section className="lc-visual-lab__section"><h3>Production source</h3><p className="lc-visual-lab__note">Sprites use their production opaque-edge extrusion. Full cubes use the exact world atlas and face resolver. Beds, chests, doors, ladders, torches, saplings, fences, gates, and slabs call the same dedicated mesh builders used in-world.</p></section>
            </> : mode === "player" ? <>
              <section className="lc-visual-lab__section"><h3>Rig contract</h3><dl className="lc-visual-lab__facts"><dt>Texture</dt><dd>64×64 / 128×128 PNG</dd><dt>Arm model</dt><dd>{skinModel}</dd><dt>Motion</dt><dd>{playerRigMotion} · {Math.round(playerRigPhase * 100)}%</dd><dt>Held</dt><dd>{playerHeldItem ?? "empty"}</dd><dt>Armor</dt><dd>{playerArmor ?? "none"}</dd><dt>Parts</dt><dd>head · body · articulated arms · articulated legs</dd><dt>Outer layers</dt><dd>hat · jacket · sleeves · pants</dd><dt>Vertices</dt><dd>{vertices}</dd>{silhouette ? <><dt>Silhouette</dt><dd>{silhouette[2]}% × {silhouette[3]}%</dd><dt>Frame position</dt><dd>{silhouette[0]}% left · {silhouette[1]}% top</dd></> : null}</dl></section>
              <section className="lc-visual-lab__section"><h3>Inspection</h3><p className="lc-visual-lab__note">Drag through every angle to inspect head, arm width, limb seams, mirrored sides, transparent outer layers, and nearest-neighbor pixels. This exact UV contract drives the local first-person arm and third-person player rig.</p></section>
              <section className="lc-visual-lab__section"><h3>Privacy</h3><p className="lc-visual-lab__note">Lakecraft never bundles or uploads the original file. When you join realtime multiplayer, its reduced 64×64 appearance is relayed transiently to connected players.</p></section>
            </> : <>
              <section className="lc-visual-lab__section"><h3>Mob contract</h3><dl className="lc-visual-lab__facts"><dt>Kind</dt><dd>{selectedMob}</dd><dt>State</dt><dd>{mobState === "fallen" ? <>death</> : mobState}</dd><dt>Vertices</dt><dd>{vertices}</dd><dt>Draw calls</dt><dd>{drawCalls}</dd><dt>Source</dt><dd>installed 26.2 texture · production mob batch</dd>{silhouette ? <><dt>Silhouette</dt><dd>{silhouette[2]}% × {silhouette[3]}%</dd><dt>Frame position</dt><dd>{silhouette[0]}% left · {silhouette[1]}% top</dd></> : null}</dl></section>
              <section className="lc-visual-lab__section"><h3>Inspection</h3><p className="lc-visual-lab__note">Orbit the exact world geometry and compare idle, walking, damage, fall-over death, and kind-specific state. Special previews sheared sheep and a primed creeper; other kinds intentionally remain at rest.</p></section>
              <section className="lc-visual-lab__section"><h3>Rendering path</h3><p className="lc-visual-lab__note">This canvas binds the same exact UV atlas, retained vertex buffer, and production rebuild function used in a running world. There is no alternate mock model.</p></section>
            </>}
          </aside>
        </div>
      </div>
    </section>
  );
}
