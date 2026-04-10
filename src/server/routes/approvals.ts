import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { approvals } from '../../db/schema'
import type { Db } from '../../db/client'
import type { PermissionCoordinator } from '../../orchestrator/permissions/coordinator'

const decideSchema = z.object({
  decision: z.enum(['allow_once', 'allow_for_task', 'deny']),
})

export function createApprovalRoutes(deps: {
  db: Db
  coordinator: PermissionCoordinator
}) {
  const app = new Hono()

  app.get('/', (c) => {
    const status = c.req.query('status') ?? 'pending'
    const rows = deps.db
      .select()
      .from(approvals)
      .where(eq(approvals.status, status))
      .all()
    return c.json(
      rows.map((r) => ({
        id: r.id,
        taskId: r.taskId,
        runId: r.runId,
        toolName: r.toolName,
        toolInputPreview: r.toolInput.slice(0, 500),
        toolInputHash: r.toolInputHash,
        judgeVerdict: r.judgeVerdict,
        judgeReason: r.judgeReason,
        status: r.status,
        decision: r.decision,
        decidedBy: r.decidedBy,
        createdAt: r.createdAt,
        decidedAt: r.decidedAt,
      })),
    )
  })

  app.get('/:id', (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400)
    const [row] = deps.db
      .select()
      .from(approvals)
      .where(eq(approvals.id, id))
      .all()
    if (!row) return c.json({ error: 'not found' }, 404)
    return c.json(row)
  })

  app.post('/:id/decide', async (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400)

    const raw = await c.req.json().catch(() => null)
    const parsed = decideSchema.safeParse(raw)
    if (!parsed.success) return c.json({ error: 'invalid body' }, 400)

    const [row] = deps.db
      .select()
      .from(approvals)
      .where(eq(approvals.id, id))
      .all()
    if (!row) return c.json({ error: 'not found' }, 404)
    if (row.status !== 'pending') {
      return c.json({ error: 'approval is not pending' }, 409)
    }

    try {
      await deps.coordinator.resolve(id, parsed.data.decision)
      return c.json({ ok: true })
    } catch (err) {
      return c.json({ error: (err as Error).message }, 409)
    }
  })

  return app
}
