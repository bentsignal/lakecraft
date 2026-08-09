const LAKEBED_HOST_SUFFIX = ".lakebed.app";

/** Hosted Lakebed capsules are single-player-only until multiplayer is reopened. */
export function isHostedLakebedHostname(value: string): boolean {
  const hostname = value.trim().toLowerCase().replace(/\.+$/, "");
  return hostname === "lakebed.app" || hostname.endsWith(LAKEBED_HOST_SUFFIX);
}

export function shouldRunSinglePlayer(hostname: string, search: string): boolean {
  if (isHostedLakebedHostname(hostname)) return true;
  return new URLSearchParams(search).get("singleplayer") === "1";
}

/** Bare hosted URLs land on Lakecraft's title; the explicit route opens worlds. */
export function shouldShowHostedSinglePlayerTitle(hostname: string, search: string): boolean {
  return isHostedLakebedHostname(hostname)
    && new URLSearchParams(search).get("singleplayer") !== "1";
}

/** Returns the clean title URL without discarding unrelated local query flags. */
export function singlePlayerTitleUrl(value: string): string {
  const url = new URL(value);
  url.searchParams.delete("singleplayer");
  url.hash = "";
  return url.href;
}
