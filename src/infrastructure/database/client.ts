import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { config } from "../../shared/config.js";
import * as schema from "./schema.js";
import { CREATE_TABLES_SQL } from "./sql.js";

export type Db = BetterSQLite3Database<typeof schema>;

export type DatabaseContext = {
  sqlite: Database.Database;
  db: Db;
  transaction: <T>(fn: () => T) => T;
};

export function openDatabase(databasePath = config.databasePath): DatabaseContext {
  if (databasePath !== ":memory:") {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  }

  const sqlite = new Database(databasePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.exec(CREATE_TABLES_SQL);

  const db = drizzle(sqlite, { schema });

  return {
    sqlite,
    db,
    transaction: <T>(fn: () => T): T => sqlite.transaction(fn)(),
  };
}

export function closeDatabase(ctx: DatabaseContext): void {
  ctx.sqlite.close();
}
