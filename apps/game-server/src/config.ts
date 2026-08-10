export interface ServerConfig {
  host: string;
  port: number;
  serverId: string;
  serverName: string;
  serverDescription: string;
  authMode: "lakebed" | "local-demo";
  ticketRedeemUrl?: string;
  registrationCredential?: string;
  localDemoToken?: string;
  adminToken?: string;
  dataDir: string;
  tickHz: number;
  snapshotHz: number;
  idleSuspendMs: number;
  maxPlayers: number;
  maxPersistedBlocks: number;
  allowedOrigins: string[];
}

export function loadConfig(env: Record<string, string | undefined> = Bun.env): ServerConfig {
  const authMode = env.AUTH_MODE ?? "lakebed";
  if (authMode !== "lakebed" && authMode !== "local-demo") {
    throw new Error("AUTH_MODE must be lakebed or local-demo");
  }
  const serverId = required(env.SERVER_ID, "SERVER_ID");
  const config: ServerConfig = {
    host: env.HOST || "0.0.0.0",
    port: integer(env.PORT, 3001, 1, 65_535, "PORT"),
    serverId,
    serverName: (env.PUBLIC_SERVER_NAME || "Lakecraft Server").slice(0, 64),
    serverDescription: (env.PUBLIC_SERVER_DESCRIPTION || "A community-hosted Lakecraft world").slice(0, 160),
    authMode,
    dataDir: env.DATA_DIR || "./data",
    tickHz: integer(env.TICK_HZ, 20, 5, 60, "TICK_HZ"),
    snapshotHz: integer(env.SNAPSHOT_HZ, 10, 1, 30, "SNAPSHOT_HZ"),
    idleSuspendMs: integer(env.IDLE_SUSPEND_MS, 15_000, 0, 300_000, "IDLE_SUSPEND_MS"),
    maxPlayers: integer(env.MAX_PLAYERS, 32, 1, 128, "MAX_PLAYERS"),
    maxPersistedBlocks: integer(env.MAX_PERSISTED_BLOCKS, 1_000, 1, 1_000, "MAX_PERSISTED_BLOCKS"),
    allowedOrigins: (env.ALLOWED_ORIGINS || "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  };

  if (env.ADMIN_TOKEN) {
    if (env.ADMIN_TOKEN.length < 24) throw new Error("ADMIN_TOKEN must be at least 24 characters");
    config.adminToken = env.ADMIN_TOKEN;
  }

  if (authMode === "lakebed") {
    if (config.allowedOrigins.length === 0) {
      throw new Error("ALLOWED_ORIGINS is required when AUTH_MODE=lakebed");
    }
    config.ticketRedeemUrl = required(env.LAKEBED_TICKET_REDEEM_URL, "LAKEBED_TICKET_REDEEM_URL");
    config.registrationCredential = required(
      env.LAKEBED_REGISTRATION_CREDENTIAL,
      "LAKEBED_REGISTRATION_CREDENTIAL",
    );
    assertSecureRedeemUrl(config.ticketRedeemUrl);
  } else {
    config.localDemoToken = required(env.LOCAL_DEMO_TOKEN, "LOCAL_DEMO_TOKEN");
    if (config.localDemoToken.length < 16) throw new Error("LOCAL_DEMO_TOKEN must be at least 16 characters");
  }
  return config;
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function integer(value: string | undefined, fallback: number, min: number, max: number, name: string): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  }
  return parsed;
}

function assertSecureRedeemUrl(value: string): void {
  const url = new URL(value);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error("LAKEBED_TICKET_REDEEM_URL must use HTTPS (HTTP is allowed only on loopback)");
  }
}
