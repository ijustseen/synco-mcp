// opencode plugin. `tool.execute.before` throws to block a tool call, and the
// message reaches the model.
//
// opencode never fires this hook for MCP tool calls, which is precisely why the
// guard asks the synco server about declared intent instead of trying to observe
// declare_change_intent locally.
import { checkEdit } from "./synco/synco-guard.mjs";

export const SyncoGuard = async (ctx) => {
  const cwd = ctx?.directory ?? ctx?.worktree ?? process.cwd();

  return {
    "tool.execute.before": async (input, output) => {
      const result = await checkEdit({
        payload: { tool: input?.tool, args: output?.args },
        cwd,
        adapterDir: new URL("./synco/", import.meta.url).pathname,
        env: process.env,
      });

      if (!result.allowed) {
        throw new Error(
          `synco-mcp blocked this edit. ${result.message ?? "Declare your change intent first."}`,
        );
      }
    },
  };
};
