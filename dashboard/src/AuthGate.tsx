import { useAuthActions, useConvexAuth } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import { useState, type FormEvent, type ReactNode } from "react";
import { api } from "../../convex/_generated/api";
import { useCreateProject } from "./api";
import { Logo } from "./icons";
import type { SessionState } from "./types";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="mt-3 block text-[13px] text-[#9A9A94]">
      {label}
      {children}
    </label>
  );
}

function inputClass() {
  return "mt-1.5 w-full rounded-lg border border-white/10 bg-[#070707] px-3 py-2 text-sm text-[#F5F5F2] outline-none focus:border-[#E8B84A]";
}

export function AuthGate({
  children,
}: {
  children: (session: SessionState, setSession: (next: SessionState) => void) => ReactNode;
}) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const { signIn } = useAuthActions();
  const workspace = useQuery(api.dashboard.listWorkspace, isAuthenticated ? {} : "skip");
  const createProject = useCreateProject();
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [projectName, setProjectName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isLoading || (isAuthenticated && workspace === undefined)) {
    return <main className="px-6 py-12 text-sm text-[#9A9A94]">Loading…</main>;
  }

  if (!isAuthenticated) {
    return (
      <main className="flex min-h-screen items-center justify-center px-5">
        <form
          className="w-full max-w-md rounded-[16px] border border-white/10 bg-[#111111] p-6"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            setBusy(true);
            setError(null);
            void signIn("password", { email: email.trim(), password, flow: mode })
              .catch((err) => {
                setError(err instanceof Error ? err.message : "Could not sign in");
              })
              .finally(() => setBusy(false));
          }}
        >
          <span className="flex items-center gap-2.5">
            <Logo className="h-6 w-6" />
            <p className="text-[15px] font-semibold tracking-tight">synco-mcp</p>
          </span>
          <h1 className="mt-2 text-xl font-medium tracking-tight">
            {mode === "signIn" ? "Sign in" : "Create account"}
          </h1>
          <p className="mt-1 text-[13px] text-[#9A9A94]">
            One Convex backend. Your projects stay on your account.
          </p>
          <Field label="Email">
            <input
              className={inputClass()}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </Field>
          <Field label="Password">
            <input
              className={inputClass()}
              type="password"
              autoComplete={mode === "signIn" ? "current-password" : "new-password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={8}
              required
            />
          </Field>
          {error && <p className="mt-3 text-[13px] text-[#E8B4B4]">{error}</p>}
          <button
            type="submit"
            disabled={busy || !email.trim() || password.length < 8}
            className="mt-5 w-full rounded-full bg-[#E8B84A] px-3.5 py-2 text-sm font-medium text-[#070707] disabled:opacity-50"
          >
            {busy ? "Please wait…" : mode === "signIn" ? "Sign in" : "Create account"}
          </button>
          <button
            type="button"
            className="mt-3 w-full text-[13px] text-[#9A9A94]"
            onClick={() => {
              setMode(mode === "signIn" ? "signUp" : "signIn");
              setError(null);
            }}
          >
            {mode === "signIn" ? "Need an account? Create one" : "Already have an account? Sign in"}
          </button>
        </form>
      </main>
    );
  }

  if (workspace === null) {
    return <main className="px-6 py-12 text-sm text-[#9A9A94]">Signing you in…</main>;
  }

  if (workspace.projects.length === 0 || !workspace.activeProjectId) {
    return (
      <main className="flex min-h-screen items-center justify-center px-5">
        <form
          className="w-full max-w-md rounded-[16px] border border-white/10 bg-[#111111] p-6"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            setBusy(true);
            setError(null);
            void createProject({ name: projectName.trim() })
              .catch((err) => {
                setError(err instanceof Error ? err.message : "Could not create project");
              })
              .finally(() => setBusy(false));
          }}
        >
          <span className="flex items-center gap-2.5">
            <Logo className="h-6 w-6" />
            <p className="text-[15px] font-semibold tracking-tight">synco-mcp</p>
          </span>
          <h1 className="mt-2 text-xl font-medium tracking-tight">Create a project</h1>
          <p className="mt-1 text-[13px] text-[#9A9A94]">
            This project becomes your active desk. Agents using your key write here.
          </p>
          <Field label="Project name">
            <input
              className={inputClass()}
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              placeholder="Website, API, mobile…"
              required
            />
          </Field>
          {error && <p className="mt-3 text-[13px] text-[#E8B4B4]">{error}</p>}
          <button
            type="submit"
            disabled={busy || !projectName.trim()}
            className="mt-5 w-full rounded-full bg-[#E8B84A] px-3.5 py-2 text-sm font-medium text-[#070707] disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create project"}
          </button>
        </form>
      </main>
    );
  }

  return <>{children(workspace, () => undefined)}</>;
}
