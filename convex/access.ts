import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { sha256Hex } from "./lib/crypto.js";

function convexEnv(name: string): string | undefined {
  return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[name];
}

export const resolveBearer = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const admin = convexEnv("SYNCO_API_KEY");
    if (admin && args.token === admin) {
      return { kind: "admin" as const };
    }

    const tokenHash = await sha256Hex(args.token);
    const key = await ctx.db
      .query("agentKeys")
      .withIndex("by_hash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    if (!key || key.revokedAt) {
      return null;
    }
    return { kind: "user" as const, userId: key.userId };
  },
});
