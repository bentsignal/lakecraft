import assert from "node:assert/strict";
import { advanceAuthoritativeFall, type StoredAuthoritativeFallState } from "../shared/fallDamageAuthority.ts";
import { decidePresenceSequence } from "../server/playerPresence.ts";

const sessionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
type Authority = {
  sequence: string;
  y: number;
  fall: StoredAuthoritativeFallState;
  health: number;
  revision: number;
  inventoryJson: string;
};

type Packet = { sequence: string; y: number; supported: boolean };

function deliver(state: Authority, packet: Packet): Authority {
  const sequence = decidePresenceSequence(sessionId, state.sequence, sessionId, packet.sequence);
  if (!sequence.accept) return state;
  const fall = advanceAuthoritativeFall({
    state: state.fall,
    previousY: state.y,
    nextY: packet.y,
    supported: packet.supported,
    onLadder: false,
    relocated: false,
    directDrop: Math.abs(state.y - packet.y) > 3,
    health: state.health,
    revision: state.revision,
  });
  assert.equal(fall.ok, true);
  if (!fall.ok) throw new Error(fall.reason);
  return {
    ...state,
    sequence: sequence.sequence,
    y: packet.y,
    fall: fall.state,
    health: fall.health,
    revision: fall.revision,
  };
}

const inventoryJson = JSON.stringify({
  slots: [{ item: "diamond_helmet", count: 1, durability: 120 }],
  equipment: { head: { item: "diamond_helmet", count: 1, durability: 120 } },
});
const initial: Authority = {
  sequence: "0",
  y: 20,
  fall: { grounded: true, fallPeakY: "20" },
  health: 20,
  revision: 9,
  inventoryJson,
};
const airborne = { sequence: "1", y: 14, supported: false };
const landed = { sequence: "2", y: 10, supported: true };

const ordered = deliver(deliver(initial, airborne), landed);
assert.deepEqual([ordered.health, ordered.revision], [13, 10]);
assert.equal(ordered.inventoryJson, inventoryJson, "fall damage leaves inventory and equipped armor byte-identical");

const landingWonRace = deliver(initial, landed);
const staleAirborne = deliver(landingWonRace, airborne);
assert.deepEqual([staleAirborne.health, staleAirborne.revision], [13, 10]);
assert.equal(staleAirborne, landingWonRace, "a stale airborne replay cannot apply or undo fall damage");

const replayedLanding = deliver(landingWonRace, landed);
assert.equal(replayedLanding, landingWonRace, "the same landing sequence is an identity-preserving no-op");

console.log("ordered authoritative fall presence tests passed");
