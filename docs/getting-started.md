# Getting started

## Local development

Start the Lakebed capsule from the repository root:

```sh
npx lakebed dev
```

Single-player needs no account and saves only in the current browser. Local
Lakebed state resets when the development server restarts, but browser-local
worlds do not. Signing in does not upload single-player worlds.

Multiplayer requires Google sign-in and a unique username. For local identity
testing, select a development identity before opening the app:

```sh
npx lakebed auth as alice
```

## Controls

- Click the world to capture the mouse. `W A S D` moves, `Space` jumps, the
  mouse looks, `Ctrl` sprints, and `Shift` sneaks.
- Hold left click to mine. Hold right click to place ordinary blocks in
  single-player, or use the held item on a block or mob.
- `1` through `9` selects the hotbar, `E` opens inventory, `Q` drops one item, and
  Ctrl/Cmd+`Q` drops the stack.
- `T` or `Enter` opens multiplayer chat or the single-player command console.
  `/help`, `/gamemode <survival|creative>`, and `/give <item> [count]` are
  available locally.
- Hold `Tab` for the player list. `Esc` opens the game menu. `F2` saves a
  screenshot without releasing pointer capture; `F3` toggles diagnostics.
- Right click crafting tables, furnaces, chests, doors, beds, fence gates, food,
  bows, shears, saplings, and bone meal for their contextual actions.

Single-player autosaves after each minute of active play and verifies a final
save before returning to the title screen.
