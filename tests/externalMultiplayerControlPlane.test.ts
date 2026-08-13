import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  EXTERNAL_MULTIPLAYER_TICKET_TTL_MS,
  bearerExternalMultiplayerCredential,
  canonicalizeExternalMultiplayerWssUrl,
  externalMultiplayerTicketIsRedeemable,
  hashExternalMultiplayerSecret,
  newExternalMultiplayerJoinTicket,
  newExternalMultiplayerServerCredential,
  validExternalMultiplayerJoinTicket,
  validExternalMultiplayerServerCredential,
  validateExternalMultiplayerServerInput,
} from "../server/externalMultiplayerControl.ts";

async function main() {
assert.equal(EXTERNAL_MULTIPLAYER_TICKET_TTL_MS, 45_000);
assert.equal(canonicalizeExternalMultiplayerWssUrl("wss://Example.COM/"), "wss://example.com");
assert.equal(canonicalizeExternalMultiplayerWssUrl("wss://Example.COM/game/"), "wss://example.com/game");
for (const invalid of [
  "ws://example.com",
  "https://example.com",
  "wss://user:pass@example.com",
  "wss://example.com/game?ticket=secret",
  "wss://example.com/#fragment",
  "not a url",
]) assert.equal(canonicalizeExternalMultiplayerWssUrl(invalid), null, `must reject non-canonical WSS URL: ${invalid}`);

assert.deepEqual(validateExternalMultiplayerServerInput({
  name: "  Fern   Hollow  ",
  description: "  Friends   survival  ",
  canonicalWssUrl: "wss://fern.example/game/",
}), {
  ok: true,
  name: "Fern Hollow",
  description: "Friends survival",
  canonicalWssUrl: "wss://fern.example/game",
});
assert.deepEqual(validateExternalMultiplayerServerInput({
  name: "Fern",
  description: "",
  canonicalWssUrl: "wss://fern.example",
  ownerUserId: "client-forged",
}), { ok: false, reason: "invalid_server" }, "registration rejects client-supplied ownership fields");

const credential = newExternalMultiplayerServerCredential();
const ticket = newExternalMultiplayerJoinTicket();
assert.ok(credential && validExternalMultiplayerServerCredential(credential));
assert.ok(ticket && validExternalMultiplayerJoinTicket(ticket));
assert.equal(validExternalMultiplayerServerCredential(ticket), false);
assert.equal(validExternalMultiplayerJoinTicket(credential), false);
assert.equal(bearerExternalMultiplayerCredential(`Bearer ${credential}`), credential);
assert.equal(bearerExternalMultiplayerCredential(`bearer ${credential}`), null);
assert.equal(bearerExternalMultiplayerCredential(`${credential}`), null);

assert.equal(
  await hashExternalMultiplayerSecret("abc"),
  "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  "credential and ticket digests use standard SHA-256",
);
assert.equal(externalMultiplayerTicketIsRedeemable({ serverId: "server-a", issuedAt: "1000", expiresAt: "46000" }, "server-a", 1000), true);
assert.equal(externalMultiplayerTicketIsRedeemable({ serverId: "server-b", issuedAt: "1000", expiresAt: "46000" }, "server-a", 1000), false);
assert.equal(externalMultiplayerTicketIsRedeemable({ serverId: "server-a", issuedAt: "1000", expiresAt: "45999" }, "server-a", 1000), false);
assert.equal(externalMultiplayerTicketIsRedeemable({ serverId: "server-a", issuedAt: "1000", expiresAt: "46000" }, "server-a", 46000), false);
assert.equal(externalMultiplayerTicketIsRedeemable({ serverId: "server-a", issuedAt: "1001", expiresAt: "46001" }, "server-a", 1000), false);
assert.equal(externalMultiplayerTicketIsRedeemable({ serverId: "server-a", issuedAt: "1000", expiresAt: "invalid" }, "server-a", 1000), false);

const serverSource = readFileSync(new URL("../server/index.ts", import.meta.url), "utf8");
for (const marker of [
  "externalMultiplayerServers: table({",
  "externalMultiplayerJoinTickets: table({",
  "registerExternalMultiplayerServer: mutation",
  "rotateExternalMultiplayerServerCredential: mutation",
  "setExternalMultiplayerServerActive: mutation",
  "createExternalMultiplayerJoinTicket: mutation",
  'path: "/api/multiplayer/redeem-join-ticket"',
  "bearerExternalMultiplayerCredential(req.headers.get(\"authorization\"))",
  "externalMultiplayerTicketIsRedeemable(ticket, server.id, serverNow)",
  "await ctx.db.externalMultiplayerJoinTickets.delete(ticket.id)",
  "profiles.length === 1",
]) assert.ok(serverSource.includes(marker), `missing external multiplayer control-plane integration: ${marker}`);

const registration = serverSource.slice(
  serverSource.indexOf("registerExternalMultiplayerServer: mutation"),
  serverSource.indexOf("claimUsername: mutation"),
);
assert.ok(registration.includes("ctx.auth.userId"), "registration ownership comes only from authenticated Lakebed identity");
assert.equal(/rawServer\.(ownerUserId|userId|email)/.test(registration), false);

const redemption = serverSource.slice(serverSource.indexOf("redeemExternalMultiplayerJoinTicket: endpoint"));
assert.equal(/body\.(userId|email|username)/.test(redemption), false, "redemption never trusts client identity data");
assert.ok(
  redemption.includes('(body as { serverId?: unknown }).serverId !== server.id'),
  "the request server id is checked against the registration resolved from its bearer credential",
);
assert.ok(
  redemption.indexOf("externalMultiplayerTicketIsRedeemable") < redemption.lastIndexOf("externalMultiplayerJoinTickets.delete(ticket.id)"),
  "the scoped unexpired ticket is checked before its one-use burn",
);

console.log("external multiplayer Lakebed control-plane tests passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
