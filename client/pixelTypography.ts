import { MINECRAFT_ASCII_TTF_BASE64 } from "./components/generated/minecraftAsciiFont.ts";

/**
 * Self-contained typeface generated from the user-owned Minecraft 26.2 ASCII
 * bitmap atlas. Each source pixel becomes an exact square outline, so menus,
 * chat and HUD labels share the game's glyph proportions without a network
 * font request or a second text-rendering implementation.
 */
export const LAKECRAFT_PIXEL_FONT_CSS = `@font-face{font-display:block;font-family:"Lakecraft Pixel";font-style:normal;font-weight:400;src:url("data:font/ttf;base64,${MINECRAFT_ASCII_TTF_BASE64}") format("truetype")}:root{--lc-pixel-font:"Lakecraft Pixel","Courier New",monospace;--lc-input-vpad:4px}body{-webkit-font-smoothing:none;font-synthesis:none}input:not([type=range]):not([type=file]){padding-block:var(--lc-input-vpad)!important}`;
