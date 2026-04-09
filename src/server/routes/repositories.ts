import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { repositories, tasks } from '../../db/schema'
import type { Db } from '../../db/client'
import type { GitClient } from '../../orchestrator/git-client'
import type { SseBus } from '../sse-bus'

// Git URL allowlist. Three accepted forms:
//   1. HTTPS:          https://host[:port]/path[.git]
//   2. SCP-like SSH:   git@host:path[.git]
//   3. ssh:// URL:     ssh://user@host[:port]/path[.git]
// Path characters are deliberately narrow — word chars, slash, dot,
// dash, tilde — no `:`, `@`, or `%`, to avoid giving any weight to URL
// percent-encoded traversal or credential smuggling. Symmetry across
// all three shapes is intentional.
const URL_HOST = /[\w.-]+/
const URL_PATH = /[\w./~-]+?/
const HTTPS_URL_RE = new RegExp(
  `^https://${URL_HOST.source}(?::\\d+)?/${URL_PATH.source}(?:\\.git)?$`,
)
const SCP_URL_RE = new RegExp(
  `^git@${URL_HOST.source}:${URL_PATH.source}(?:\\.git)?$`,
)
const SSH_URL_RE = new RegExp(
  `^ssh://${URL_HOST.source}@${URL_HOST.source}(?::\\d+)?/${URL_PATH.source}(?:\\.git)?$`,
)

const bodySchema = z.object({
  name: z
    .string()
    .min(1)
    .max(100, { message: 'name must be at most 100 characters' })
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
      (s) =>
        HTTPS_URL_RE.test(s) || SCP_URL_RE.test(s) || SSH_URL_RE.test(s),
      {
        message:
          'url must be https://host/path, git@host:path, or ssh://user@host/path (no other schemes, no whitespace)',
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
      // Do NOT echo `err.message` to the client: git's clone errors
      // routinely include the resolved URL (with any embedded tokens),
      // local filesystem paths, and DNS error details. Log server-side,
      // return a generic message.
      console.error('[repositories] clone failed:', err)
      return c.json({ error: 'failed to clone repository' }, 500)
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
  const candidate = match?.[1] ?? ''
  if (/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(candidate)) return candidate
  // Fallback includes a timestamp suffix so two simultaneous "garbage
  // URL" submissions don't collide on the unique `name` constraint and
  // produce a cryptic Drizzle error for the second caller.
  return `repo-${Date.now()}`
}
