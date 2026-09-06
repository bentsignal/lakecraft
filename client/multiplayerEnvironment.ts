const PRODUCTION_WORLD_HOSTS = new Set([
  "lake" + "craft-production.up.railway.app",
  "lake" + "craft-creative-production.up.railway.app",
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
