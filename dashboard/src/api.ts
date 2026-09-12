import { useConvex, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { SessionState } from "./types";

export function convexSiteUrl(): string {
  const url = import.meta.env.VITE_CONVEX_URL ?? "";
  return url.replace(".convex.cloud", ".convex.site");
}

export function useCreateProject() {
  const create = useMutation(api.coordination.createProject);
  const select = useMutation(api.dashboard.selectProject);
  const convex = useConvex();
  return async (input: { name: string; id?: string }): Promise<SessionState> => {
    const project = await create(input);
    await select({ projectId: project.id });
    const workspace = await convex.query(api.dashboard.listWorkspace, {});
    if (!workspace) {
      throw new Error("Sign in on the website first.");
    }
    return workspace;
  };
}

export function useSetActiveProject() {
  const select = useMutation(api.dashboard.selectProject);
  const convex = useConvex();
  return async (projectId: string): Promise<SessionState> => {
    await select({ projectId });
    const workspace = await convex.query(api.dashboard.listWorkspace, {});
    if (!workspace) {
      throw new Error("Sign in on the website first.");
    }
    return workspace;
  };
}

export function useAddManualLog() {
  const add = useMutation(api.dashboard.addManualLog);
  return async (projectId: string, input: { summary: string; author?: string }): Promise<void> => {
    await add({
      projectId,
      summary: input.summary,
      author: input.author,
    });
  };
}
