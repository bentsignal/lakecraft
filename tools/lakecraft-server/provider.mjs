const DEFAULT_HEALTH_PATH = "/status";
const DEFAULT_WEBSOCKET_PATH = "/ws";
const AUTH_MODES = new Set(["lakebed", "local-demo"]);

function requireNonEmpty(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function publicCandidate(explicitUrl, env) {
  if (explicitUrl) return explicitUrl;
  if (env.LAKECRAFT_PUBLIC_URL) return env.LAKECRAFT_PUBLIC_URL;
  if (env.RAILWAY_PUBLIC_DOMAIN) return env.RAILWAY_PUBLIC_DOMAIN;
  throw new Error(
    "No server URL was supplied. Pass one, set LAKECRAFT_PUBLIC_URL, or run inside Railway with public networking enabled.",
  );
}

function parsePublicUrl(candidate) {
  const raw = requireNonEmpty(candidate, "Server URL");
  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error(`Invalid server URL: ${raw}`);
  }
  if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) {
    throw new Error("Server URL must use http, https, ws, or wss.");
  }
  if (url.username || url.password) throw new Error("Server URLs must not contain credentials.");
  if (url.search || url.hash) {
    throw new Error("Server URLs must not contain query parameters or fragments; share access tokens separately.");
  }
  return url;
}

function replaceProtocol(url, protocol) {
  const copy = new URL(url.href);
  copy.protocol = protocol;
  return copy;
}

function normalizePath(pathname, expectedPath) {
  const path = pathname.replace(/\/+$/, "");
  if (!path) return expectedPath;
  if (path === DEFAULT_HEALTH_PATH || path === DEFAULT_WEBSOCKET_PATH) return expectedPath;
  throw new Error(
    `Server URL path must be empty, ${DEFAULT_HEALTH_PATH}, or ${DEFAULT_WEBSOCKET_PATH}; received ${pathname}.`,
  );
}

export function connectionInfo({ explicitUrl, env = process.env } = {}) {
  const parsed = parsePublicUrl(publicCandidate(explicitUrl, env));
  const secure = parsed.protocol === "https:" || parsed.protocol === "wss:";
  const health = replaceProtocol(parsed, secure ? "https:" : "http:");
  const websocket = replaceProtocol(parsed, secure ? "wss:" : "ws:");
  health.pathname = normalizePath(parsed.pathname, DEFAULT_HEALTH_PATH);
  websocket.pathname = normalizePath(parsed.pathname, DEFAULT_WEBSOCKET_PATH);
  return Object.freeze({
    directConnectUrl: websocket.href,
    healthUrl: health.href,
    provider: env.RAILWAY_PUBLIC_DOMAIN ? "railway" : "custom",
    serverName: env.PUBLIC_SERVER_NAME?.trim() || "Lakecraft Server",
  });
}

export function inspectEnvironment(env = process.env) {
  const errors = [];
  const warnings = [];
  const provider = env.RAILWAY_ENVIRONMENT_ID || env.RAILWAY_PUBLIC_DOMAIN ? "railway" : "custom";
  const volumePath = env.RAILWAY_VOLUME_MOUNT_PATH?.trim() || null;
  const dataDir = env.DATA_DIR?.trim() || volumePath || "./data";
  const authMode = env.AUTH_MODE?.trim() || "lakebed";

  if (!AUTH_MODES.has(authMode)) errors.push("AUTH_MODE must be lakebed or local-demo.");
  if (!env.SERVER_ID?.trim()) errors.push("SERVER_ID is required in every auth mode.");
  if (authMode === "lakebed") {
    for (const name of ["LAKEBED_TICKET_REDEEM_URL", "LAKEBED_REGISTRATION_CREDENTIAL"]) {
      if (!env[name]?.trim()) errors.push(`${name} is required when AUTH_MODE=lakebed.`);
    }
  }
  if (authMode === "local-demo" && !env.LOCAL_DEMO_TOKEN?.trim()) {
    errors.push("LOCAL_DEMO_TOKEN is required when AUTH_MODE=local-demo.");
  }
  if (provider === "railway") {
    if (!volumePath) errors.push("Attach a Railway volume at /data before starting the server.");
    if (volumePath && dataDir !== volumePath) {
      warnings.push(`DATA_DIR (${dataDir}) does not match RAILWAY_VOLUME_MOUNT_PATH (${volumePath}).`);
    }
    if (!env.RAILWAY_PUBLIC_DOMAIN?.trim()) {
      warnings.push("Enable Railway HTTP public networking and generate a domain before sharing the server.");
    }
  }
  if (!env.ALLOWED_ORIGINS?.trim()) {
    const message = "ALLOWED_ORIGINS is unset; set it to the exact Lakecraft web origin before inviting players.";
    if (authMode === "lakebed") errors.push(message);
    else warnings.push(message);
  }

  return Object.freeze({ authMode, dataDir, errors, provider, volumePath, warnings });
}

export function validateTemplatePlan(plan) {
  const problems = [];
  if (plan?.format !== "lakecraft.railway-template-plan.v1") problems.push("unexpected format");
  if (plan?.service?.sourceRoot !== "/apps/game-server") problems.push("sourceRoot must be /apps/game-server");
  if (plan?.service?.configFile !== "/apps/game-server/railway.json") {
    problems.push("configFile must be /apps/game-server/railway.json");
  }
  if (plan?.service?.volume?.mountPath !== "/data" || plan?.service?.volume?.required !== true) {
    problems.push("a required /data volume is missing");
  }
  if (plan?.service?.publicNetworking?.type !== "HTTP") problems.push("HTTP public networking is required");
  if (plan?.service?.replicas !== 1) problems.push("the SQLite service must use exactly one replica");
  const variables = new Map((plan?.variables ?? []).map((entry) => [entry.name, entry]));
  for (const name of ["AUTH_MODE", "LOCAL_DEMO_TOKEN", "SERVER_ID", "PUBLIC_SERVER_NAME", "ALLOWED_ORIGINS"]) {
    if (!variables.has(name)) problems.push(`template variable ${name} is missing`);
  }
  if (variables.get("LOCAL_DEMO_TOKEN")?.templateValue !== "${{ secret(32) }}") {
    problems.push("LOCAL_DEMO_TOKEN must use Railway's secret generator");
  }
  return problems;
}

export const protocolPaths = Object.freeze({
  health: DEFAULT_HEALTH_PATH,
  websocket: DEFAULT_WEBSOCKET_PATH,
});
