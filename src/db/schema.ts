import { sqliteTable, integer, text, index } from 'drizzle-orm/sqlite-core'

export const meta = sqliteTable('meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})

export const repositories = sqliteTable('repositories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  url: text('url').notNull(),
  localPath: text('local_path').notNull(),
  defaultBranch: text('default_branch').notNull(),
  createdAt: integer('created_at').notNull(),
})

export const tasks = sqliteTable(
  'tasks',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    repositoryId: integer('repository_id')
      .notNull()
      .references(() => repositories.id),
    column: text('column').notNull(),
    position: integer('position').notNull(),
    attemptsCount: integer('attempts_count').notNull().default(0),
    branchName: text('branch_name'),
    worktreePath: text('worktree_path'),
    awaitingReturnColumn: text('awaiting_return_column'),
    lastFailureReason: text('last_failure_reason'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('tasks_by_column').on(t.column, t.position)],
)

export const runs = sqliteTable(
  'runs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    taskId: integer('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    status: text('status').notNull(),
    verdict: text('verdict'),
    summary: text('summary'),
    error: text('error'),
    startedAt: integer('started_at').notNull(),
    endedAt: integer('ended_at'),
  },
  (t) => [index('runs_by_task').on(t.taskId, t.startedAt)],
)

export const approvals = sqliteTable(
  'approvals',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    taskId: integer('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    runId: integer('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    toolName: text('tool_name').notNull(),
    toolInput: text('tool_input').notNull(),
    toolInputHash: text('tool_input_hash').notNull(),
    judgeVerdict: text('judge_verdict'),
    judgeReason: text('judge_reason'),
    status: text('status').notNull(),
    decision: text('decision'),
    decidedBy: text('decided_by'),
    createdAt: integer('created_at').notNull(),
    decidedAt: integer('decided_at'),
  },
  (t) => [index('approvals_by_task_status').on(t.taskId, t.status)],
)
