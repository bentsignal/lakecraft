import { LAKE_BED_EDITION_TITLE_WEBP_BASE64 } from "./generated/lakeBedEditionTitle.ts";

const TITLE_SRC = LAKE_BED_EDITION_TITLE_WEBP_BASE64.includes(":")
  ? LAKE_BED_EDITION_TITLE_WEBP_BASE64 : `data:image/webp;base64,${LAKE_BED_EDITION_TITLE_WEBP_BASE64}`;

export function TitleLogo() {
  return (
    <header className="lc-title-logo">
      <img
        alt="Minecraft — Lake Bed Edition"
        decoding="sync"
        draggable={false}
        height="302"
        src={TITLE_SRC}
        width="1400"
      />
    </header>
  );
}
