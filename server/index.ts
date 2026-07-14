import { boolean, capsule, endpoint, mutation, query, string, table, text } from "lakebed/server";
import {
  CHAT_RATE_LIMIT_MS,
  RECENT_CHAT_LIMIT,
  validateChatMessage,
  validateUsername
} from "../shared/multiplayer";
import {
  decideChestWrite,
  normalizeChestToken,
  validateChestCoordinate,
  validateChestInventoryJson
} from "../shared/chests";
import {
  ACTIVE_PLAYER_WINDOW_MS,
  MAX_SLEEP_PARTICIPANTS,
  MORNING_PHASE,
  SLEEP_VOTE_FRESH_MS,
  WORLD_CLOCK_KEY,
  morningClockSnapshot,
  sleepVoteStatus,
  validateSleepCoordinate,
  worldClockSnapshot
} from "../shared/sleep";

const PLACEABLE_BLOCKS = ["grass", "dirt", "stone", "wood", "leaves", "planks", "crafting_table", "torch", "chest", "bed", "door_closed", "door_open"];

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
      actorId: string(),
      editedAt: string().default("0")
    })
      .index("by_coord", ["coordKey"])
      .index("by_edited", ["editedAt"]),

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
    }).index("by_user", ["userId"]),

    /** Shared container state. updatedAt is the optimistic concurrency token. */
    chests: table({
      coordKey: string(),
      inventoryJson: string(),
      lastActorId: string()
    }).index("by_coord", ["coordKey"]),

    /** Immutable, one-time username claims. Lakebed serializes each mutation transaction. */
    profiles: table({
      userId: string(),
      username: string(),
      normalizedUsername: string(),
      claimedAt: string()
    })
      .index("by_user", ["userId"])
      .index("by_username", ["normalizedUsername"]),

    chatMessages: table({
      userId: string(),
      username: string(),
      message: string(),
      sentAt: string()
    })
      .index("by_sent_at", ["sentAt"])
      .index("by_user_sent_at", ["userId", "sentAt"]),

    /** Singleton-like shared day/night origin, addressed by WORLD_CLOCK_KEY. */
    worldClock: table({
      clockKey: string(),
      epochMs: string(),
      epochPhase: string()
    }).index("by_key", ["clockKey"]),

    /** One current vote per authenticated user; stale rows are pruned on each vote. */
    sleepVotes: table({
      userId: string(),
      coordKey: string(),
      votedAt: string()
    })
      .index("by_user", ["userId"])
      .index("by_voted_at", ["votedAt"])
  },

  queries: {
    worldEdits: query(async (ctx) =>
      ctx.db.worldEdits.withIndex("by_edited").order("desc").take(1_000)
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
    ),

    chestAt: query(async (ctx, rawCoordKey: string) => {
      const coordinate = validateChestCoordinate(rawCoordKey);
      if (!coordinate.ok) return { ok: false, reason: coordinate.reason };
      const chest = await ctx.db.chests
        .withIndex("by_coord", (q) => q.eq("coordKey", coordinate.coordKey))
        .order("desc")
        .first();
      return { ok: true, chest: chest ?? null };
    }),

    myProfile: query(async (ctx) =>
      (await ctx.db.profiles
        .withIndex("by_user", (q) => q.eq("userId", ctx.auth.userId))
        .order("desc")
        .first()) ?? null
    ),

    /** Bounded profile event feed; currently one immutable claim exists per user. */
    currentProfiles: query(async (ctx) =>
      ctx.db.profiles.withIndex("by_creation").order("desc").take(512)
    ),

    usernameAvailability: query(async (ctx, requestedUsername: string) => {
      const validation = validateUsername(requestedUsername);
      if (!validation.ok) {
        return { available: false, username: requestedUsername.trim().toLowerCase(), reason: validation.reason };
      }
      const claim = await ctx.db.profiles
        .withIndex("by_username", (q) => q.eq("normalizedUsername", validation.username))
        .order("asc")
        .first();
      if (!claim || claim.userId === ctx.auth.userId) {
        return { available: true, username: validation.username };
      }
      return { available: false, username: validation.username, reason: "taken" };
    }),

    recentChat: query(async (ctx) => {
      const newest = await ctx.db.chatMessages
        .withIndex("by_sent_at")
        .order("desc")
        .take(RECENT_CHAT_LIMIT);
      return newest.reverse();
    }),

    worldClock: query(async (ctx) => {
      const serverNow = Date.now();
      const clock = await ctx.db.worldClock
        .withIndex("by_key", (q) => q.eq("clockKey", WORLD_CLOCK_KEY))
        .order("desc")
        .first();
      return worldClockSnapshot(clock, serverNow);
    })
  },

  mutations: {
    setBlock: mutation(
      async (ctx, _coordKey: string, x: string, y: string, z: string, blockType: string) => {
        if (!ctx.auth.isAuthenticated || ctx.auth.isGuest) throw new Error("Sign in to edit the shared world.");
        const px = boundedInteger(x, -64, 64);
        const py = boundedInteger(y, -4, 64);
        const pz = boundedInteger(z, -64, 64);
        const block = blockType.trim().toLowerCase();
        if (px == null || py == null || pz == null || !PLACEABLE_BLOCKS.includes(block)) return;
        const existing = await ctx.db.worldEdits
          .withIndex("by_coord", (q) => q.eq("coordKey", `${px}:${py}:${pz}`))
          .order("desc")
          .first();
        const value = {
          coordKey: `${px}:${py}:${pz}`,
          x: String(px),
          y: String(py),
          z: String(pz),
          blockType: block,
          actorId: ctx.auth.userId,
          editedAt: String(Date.now())
        };
        return existing
          ? ctx.db.worldEdits.update(existing.id, value)
          : ctx.db.worldEdits.insert(value);
      }
    ),

    removeBlock: mutation(async (ctx, _coordKey: string, x: string, y: string, z: string) => {
      if (!ctx.auth.isAuthenticated || ctx.auth.isGuest) throw new Error("Sign in to edit the shared world.");
      const px = boundedInteger(x, -64, 64);
      const py = boundedInteger(y, -4, 64);
      const pz = boundedInteger(z, -64, 64);
      if (px == null || py == null || pz == null) return;
      const existing = await ctx.db.worldEdits
        .withIndex("by_coord", (q) => q.eq("coordKey", `${px}:${py}:${pz}`))
        .order("desc")
        .first();
      const value = {
        coordKey: `${px}:${py}:${pz}`,
        x: String(px),
        y: String(py),
        z: String(pz),
        blockType: "air",
        actorId: ctx.auth.userId,
        editedAt: String(Date.now())
      };
      return existing
        ? ctx.db.worldEdits.update(existing.id, value)
        : ctx.db.worldEdits.insert(value);
    }),

    heartbeatPlayer: mutation(
      async (
        ctx,
        _displayName: string,
        color: string,
        x: string,
        y: string,
        z: string,
        yaw: string,
        pitch: string,
        _heartbeatAt: string
      ) => {
        if (!ctx.auth.isAuthenticated || ctx.auth.isGuest) throw new Error("Sign in to join the shared world.");
        const px = boundedNumber(x, -128, 128);
        const py = boundedNumber(y, -32, 128);
        const pz = boundedNumber(z, -128, 128);
        const playerYaw = boundedNumber(yaw, -100_000, 100_000);
        const playerPitch = boundedNumber(pitch, -2, 2);
        if (px == null || py == null || pz == null || playerYaw == null || playerPitch == null) return;
        const profile = await ctx.db.profiles
          .withIndex("by_user", (q) => q.eq("userId", ctx.auth.userId))
          .order("desc")
          .first();
        if (!profile) throw new Error("Choose a username before joining the shared world.");
        const safeColor = /^#[0-9a-f]{6}$/i.test(color.trim()) ? color.trim() : "#8fbf79";
        const existing = await ctx.db.playerPresence
          .withIndex("by_user", (q) => q.eq("userId", ctx.auth.userId))
          .order("desc")
          .first();
        const value = {
          userId: ctx.auth.userId,
          displayName: profile.username,
          color: safeColor,
          x: String(px),
          y: String(py),
          z: String(pz),
          yaw: String(playerYaw),
          pitch: String(playerPitch),
          heartbeatAt: String(Date.now()),
          online: true
        };
        return existing
          ? ctx.db.playerPresence.update(existing.id, value)
          : ctx.db.playerPresence.insert(value);
      }
    ),

    leavePlayer: mutation(async (ctx, _heartbeatAt: string) => {
      if (!ctx.auth.isAuthenticated || ctx.auth.isGuest) throw new Error("Sign in to leave the shared world.");
      const profile = await ctx.db.profiles
        .withIndex("by_user", (q) => q.eq("userId", ctx.auth.userId))
        .order("desc")
        .first();
      if (!profile) throw new Error("Choose a username before joining the shared world.");
      const existing = await ctx.db.playerPresence
        .withIndex("by_user", (q) => q.eq("userId", ctx.auth.userId))
        .order("desc")
        .first();
      const value = {
        userId: ctx.auth.userId,
        displayName: profile.username,
        color: "#8fbf79",
        x: "0",
        y: "0",
        z: "0",
        yaw: "0",
        pitch: "0",
        heartbeatAt: String(Date.now()),
        online: false
      };
      return existing
        ? ctx.db.playerPresence.update(existing.id, value)
        : ctx.db.playerPresence.insert(value);
    }),

    saveInventory: mutation(async (ctx, inventoryJson: string) => {
      if (!ctx.auth.isAuthenticated || ctx.auth.isGuest) throw new Error("Sign in to save inventory.");
      const serialized = inventoryJson.trim().slice(0, 8_192);
      try {
        JSON.parse(serialized);
      } catch {
        return;
      }
      const existing = await ctx.db.inventories
        .withIndex("by_user", (q) => q.eq("userId", ctx.auth.userId))
        .order("desc")
        .first();
      const value = {
        userId: ctx.auth.userId,
        inventoryJson: serialized
      };
      return existing
        ? ctx.db.inventories.update(existing.id, value)
        : ctx.db.inventories.insert(value);
    }),

    saveChest: mutation(async (ctx, rawCoordKey: string, rawInventoryJson: string, rawExpectedUpdatedAt: string) => {
      if (!ctx.auth.isAuthenticated || ctx.auth.isGuest) {
        return { ok: false, reason: "authentication_required" };
      }
      const coordinate = validateChestCoordinate(rawCoordKey);
      if (!coordinate.ok) return { ok: false, reason: coordinate.reason };
      const inventory = validateChestInventoryJson(rawInventoryJson);
      if (!inventory.ok) return { ok: false, reason: "invalid_inventory", detail: inventory.reason };
      const expectedUpdatedAt = normalizeChestToken(rawExpectedUpdatedAt);
      if (expectedUpdatedAt === null) return { ok: false, reason: "invalid_token" };

      const existing = await ctx.db.chests
        .withIndex("by_coord", (q) => q.eq("coordKey", coordinate.coordKey))
        .order("desc")
        .first();
      const decision = decideChestWrite(existing?.updatedAt ?? null, expectedUpdatedAt);
      if (decision === "conflict") return { ok: false, reason: "conflict", chest: existing ?? null };

      const value = {
        coordKey: coordinate.coordKey,
        inventoryJson: inventory.inventoryJson,
        lastActorId: ctx.auth.userId
      };
      const chest = existing
        ? await ctx.db.chests.update(existing.id, value)
        : await ctx.db.chests.insert(value);
      return { ok: true, chest };
    }),

    sleepInBed: mutation(async (ctx, rawCoordKey: string) => {
      if (!ctx.auth.isAuthenticated || ctx.auth.isGuest) {
        return { ok: false, reason: "authentication_required" };
      }
      const coordinate = validateSleepCoordinate(rawCoordKey);
      if (!coordinate.ok) return { ok: false, reason: coordinate.reason };
      const bed = await ctx.db.worldEdits
        .withIndex("by_coord", (q) => q.eq("coordKey", coordinate.coordKey))
        .order("desc")
        .first();
      if (!bed || bed.blockType !== "bed") return { ok: false, reason: "bed_required" };

      const serverNow = Date.now();
      const activeSince = String(serverNow - ACTIVE_PLAYER_WINDOW_MS);
      const presences = await ctx.db.playerPresence
        .withIndex("by_heartbeat", (q) => q.gte("heartbeatAt", activeSince))
        .order("desc")
        .take(MAX_SLEEP_PARTICIPANTS);
      const preVoteStatus = sleepVoteStatus(presences, [], serverNow);
      if (!preVoteStatus.activePlayerIds.includes(ctx.auth.userId)) {
        return { ok: false, reason: "active_presence_required" };
      }

      const staleBefore = String(serverNow - SLEEP_VOTE_FRESH_MS);
      const staleVotes = await ctx.db.sleepVotes
        .withIndex("by_voted_at", (q) => q.lt("votedAt", staleBefore))
        .order("asc")
        .take(MAX_SLEEP_PARTICIPANTS);
      for (const staleVote of staleVotes) await ctx.db.sleepVotes.delete(staleVote.id);

      const existingVote = await ctx.db.sleepVotes
        .withIndex("by_user", (q) => q.eq("userId", ctx.auth.userId))
        .order("desc")
        .first();
      const voteValue = {
        userId: ctx.auth.userId,
        coordKey: coordinate.coordKey,
        votedAt: String(serverNow)
      };
      if (existingVote) await ctx.db.sleepVotes.update(existingVote.id, voteValue);
      else await ctx.db.sleepVotes.insert(voteValue);

      const votes = await ctx.db.sleepVotes
        .withIndex("by_voted_at", (q) => q.gte("votedAt", staleBefore))
        .order("desc")
        .take(MAX_SLEEP_PARTICIPANTS);
      const status = sleepVoteStatus(presences, votes, serverNow);
      if (!status.reached) {
        return {
          ok: true,
          slept: false,
          activePlayers: status.activePlayers,
          sleepingPlayers: status.sleepingPlayers,
          requiredPlayers: status.requiredPlayers
        };
      }

      const existingClock = await ctx.db.worldClock
        .withIndex("by_key", (q) => q.eq("clockKey", WORLD_CLOCK_KEY))
        .order("desc")
        .first();
      const clockValue = {
        clockKey: WORLD_CLOCK_KEY,
        epochMs: String(serverNow),
        epochPhase: String(MORNING_PHASE)
      };
      if (existingClock) await ctx.db.worldClock.update(existingClock.id, clockValue);
      else await ctx.db.worldClock.insert(clockValue);
      for (const vote of votes) await ctx.db.sleepVotes.delete(vote.id);

      return {
        ok: true,
        slept: true,
        activePlayers: status.activePlayers,
        sleepingPlayers: status.sleepingPlayers,
        requiredPlayers: status.requiredPlayers,
        clock: morningClockSnapshot(serverNow)
      };
    }),

    claimUsername: mutation(async (ctx, requestedUsername: string) => {
      if (!ctx.auth.isAuthenticated || ctx.auth.isGuest) {
        return { ok: false, reason: "authentication_required" };
      }
      const validation = validateUsername(requestedUsername);
      if (!validation.ok) return { ok: false, reason: validation.reason };

      const existingProfile = await ctx.db.profiles
        .withIndex("by_user", (q) => q.eq("userId", ctx.auth.userId))
        .order("desc")
        .first();
      if (existingProfile) {
        if (existingProfile.normalizedUsername === validation.username) {
          return { ok: true, profile: existingProfile };
        }
        return { ok: false, reason: "username_locked" };
      }

      const existingClaim = await ctx.db.profiles
        .withIndex("by_username", (q) => q.eq("normalizedUsername", validation.username))
        .order("asc")
        .first();
      if (existingClaim) return { ok: false, reason: "taken" };

      const claimedAt = String(Date.now());
      const profile = await ctx.db.profiles.insert({
        userId: ctx.auth.userId,
        username: validation.username,
        normalizedUsername: validation.username,
        claimedAt
      });
      return { ok: true, profile };
    }),

    sendChat: mutation(async (ctx, rawMessage: string) => {
      if (!ctx.auth.isAuthenticated || ctx.auth.isGuest) {
        return { ok: false, reason: "authentication_required" };
      }
      const validation = validateChatMessage(rawMessage);
      if (!validation.ok) return { ok: false, reason: validation.reason };

      const profile = await ctx.db.profiles
        .withIndex("by_user", (q) => q.eq("userId", ctx.auth.userId))
        .order("desc")
        .first();
      if (!profile) return { ok: false, reason: "profile_required" };

      const previous = await ctx.db.chatMessages
        .withIndex("by_user_sent_at", (q) => q.eq("userId", ctx.auth.userId))
        .order("desc")
        .first();
      const now = Date.now();
      const elapsed = previous ? now - Number(previous.sentAt) : CHAT_RATE_LIMIT_MS;
      if (elapsed < CHAT_RATE_LIMIT_MS) {
        return { ok: false, reason: "rate_limited", retryAfterMs: CHAT_RATE_LIMIT_MS - elapsed };
      }

      const message = await ctx.db.chatMessages.insert({
        userId: ctx.auth.userId,
        username: profile.username,
        message: validation.message,
        sentAt: String(now)
      });
      return { ok: true, message };
    })
  },

  endpoints: {
    status: endpoint({ method: "GET", path: "/api/status" }, () => text("lakecraft:ok"))
  }
});
