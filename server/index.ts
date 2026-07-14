import { boolean, capsule, endpoint, mutation, query, string, table, text } from "lakebed/server";

const PLACEABLE_BLOCKS = ["grass", "dirt", "stone", "wood", "leaves", "planks"];

function boundedInteger(value: string, minimum: number, maximum: number): number | null {
  if (!/^-?\d{1,4}$/.test(value.trim())) return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= minimum && number <= maximum ? number : null;
}

function boundedNumber(value: string, minimum: number, maximum: number): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum ? number : null;
}

export default capsule({
  name: "lakecraft",

  schema: {
    worldEdits: table({
      coordKey: string(),
      x: string(),
      y: string(),
      z: string(),
      blockType: string(),
      actorId: string()
    }).index("by_coord", ["coordKey"]),

    playerPresence: table({
      userId: string(),
      displayName: string(),
      color: string(),
      x: string(),
      y: string(),
      z: string(),
      yaw: string(),
      pitch: string(),
      heartbeatAt: string(),
      online: boolean().default(true)
    })
      .index("by_user", ["userId"])
      .index("by_heartbeat", ["heartbeatAt"]),

    inventories: table({
      userId: string(),
      inventoryJson: string()
    }).index("by_user", ["userId"])
  },

  queries: {
    worldEdits: query(async (ctx) =>
      ctx.db.worldEdits.withIndex("by_creation").order("desc").take(1_000)
    ),

    worldEditsAt: query(async (ctx, coordKey: string) =>
      ctx.db.worldEdits
        .withIndex("by_coord", (q) => q.eq("coordKey", coordKey.trim().slice(0, 96)))
        .order("asc")
        .collect()
    ),

    recentPlayers: query(async (ctx, activeSince: string) =>
      ctx.db.playerPresence
        .withIndex("by_heartbeat", (q) => q.gte("heartbeatAt", activeSince.trim().slice(0, 32)))
        .order("desc")
        .take(128)
    ),

    myPresence: query(async (ctx) =>
      (await ctx.db.playerPresence
        .withIndex("by_user", (q) => q.eq("userId", ctx.auth.userId))
        .order("desc")
        .first()) ?? null
    ),

    myInventory: query(async (ctx) =>
      (await ctx.db.inventories
        .withIndex("by_user", (q) => q.eq("userId", ctx.auth.userId))
        .order("desc")
        .first()) ?? null
    )
  },

  mutations: {
    setBlock: mutation(
      async (ctx, _coordKey: string, x: string, y: string, z: string, blockType: string) => {
        const px = boundedInteger(x, -64, 64);
        const py = boundedInteger(y, -4, 64);
        const pz = boundedInteger(z, -64, 64);
        const block = blockType.trim().toLowerCase();
        if (px == null || py == null || pz == null || !PLACEABLE_BLOCKS.includes(block)) return;
        return ctx.db.worldEdits.insert({
          coordKey: `${px}:${py}:${pz}`,
          x: String(px),
          y: String(py),
          z: String(pz),
          blockType: block,
          actorId: ctx.auth.userId
        });
      }
    ),

    removeBlock: mutation(async (ctx, _coordKey: string, x: string, y: string, z: string) => {
      const px = boundedInteger(x, -64, 64);
      const py = boundedInteger(y, -4, 64);
      const pz = boundedInteger(z, -64, 64);
      if (px == null || py == null || pz == null) return;
      return ctx.db.worldEdits.insert({
        coordKey: `${px}:${py}:${pz}`,
        x: String(px),
        y: String(py),
        z: String(pz),
        blockType: "air",
        actorId: ctx.auth.userId
      });
    }),

    heartbeatPlayer: mutation(
      async (
        ctx,
        displayName: string,
        color: string,
        x: string,
        y: string,
        z: string,
        yaw: string,
        pitch: string,
        _heartbeatAt: string
      ) => {
        const px = boundedNumber(x, -128, 128);
        const py = boundedNumber(y, -32, 128);
        const pz = boundedNumber(z, -128, 128);
        const playerYaw = boundedNumber(yaw, -100_000, 100_000);
        const playerPitch = boundedNumber(pitch, -2, 2);
        if (px == null || py == null || pz == null || playerYaw == null || playerPitch == null) return;
        const safeColor = /^#[0-9a-f]{6}$/i.test(color.trim()) ? color.trim() : "#8fbf79";
        return ctx.db.playerPresence.insert({
          userId: ctx.auth.userId,
          displayName: (displayName.trim() || ctx.auth.displayName).slice(0, 32),
          color: safeColor,
          x: String(px),
          y: String(py),
          z: String(pz),
          yaw: String(playerYaw),
          pitch: String(playerPitch),
          heartbeatAt: String(Date.now()),
          online: true
        });
      }
    ),

    leavePlayer: mutation(async (ctx, _heartbeatAt: string) =>
      ctx.db.playerPresence.insert({
        userId: ctx.auth.userId,
        displayName: ctx.auth.displayName.trim().slice(0, 32),
        color: "#8fbf79",
        x: "0",
        y: "0",
        z: "0",
        yaw: "0",
        pitch: "0",
        heartbeatAt: String(Date.now()),
        online: false
      })
    ),

    saveInventory: mutation(async (ctx, inventoryJson: string) => {
      const value = inventoryJson.trim().slice(0, 8_192);
      try {
        JSON.parse(value);
      } catch {
        return;
      }
      return ctx.db.inventories.insert({
        userId: ctx.auth.userId,
        inventoryJson: value
      });
    })
  },

  endpoints: {
    status: endpoint({ method: "GET", path: "/api/status" }, () => text("lakecraft:ok"))
  }
});
