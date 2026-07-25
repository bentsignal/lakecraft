# First-person viewmodel reference and acceptance

Lakecraft's first-person models are original geometry and colors built from the
project's existing item catalog and texture atlas. No Minecraft texture, model,
or source asset is included.

## References inspected

| Pose | Reference signal | Lakecraft interpretation |
| --- | --- | --- |
| Empty hand | [How to Minecraft](https://www.minecraft.net/en-us/article/how-minecraft) introduces the player's hand, first mining tool, bare-fist combat, and items held from the hotbar. The [HUD history](https://minecraft.fandom.com/wiki/Heads-up_display) records a camera-facing hand and walking hand animation. | A joined turquoise sleeve and skin prism enters from the lower right. The hand remains below/right of the crosshair at rest and follows the same action matrix as the held object. |
| Held block | [How to Minecraft](https://www.minecraft.net/en-us/article/how-minecraft) shows moving a crafting table to the hotbar, holding it, and placing it. The [HUD history](https://minecraft.fandom.com/wiki/Heads-up_display) distinguishes held blocks and later 3D non-block items. | Full cubes use the exact Lakecraft world-atlas face resolver and per-face axis/UV orientation, including directional crafting-table, furnace, TNT, and log tiles. Three-quarter rotation exposes top and two sides. Thin placeables use small solid cuboid arrangements rather than a flattened inventory sprite. |
| Pickaxe / sword | [Taking Inventory: Pickaxe](https://www.minecraft.net/en-us/article/taking-inventory-pickaxe) calls the pickaxe Minecraft's iconic tool and shows its stable handle/head identity across tiers. [How to Minecraft](https://www.minecraft.net/en-us/article/how-minecraft) treats pickaxes, shovels, fists, swords, and bows as the player's visible combat/mining vocabulary. | Tier color is limited to the solid head/blade; handles stay wooden. Pickaxes keep a wide cross-head, swords keep a long blade, guard, and grip, and both share a diagonal lower-right grip pose. |
| Food | Microsoft's official [`minecraft:use_animation`](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/itemreference/examples/itemcomponents/minecraft_use_animation?view=minecraft-bedrock-stable) documentation defines `eat` as the apple's use animation. Minecraft's [health guide](https://www.minecraft.net/en-us/article/health-minecraft) describes selecting food in the hotbar and consuming it. | Food is chunky original solid geometry. A confirmed use moves it up and inward toward the screen center; reduced-motion users keep the static model. |
| Bow | [Taking Inventory: Bow](https://www.minecraft.net/en-us/article/taking-inventory--bow) specifies the visual/action sequence: select, hold use to nock and draw, then release; full charge has a subtle shake/sparkle cue. | Four solid limb segments, two string segments, and a solid arrow occupy three upload stages. The nock moves monotonically toward center, the arrow remains attached, and release reuses the short action matrix. |
| First-person transforms | Microsoft's official [item display transforms](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/blockreference/examples/itemdisplaytransforms?view=minecraft-bedrock-stable) explicitly defines first-person right-hand translation, rotation, scale, and pivots. Minecraft Help documents [F5 perspective switching](https://help.minecraft.net/hc/en-us/articles/40719065932557-Take-and-Manage-Screenshots-in-Minecraft-Java-Edition). | Lakecraft has one camera-local model matrix with a lower-right pivot. It uses the active world projection/FOV, a fresh depth plane after the world, and leaves the DOM crosshair at exact viewport center. |

These are pose and behavior references, not asset sources. Dimensions, cuboid
breakdown, palette values, atlas pixels, and animation curves remain Lakecraft's.

## Fixed render budget

- One retained color buffer: at most 18 cuboids / 648 vertices.
- One retained atlas buffer: at most one six-face cube / 36 vertices.
- 16,416 bytes of fixed GPU buffer capacity.
- At most two additional draw calls; most poses use one.
- Geometry uploads happen only when the selected item or bow charge stage
  changes. Swing/eat feedback changes a matrix, so it uploads no geometry per
  frame.
- The action pose and MVP matrices use retained caller-owned storage. Idle,
  active, and reduced-motion frames allocate no pose objects.
- `prefers-reduced-motion: reduce` zeros the action transform while keeping the
  held model readable.
- Pause, inventory/container/chat modal, mobile warning, and death states gate
  both first-person draw calls.

## Live acceptance

Automated acceptance records the exact vertex, upload, draw-call, and retained
buffer budgets for empty hand, block, pickaxe/sword, food, and the fully drawn
bow. Live review should capture those same poses at 1280×720 and 800×720,
confirming the crosshair remains centered and the model stays below/right of it.

The implementation worktree had no browser attached to the prescribed browser
runtime, so screenshots could not be captured in this change. That manual
two-viewport capture remains an explicit review item rather than inferred
evidence.
