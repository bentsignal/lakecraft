import {
  DEFAULT_SUPERFLAT_GROUND_Y,
  SUPERFLAT_MAX_GROUND_Y,
  SUPERFLAT_MIN_GROUND_Y,
  type WorldPreset,
} from "../../../shared/worldPreset.ts";
import type { ServerGameMode } from "./protocol";
import type { ServerAccessMode } from "./database";

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
  agentToken?: string;
  dataDir: string;
  tickHz: number;
  snapshotHz: number;
  idleSuspendMs: number;
  maxPlayers: number;
  maxPersistedBlocks: number;
  allowedOrigins: string[];
  worldPreset: WorldPreset;
  superflatGroundY: number;
  defaultGameMode: ServerGameMode;
  spawnX: number;
  spawnZ: number;
  spawnYaw: number;
  accessMode: ServerAccessMode;
  serverPassword?: string;
  initialWhitelist: string[];
  daylightCycle: boolean;
  dayPhase: number;
}

export function loadConfig(env: Record<string, string | undefined> = Bun.env): ServerConfig {
  const authMode = env.AUTH_MODE ?? "lakebed";
  if (authMode !== "lakebed" && authMode !== "local-demo") {
    throw new Error("AUTH_MODE must be lakebed or local-demo");
  }
  const serverId = required(env.SERVER_ID, "SERVER_ID");
  const worldPreset = env.WORLD_PRESET ?? "default";
  if (worldPreset !== "default" && worldPreset !== "superflat") {
    throw new Error("WORLD_PRESET must be default or superflat");
  }
  const defaultGameMode = env.DEFAULT_GAME_MODE ?? "survival";
  if (defaultGameMode !== "survival" && defaultGameMode !== "creative") {
    throw new Error("DEFAULT_GAME_MODE must be survival or creative");
  }
  const requestedSuperflatGroundY = integer(
    env.SUPERFLAT_GROUND_Y,
    DEFAULT_SUPERFLAT_GROUND_Y,
    SUPERFLAT_MIN_GROUND_Y,
    SUPERFLAT_MAX_GROUND_Y,
    "SUPERFLAT_GROUND_Y",
  );
  const accessMode = env.ACCESS_MODE ?? "token";
  if (!["token", "public", "password", "whitelist", "closed"].includes(accessMode)) {
    throw new Error("ACCESS_MODE must be token, public, password, whitelist, or closed");
  }
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
    maxPlayers: integer(env.MAX_PLAYERS, 32, 1, 32, "MAX_PLAYERS"),
    maxPersistedBlocks: integer(env.MAX_PERSISTED_BLOCKS, 1_000_000, 1, 2_000_000, "MAX_PERSISTED_BLOCKS"),
    allowedOrigins: (env.ALLOWED_ORIGINS || "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    worldPreset,
    superflatGroundY: worldPreset === "superflat" ? requestedSuperflatGroundY : DEFAULT_SUPERFLAT_GROUND_Y,
    defaultGameMode,
    spawnX: decimal(env.SPAWN_X, 0.5, -1_000_000, 1_000_000, "SPAWN_X"),
    spawnZ: decimal(env.SPAWN_Z, 0.5, -1_000_000, 1_000_000, "SPAWN_Z"),
    spawnYaw: decimal(env.SPAWN_YAW_DEGREES, 0, -360, 360, "SPAWN_YAW_DEGREES") * Math.PI / 180,
    accessMode: accessMode as ServerAccessMode,
    initialWhitelist: (env.WHITELIST_USERNAMES || "").split(",").map((name) => name.trim()).filter(Boolean),
    daylightCycle: booleanValue(env.DAYLIGHT_CYCLE, true, "DAYLIGHT_CYCLE"),
    dayPhase: decimal(env.DAY_PHASE, 0.25, 0, 0.999999, "DAY_PHASE"),
  };

  if (env.ADMIN_TOKEN) {
    if (env.ADMIN_TOKEN.length < 24) throw new Error("ADMIN_TOKEN must be at least 24 characters");
    config.adminToken = env.ADMIN_TOKEN;
  }

  if (env.AGENT_TOKEN) {
    if (env.AGENT_TOKEN.length < 32) throw new Error("AGENT_TOKEN must be at least 32 characters");
    config.agentToken = env.AGENT_TOKEN;
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
  } else if (env.LOCAL_DEMO_TOKEN) {
    config.localDemoToken = env.LOCAL_DEMO_TOKEN;
    if (config.localDemoToken.length < 16) throw new Error("LOCAL_DEMO_TOKEN must be at least 16 characters");
  } else if (config.accessMode === "token") {
    throw new Error("LOCAL_DEMO_TOKEN is required when ACCESS_MODE=token");
  }
  if (accessMode === "password") {
    config.serverPassword = required(env.SERVER_PASSWORD, "SERVER_PASSWORD");
    if (config.serverPassword.length < 8 || config.serverPassword.length > 128) {
      throw new Error("SERVER_PASSWORD must be 8 to 128 characters");
    }
  }
  if (config.agentToken && [config.adminToken, config.localDemoToken, config.registrationCredential]
    .some((secret) => secret === config.agentToken)) {
    throw new Error("AGENT_TOKEN must be distinct from player, registration, and admin credentials");
  }
  return config;
}

function booleanValue(value: string | undefined, fallback: boolean, name: string): boolean {
  if (value === undefined) return fallback;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  throw new Error(`${name} must be true or false`);
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

function decimal(value: string | undefined, fallback: number, min: number, max: number, name: string): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be a finite number from ${min} to ${max}`);
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
