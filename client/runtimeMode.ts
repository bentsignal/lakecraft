const LAKEBED_HOST_SUFFIX = ".lakebed.app";

/** Identifies the Lakebed control-plane origin without changing the selected game mode. */
export function isHostedLakebedHostname(value: string): boolean {
  const hostname = value.trim().toLowerCase().replace(/\.+$/, "");
  return hostname === "lakebed.app" || hostname.endsWith(LAKEBED_HOST_SUFFIX);
}

export function shouldRunSinglePlayer(hostname: string, search: string): boolean {
  void hostname;
  return new URLSearchParams(search).get("singleplayer") === "1";
}

/** Retained for older callers; the unified title screen now owns hosted entry. */
export function shouldShowHostedSinglePlayerTitle(hostname: string, search: string): boolean {
  void hostname;
  void search;
  return false;
}

/** Returns the clean title URL without discarding unrelated local query flags. */
export function singlePlayerTitleUrl(value: string): string {
  const url = new URL(value);
  url.searchParams.delete("singleplayer");
  url.hash = "";
  return url.href;
}
