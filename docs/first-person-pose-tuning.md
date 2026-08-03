# First-person pose tuning

This is the simple way to show the developer how the arm, block, tool, or bow should look.

## Before you start

1. Open Lakecraft at `http://localhost:3100`.
2. Enter a world and hold the thing you want to fix.
3. Press **Escape** so the game is paused. Keep the browser window visible.
4. Open `client/game/firstPersonTuning.ts` in your code editor.

The held arm and item stay visible while **Game Menu** or **Click to Play** is on screen. Each time you save the tuning file, Lakebed reloads the changed code and redraws the paused pose. You do not need to unpause, click the game, or refresh the browser.

If the browser tab is completely hidden, the redraw waits to save battery. Put the browser and editor side by side, or switch back to the visible browser after saving.

## Pick the right box

- Holding a block? Change `block`.
- Holding a pickaxe, axe, shovel, hoe, or sword? Change `tool`.
- Holding a bow? Change `bow`.
- Fixing the arm or empty hand? Change `arm`.
- Holding food or another ordinary item? Change `otherItem`.
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

Save the file. Look at the paused browser. If it moved the wrong way, press **Undo** in the editor and save again. Change only one number at a time so it is always clear what that number did.

## When it looks right

Do not clean up or rewrite the file. Send the developer:

1. Which box you changed (`block`, `tool`, `bow`, `arm`, or `otherItem`).
2. The finished `position`, `rotationDegrees`, and `scale` values—or `center`, `rotationDegrees`, and `size` for a block.
3. A screenshot of the paused game.
