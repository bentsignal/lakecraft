const LAKEBED_HOST_SUFFIX = ".lakebed.app";
export const AUTH_CALLBACK_PATH = "/auth/callback";

/** Identifies the Lakebed control-plane origin without changing the selected game mode. */
export function isHostedLakebedHostname(value: string): boolean {
  const hostname = value.trim().toLowerCase().replace(/\.+$/, "");
  return hostname === "lakebed.app" || hostname.endsWith(LAKEBED_HOST_SUFFIX);
}

export function shouldRunSinglePlayer(hostname: string, search: string): boolean {
  void hostname;
  return new URLSearchParams(search).get("singleplayer") === "1";
}

/** Multiplayer owns a Lakebed-served URL so auth never mounts on the title route. */
export function shouldRunMultiplayer(search: string): boolean {
  return new URLSearchParams(search).get("multiplayer") === "1";
}

export type LakecraftAppRoute = "title" | "singleplayer" | "multiplayer" | "auth_callback";

export function appRouteForLocation(hostname: string, pathname: string, search: string): LakecraftAppRoute {
  if (pathname === AUTH_CALLBACK_PATH) return "auth_callback";
  if (shouldRunSinglePlayer(hostname, search)) return "singleplayer";
  if (shouldRunMultiplayer(search)) return "multiplayer";
  return "title";
}

export function multiplayerUrl(value: string): string {
  const url = new URL(value);
  url.pathname = "/";
  url.searchParams.delete("singleplayer");
  url.searchParams.set("multiplayer", "1");
  url.hash = "";
  return url.href;
}

export function titleUrl(value: string): string {
  const url = new URL(value);
  url.pathname = "/";
  url.searchParams.delete("singleplayer");
  url.searchParams.delete("multiplayer");
  url.hash = "";
  return url.href;
}

/** Retained for older callers; the unified title screen now owns hosted entry. */
export function shouldShowHostedSinglePlayerTitle(hostname: string, search: string): boolean {
  void hostname;
  void search;
  return false;
}

/** Returns the clean title URL without discarding unrelated local query flags. */
export function singlePlayerTitleUrl(value: string): string {
  return titleUrl(value);
}
