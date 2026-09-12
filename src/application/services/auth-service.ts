import { AppError, ErrorCodes } from "../../domain/errors.js";
import type { Session, User, UserRecord } from "../../domain/types.js";
import type { Repositories } from "../../infrastructure/repositories/sqlite-repos.js";
import { config } from "../../shared/config.js";
import { newId, nowIso } from "../../shared/utils/ids.js";
import { hashPassword, newSessionToken, verifyPassword } from "../../shared/utils/password.js";
import {
  authCredentialsInput,
  setActiveProjectInput,
} from "../../shared/validation/schemas.js";

const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

function parse<T>(schema: { parse: (value: unknown) => T }, value: unknown): T {
  try {
    return schema.parse(value);
  } catch (error) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, "Invalid input", error);
  }
}

function publicUser(user: UserRecord): User {
  return { id: user.id, username: user.username, createdAt: user.createdAt };
}

export type AuthService = ReturnType<typeof createAuthService>;

export function createAuthService(repos: Repositories) {
  function expireIfNeeded(session: Session): Session | undefined {
    if (new Date(session.expiresAt).getTime() <= Date.now()) {
      repos.sessions.delete(session.token);
      return undefined;
    }
    return session;
  }

  function withActivity(projects: ReturnType<Repositories["projects"]["listForUser"]>) {
    return projects.map((project) => ({
      ...project,
      eventCount: repos.projects.eventCount(project.id),
    }));
  }

  function syncDesk(projectId: string | undefined): void {
    if (projectId) {
      repos.settings.set("desk_project_id", projectId);
    }
  }

  function sessionPayload(session: Session, user: UserRecord) {
    const projects = withActivity(repos.projects.listForUser(user.id));
    let activeProjectId = session.activeProjectId;
    if (activeProjectId && !projects.some((project) => project.id === activeProjectId)) {
      activeProjectId = undefined;
    }
    if (!activeProjectId) {
      activeProjectId = projects[0]?.id;
    }
    if (activeProjectId && activeProjectId !== session.activeProjectId) {
      repos.sessions.setActiveProject(session.token, activeProjectId);
    }
    syncDesk(activeProjectId);
    return {
      user: publicUser(user),
      projects,
      activeProjectId,
    };
  }

  function claimOrphanDefault(userId: string): void {
    const project = repos.projects.getById(config.defaultProjectId);
    if (!project) {
      return;
    }
    if (repos.members.countByProject(project.id) > 0) {
      return;
    }
    repos.members.insert({
      projectId: project.id,
      userId,
      role: "owner",
      createdAt: nowIso(),
    });
  }

  function createSession(userId: string, activeProjectId?: string): Session {
    return repos.sessions.insert({
      token: newSessionToken(),
      userId,
      activeProjectId,
      expiresAt: new Date(Date.now() + SESSION_MS).toISOString(),
      createdAt: nowIso(),
    });
  }

  function requireUser(session: Session): UserRecord {
    const user = repos.users.getById(session.userId);
    if (!user) {
      repos.sessions.delete(session.token);
      throw new AppError(ErrorCodes.UNAUTHORIZED, "Sign in required", undefined, 401);
    }
    return user;
  }

  return {
    hasUsers(): boolean {
      return repos.users.count() > 0;
    },

    register(raw: unknown) {
      const input = parse(authCredentialsInput, raw);
      if (repos.users.getByUsername(input.username)) {
        throw new AppError(ErrorCodes.USERNAME_TAKEN, "Username already taken", { username: input.username }, 409);
      }
      const user = repos.users.insert({
        id: newId(),
        username: input.username,
        passwordHash: hashPassword(input.password),
        createdAt: nowIso(),
      });
      claimOrphanDefault(user.id);
      const projects = repos.projects.listForUser(user.id);
      const session = createSession(user.id, projects[0]?.id);
      syncDesk(projects[0]?.id);
      return { session, ...sessionPayload(session, user) };
    },

    login(raw: unknown) {
      const input = parse(authCredentialsInput, raw);
      const user = repos.users.getByUsername(input.username);
      if (!user || !verifyPassword(input.password, user.passwordHash)) {
        throw new AppError(ErrorCodes.INVALID_CREDENTIALS, "Invalid username or password", undefined, 401);
      }
      const projects = repos.projects.listForUser(user.id);
      const previous = repos.sessions.latestForUser(user.id);
      const preferred = previous?.activeProjectId;
      const activeProjectId =
        preferred && projects.some((project) => project.id === preferred) ? preferred : projects[0]?.id;
      const session = createSession(user.id, activeProjectId);
      syncDesk(activeProjectId);
      return { session, ...sessionPayload(session, user) };
    },

    logout(token: string | undefined): void {
      if (token) {
        repos.sessions.delete(token);
      }
    },

    resolveSession(token: string | undefined): Session | undefined {
      if (!token) {
        return undefined;
      }
      const session = repos.sessions.getByToken(token);
      if (!session) {
        return undefined;
      }
      return expireIfNeeded(session);
    },

    requireSession(token: string | undefined): Session {
      const session = this.resolveSession(token);
      if (!session) {
        throw new AppError(ErrorCodes.UNAUTHORIZED, "Sign in required", undefined, 401);
      }
      return session;
    },

    me(token: string | undefined) {
      const session = this.requireSession(token);
      return { session, ...sessionPayload(session, requireUser(session)) };
    },

    requireProjectAccess(token: string | undefined, projectId: string): Session {
      const session = this.requireSession(token);
      repos.projects.require(projectId);
      if (!repos.members.get(projectId, session.userId)) {
        throw new AppError(ErrorCodes.FORBIDDEN, "Not a member of this project", { projectId }, 403);
      }
      return session;
    },

    setActiveProject(token: string | undefined, raw: unknown) {
      const { projectId } = parse(setActiveProjectInput, raw);
      const session = this.requireProjectAccess(token, projectId);
      repos.sessions.setActiveProject(session.token, projectId);
      syncDesk(projectId);
      const next = { ...session, activeProjectId: projectId };
      return { session: next, ...sessionPayload(next, requireUser(session)) };
    },
  };
}
