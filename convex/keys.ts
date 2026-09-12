import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { AppError, ErrorCodes } from "./lib/errors.js";
import { newAgentKey, sha256Hex } from "./lib/crypto.js";
import { nowIso } from "./lib/ids.js";

async function requireUser(ctx: QueryCtx | MutationCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new AppError(ErrorCodes.UNAUTHORIZED, "Sign in on the website first.", undefined, 401);
  }
  return userId;
}

export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return [];
    }
    const keys = await ctx.db
      .query("agentKeys")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return keys
      .filter((key) => !key.revokedAt)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map((key) => ({
        id: key._id,
        name: key.name,
        prefix: key.prefix,
        createdAt: key.createdAt,
        lastUsedAt: key.lastUsedAt,
      }));
  },
});

export const create = mutation({
  args: { name: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const token = newAgentKey();
    const ts = nowIso();
    await ctx.db.insert("agentKeys", {
      userId,
      name: args.name?.trim() || "Cursor / Claude / OpenCode",
      tokenHash: await sha256Hex(token),
      prefix: token.slice(0, 12),
      createdAt: ts,
    });
    return { token, prefix: token.slice(0, 12) };
  },
});

export const revoke = mutation({
  args: { id: v.id("agentKeys") },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const key = await ctx.db.get(args.id);
    if (!key || key.userId !== userId) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, "Key not found.", undefined, 404);
    }
    await ctx.db.patch(key._id, { revokedAt: nowIso() });
  },
});
