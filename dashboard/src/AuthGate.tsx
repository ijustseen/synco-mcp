import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { authStatus, createProject, login, logout, register, loadSession } from "./api";
import { Logo } from "./icons";
import type { SessionState } from "./types";

type Mode = "signin" | "register";

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="mt-3 block text-[13px] text-[#9A9A94]">
      {label}
      {children}
    </label>
  );
}

function inputClass(): string {
  return "mt-1.5 w-full rounded-lg border border-white/10 bg-[#070707] px-3 py-2 text-sm text-[#F5F5F2] outline-none focus:border-[#E8B84A]";
}

export function AuthGate({
  children,
}: {
  children: (session: SessionState, setSession: (next: SessionState) => void) => ReactNode;
}) {
  const [session, setSession] = useState<SessionState | null>(null);
  const [hasUsers, setHasUsers] = useState<boolean | null>(null);
  const [mode, setMode] = useState<Mode>("signin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [projectName, setProjectName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const status = await authStatus();
        if (!cancelled) {
          setHasUsers(status.hasUsers);
          setMode(status.hasUsers ? "signin" : "register");
        }
      } catch {
        if (!cancelled) setHasUsers(true);
      }
      try {
        const next = await loadSession();
        if (!cancelled) setSession(next);
      } catch {
        if (!cancelled) setSession(null);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function submitAuth(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const next =
        mode === "register"
          ? await register({ username: username.trim(), password })
          : await login({ username: username.trim(), password });
      setSession(next);
      setHasUsers(true);
      setPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in");
    } finally {
      setBusy(false);
    }
  }

  async function submitProject(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const next = await createProject({ name: projectName.trim() });
      setSession(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create project");
    } finally {
      setBusy(false);
    }
  }

  if (!ready) {
    return <main className="px-6 py-12 text-sm text-[#9A9A94]">Loading…</main>;
  }

  if (!session) {
    return (
      <main className="flex min-h-screen items-center justify-center px-5">
        <form
          className="w-full max-w-md rounded-[16px] border border-white/10 bg-[#111111] p-6"
          onSubmit={(event) => void submitAuth(event)}
        >
          <span className="flex items-center gap-2.5">
            <Logo className="h-6 w-6" />
            <p className="text-[15px] font-semibold tracking-tight">synco-mcp</p>
          </span>
          <h1 className="mt-2 text-xl font-medium tracking-tight">
            {hasUsers === false ? "Create the first account" : mode === "register" ? "Create account" : "Sign in"}
          </h1>
          <p className="mt-1 text-[13px] text-[#9A9A94]">
            Dashboard login. Agents still use MCP with a project id.
          </p>
          <Field label="Username">
            <input
              className={inputClass()}
              value={username}
              autoComplete="username"
              onChange={(event) => setUsername(event.target.value)}
              required
              minLength={3}
            />
          </Field>
          <Field label="Password">
            <input
              className={inputClass()}
              type="password"
              value={password}
              autoComplete={mode === "register" ? "new-password" : "current-password"}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={8}
            />
          </Field>
          {error && <p className="mt-3 text-[13px] text-[#E8B4B4]">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="mt-5 w-full rounded-full bg-[#E8B84A] px-3.5 py-2 text-sm font-medium text-[#070707] disabled:opacity-50"
          >
            {busy ? "Please wait…" : mode === "register" ? "Create account" : "Sign in"}
          </button>
          {hasUsers !== false && (
            <button
              type="button"
              className="mt-3 w-full text-[13px] text-[#9A9A94]"
              onClick={() => {
                setMode(mode === "register" ? "signin" : "register");
                setError(null);
              }}
            >
              {mode === "register" ? "Already have an account? Sign in" : "Need an account? Create one"}
            </button>
          )}
        </form>
      </main>
    );
  }

  if (session.projects.length === 0 || !session.activeProjectId) {
    return (
      <main className="flex min-h-screen items-center justify-center px-5">
        <form
          className="w-full max-w-md rounded-[16px] border border-white/10 bg-[#111111] p-6"
          onSubmit={(event) => void submitProject(event)}
        >
          <span className="flex items-center gap-2.5">
            <Logo className="h-6 w-6" />
            <p className="text-[15px] font-semibold tracking-tight">synco-mcp</p>
          </span>
          <h1 className="mt-2 text-xl font-medium tracking-tight">Create a project</h1>
          <p className="mt-1 text-[13px] text-[#9A9A94]">
            Signed in as {session.user.username}. This project becomes the active desk.
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
          <button
            type="button"
            className="mt-3 w-full text-[13px] text-[#9A9A94]"
            onClick={() => {
              void logout().then(() => setSession(null));
            }}
          >
            Sign out
          </button>
        </form>
      </main>
    );
  }

  return <>{children(session, setSession)}</>;
}
