# First-person pose tuning

This is the simple way to show the developer how the arm, block, tool, or bow should look.

## Before you start

1. Open Lakecraft at `http://localhost:3100`.
2. Enter a world and hold the thing you want to fix.
3. Press **Escape** so the game is paused, or stay on **Click to Play**.
4. Use the **POSE LAB** panel on the left side of the game.

The active first-person presentation stays visible while **Game Menu** or **Click to Play** is on screen. An empty slot shows the arm; any selected item replaces it. Every number in POSE LAB updates the retained WebGL model directly. You do not need to save a file, unpause, click the game, or refresh the browser.

## Pick the right box

- Holding a normal full cube, such as dirt, stone, or planks? Change `block`. The stone-brick slab also uses `block`.
- Holding a special held block item, such as a torch, chest, bed, door, ladder, fence, fence gate, or sapling? Change `otherItem`.
- Holding a pickaxe, axe, shovel, or sword? Change `tool`.
- Holding a bow? Change `bow`.
- Fixing the arm or empty hand? Change `arm`.
- Holding food, a material, or another ordinary item? Change `otherItem`.
- Ignore `rig` at first. It moves everything and the swing animation together.

## Change one number

Most rows contain three numbers: `[X, Y, Z]`.

- The first number is **X**. Bigger moves right. Smaller moves left.
- The second number is **Y**. Bigger moves up. Smaller moves down.
- The third number is **Z**. Bigger moves toward your face. Smaller moves away.

Try these small steps:

- `position` or block `center`: add or subtract `0.02`.
- `rotationDegrees`: add or subtract `5`.
- `scale` or block `size`: add or subtract `0.05`.
- Leave `pivot` alone until the other values have been tried.

For example, to move a tool slightly right, change:

```ts
position: [0, 0, 0]
```

to:

```ts
position: [0.02, 0, 0]
```

Look at the paused pose immediately after changing a number. If it moved the wrong way, put the old number back or use **Reset this group**. Change only one number at a time so it is always clear what that number did.

## When it looks right

Use **Copy values**, then send the developer:

1. Which box you changed (`block`, `tool`, `bow`, `arm`, or `otherItem`).
2. The finished `position`, `rotationDegrees`, and `scale` values—or `center`, `rotationDegrees`, and `size` for a block.
3. A screenshot of the paused game.
