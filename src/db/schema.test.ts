import { test, expect } from 'bun:test'
import { eq } from 'drizzle-orm'
import { makeDb } from '../../tests/helpers/in-memory-db'
import { repositories, tasks, runs } from './schema'

test('repositories table accepts inserts and enforces unique name', () => {
  const db = makeDb()
  db.insert(repositories)
    .values({
      name: 'foo',
      url: 'git@example.com:foo.git',
      localPath: '.data/repos/foo',
      defaultBranch: 'main',
      createdAt: 1,
    })
    .run()

  const rows = db.select().from(repositories).all()
  expect(rows).toHaveLength(1)
  expect(rows[0]?.name).toBe('foo')

  expect(() =>
    db
      .insert(repositories)
      .values({
        name: 'foo',
        url: 'git@example.com:foo.git',
        localPath: '.data/repos/foo',
        defaultBranch: 'main',
        createdAt: 2,
      })
      .run(),
  ).toThrow()
})

test('tasks table defaults attempts_count to 0 and stores nullable fields', () => {
  const db = makeDb()
  const [repo] = db
    .insert(repositories)
    .values({
      name: 'r',
      url: 'x',
      localPath: '.data/repos/r',
      defaultBranch: 'main',
      createdAt: 1,
    })
    .returning()
    .all()

  db.insert(tasks)
    .values({
      title: 'first',
      description: 'desc',
      repositoryId: repo!.id,
      column: 'backlog',
      position: 0,
      createdAt: 1,
      updatedAt: 1,
    })
    .run()

  const rows = db.select().from(tasks).all()
  expect(rows).toHaveLength(1)
  expect(rows[0]?.attemptsCount).toBe(0)
  expect(rows[0]?.branchName).toBeNull()
  expect(rows[0]?.lastFailureReason).toBeNull()
})

test('deleting a task cascades to its runs', () => {
  const db = makeDb()
  const [repo] = db
    .insert(repositories)
    .values({
      name: 'r',
      url: 'x',
      localPath: '.data/repos/r',
      defaultBranch: 'main',
      createdAt: 1,
    })
    .returning()
    .all()
  const [task] = db
    .insert(tasks)
    .values({
      title: 'x',
      description: '',
      repositoryId: repo!.id,
      column: 'todo',
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
      status: 'succeeded',
      summary: 'ok',
      startedAt: 1,
      endedAt: 2,
    })
    .run()

  db.delete(tasks).where(eq(tasks.id, task!.id)).run()

  const remaining = db.select().from(runs).all()
  expect(remaining).toHaveLength(0)
})
