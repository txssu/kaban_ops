import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { repositories, tasks } from '../../db/schema'
import type { Db } from '../../db/client'
import type { GitClient } from '../../orchestrator/git-client'
import type { SseBus } from '../sse-bus'

const HTTPS_URL_RE =
  /^https:\/\/[\w.-]+(?::\d+)?\/[\w./~\-:%@]+?(?:\.git)?$/
const SSH_URL_RE = /^git@[\w.-]+:[\w./~\-]+?(?:\.git)?$/

const bodySchema = z.object({
  name: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, {
      message:
        'name must start with an alphanumeric and contain only A-Z, a-z, 0-9, ., _, -',
    })
    .optional(),
  url: z
    .string()
    .min(1)
    .max(2048)
    .refine(
      (s) => HTTPS_URL_RE.test(s) || SSH_URL_RE.test(s),
      {
        message:
          'only https://… or git@host:path URLs are allowed (no ext::, file://, ssh://, or whitespace)',
      },
    ),
})

export function createRepositoryRoutes(deps: {
  db: Db
  bus: SseBus
  git: GitClient
}) {
  const app = new Hono()

  app.get('/', (c) => {
    const rows = deps.db.select().from(repositories).all()
    return c.json(
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        url: r.url,
        localPath: r.localPath,
        defaultBranch: r.defaultBranch,
        createdAt: r.createdAt,
      })),
    )
  })

  app.post('/', async (c) => {
    const raw = await c.req.json().catch(() => null)
    const parsed = bodySchema.safeParse(raw)
    if (!parsed.success) {
      return c.json({ error: 'invalid body' }, 400)
    }
    const name = parsed.data.name ?? deriveName(parsed.data.url)

    try {
      const info = await deps.git.cloneRepository({
        name,
        url: parsed.data.url,
      })
      const [row] = deps.db
        .insert(repositories)
        .values({
          name: info.name,
          url: parsed.data.url,
          localPath: info.localPath,
          defaultBranch: info.defaultBranch,
          createdAt: Date.now(),
        })
        .returning()
        .all()
      deps.bus.publish({
        type: 'repository.created',
        payload: { repositoryId: row!.id },
      })
      return c.json(row, 201)
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500)
    }
  })

  app.delete('/:id', (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400)
    const linked = deps.db
      .select()
      .from(tasks)
      .where(eq(tasks.repositoryId, id))
      .all()
    if (linked.length > 0) {
      return c.json({ error: 'repository still referenced by tasks' }, 409)
    }
    deps.db.delete(repositories).where(eq(repositories.id, id)).run()
    deps.bus.publish({
      type: 'repository.deleted',
      payload: { repositoryId: id },
    })
    return c.json({ ok: true })
  })

  return app
}

function deriveName(url: string): string {
  const match = url.match(/([^\/:]+?)(?:\.git)?$/)
  const candidate = match?.[1] ?? 'repo'
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(candidate) ? candidate : 'repo'
}
