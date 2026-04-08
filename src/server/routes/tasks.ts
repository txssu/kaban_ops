import { Hono } from 'hono'
import { eq, sql, desc } from 'drizzle-orm'
import { z } from 'zod'
import { tasks, runs } from '../../db/schema'
import type { Db } from '../../db/client'
import type { SseBus } from '../sse-bus'
import type { Task, TaskColumn } from '../../shared/types'
import {
  canEditTask,
  canManuallyMove,
  clearFailureOnReopen,
  isActiveColumn,
} from '../../domain/task'
import { TASK_COLUMNS } from '../../shared/types'

const TITLE_MAX = 200
const DESCRIPTION_MAX = 10_000

const createSchema = z.object({
  title: z.string().min(1).max(TITLE_MAX),
  description: z.string().max(DESCRIPTION_MAX).default(''),
  repositoryId: z.number().int().positive(),
})

const patchSchema = z.object({
  title: z.string().min(1).max(TITLE_MAX).optional(),
  description: z.string().max(DESCRIPTION_MAX).optional(),
  repositoryId: z.number().int().positive().optional(),
  column: z.enum(TASK_COLUMNS).optional(),
  position: z.number().int().nonnegative().optional(),
})

export function createTaskRoutes(deps: {
  db: Db
  bus: SseBus
  onStopTask: (taskId: number) => void
}) {
  const app = new Hono()

  app.get('/', (c) => {
    const rows = deps.db
      .select({
        task: tasks,
        activeRunStartedAt: sql<number | null>`(
          SELECT ${runs.startedAt} FROM ${runs}
          WHERE ${runs.taskId} = ${tasks.id} AND ${runs.status} = 'running'
          ORDER BY ${runs.startedAt} DESC LIMIT 1
        )`,
      })
      .from(tasks)
      .all()

    return c.json(
      rows.map((r) => ({
        ...r.task,
        activeRunStartedAt: r.activeRunStartedAt ?? null,
      })),
    )
  })

  app.get('/:id/runs', (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400)
    const rows = deps.db
      .select()
      .from(runs)
      .where(eq(runs.taskId, id))
      .orderBy(desc(runs.startedAt))
      .all()
    return c.json(rows)
  })

  app.post('/', async (c) => {
    const raw = await c.req.json().catch(() => null)
    const parsed = createSchema.safeParse(raw)
    if (!parsed.success) return c.json({ error: 'invalid body' }, 400)

    const maxRow = deps.db
      .select({
        max: sql<number>`COALESCE(MAX(${tasks.position}), -1)`,
      })
      .from(tasks)
      .where(eq(tasks.column, 'backlog'))
      .all()[0]
    const max = maxRow?.max ?? -1

    const now = Date.now()
    const [row] = deps.db
      .insert(tasks)
      .values({
        title: parsed.data.title,
        description: parsed.data.description,
        repositoryId: parsed.data.repositoryId,
        column: 'backlog',
        position: max + 1,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .all()
    deps.bus.publish({ type: 'task.created', payload: { taskId: row!.id } })
    return c.json(row, 201)
  })

  app.patch('/:id', async (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400)
    const raw = await c.req.json().catch(() => null)
    const parsed = patchSchema.safeParse(raw)
    if (!parsed.success) return c.json({ error: 'invalid body' }, 400)

    const [existing] = deps.db
      .select()
      .from(tasks)
      .where(eq(tasks.id, id))
      .all()
    if (!existing) return c.json({ error: 'not found' }, 404)

    const existingTask = existing as unknown as Task

    if (!canEditTask(existingTask)) {
      return c.json({ error: 'task is active and cannot be edited' }, 409)
    }

    if (
      parsed.data.column &&
      parsed.data.column !== existingTask.column &&
      !canManuallyMove(existingTask.column, parsed.data.column)
    ) {
      return c.json({ error: 'transition not allowed' }, 409)
    }

    const patch: Record<string, unknown> = { updatedAt: Date.now() }
    if (parsed.data.title !== undefined) patch.title = parsed.data.title
    if (parsed.data.description !== undefined)
      patch.description = parsed.data.description
    if (parsed.data.repositoryId !== undefined)
      patch.repositoryId = parsed.data.repositoryId
    if (parsed.data.column !== undefined) {
      patch.column = parsed.data.column
      const nextPos =
        parsed.data.position ??
        (
          deps.db
            .select({
              max: sql<number>`COALESCE(MAX(${tasks.position}), -1)`,
            })
            .from(tasks)
            .where(eq(tasks.column, parsed.data.column))
            .all()[0]?.max ?? -1
        ) + 1
      patch.position = nextPos
      Object.assign(patch, clearFailureOnReopen(existingTask, parsed.data.column))
    } else if (parsed.data.position !== undefined) {
      patch.position = parsed.data.position
    }

    deps.db.update(tasks).set(patch).where(eq(tasks.id, id)).run()
    deps.bus.publish({ type: 'task.updated', payload: { taskId: id } })
    const [updated] = deps.db
      .select()
      .from(tasks)
      .where(eq(tasks.id, id))
      .all()
    return c.json(updated)
  })

  app.delete('/:id', (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400)
    const [existing] = deps.db
      .select()
      .from(tasks)
      .where(eq(tasks.id, id))
      .all()
    if (!existing) return c.json({ error: 'not found' }, 404)

    if (isActiveColumn(existing.column as TaskColumn)) {
      return c.json({ error: 'task is active' }, 409)
    }

    deps.db.delete(tasks).where(eq(tasks.id, id)).run()
    deps.bus.publish({ type: 'task.deleted', payload: { taskId: id } })
    return c.json({ ok: true })
  })

  app.post('/:id/stop', (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400)
    deps.onStopTask(id)
    return c.json({ ok: true })
  })

  return app
}
