import type { ServerConfig } from "./config";
import type { ClientMessage } from "./protocol";
import type { WorldStore } from "./database";

type JoinMessage = Extract<ClientMessage, { type: "join" }>;

export interface AuthPrincipal {
  userId: string;
  displayName: string;
  initialInventoryJson?: string;
}

export interface JoinAuthenticator {
  authenticate(message: JoinMessage): Promise<AuthPrincipal>;
}

export function createAuthenticator(config: ServerConfig, store: WorldStore): JoinAuthenticator {
  return config.authMode === "local-demo"
    ? new LocalDemoAuthenticator()
    : new LakebedTicketAuthenticator(
        config.serverId,
        config.ticketRedeemUrl!,
        config.registrationCredential!,
        store,
      );
}

class LocalDemoAuthenticator implements JoinAuthenticator {
  async authenticate(message: JoinMessage): Promise<AuthPrincipal> {
    const demo = message.demo;
    if (!demo) throw new Error("A local player identity is required");
    // Local-demo is the only mode where client-provided identity is intentionally accepted.
    return {
      userId: sanitizeId(demo.userId),
      displayName: sanitizeName(demo.name),
      ...(demo.inventoryJson === undefined ? {} : { initialInventoryJson: demo.inventoryJson }),
    };
  }
}

class LakebedTicketAuthenticator implements JoinAuthenticator {
  constructor(
    private readonly serverId: string,
    private readonly redeemUrl: string,
    private readonly registrationCredential: string,
    private readonly store: WorldStore,
  ) {}

  async authenticate(message: JoinMessage): Promise<AuthPrincipal> {
    if (!message.ticket) throw new Error("A Lakebed join ticket is required");
    if (message.serverId !== undefined && message.serverId !== this.serverId) {
      throw new Error("Join ticket was presented to the wrong server");
    }
    const response = await fetch(this.redeemUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.registrationCredential}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ ticket: message.ticket, serverId: this.serverId }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error("Lakebed rejected the join ticket");
    const payload: unknown = await response.json();
    if (!isRedeemResponse(payload)) throw new Error("Lakebed returned an invalid ticket response");
    if (payload.serverId !== this.serverId) throw new Error("Join ticket is not scoped to this server");
    const now = Date.now();
    if (payload.expiresAt <= now || payload.expiresAt > now + 65_000) {
      throw new Error("Join ticket is expired or has an invalid lifetime");
    }
    if (!this.store.consumeTicket(payload.ticketId, now)) throw new Error("Join ticket was already used");
    return {
      userId: sanitizeId(payload.userId),
      displayName: sanitizeName(payload.displayName),
      ...(payload.inventoryJson === undefined ? {} : { initialInventoryJson: payload.inventoryJson }),
    };
  }
}

interface RedeemResponse {
  userId: string;
  displayName: string;
  ticketId: string;
  serverId: string;
  expiresAt: number;
  inventoryJson?: string;
}

function isRedeemResponse(value: unknown): value is RedeemResponse {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.userId === "string" && item.userId.length > 0 && item.userId.length <= 128 &&
    typeof item.displayName === "string" && item.displayName.length > 0 && item.displayName.length <= 64 &&
    typeof item.ticketId === "string" && item.ticketId.length > 0 && item.ticketId.length <= 256 &&
    typeof item.serverId === "string" && item.serverId.length > 0 && item.serverId.length <= 128 &&
    typeof item.expiresAt === "number" && Number.isFinite(item.expiresAt) &&
    (item.inventoryJson === undefined || (typeof item.inventoryJson === "string" && item.inventoryJson.length <= 16_384))
  );
}

function sanitizeId(value: string): string {
  const clean = value.trim();
  if (!/^[a-zA-Z0-9:_-]{1,128}$/.test(clean)) throw new Error("Identity id is invalid");
  return clean;
}

function sanitizeName(value: string): string {
  const clean = value.trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 32);
  if (!clean) throw new Error("Identity name is invalid");
  return clean;
}
