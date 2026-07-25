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
