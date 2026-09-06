const PRODUCTION_WORLD_HOSTS = new Set([
  "lakecraft-production.up.railway.app",
  "lakecraft-creative-production.up.railway.app",
]);

export function permitsMultiplayerEndpoint(origin: string, endpoint: string): boolean {
  try {
    const target = new URL(endpoint);
    if (target.protocol !== "wss:" || target.username || target.password) return false;
    return !PRODUCTION_WORLD_HOSTS.has(target.hostname) || origin === "https://craft.lakebed.app";
  } catch {
    return false;
  }
}
