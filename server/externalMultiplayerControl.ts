export const EXTERNAL_MULTIPLAYER_TICKET_TTL_MS = 45_000;
export const EXTERNAL_MULTIPLAYER_SECRET_BYTES = 32;
export const EXTERNAL_MULTIPLAYER_MAX_NAME_LENGTH = 48;
export const EXTERNAL_MULTIPLAYER_MAX_DESCRIPTION_LENGTH = 160;

const SERVER_CREDENTIAL_PREFIX = "lcs_";
const JOIN_TICKET_PREFIX = "lcj_";
const HEX_SECRET = /^[a-f0-9]{64}$/;

export type ExternalMultiplayerServerInput = {
  name: string;
  description: string;
  canonicalWssUrl: string;
};

export type ValidatedExternalMultiplayerServerInput = {
  ok: true;
  name: string;
  description: string;
  canonicalWssUrl: string;
};

function cleanSingleLine(value: unknown, maximumLength: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/\s+/g, " ");
  return cleaned.length >= 1 && cleaned.length <= maximumLength ? cleaned : null;
}

export function canonicalizeExternalMultiplayerWssUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length < 9 || value.length > 512) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== "wss:" || parsed.username || parsed.password || parsed.search || parsed.hash) return null;
  if (!parsed.hostname || parsed.pathname.includes("//")) return null;
  const pathname = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/$/, "");
  return `${parsed.origin}${pathname}`;
}

export function validateExternalMultiplayerServerInput(
  value: unknown,
): ValidatedExternalMultiplayerServerInput | { ok: false; reason: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, reason: "invalid_server" };
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== "canonicalWssUrl,description,name") {
    return { ok: false, reason: "invalid_server" };
  }
  const name = cleanSingleLine(record.name, EXTERNAL_MULTIPLAYER_MAX_NAME_LENGTH);
  if (!name) return { ok: false, reason: "invalid_name" };
  const description = typeof record.description === "string"
    ? record.description.trim().replace(/\s+/g, " ")
    : "";
  if (description.length > EXTERNAL_MULTIPLAYER_MAX_DESCRIPTION_LENGTH) {
    return { ok: false, reason: "invalid_description" };
  }
  const canonicalWssUrl = canonicalizeExternalMultiplayerWssUrl(record.canonicalWssUrl);
  if (!canonicalWssUrl) return { ok: false, reason: "invalid_wss_url" };
  return { ok: true, name, description, canonicalWssUrl };
}

export function secureExternalMultiplayerSecret(prefix: "lcs_" | "lcj_"): string | null {
  if (typeof crypto !== "object" || typeof crypto.getRandomValues !== "function") return null;
  const bytes = new Uint8Array(EXTERNAL_MULTIPLAYER_SECRET_BYTES);
  crypto.getRandomValues(bytes);
  return `${prefix}${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function newExternalMultiplayerServerCredential(): string | null {
  return secureExternalMultiplayerSecret(SERVER_CREDENTIAL_PREFIX);
}

export function newExternalMultiplayerJoinTicket(): string | null {
  return secureExternalMultiplayerSecret(JOIN_TICKET_PREFIX);
}

export function validExternalMultiplayerServerCredential(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(SERVER_CREDENTIAL_PREFIX)
    && HEX_SECRET.test(value.slice(SERVER_CREDENTIAL_PREFIX.length));
}

export function validExternalMultiplayerJoinTicket(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(JOIN_TICKET_PREFIX)
    && HEX_SECRET.test(value.slice(JOIN_TICKET_PREFIX.length));
}

export async function hashExternalMultiplayerSecret(value: string): Promise<string | null> {
  if (typeof crypto !== "object" || !crypto.subtle) return null;
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(value, (character) => character.charCodeAt(0)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function externalMultiplayerTicketIsRedeemable(
  ticket: { serverId?: unknown; issuedAt?: unknown; expiresAt?: unknown },
  serverId: string,
  now: number,
): boolean {
  if (ticket.serverId !== serverId
    || typeof ticket.issuedAt !== "string" || !/^\d{1,16}$/.test(ticket.issuedAt)
    || typeof ticket.expiresAt !== "string" || !/^\d{1,16}$/.test(ticket.expiresAt)) {
    return false;
  }
  const issuedAt = Number(ticket.issuedAt);
  const expiresAt = Number(ticket.expiresAt);
  return Number.isSafeInteger(now) && Number.isSafeInteger(issuedAt) && Number.isSafeInteger(expiresAt)
    && issuedAt <= now && expiresAt === issuedAt + EXTERNAL_MULTIPLAYER_TICKET_TTL_MS && expiresAt > now;
}

export function bearerExternalMultiplayerCredential(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(/^Bearer ([A-Za-z0-9_-]+)$/);
  return match && validExternalMultiplayerServerCredential(match[1]) ? match[1] : null;
}
