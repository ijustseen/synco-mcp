import { createAuthService, type AuthService } from "./services/auth-service.js";
import { createCoordinationService, type CoordinationService } from "./services/coordination-service.js";
import { closeDatabase, openDatabase, type DatabaseContext } from "../infrastructure/database/client.js";
import { createInProcessEventBus, type EventBus } from "../infrastructure/events/event-bus.js";
import { createRepositories, type Repositories } from "../infrastructure/repositories/sqlite-repos.js";

export type Runtime = {
  db: DatabaseContext;
  repos: Repositories;
  bus: EventBus;
  service: CoordinationService;
  auth: AuthService;
  close: () => void;
};

export function createRuntime(databasePath?: string): Runtime {
  const db = openDatabase(databasePath);
  const repos = createRepositories(db);
  const bus = createInProcessEventBus();
  const service = createCoordinationService(repos, bus);
  const auth = createAuthService(repos);
  service.seedDefaultProject();

  return {
    db,
    repos,
    bus,
    service,
    auth,
    close: () => closeDatabase(db),
  };
}
