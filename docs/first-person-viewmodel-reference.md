# First-person viewmodel reference and acceptance

Lakecraft's first-person models are original geometry and colors built from the
project's existing item catalog and texture atlas. No Minecraft texture, model,
or source asset is included.

## References inspected

| Pose | Reference signal | Lakecraft interpretation |
| --- | --- | --- |
| Empty hand | [How to Minecraft](https://www.minecraft.net/en-us/article/how-minecraft) introduces the player's hand, first mining tool, bare-fist combat, and items held from the hotbar. The [HUD history](https://minecraft.fandom.com/wiki/Heads-up_display) records a camera-facing hand and walking hand animation. | The right arm and transparent sleeve are sliced from the same standard 64×64 wide/slim UV rig used by the local player. There is no separately colored hand box or hand/arm seam. The retained arm enters from the lower right and follows the same action matrix as the held object. |
| Held block | [How to Minecraft](https://www.minecraft.net/en-us/article/how-minecraft) shows moving a crafting table to the hotbar, holding it, and placing it. | Full cubes use the exact Lakecraft world-atlas face resolver and per-face axis/UV orientation. Thin/special placeables reuse their one canonical original inventory sprite as an opaque-edge extrusion. |
| Pickaxe / sword | [Taking Inventory: Pickaxe](https://www.minecraft.net/en-us/article/taking-inventory-pickaxe) calls the pickaxe Minecraft's iconic tool and shows its stable handle/head identity across tiers. | One original 16x16 silhouette per tool kind is palette-swapped by tier, then used unchanged by inventory and held rendering. The renderer extrudes transparent/opaque boundaries instead of approximating tools from unrelated boxes. |
| Food | Microsoft's official [`minecraft:use_animation`](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/itemreference/examples/itemcomponents/minecraft_use_animation?view=minecraft-bedrock-stable) documentation defines `eat` as the apple's use animation. | Food uses the same original sprite in inventory and hand. A confirmed use moves it up and inward; reduced-motion users keep the static model. |
| Bow | [Taking Inventory: Bow](https://www.minecraft.net/en-us/article/taking-inventory--bow) specifies the visual/action sequence: select, hold use to nock and draw, then release. | Bow states inherit one display pose and swap original Lakecraft sprite stages; release reuses the short action matrix. |
| First-person transforms | Microsoft's official [item display transforms](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/blockreference/examples/itemdisplaytransforms?view=minecraft-bedrock-stable) explicitly defines first-person right-hand translation, rotation, scale, and pivots. Minecraft Help documents [F5 perspective switching](https://help.minecraft.net/hc/en-us/articles/40719065932557-Take-and-Manage-Screenshots-in-Minecraft-Java-Edition). | Lakecraft has one camera-local model matrix with a lower-right pivot. It uses the active world projection/FOV, a fresh depth plane after the world, and leaves the DOM crosshair at exact viewport center. |

These are pose and behavior references, not asset sources. Dimensions, cuboid
breakdown, palette values, atlas pixels, and animation curves remain Lakecraft's.

## Fixed render budget

- One retained color buffer: at most 4,608 vertices for one bounded opaque-edge
  16x16 sprite.
- One retained atlas buffer: at most one six-face cube / 36 vertices.
- One separate retained standard-skin right-arm/right-sleeve buffer: exactly 72
  vertices / 1,728 bytes. It shares the imported skin texture with the player
  contract rather than duplicating arm colors inside item geometry.
- 113,184 bytes of fixed geometry-buffer capacity across all three batches,
  below the 120 KiB acceptance ceiling.
- At most two viewmodel draw calls: item/block plus arm. A staged bow owns its
  full silhouette and uses one draw; an empty hand uses the skin draw only.
- Geometry uploads happen only when the selected item or bow charge stage
  changes. Swing/eat feedback changes a matrix, so it uploads no geometry per
  frame.
- The action pose and MVP matrices use retained caller-owned storage. Idle,
  active, and reduced-motion frames allocate no pose objects.
- `prefers-reduced-motion: reduce` zeros the action transform while keeping the
  held model readable.
- Inventory and Game Menu preserve the composed model for inspection. Blocking
  container/chat/mobile/death surfaces may hide it when the interaction would
  otherwise be misleading.

## Live acceptance

Automated acceptance records the exact vertex, upload, draw-call, and retained
buffer budgets for empty hand, block, pickaxe/sword, food, and the fully drawn
bow. Live review covers the in-world click-to-play frame and the deterministic
Visual Lab first-person viewport. The lab binds the production item, atlas, and
skin buffers at the production 70° field of view, exposes every bow stage, and
keeps the same live Pose Lab tuning snapshot. Real Chrome QA additionally
verifies that a valid local 64×64 PNG changes both the full third-person rig and
the first-person sleeve before the bundled-original reset is applied.
