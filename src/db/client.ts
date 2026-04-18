import { Database } from 'bun:sqlite'
import { drizzle, BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import * as schema from './schema'
import { paths } from '../shared/paths'

export type Db = BunSQLiteDatabase<typeof schema>

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS repositories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  url TEXT NOT NULL,
  local_path TEXT NOT NULL,
  default_branch TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  repository_id INTEGER NOT NULL REFERENCES repositories(id),
  column TEXT NOT NULL,
  position INTEGER NOT NULL,
  attempts_count INTEGER NOT NULL DEFAULT 0,
  branch_name TEXT,
  worktree_path TEXT,
  awaiting_return_column TEXT,
  last_failure_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS tasks_by_column ON tasks(column, position);

CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  verdict TEXT,
  summary TEXT,
  error TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER
);

CREATE INDEX IF NOT EXISTS runs_by_task ON runs(task_id, started_at);

CREATE TABLE IF NOT EXISTS approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  tool_input TEXT NOT NULL,
  tool_input_hash TEXT NOT NULL,
  judge_verdict TEXT,
  judge_reason TEXT,
  status TEXT NOT NULL,
  decision TEXT,
  decided_by TEXT,
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);

CREATE INDEX IF NOT EXISTS approvals_by_task_status ON approvals(task_id, status);
`

export function applySchema(sqlite: Database): void {
  sqlite.exec('PRAGMA foreign_keys = ON;')
  sqlite.exec(SCHEMA_SQL)
  ensureInstanceId(sqlite)
}

function ensureInstanceId(sqlite: Database): void {
  const row = sqlite
    .query("SELECT value FROM meta WHERE key = 'instance_id'")
    .get() as { value: string } | null
  if (row) return
  const id = randomBytes(4).toString('hex')
  sqlite
    .prepare("INSERT INTO meta (key, value) VALUES ('instance_id', ?)")
    .run(id)
}

export function getInstanceId(db: Db): string {
  const rows = db
    .select()
    .from(schema.meta)
    .where(eq(schema.meta.key, 'instance_id'))
    .all()
  const row = rows[0]
  if (!row) throw new Error('instance_id missing — DB not initialized')
  return row.value
}

export function createDb(file: string = paths.dbFile): Db {
  mkdirSync(dirname(file), { recursive: true })
  const sqlite = new Database(file)
  applySchema(sqlite)
  return drizzle(sqlite, { schema })
}

export function createMemoryDb(): Db {
  const sqlite = new Database(':memory:')
  applySchema(sqlite)
  return drizzle(sqlite, { schema })
}
