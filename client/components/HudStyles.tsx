const HUD_CSS = `
:root {
  --lc-paper: #e6dcc1;
  --lc-paper-deep: #c9b98f;
  --lc-ink: #24261f;
  --lc-charcoal: #171a16;
  --lc-moss: #667541;
  --lc-moss-bright: #a8b66b;
  --lc-amber: #d49a45;
  --lc-rust: #9a5434;
  --lc-line: rgba(33, 37, 29, .2);
  --lc-shadow: rgba(10, 12, 9, .45);
  --lc-display: "Trebuchet MS", "Avenir Next Condensed", sans-serif;
  --lc-note: "Courier New", Courier, monospace;
}
.lc-hud, .lc-drawer-layer, .lc-unsupported { color: var(--lc-paper); font-family: var(--lc-display); }
.lc-hud { inset: 0; pointer-events: none; position: fixed; z-index: 20; }
.lc-hud button, .lc-drawer-layer button, .lc-unsupported button { font: inherit; }
.lc-status {
  align-items: stretch; background: linear-gradient(90deg, rgba(18,21,17,.97), rgba(31,34,25,.91));
  border-bottom: 1px solid rgba(229,217,180,.2); box-shadow: 0 12px 32px rgba(8,10,8,.25); display: flex;
  height: 64px; left: 20px; pointer-events: auto; position: absolute; right: 20px; top: 18px;
}
.lc-status::after { background: var(--lc-amber); bottom: -3px; content: ""; height: 3px; left: 0; position: absolute; width: 82px; }
.lc-status__brand, .lc-status__world, .lc-status__presence, .lc-status__health, .lc-status__hunger { align-items: center; display: flex; }
.lc-status__brand { border-right: 1px solid rgba(229,217,180,.16); gap: 11px; padding: 0 22px 0 12px; }
.lc-status__brand-mark { align-items: center; background: var(--lc-amber); clip-path: polygon(0 0, 84% 0, 100% 50%, 84% 100%, 0 100%); color: var(--lc-charcoal); display: flex; font: 900 25px/1 var(--lc-display); height: 40px; justify-content: center; padding-right: 4px; width: 44px; }
.lc-status__brand strong { display: block; font-size: 15px; letter-spacing: .15em; }
.lc-status small { color: rgba(230,220,193,.58); display: block; font: 9px/1.4 var(--lc-note); letter-spacing: .08em; text-transform: uppercase; }
.lc-status__world { flex: 1; gap: 13px; min-width: 0; padding: 0 20px; }
.lc-status__world > strong { font-size: 14px; letter-spacing: .035em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lc-status__room { border-left: 1px solid rgba(229,217,180,.2); color: var(--lc-amber); font: 10px var(--lc-note); letter-spacing: .09em; padding-left: 13px; }
.lc-status__presence { background: rgba(0,0,0,.16); gap: 10px; justify-content: flex-start; min-width: 164px; padding: 0 18px; }
.lc-status__health { border-left: 1px solid rgba(229,217,180,.16); flex-direction: column; justify-content: center; min-width: 132px; padding: 0 12px; }.lc-status__health span { color: rgba(230,220,193,.5); font: 7px var(--lc-note); letter-spacing: .12em; }.lc-status__health strong { color: #c96552; font: 13px/1.2 Georgia, serif; letter-spacing: .04em; }
.lc-status__hunger { border-left: 1px solid rgba(229,217,180,.16); flex-direction: column; justify-content: center; min-width: 132px; padding: 0 12px; }.lc-status__hunger span { color: rgba(230,220,193,.5); font: 7px var(--lc-note); letter-spacing: .12em; }.lc-status__hunger strong { color: #d49a45; font: 12px/1.2 Georgia, serif; letter-spacing: .04em; }
.lc-status__presence strong { display: block; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; }
.lc-signal { background: var(--lc-rust); border: 3px solid rgba(154,84,52,.22); border-radius: 50%; box-shadow: 0 0 0 1px var(--lc-rust); height: 7px; width: 7px; }
.lc-signal.is-online { animation: lc-signal 2.2s ease-out infinite; background: var(--lc-moss-bright); border-color: rgba(168,182,107,.18); box-shadow: 0 0 0 1px var(--lc-moss-bright); }
@keyframes lc-signal { 0%, 40% { box-shadow: 0 0 0 1px var(--lc-moss-bright), 0 0 0 2px rgba(168,182,107,.2); } 90%, 100% { box-shadow: 0 0 0 1px var(--lc-moss-bright), 0 0 0 8px rgba(168,182,107,0); } }
.lc-kicker { color: var(--lc-amber); font: 9px/1.2 var(--lc-note); letter-spacing: .14em; text-transform: uppercase; }
.lc-crosshair { height: 22px; left: 50%; position: absolute; top: 50%; transform: translate(-50%, -50%); width: 22px; }
.lc-crosshair::before, .lc-crosshair::after { background: rgba(237,227,199,.88); box-shadow: 0 1px 3px #000; content: ""; left: 50%; position: absolute; top: 50%; transform: translate(-50%,-50%); }
.lc-crosshair::before { height: 2px; width: 22px; }.lc-crosshair::after { height: 22px; width: 2px; }
.lc-hotbar-wrap { bottom: 23px; left: 50%; pointer-events: auto; position: absolute; transform: translateX(-50%); }
.lc-hotbar-label { align-items: flex-end; display: flex; justify-content: space-between; margin: 0 2px 7px; }
.lc-hotbar-label span { color: rgba(230,220,193,.62); font: 9px var(--lc-note); letter-spacing: .12em; text-transform: uppercase; }
.lc-hotbar-label strong { color: var(--lc-paper); font: 11px var(--lc-note); letter-spacing: .04em; }
.lc-hotbar { background: rgba(18,21,17,.92); border: 1px solid rgba(230,220,193,.28); box-shadow: 0 11px 28px rgba(0,0,0,.38); display: grid; gap: 3px; grid-template-columns: repeat(9, 58px); padding: 5px; position: relative; }
.lc-hotbar::before { border-left: 8px solid transparent; border-right: 8px solid transparent; border-top: 7px solid var(--lc-amber); content: ""; left: calc((58px + 3px) * var(--selected, 0) + 27px); position: absolute; top: -1px; }
.lc-slot { appearance: none; background: rgba(230,220,193,.045); border: 1px solid rgba(230,220,193,.13); color: var(--lc-paper); cursor: pointer; min-width: 0; padding: 0; position: relative; transition: background .14s ease, border-color .14s ease, transform .14s ease; }
.lc-slot:hover { background: rgba(230,220,193,.1); border-color: rgba(230,220,193,.38); }
.lc-slot:focus-visible, .lc-recipe:focus-visible, .lc-close:focus-visible { outline: 2px solid var(--lc-amber); outline-offset: 2px; }
.lc-hotbar__slot { height: 58px; }.lc-hotbar__slot.is-selected { background: rgba(212,154,69,.16); border-color: var(--lc-amber); transform: translateY(-3px); }
.lc-slot__key, .lc-slot__index { color: rgba(230,220,193,.44); font: 8px var(--lc-note); left: 4px; position: absolute; top: 3px; z-index: 2; }
.lc-item-glyph { align-items: center; display: flex; height: 100%; justify-content: center; min-height: 42px; overflow: hidden; position: relative; width: 100%; }
.lc-item-glyph::before { background: color-mix(in srgb, var(--item-color), transparent 78%); border: 1px solid color-mix(in srgb, var(--item-color), white 16%); box-shadow: inset 3px 3px rgba(255,255,255,.06), inset -4px -4px rgba(0,0,0,.14); content: ""; height: 25px; position: absolute; transform: rotate(-2deg); width: 25px; }
.lc-item-glyph--tool::before, .lc-item-glyph--material::before { border-radius: 50%; transform: rotate(0); }
.lc-item-glyph--empty::before { background: none; border: 1px dashed rgba(230,220,193,.07); box-shadow: none; }
.lc-item-glyph__mark { color: var(--item-color); filter: drop-shadow(1px 2px 0 rgba(0,0,0,.4)); font: 900 22px/1 Georgia, serif; position: relative; z-index: 1; }
.lc-item-glyph__code { bottom: 3px; color: rgba(230,220,193,.68); font: 7px var(--lc-note); left: 4px; letter-spacing: .06em; position: absolute; }
.lc-item-glyph__count { background: var(--lc-paper); bottom: 2px; color: var(--lc-ink); font: 900 9px/1 var(--lc-note); min-width: 11px; padding: 2px; position: absolute; right: 2px; text-align: center; z-index: 2; }
.lc-item-glyph.is-muted { filter: grayscale(1); opacity: .45; }
.lc-controls { background: rgba(27,30,23,.91); border: 1px solid rgba(230,220,193,.22); bottom: 22px; left: 20px; padding: 13px 14px 12px; pointer-events: auto; position: absolute; width: 210px; }
.lc-controls::after { border-bottom: 20px solid var(--lc-amber); border-left: 20px solid transparent; bottom: -1px; content: ""; position: absolute; right: -1px; }
.lc-controls__head { align-items: center; border-bottom: 1px solid rgba(230,220,193,.15); display: flex; justify-content: space-between; margin-bottom: 9px; padding-bottom: 7px; }
.lc-controls__head button { background: none; border: 0; color: rgba(230,220,193,.5); cursor: pointer; font-size: 18px; line-height: .7; }
.lc-controls__grid { display: grid; gap: 7px; grid-template-columns: 1fr 1fr; }
.lc-controls__grid > div { align-items: center; display: flex; gap: 7px; min-height: 35px; }
.lc-controls p { margin: 0; }.lc-controls p strong { display: block; font-size: 9px; letter-spacing: .08em; text-transform: uppercase; }.lc-controls p small { color: rgba(230,220,193,.5); font: 7px var(--lc-note); white-space: nowrap; }
.lc-controls kbd { align-items: center; background: rgba(230,220,193,.08); border: 1px solid rgba(230,220,193,.32); border-bottom-width: 2px; color: var(--lc-paper); display: inline-flex; font: 7px var(--lc-note); height: 13px; justify-content: center; min-width: 13px; padding: 0 2px; }
.lc-key-cluster { display: grid; gap: 1px; justify-items: center; min-width: 33px; }.lc-key-cluster > span, .lc-key-row { display: flex; gap: 1px; }.lc-mouse { border: 1px solid rgba(230,220,193,.38); border-radius: 9px 9px 7px 7px; height: 25px; min-width: 17px; position: relative; }
.lc-mouse::before { background: rgba(230,220,193,.45); content: ""; height: 1px; left: 0; position: absolute; right: 0; top: 10px; }.lc-mouse::after { background: var(--lc-amber); border-radius: 3px 0 0 0; content: ""; height: 9px; left: 1px; position: absolute; top: 1px; width: 7px; }.lc-mouse--right::after { border-radius: 0 3px 0 0; left: auto; right: 1px; }
.lc-toasts { display: flex; flex-direction: column; gap: 7px; pointer-events: auto; position: absolute; right: 20px; top: 96px; width: min(300px, calc(100vw - 40px)); }
.lc-toast { animation: lc-toast-in .25s ease-out both; appearance: none; background: var(--lc-paper); border: 0; box-shadow: 5px 7px 20px rgba(0,0,0,.3); color: var(--lc-ink); cursor: pointer; display: flex; gap: 11px; padding: 12px 15px; text-align: left; transform: rotate(.35deg); }
.lc-toast__pin { background: var(--lc-moss); border-radius: 50%; box-shadow: 0 1px 2px rgba(0,0,0,.45); height: 8px; margin-top: 3px; width: 8px; }.lc-toast--success .lc-toast__pin { background: var(--lc-moss); }.lc-toast--warning .lc-toast__pin { background: var(--lc-rust); }
.lc-toast strong { display: block; font-size: 11px; letter-spacing: .05em; }.lc-toast small { color: rgba(36,38,31,.66); display: block; font: 9px/1.4 var(--lc-note); margin-top: 3px; }
@keyframes lc-toast-in { from { opacity: 0; transform: translateX(25px) rotate(.35deg); } }
.lc-drawer-layer { align-items: center; background: rgba(8,10,8,.67); backdrop-filter: blur(4px); display: flex; inset: 0; justify-content: center; padding: 28px; position: fixed; z-index: 60; }
.lc-drawer { background-color: #d9cfb3; background-image: linear-gradient(rgba(74,81,59,.075) 1px, transparent 1px), linear-gradient(90deg, rgba(74,81,59,.045) 1px, transparent 1px); background-size: 100% 24px, 24px 100%; border: 1px solid #eee5ce; box-shadow: 0 24px 80px rgba(0,0,0,.55), inset 0 0 0 5px rgba(87,77,49,.13); color: var(--lc-ink); max-height: calc(100vh - 56px); max-width: 1040px; overflow: auto; position: relative; width: 100%; }
.lc-drawer::before { background: var(--lc-moss); content: ""; height: 7px; left: 0; position: absolute; right: 0; top: 0; }
.lc-drawer__heading { align-items: flex-end; border-bottom: 2px solid rgba(36,38,31,.7); display: flex; justify-content: space-between; margin: 30px 32px 0; padding-bottom: 14px; }.lc-drawer__heading h2 { font-size: clamp(24px, 4vw, 38px); letter-spacing: -.04em; line-height: 1; margin: 5px 0 0; text-transform: uppercase; }.lc-drawer__heading .lc-kicker { color: var(--lc-rust); }
.lc-close { align-items: center; background: none; border: 0; color: var(--lc-ink); cursor: pointer; display: flex; gap: 9px; padding: 5px; }.lc-close span { font: 9px var(--lc-note); letter-spacing: .1em; text-transform: uppercase; }.lc-close kbd { border: 1px solid rgba(36,38,31,.45); box-shadow: 0 2px rgba(36,38,31,.3); font: 10px var(--lc-note); padding: 5px 8px; }
.lc-drawer__body { display: grid; gap: 32px; grid-template-columns: minmax(330px, 1fr) minmax(330px, 1.1fr); padding: 25px 32px 33px; }
.lc-section-rule { align-items: baseline; border-bottom: 1px solid rgba(36,38,31,.28); display: flex; justify-content: space-between; margin-bottom: 13px; padding-bottom: 7px; }.lc-section-rule h3 { font-size: 12px; letter-spacing: .12em; margin: 0; text-transform: uppercase; }.lc-section-rule small { color: rgba(36,38,31,.56); font: 9px var(--lc-note); }
.lc-inventory-grid { background: rgba(36,38,31,.87); border: 4px solid rgba(36,38,31,.18); display: grid; gap: 3px; grid-template-columns: repeat(9, 1fr); padding: 5px; }
.lc-inventory-grid__slot { aspect-ratio: 1; min-width: 0; }.lc-inventory-grid__slot:nth-child(-n+9) { border-bottom-color: var(--lc-amber); }.lc-inventory-grid__slot.is-selected { background: rgba(212,154,69,.18); border-color: var(--lc-amber); }
.lc-inventory-grid .lc-item-glyph__mark { font-size: 17px; }.lc-inventory-grid .lc-item-glyph::before { height: 21px; width: 21px; }.lc-pencil-note { color: rgba(36,38,31,.64); font: italic 10px/1.5 var(--lc-note); margin: 12px 4px 0; transform: rotate(-.4deg); }
.lc-armor-rack { align-items: stretch; background: rgba(36,38,31,.08); border: 1px solid rgba(36,38,31,.18); display: grid; gap: 5px; grid-template-columns: 1fr repeat(4, 48px); margin-top: 12px; padding: 7px; }.lc-armor-rack > div { align-self: center; padding-left: 5px; }.lc-armor-rack > div strong { display: block; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; }.lc-armor-rack > div small { color: rgba(36,38,31,.56); font: 8px var(--lc-note); }.lc-armor-slot { background: rgba(36,38,31,.84); border: 1px solid rgba(36,38,31,.2); color: var(--lc-paper); cursor: pointer; height: 48px; padding: 0; position: relative; }.lc-armor-slot:disabled { cursor: default; opacity: .35; }.lc-armor-slot > span { color: rgba(230,220,193,.45); font: 6px var(--lc-note); left: 3px; position: absolute; text-transform: uppercase; top: 2px; z-index: 2; }.lc-armor-slot .lc-item-glyph { min-height: 46px; }.lc-armor-slot .lc-item-glyph__mark { font-size: 17px; }
.lc-recipe-list { display: flex; flex-direction: column; gap: 6px; }.lc-recipe { align-items: center; appearance: none; background: rgba(255,255,255,.16); border: 1px solid rgba(36,38,31,.17); color: var(--lc-ink); cursor: pointer; display: grid; gap: 10px; grid-template-columns: 26px 1fr auto 46px; min-height: 59px; padding: 8px 9px; text-align: left; transition: background .15s, transform .15s; }.lc-recipe:not(:disabled):hover { background: rgba(255,255,255,.42); transform: translateX(-3px); }.lc-recipe:disabled { cursor: not-allowed; filter: saturate(.4); opacity: .55; }.lc-recipe.is-ready { border-left: 3px solid var(--lc-moss); }
.lc-recipe__number { color: rgba(36,38,31,.46); font: 8px var(--lc-note); }.lc-recipe__output { align-items: center; display: flex; gap: 9px; min-width: 0; }.lc-recipe__output > b { align-items: center; background: color-mix(in srgb, var(--item-color), transparent 75%); border: 1px solid var(--item-color); color: var(--item-color); display: flex; font: 900 19px Georgia, serif; height: 34px; justify-content: center; width: 34px; }.lc-recipe__output strong { display: block; font-size: 11px; letter-spacing: .03em; }.lc-recipe__output small { color: rgba(36,38,31,.56); display: block; font: 8px/1.3 var(--lc-note); margin-top: 2px; }.lc-recipe__ingredients { align-items: center; display: flex; gap: 4px; }.lc-ingredient { align-items: center; background: rgba(36,38,31,.08); display: flex; font: 9px var(--lc-note); gap: 2px; padding: 3px 4px; }.lc-ingredient.is-short { color: var(--lc-rust); text-decoration: line-through; }.lc-ingredient__mark { font: 12px Georgia, serif; }.lc-recipe__arrow { color: rgba(36,38,31,.4); }.lc-recipe__action { border: 1px solid rgba(36,38,31,.35); font: 8px var(--lc-note); letter-spacing: .08em; padding: 6px 4px; text-align: center; }.lc-recipe.is-ready .lc-recipe__action { background: var(--lc-moss); border-color: var(--lc-moss); color: #f1e8ce; }
.lc-unsupported { align-items: center; background: var(--lc-charcoal); display: flex; inset: 0; justify-content: center; overflow: hidden; padding: 24px; position: fixed; z-index: 100; }.lc-unsupported__topo { background: repeating-radial-gradient(ellipse at 80% 20%, transparent 0 26px, rgba(168,182,107,.08) 27px 28px, transparent 29px 42px); inset: -30%; position: absolute; transform: rotate(-10deg); }.lc-unsupported__card { background: var(--lc-paper); box-shadow: 12px 14px 0 rgba(102,117,65,.48); color: var(--lc-ink); max-width: 390px; padding: 34px 31px; position: relative; transform: rotate(-1deg); }.lc-unsupported__stamp { border: 1px solid var(--lc-rust); color: var(--lc-rust); font: 9px var(--lc-note); letter-spacing: .12em; padding: 5px 7px; }.lc-unsupported__icon { color: var(--lc-moss); font: 900 44px/1 var(--lc-display); margin-top: 27px; }.lc-unsupported h2 { font-size: 35px; letter-spacing: -.045em; line-height: .95; margin: 13px 0 16px; text-transform: uppercase; }.lc-unsupported p { font: 13px/1.6 var(--lc-note); }.lc-unsupported button { align-items: center; background: var(--lc-ink); border: 0; color: var(--lc-paper); cursor: pointer; display: flex; justify-content: space-between; margin-top: 22px; padding: 13px 16px; width: 100%; }.lc-unsupported small { color: rgba(36,38,31,.55); display: block; font: 9px var(--lc-note); margin-top: 13px; }
@media (max-width: 820px) { .lc-status { left: 10px; right: 10px; top: 10px; }.lc-status__brand { padding-right: 10px; }.lc-status__brand strong, .lc-status__brand small, .lc-status__room, .lc-status__health span, .lc-status__hunger span { display: none; }.lc-status__health, .lc-status__hunger { min-width: 82px; }.lc-status__world { padding: 0 11px; }.lc-status__presence { min-width: 115px; padding: 0 10px; }.lc-controls { display: none; }.lc-hotbar { grid-template-columns: repeat(9, minmax(36px, 1fr)); max-width: calc(100vw - 20px); }.lc-hotbar__slot { height: min(52px, calc((100vw - 56px) / 9)); }.lc-hotbar-label { display: none; }.lc-drawer-layer { padding: 10px; }.lc-drawer { max-height: calc(100vh - 20px); }.lc-drawer__body { grid-template-columns: 1fr; }.lc-inventory-grid { grid-template-columns: repeat(9, 1fr); }.lc-drawer__heading { margin-inline: 19px; }.lc-drawer__body { padding: 20px 19px 25px; } }
@media (max-width: 560px) { .lc-recipe { grid-template-columns: 22px 1fr 42px; }.lc-recipe__ingredients { grid-column: 2 / 4; }.lc-inventory-grid { grid-template-columns: repeat(6, 1fr); } }
@media (prefers-reduced-motion: reduce) { .lc-signal.is-online, .lc-toast { animation: none; }.lc-slot, .lc-recipe { transition: none; } }
`;

export function HudStyles() {
  return <style>{HUD_CSS}</style>;
}
