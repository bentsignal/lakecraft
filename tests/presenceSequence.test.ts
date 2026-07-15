import assert from "node:assert/strict";
import { decidePresenceSequence } from "../server/playerPresence.ts";

const sessionA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const sessionB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

assert.deepEqual(decidePresenceSequence(sessionA, "0", sessionA, "1"), { accept: true, sequence: "1" });
assert.deepEqual(decidePresenceSequence(sessionA, "1", sessionA, "2"), { accept: true, sequence: "2" });
assert.deepEqual(decidePresenceSequence(sessionA, "1", sessionA, "3"), { accept: true, sequence: "3" }, "lost request gaps are valid");
assert.deepEqual(decidePresenceSequence(sessionA, "2", sessionA, "2"), { accept: false, reason: "stale_sequence" });
assert.deepEqual(decidePresenceSequence(sessionA, "2", sessionA, "1"), { accept: false, reason: "stale_sequence" });
assert.deepEqual(decidePresenceSequence(sessionB, "0", sessionA, "99"), { accept: false, reason: "session_mismatch" });
assert.deepEqual(decidePresenceSequence("", "4", sessionA, "5"), { accept: false, reason: "session_mismatch" }, "leave revokes delayed requests");

for (const invalid of ["", "0", "-1", "1.1", "01x", "9007199254740992", "1".repeat(17)]) {
  assert.deepEqual(
    decidePresenceSequence(sessionA, "0", sessionA, invalid),
    { accept: false, reason: "invalid_sequence" },
    `invalid requested sequence is rejected: ${invalid}`,
  );
}
assert.deepEqual(decidePresenceSequence(sessionA, "broken", sessionA, "1"), { accept: false, reason: "invalid_sequence" });

type OrderedPose = { sessionId: string; poseSequence: string; x: number };
function deliver(initial: OrderedPose, packets: OrderedPose[]): OrderedPose {
  return packets.reduce((stored, packet) => {
    const decision = decidePresenceSequence(stored.sessionId, stored.poseSequence, packet.sessionId, packet.poseSequence);
    return decision.accept ? { ...packet, poseSequence: decision.sequence } : stored;
  }, initial);
}
const initial = { sessionId: sessionA, poseSequence: "0", x: 0 };
const packet1 = { sessionId: sessionA, poseSequence: "1", x: 1 };
const packet2 = { sessionId: sessionA, poseSequence: "2", x: 2 };
assert.deepEqual(deliver(initial, [packet1, packet2]), packet2);
assert.deepEqual(deliver(initial, [packet2, packet1]), packet2, "arrival order cannot roll pose backward");
assert.deepEqual(deliver(initial, [packet2, packet2, packet1]), packet2, "duplicates and replays are byte-stable no-ops");
assert.deepEqual(deliver({ sessionId: sessionB, poseSequence: "0", x: 8 }, [packet2]), { sessionId: sessionB, poseSequence: "0", x: 8 });

console.log("presence sequence authority tests passed");
