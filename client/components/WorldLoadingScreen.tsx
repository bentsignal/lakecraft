import { MINECRAFT_DIRT_BACKGROUND_CSS, MINECRAFT_DIRT_TEXTURE_DATA_URI } from "../menuPresentation.ts";
import { LAKECRAFT_PIXEL_FONT_CSS } from "../pixelTypography.ts";

const WORLD_LOADING_CSS = `
.lc-world-loading{${MINECRAFT_DIRT_BACKGROUND_CSS};align-items:center;color:#fff;display:flex;font-family:var(--lc-pixel-font,"Courier New",monospace);inset:0;justify-content:center;padding:24px;position:fixed;text-align:center;text-shadow:2px 2px #202020;z-index:110}
.lc-world-loading__content{display:grid;justify-items:center;max-width:520px;width:100%}
.lc-world-loading h1{font-size:clamp(20px,2.1vw,28px);font-weight:400;line-height:1.25;margin:0}
.lc-world-loading p{color:#cfcfcf;font-size:clamp(12px,1.2vw,15px);line-height:1.4;margin:13px 0 0}
.lc-world-loading__blocks{display:flex;gap:6px;height:38px;margin-top:28px}
.lc-world-loading__blocks i{animation:lc-world-loading__block-animation 1.2s steps(2,end) infinite;background-image:url("${MINECRAFT_DIRT_TEXTURE_DATA_URI}");background-size:24px 24px;box-shadow:inset 2px 2px rgba(255,255,255,.16),inset -2px -2px rgba(0,0,0,.36),2px 2px #111;display:block;height:24px;image-rendering:pixelated;width:24px}
.lc-world-loading__blocks i:nth-child(2){animation-delay:.12s}.lc-world-loading__blocks i:nth-child(3){animation-delay:.24s}.lc-world-loading__blocks i:nth-child(4){animation-delay:.36s}.lc-world-loading__blocks i:nth-child(5){animation-delay:.48s}
@keyframes lc-world-loading__block-animation{0%,58%,100%{filter:brightness(.54);transform:translateY(9px)}18%,42%{filter:brightness(1.14);transform:translateY(0)}}
@media(prefers-reduced-motion:reduce){.lc-world-loading__blocks i{animation:none;filter:brightness(.82);transform:translateY(6px)}.lc-world-loading__blocks i:nth-child(3){filter:brightness(1.1);transform:translateY(0)}}`;

export interface WorldLoadingScreenProps {
  detail?: string;
  label?: string;
}

export function WorldLoadingScreen({
  detail = "Preparing terrain…",
  label = "Loading world",
}: WorldLoadingScreenProps) {
  return (
    <main aria-atomic="true" aria-live="polite" className="lc-world-loading" role="status">
      <style>{LAKECRAFT_PIXEL_FONT_CSS + WORLD_LOADING_CSS}</style>
      <section className="lc-world-loading__content">
        <h1>{label}</h1>
        <p>{detail}</p>
        <span aria-hidden="true" className="lc-world-loading__blocks"><i /><i /><i /><i /><i /></span>
      </section>
    </main>
  );
}
