import { test, expect } from 'bun:test'
import { makeDb } from '../../tests/helpers/in-memory-db'
import { SseBus } from './sse-bus'
import { repositories } from '../db/schema'
import { createApp } from './app'
import type { GitClient } from '../orchestrator/git-client'
import { tasks, runs } from '../db/schema'
import { eq } from 'drizzle-orm'
import { defaultConfig } from '../shared/config'

class StubGit implements GitClient {
  async cloneRepository(input: { name: string; url: string }) {
    return {
      name: input.name,
      localPath: `/tmp/repos/${input.name}`,
      defaultBranch: 'main',
    }
  }
  async fetchRepository() {}
  async createWorktree() {
    return '/tmp/wt'
  }
  async removeWorktree() {}
}

test('POST /api/repositories clones and stores the repo', async () => {
  const db = makeDb()
  const app = createApp({
    db,
    bus: new SseBus(),
    git: new StubGit(),
    onStopTask: () => {},
    config: defaultConfig,
  })
  const res = await app.request('/api/repositories', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'proj', url: 'git@example.com:proj.git' }),
  })
  expect(res.status).toBe(201)
  const body = (await res.json()) as Record<string, unknown>
  expect(body.name).toBe('proj')
  expect(body.defaultBranch).toBe('main')

  const rows = db.select().from(repositories).all()
  expect(rows).toHaveLength(1)
})

test('GET /api/repositories returns the list', async () => {
  const db = makeDb()
  db.insert(repositories)
    .values({
      name: 'a',
      url: 'u',
      localPath: '/tmp/a',
      defaultBranch: 'main',
      createdAt: 1,
    })
    .run()

  const app = createApp({
    db,
    bus: new SseBus(),
    git: new StubGit(),
    onStopTask: () => {},
    config: defaultConfig,
  })
  const res = await app.request('/api/repositories')
  expect(res.status).toBe(200)
  const body = (await res.json()) as Array<Record<string, unknown>>
  expect(body).toHaveLength(1)
  expect(body[0]!.name).toBe('a')
})

function seedRepo(db: ReturnType<typeof makeDb>) {
  const [repo] = db
    .insert(repositories)
    .values({
      name: 'proj',
      url: 'u',
      localPath: '/tmp/proj',
      defaultBranch: 'main',
      createdAt: 1,
    })
    .returning()
    .all()
  return repo!
}

test('POST /api/tasks creates a task in BACKLOG', async () => {
  const db = makeDb()
  const repo = seedRepo(db)
  const app = createApp({
    db,
    bus: new SseBus(),
    git: new StubGit(),
    onStopTask: () => {},
    config: defaultConfig,
  })

  const res = await app.request('/api/tasks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: 'first',
      description: 'do the thing',
      repositoryId: repo.id,
    }),
  })
  expect(res.status).toBe(201)
  const rows = db.select().from(tasks).all()
  expect(rows).toHaveLength(1)
  expect(rows[0]?.column).toBe('backlog')
})

test('GET /api/tasks returns tasks with active_run_started_at derived', async () => {
  const db = makeDb()
  const repo = seedRepo(db)
  const [task] = db
    .insert(tasks)
    .values({
      title: 'active',
      description: '',
      repositoryId: repo.id,
      column: 'progress',
      position: 0,
      createdAt: 1,
      updatedAt: 1,
    })
    .returning()
    .all()
  db.insert(runs)
    .values({
      taskId: task!.id,
      kind: 'executor',
      status: 'running',
      startedAt: 12345,
    })
    .run()

  const app = createApp({
    db,
    bus: new SseBus(),
    git: new StubGit(),
    onStopTask: () => {},
    config: defaultConfig,
  })
  const res = await app.request('/api/tasks')
  const body = (await res.json()) as Array<{ activeRunStartedAt: number | null }>
  expect(body).toHaveLength(1)
  expect(body[0]!.activeRunStartedAt).toBe(12345)
})

test('PATCH /api/tasks/:id rejects moves into PROGRESS', async () => {
  const db = makeDb()
  const repo = seedRepo(db)
  const [task] = db
    .insert(tasks)
    .values({
      title: 't',
      description: '',
      repositoryId: repo.id,
      column: 'todo',
      position: 0,
      createdAt: 1,
      updatedAt: 1,
    })
    .returning()
    .all()

  const app = createApp({
    db,
    bus: new SseBus(),
    git: new StubGit(),
    onStopTask: () => {},
    config: defaultConfig,
  })
  const res = await app.request(`/api/tasks/${task!.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ column: 'progress' }),
  })
  expect(res.status).toBe(409)
})

test('PATCH /api/tasks/:id manual HUMAN_REVIEW→TODO clears attempts and failure', async () => {
  const db = makeDb()
  const repo = seedRepo(db)
  const [task] = db
    .insert(tasks)
    .values({
      title: 't',
      description: '',
      repositoryId: repo.id,
      column: 'human_review',
      position: 0,
      attemptsCount: 2,
      lastFailureReason: 'error',
      createdAt: 1,
      updatedAt: 1,
    })
    .returning()
    .all()

  const app = createApp({
    db,
    bus: new SseBus(),
    git: new StubGit(),
    onStopTask: () => {},
    config: defaultConfig,
  })
  const res = await app.request(`/api/tasks/${task!.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ column: 'todo' }),
  })
  expect(res.status).toBe(200)
  const after = db.select().from(tasks).where(eq(tasks.id, task!.id)).all()
  expect(after[0]?.attemptsCount).toBe(0)
  expect(after[0]?.lastFailureReason).toBeNull()
})

test('DELETE /api/tasks/:id removes the task and blocks deletion of active tasks', async () => {
  const db = makeDb()
  const repo = seedRepo(db)
  const [t1] = db
    .insert(tasks)
    .values({
      title: 'a',
      description: '',
      repositoryId: repo.id,
      column: 'backlog',
      position: 0,
      createdAt: 1,
      updatedAt: 1,
    })
    .returning()
    .all()
  const [t2] = db
    .insert(tasks)
    .values({
      title: 'b',
      description: '',
      repositoryId: repo.id,
      column: 'progress',
      position: 0,
      createdAt: 1,
      updatedAt: 1,
    })
    .returning()
    .all()

  const app = createApp({
    db,
    bus: new SseBus(),
    git: new StubGit(),
    onStopTask: () => {},
    config: defaultConfig,
  })
  const ok = await app.request(`/api/tasks/${t1!.id}`, { method: 'DELETE' })
  expect(ok.status).toBe(200)

  const blocked = await app.request(`/api/tasks/${t2!.id}`, {
    method: 'DELETE',
  })
  expect(blocked.status).toBe(409)
})

test('POST /api/tasks/:id/stop calls onStopTask callback', async () => {
  const db = makeDb()
  const repo = seedRepo(db)
  const [task] = db
    .insert(tasks)
    .values({
      title: 'x',
      description: '',
      repositoryId: repo.id,
      column: 'progress',
      position: 0,
      createdAt: 1,
      updatedAt: 1,
    })
    .returning()
    .all()

  const stopped: number[] = []
  const app = createApp({
    db,
    bus: new SseBus(),
    git: new StubGit(),
    onStopTask: (id) => stopped.push(id),
    config: defaultConfig,
  })
  const res = await app.request(`/api/tasks/${task!.id}/stop`, {
    method: 'POST',
  })
  expect(res.status).toBe(200)
  expect(stopped).toEqual([task!.id])
})

test('GET /api/config returns only operational limits', async () => {
  const db = makeDb()
  const app = createApp({
    db,
    bus: new SseBus(),
    git: new StubGit(),
    onStopTask: () => {},
    config: {
      progressLimit: 4,
      aiReviewLimit: 2,
      maxAttempts: 5,
      taskTimeoutMs: 60_000,
      bindHost: '127.0.0.1',
      port: 3000,
    },
  })
  const res = await app.request('/api/config')
  expect(res.status).toBe(200)
  const body = (await res.json()) as Record<string, unknown>
  expect(body).toEqual({
    progressLimit: 4,
    aiReviewLimit: 2,
    maxAttempts: 5,
  })
  // Sanity — nothing else leaks.
  expect(body.bindHost).toBeUndefined()
  expect(body.port).toBeUndefined()
  expect(body.taskTimeoutMs).toBeUndefined()
})

test('POST /api/repositories rejects ext:: URLs', async () => {
  const db = makeDb()
  const app = createApp({
    db,
    bus: new SseBus(),
    git: new StubGit(),
    onStopTask: () => {},
    config: defaultConfig,
  })
  const res = await app.request('/api/repositories', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'evil',
      url: "ext::sh -c 'echo pwned'",
    }),
  })
  expect(res.status).toBe(400)
})

test('POST /api/repositories rejects URL paths containing ..', async () => {
  const db = makeDb()
  const app = createApp({
    db,
    bus: new SseBus(),
    git: new StubGit(),
    onStopTask: () => {},
    config: defaultConfig,
  })
  const res = await app.request('/api/repositories', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'traverse',
      url: 'https://github.com/user/../../etc/passwd',
    }),
  })
  expect(res.status).toBe(400)
})

test('POST /api/repositories rejects file:// URLs', async () => {
  const db = makeDb()
  const app = createApp({
    db,
    bus: new SseBus(),
    git: new StubGit(),
    onStopTask: () => {},
    config: defaultConfig,
  })
  const res = await app.request('/api/repositories', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'evil',
      url: 'file:///etc/passwd',
    }),
  })
  expect(res.status).toBe(400)
})

test('POST /api/repositories rejects URLs containing whitespace', async () => {
  const db = makeDb()
  const app = createApp({
    db,
    bus: new SseBus(),
    git: new StubGit(),
    onStopTask: () => {},
    config: defaultConfig,
  })
  const res = await app.request('/api/repositories', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'evil',
      url: 'https://github.com/a/b.git --upload-pack=echo',
    }),
  })
  expect(res.status).toBe(400)
})

test('POST /api/repositories accepts a plain https URL', async () => {
  const db = makeDb()
  const app = createApp({
    db,
    bus: new SseBus(),
    git: new StubGit(),
    onStopTask: () => {},
    config: defaultConfig,
  })
  const res = await app.request('/api/repositories', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'proj-https',
      url: 'https://github.com/example/proj.git',
    }),
  })
  expect(res.status).toBe(201)
})

test('POST /api/repositories accepts a git@host:path URL', async () => {
  const db = makeDb()
  const app = createApp({
    db,
    bus: new SseBus(),
    git: new StubGit(),
    onStopTask: () => {},
    config: defaultConfig,
  })
  const res = await app.request('/api/repositories', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'proj-ssh',
      url: 'git@github.com:example/proj.git',
    }),
  })
  expect(res.status).toBe(201)
})

test('POST /api/repositories rejects an oversized url', async () => {
  const db = makeDb()
  const app = createApp({
    db,
    bus: new SseBus(),
    git: new StubGit(),
    onStopTask: () => {},
    config: defaultConfig,
  })
  const res = await app.request('/api/repositories', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'big',
      url: 'https://github.com/' + 'a'.repeat(3000),
    }),
  })
  expect(res.status).toBe(400)
})

test('POST /api/repositories rejects name with path traversal', async () => {
  const db = makeDb()
  const app = createApp({
    db,
    bus: new SseBus(),
    git: new StubGit(),
    onStopTask: () => {},
    config: defaultConfig,
  })
  const res = await app.request('/api/repositories', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: '../../.ssh/authorized_keys',
      url: 'https://github.com/example/proj.git',
    }),
  })
  expect(res.status).toBe(400)
})

test('POST /api/repositories rejects name with leading dot', async () => {
  const db = makeDb()
  const app = createApp({
    db,
    bus: new SseBus(),
    git: new StubGit(),
    onStopTask: () => {},
    config: defaultConfig,
  })
  const res = await app.request('/api/repositories', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: '.hidden',
      url: 'https://github.com/example/proj.git',
    }),
  })
  expect(res.status).toBe(400)
})

test('POST /api/repositories rejects name with slash', async () => {
  const db = makeDb()
  const app = createApp({
    db,
    bus: new SseBus(),
    git: new StubGit(),
    onStopTask: () => {},
    config: defaultConfig,
  })
  const res = await app.request('/api/repositories', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'foo/bar',
      url: 'https://github.com/example/proj.git',
    }),
  })
  expect(res.status).toBe(400)
})

test('POST /api/repositories rejects name with NUL byte', async () => {
  const db = makeDb()
  const app = createApp({
    db,
    bus: new SseBus(),
    git: new StubGit(),
    onStopTask: () => {},
    config: defaultConfig,
  })
  const res = await app.request('/api/repositories', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'foo\x00bar',
      url: 'https://github.com/example/proj.git',
    }),
  })
  expect(res.status).toBe(400)
})

test('POST /api/repositories accepts a reasonable name', async () => {
  const db = makeDb()
  const app = createApp({
    db,
    bus: new SseBus(),
    git: new StubGit(),
    onStopTask: () => {},
    config: defaultConfig,
  })
  const res = await app.request('/api/repositories', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'my_proj-v2.0',
      url: 'https://github.com/example/proj.git',
    }),
  })
  expect(res.status).toBe(201)
})

test('POST /api/tasks rejects oversized title', async () => {
  const db = makeDb()
  const repo = seedRepo(db)
  const app = createApp({
    db,
    bus: new SseBus(),
    git: new StubGit(),
    onStopTask: () => {},
    config: defaultConfig,
  })
  const res = await app.request('/api/tasks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: 'a'.repeat(300),
      description: '',
      repositoryId: repo.id,
    }),
  })
  expect(res.status).toBe(400)
})

test('POST /api/tasks rejects oversized description', async () => {
  const db = makeDb()
  const repo = seedRepo(db)
  const app = createApp({
    db,
    bus: new SseBus(),
    git: new StubGit(),
    onStopTask: () => {},
    config: defaultConfig,
  })
  const res = await app.request('/api/tasks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: 'ok',
      description: 'x'.repeat(20_000),
      repositoryId: repo.id,
    }),
  })
  expect(res.status).toBe(400)
})
