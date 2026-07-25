import assert from "node:assert/strict";
import { advanceAuthoritativeSurvival } from "../shared/survivalAuthority.ts";

type State = { health: number; hunger: number; revision: number };
type Event = "regen" | "starve" | "pvp" | "mob";

function permutations<T>(values: T[]): T[][] {
  return values.length <= 1
    ? [values]
    : values.flatMap((value, index) => permutations(values.filter((_, candidate) => candidate !== index))
      .map((tail) => [value, ...tail]));
}

function damage(state: State, amount: number): State {
  if (state.health <= 0 || amount <= 0) return state;
  return { ...state, health: Math.max(0, state.health - amount), revision: state.revision + 1 };
}

function survivalEvent(state: State, event: "regen" | "starve"): State {
  const result = advanceAuthoritativeSurvival({
    ...state,
    progress: {
      survivalAt: "1000",
      hungerProgressHalfMs: "0",
      recoveryProgressMs: event === "regen" ? "3999" : "0",
      starvationProgressMs: event === "starve" ? "3999" : "0",
    },
    serverNow: 1001,
    activityHalfUnits: 1,
  });
  return { health: result.health, hunger: result.hunger, revision: result.revision };
}

function apply(state: State, event: Event): State {
  if (event === "regen" || event === "starve") return survivalEvent(state, event);
  return damage(state, event === "pvp" ? 4 : 3);
}

for (const order of permutations<Event>(["regen", "pvp", "mob"])) {
  const result = order.reduce(apply, { health: 10, hunger: 20, revision: 5 });
  assert.deepEqual(result, { health: 4, hunger: 19, revision: 8 }, `serialized order stays canonical: ${order.join("→")}`);
}

for (const order of permutations<Event>(["starve", "pvp", "mob"])) {
  const result = order.reduce((state, event) => event === "starve"
    ? survivalEvent(state, event)
    : damage(state, 1), { health: 4, hunger: 0, revision: 5 });
  assert.deepEqual(result, { health: 1, hunger: 0, revision: 8 }, `starvation/PvP/mob share one revision line: ${order.join("→")}`);
}

const killedFirst = survivalEvent(damage({ health: 1, hunger: 0, revision: 2 }, 1), "starve");
assert.deepEqual(killedFirst, { health: 0, hunger: 0, revision: 3 }, "dead survival is a zero-revision no-op");
const starvedAtFloor = survivalEvent({ health: 1, hunger: 0, revision: 2 }, "starve");
assert.deepEqual(starvedAtFloor, { health: 1, hunger: 0, revision: 2 }, "starvation floor consumes no revision");

console.log("survival/combat serialized ordering tests passed");
