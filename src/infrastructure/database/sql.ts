export const CREATE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  repository_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  platform TEXT NOT NULL,
  model TEXT,
  status TEXT NOT NULL,
  current_task_id TEXT,
  last_seen_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS agents_project_idx ON agents (project_id);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL,
  assigned_agent_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS tasks_project_status_idx ON tasks (project_id, status);

CREATE TABLE IF NOT EXISTS change_reports (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  task_id TEXT,
  agent_id TEXT NOT NULL,
  source TEXT NOT NULL,
  summary TEXT NOT NULL,
  files TEXT NOT NULL,
  affected_areas TEXT NOT NULL,
  interfaces_changed TEXT NOT NULL,
  behavior_changes TEXT NOT NULL,
  breaking_change TEXT NOT NULL,
  tests TEXT NOT NULL,
  next_steps TEXT NOT NULL,
  commit_hash TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS reports_project_created_idx ON change_reports (project_id, created_at);

CREATE TABLE IF NOT EXISTS project_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  type TEXT NOT NULL,
  agent_id TEXT,
  task_id TEXT,
  payload TEXT NOT NULL,
  correlation_id TEXT,
  idempotency_key TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_project_created_idx ON project_events (project_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS events_project_idempotency_idx
  ON project_events (project_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS resource_claims (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  task_id TEXT,
  resource_type TEXT NOT NULL,
  resource_path TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  released_at TEXT
);
CREATE INDEX IF NOT EXISTS claims_project_status_idx ON resource_claims (project_id, status);

CREATE TABLE IF NOT EXISTS handoffs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  from_agent_id TEXT NOT NULL,
  to_agent_id TEXT,
  task_id TEXT,
  summary TEXT NOT NULL,
  completed_work TEXT NOT NULL,
  remaining_work TEXT NOT NULL,
  important_files TEXT NOT NULL,
  known_issues TEXT NOT NULL,
  next_steps TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS handoffs_project_created_idx ON handoffs (project_id, created_at);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_idx ON users (username);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  active_project_id TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);

CREATE TABLE IF NOT EXISTS project_members (
  project_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, user_id)
);
CREATE INDEX IF NOT EXISTS members_user_idx ON project_members (user_id);

CREATE TABLE IF NOT EXISTS workspace_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;
