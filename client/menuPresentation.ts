/**
 * Exact 16×16 dirt texture from the project owner's installed Minecraft Java
 * 26.2 client. Embedded because Lakebed capsules cannot serve loose assets.
 *
 * Source: assets/minecraft/textures/block/dirt.png
 * SHA-256: 67197d5371efc3ca1638217c38349665dbd5a977b47bfb20075c858dff87d510
 */
export const MINECRAFT_DIRT_TEXTURE_DATA_URI = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQBAMAAADt3eJSAAAAFVBMVEV5VTq5hVyHh4eWbEpsbGx0WERZPSk6VlZqAAAAa0lEQVR42gXBwQnDQAxFwSd+0FnLgs8+5SyjsA2kgZQgY9j+S8gMM61oM9R6W85NeBDs4BPLSpbk9bBeary02zGC02JIMIpVFCm5kkbtDUPIYt5HnaQuffNxPCuAgfiVH1bk7T5EkTPPovwPGbIOYwnMHcMAAAAASUVORK5CYII=";

/** Classic menu darkness with an integer 2× scale for crisp source pixels. */
export const MINECRAFT_DIRT_BACKGROUND_CSS = `background-color:#493322;background-image:linear-gradient(rgba(0,0,0,.44),rgba(0,0,0,.44)),url("${MINECRAFT_DIRT_TEXTURE_DATA_URI}");background-position:0 0;background-repeat:repeat;background-size:auto,32px 32px;image-rendering:pixelated`;
