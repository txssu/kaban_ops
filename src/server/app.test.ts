import { test, expect } from 'bun:test'
import { makeDb } from '../../tests/helpers/in-memory-db'
import { SseBus } from './sse-bus'
import { repositories } from '../db/schema'
import { createApp } from './app'
import type { GitClient } from '../orchestrator/git-client'

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
  })
  const res = await app.request('/api/repositories')
  expect(res.status).toBe(200)
  const body = (await res.json()) as Array<Record<string, unknown>>
  expect(body).toHaveLength(1)
  expect(body[0]!.name).toBe('a')
})
