# Creative single-player combat QA

Use this smoke route when combat, explosives, inventory durability, death, or
respawn changes. It runs entirely in **Singleplayer** and must not create
Lakebed queries or mutations.

## Under-one-minute setup

Start or load a local world. Press `T` or `Enter` once; the command console
stays open after each command. Paste each line below and press `Enter`.

<!-- creative-qa-setup:start -->
```text
/gamemode creative
/give diamond_sword
/give diamond_chestplate
/give cobblestone 64
/give tnt 8
/give flint_and_steel
/give bow
/give arrow 16
```
<!-- creative-qa-setup:end -->

Press `Escape`, then:

1. Press `E` and shift-click the diamond chestplate to equip it.
2. Put two TNT blocks side by side on open ground.
3. Make a two-block-high cobblestone wall four or five blocks from them.
4. Keep the sword, flint and steel, and bow in hotbar slots.
5. Press `T`, run `/gamemode survival`, then press `Escape`.

Creative is deliberately only the setup phase. Survival must be active for
weapon and armor wear, arrow consumption, player damage, death drops, and
respawn settlement. If the HUD still says Creative, those observations are not
valid.

## Subjective checklist

### Melee, armor, and hostile cover

- Miss once, then hit a mob. A miss does not change sword durability; each
  confirmed health-reducing hit removes exactly one point.
- Let a zombie, skeleton, or spider land one hit. Health falls once, the
  equipped chestplate loses one durability, and its protection reduces damage.
- At night, draw a creeper toward the cobblestone wall. A full-height solid wall
  blocks or reduces the blast; torches, ladders, and open doors do not count as
  blast cover. The terrain changes once and the creeper cannot damage twice.

### TNT ignition, cover, armor, and chain fuse

- Right-click the first TNT with flint and steel. It primes once, shows fuse
  feedback, and the manual ignition removes exactly one tool durability.
- The first TNT explodes after about four seconds. The adjacent TNT receives a
  visibly shorter secondary fuse and then explodes once; neither TNT produces a
  mining drop.
- Repeat once behind the full wall and once exposed. Solid cover reduces or
  removes damage. With the chestplate equipped, accepted positive damage is
  mitigated and wears the armor once.

### Bow draw, release, ammunition, and hits

- Hold right click: the bow advances through its draw poses. Release early and
  then at full draw; the full shot is faster and stronger.
- Cancel one draw with `Escape` or a UI. Cancellation spends no arrow or bow
  durability.
- Each release, including a miss, spends exactly one arrow and one bow
  durability in Survival. A projectile is visible and a targeted hit flashes
  and damages the mob exactly once.
- Ctrl/Cmd+`Q` the arrow stack, select the bow, and confirm it cannot start a
  shot without ammunition. Restore it with `/give arrow 16`.

### Death drops and respawn

- Unequip the chestplate if a faster death is needed, then stand exposed to TNT
  until the death screen reports `Blown up by TNT`.
- Click **Respawn** once. The pack and equipped armor clear together, conserved
  item drops appear around the locked death position, and health/hunger return
  at the saved bed or deterministic world spawn.
- Walk back through the drops. Each stack is collected at most once; worn
  sword, bow, flint-and-steel, and armor durability is preserved, with no
  missing or duplicated items.

## Automated smoke

Run the setup-contract test together with the existing focused authorities:

```sh
node --experimental-transform-types --test \
  tests/creativeCombatQa.test.ts \
  tests/localCommandConsole.test.ts \
  tests/singlePlayerWeaponDurability.test.ts \
  tests/singlePlayerArmorDamageIntegration.test.ts \
  tests/localCreeperExposure.test.ts \
  tests/singlePlayerTnt.test.ts \
  tests/localTntPlayerDamage.test.ts \
  tests/tntChainAuthority.test.ts \
  tests/singlePlayerBowIntegration.test.ts \
  tests/deathDrops.test.ts \
  tests/localRespawnSafetyIntegration.test.ts \
  tests/singlePlayerDeathLifecycle.test.ts
```

The command preset is executable documentation: the first test parses the
marked block through the production command parser, applies every grant
atomically to a starter inventory, equips the documented armor, switches back
to Survival, and proves that the prepared carried state can settle into
conserved death drops. The remaining tests own the detailed combat, cover, TNT,
bow, durability, and respawn invariants.
