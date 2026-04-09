import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { repositories, tasks } from '../../db/schema'
import type { Db } from '../../db/client'
import type { GitClient } from '../../orchestrator/git-client'
import type { SseBus } from '../sse-bus'

// Git URL allowlist. Three accepted forms:
//   1. HTTPS:          https://host[:port]/path[.git]
//   2. SCP-like SSH:   git@host:path[.git]
//   3. ssh:// URL:     ssh://user@host[:port]/path[.git]
//
// `URL_HOST` is structured as dot-separated DNS labels: each label must
// start and end with an alphanumeric, may contain dashes in the middle,
// and labels are joined by single dots. That deliberately rejects
// hostnames beginning with `-` or `.`, hostnames with consecutive dots
// (`github..com`), and trailing-dot hostnames. `git clone -- <url>`
// in `git-client.ts` is the belt; this is the braces.
//
// `URL_USER` (SCP/ssh:// username) is intentionally narrow — `[\w.-]+`
// — and the canonical git forms use `git@` but we also accept
// alternative usernames (Gitea `gitea@`, self-hosted `forge@`, …) so
// long as they match that charset. `@` and `:` are both excluded so
// credentials cannot be smuggled in this field.
//
// `URL_PATH` characters are deliberately narrow — word chars, slash,
// dot, dash, tilde — no `:`, `@`, or `%`, to avoid giving any weight
// to URL percent-encoded traversal or credential smuggling. Symmetry
// across all three shapes is intentional.
const URL_HOST =
  /[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*/
const URL_USER = /[\w.-]+/
const URL_PATH = /[\w./~-]+?/
const HTTPS_URL_RE = new RegExp(
  `^https://${URL_HOST.source}(?::\\d+)?/${URL_PATH.source}(?:\\.git)?$`,
)
const SCP_URL_RE = new RegExp(
  `^${URL_USER.source}@${URL_HOST.source}:${URL_PATH.source}(?:\\.git)?$`,
)
// The username on `ssh://` is optional — `ssh://host/path.git` is a
// valid git URL (git infers the SSH user from the client config).
const SSH_URL_RE = new RegExp(
  `^ssh://(?:${URL_USER.source}@)?${URL_HOST.source}(?::\\d+)?/${URL_PATH.source}(?:\\.git)?$`,
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
      (s) => ({ message: explainUrlRejection(s) }),
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
      // local filesystem paths, and DNS error details. The same
      // argument applies to persistent server-side logs (journalctl,
      // log aggregators, terminal scrollback) — so we log only the
      // Error's `name`, not the message or the full object. An
      // operator debugging a specific clone failure can rerun
      // `git clone` from the shell with the exact URL to see the
      // verbose output; that's a deliberate trade in favour of never
      // writing third-party tokens to disk.
      const name = err instanceof Error ? err.name : typeof err
      console.error(`[repositories] clone failed (${name})`)
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

// Produce a per-shape error message so a user with a typo in an
// otherwise-valid URL gets a hint about which shape was closest,
// rather than a single generic "url must be X, Y, or Z".
function explainUrlRejection(url: string): string {
  if (/\s/.test(url)) {
    return 'url must not contain whitespace'
  }
  if (url.startsWith('https://')) {
    return 'invalid https url: expected https://host[:port]/path[.git], with host made of dot-separated alphanumeric labels'
  }
  if (url.startsWith('ssh://')) {
    return 'invalid ssh url: expected ssh://[user@]host[:port]/path[.git]'
  }
  if (/^[\w.-]+@/.test(url)) {
    return 'invalid scp-style url: expected user@host:path[.git]'
  }
  return 'url must be https://host/path, user@host:path, or ssh://[user@]host/path (no other schemes)'
}

function deriveName(url: string): string {
  const match = url.match(/([^\/:]+?)(?:\.git)?$/)
  const candidate = match?.[1] ?? ''
  if (/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(candidate)) return candidate
  // Fallback uses random bytes (not `Date.now()`) so two simultaneous
  // "garbage URL" submissions inside the same millisecond don't
  // collide on the unique `name` constraint and return a cryptic
  // sanitized 500 to the second caller.
  return `repo-${randomBytes(6).toString('hex')}`
}
