import { test, expect } from 'bun:test'
import { eq } from 'drizzle-orm'
import { makeDb } from '../../tests/helpers/in-memory-db'
import { repositories, tasks, runs } from '../db/schema'
import { Orchestrator } from './orchestrator'
import { FakeAIRunner } from './runner'
import { SseBus } from '../server/sse-bus'
import type { GitClient } from './git-client'

class StubGitClient implements GitClient {
  createCalls: number[] = []
  removeCalls: number[] = []

  async cloneRepository() {
    return {
      name: 'stub',
      localPath: '/tmp/stub',
      defaultBranch: 'main',
    }
  }
  async fetchRepository() {}
  async createWorktree(input: {
    localPath: string
    defaultBranch: string
    taskId: number
  }) {
    this.createCalls.push(input.taskId)
    return `/tmp/wt/task-${input.taskId}`
  }
  async removeWorktree(input: { localPath: string; taskId: number }) {
    this.removeCalls.push(input.taskId)
  }
}

function seedRepo(db: ReturnType<typeof makeDb>) {
  const [repo] = db
    .insert(repositories)
    .values({
      name: 'r',
      url: 'u',
      localPath: '/tmp/r',
      defaultBranch: 'main',
      createdAt: 1,
    })
    .returning()
    .all()
  return repo!
}

function insertTask(
  db: ReturnType<typeof makeDb>,
  repoId: number,
  overrides: Partial<typeof tasks.$inferInsert> = {},
) {
  const [task] = db
    .insert(tasks)
    .values({
      title: 'T',
      description: '',
      repositoryId: repoId,
      column: 'todo',
      position: 0,
      createdAt: 1,
      updatedAt: 1,
      ...overrides,
    })
    .returning()
    .all()
  return task!
}

function makeOrchestrator(opts: {
  db: ReturnType<typeof makeDb>
  runner: FakeAIRunner
  git: GitClient
  bus?: SseBus
}): Orchestrator {
  return new Orchestrator({
    db: opts.db,
    runner: opts.runner,
    git: opts.git,
    bus: opts.bus ?? new SseBus(),
    config: {
      progressLimit: 1,
      aiReviewLimit: 1,
      maxAttempts: 3,
      taskTimeoutMs: 1_000_000,
    },
  })
}

test('tick() moves a TODO task to PROGRESS and runs the executor', async () => {
  const db = makeDb()
  const repo = seedRepo(db)
  insertTask(db, repo.id, { title: 'first', position: 0 })

  const runner = new FakeAIRunner()
  runner.queueExecutor({ summary: 'all done' })
  const git = new StubGitClient()

  const orch = makeOrchestrator({ db, runner, git })
  await orch.tick()
  await orch.drain()

  const after = db.select().from(tasks).all()
  expect(after).toHaveLength(1)
  expect(after[0]?.column).toBe('ai_review')
  expect(git.createCalls).toEqual([after[0]!.id])
  const allRuns = db.select().from(runs).all()
  expect(allRuns).toHaveLength(1)
  expect(allRuns[0]?.status).toBe('succeeded')
  expect(allRuns[0]?.summary).toBe('all done')
})

test('tick() honours progressLimit and does not pull a second task', async () => {
  const db = makeDb()
  const repo = seedRepo(db)
  insertTask(db, repo.id, { title: 'a', position: 0 })
  insertTask(db, repo.id, { title: 'b', position: 1 })

  const runner = new FakeAIRunner()
  runner.queueExecutor({ summary: 'a done' })
  const git = new StubGitClient()
  const orch = makeOrchestrator({ db, runner, git })

  await orch.tick()
  await orch.drain()

  const aiReview = db
    .select()
    .from(tasks)
    .where(eq(tasks.column, 'ai_review'))
    .all()
  const todo = db.select().from(tasks).where(eq(tasks.column, 'todo')).all()
  expect(aiReview).toHaveLength(1)
  expect(todo).toHaveLength(1)
})

test('executor failure routes task to HUMAN_REVIEW with last_failure_reason=error', async () => {
  const db = makeDb()
  const repo = seedRepo(db)
  insertTask(db, repo.id, { title: 'x', position: 0 })

  const runner = new FakeAIRunner()
  // Do not queue anything → runner throws
  const git = new StubGitClient()

  const orch = makeOrchestrator({ db, runner, git })
  await orch.tick()
  await orch.drain()

  const after = db.select().from(tasks).all()
  expect(after[0]?.column).toBe('human_review')
  expect(after[0]?.lastFailureReason).toBe('error')
})

test('reviewer approved moves task from AI_REVIEW_IN_PROGRESS to HUMAN_REVIEW', async () => {
  const db = makeDb()
  const repo = seedRepo(db)
  insertTask(db, repo.id, {
    title: 'x',
    column: 'ai_review',
    position: 0,
    branchName: 'kaban/task-1',
    worktreePath: '/tmp/wt/task-1',
  })
  // Seed a successful executor run so the reviewer has context
  const [createdTask] = db.select().from(tasks).all()
  db.insert(runs)
    .values({
      taskId: createdTask!.id,
      kind: 'executor',
      status: 'succeeded',
      summary: 'did it',
      startedAt: 1,
      endedAt: 2,
    })
    .run()

  const runner = new FakeAIRunner()
  runner.queueReviewer({ verdict: 'approved', summary: 'lgtm' })
  const git = new StubGitClient()
  const orch = makeOrchestrator({ db, runner, git })

  await orch.tick()
  await orch.drain()

  const after = db.select().from(tasks).all()
  expect(after[0]?.column).toBe('human_review')
})

test('reviewer rejected with attempts remaining routes task back to TODO and increments attempts', async () => {
  const db = makeDb()
  const repo = seedRepo(db)
  insertTask(db, repo.id, {
    title: 'x',
    column: 'ai_review',
    position: 0,
    attemptsCount: 1,
    branchName: 'kaban/task-1',
    worktreePath: '/tmp/wt/task-1',
  })
  const [createdTask] = db.select().from(tasks).all()
  db.insert(runs)
    .values({
      taskId: createdTask!.id,
      kind: 'executor',
      status: 'succeeded',
      summary: 'tried',
      startedAt: 1,
      endedAt: 2,
    })
    .run()

  const runner = new FakeAIRunner()
  runner.queueReviewer({ verdict: 'rejected', summary: 'no good' })
  const git = new StubGitClient()
  const orch = makeOrchestrator({ db, runner, git })

  await orch.tick()
  await orch.drain()

  const after = db.select().from(tasks).all()
  expect(after[0]?.column).toBe('todo')
  expect(after[0]?.attemptsCount).toBe(2)
})

test('reviewer rejected at limit routes task to HUMAN_REVIEW with max_retries', async () => {
  const db = makeDb()
  const repo = seedRepo(db)
  insertTask(db, repo.id, {
    title: 'x',
    column: 'ai_review',
    position: 0,
    attemptsCount: 2,
    branchName: 'kaban/task-1',
    worktreePath: '/tmp/wt/task-1',
  })
  const [createdTask] = db.select().from(tasks).all()
  db.insert(runs)
    .values({
      taskId: createdTask!.id,
      kind: 'executor',
      status: 'succeeded',
      summary: 'tried',
      startedAt: 1,
      endedAt: 2,
    })
    .run()

  const runner = new FakeAIRunner()
  runner.queueReviewer({ verdict: 'rejected', summary: 'still bad' })
  const git = new StubGitClient()
  const orch = makeOrchestrator({ db, runner, git })

  await orch.tick()
  await orch.drain()

  const after = db.select().from(tasks).all()
  expect(after[0]?.column).toBe('human_review')
  expect(after[0]?.attemptsCount).toBe(3)
  expect(after[0]?.lastFailureReason).toBe('max_retries')
})

test('abortTask aborts an in-flight executor and lands the task in HUMAN_REVIEW aborted', async () => {
  const db = makeDb()
  const repo = seedRepo(db)
  insertTask(db, repo.id, { title: 'x', position: 0 })

  const runner = new FakeAIRunner()
  let startResolved!: () => void
  const started = new Promise<void>((r) => (startResolved = r))
  runner.queueExecutor({ summary: 'never reached' })
  // Override execute to wait until aborted
  runner.execute = async (input) => {
    startResolved()
    await new Promise<void>((_, reject) => {
      input.signal.addEventListener('abort', () => {
        const err = new Error('aborted')
        err.name = 'AbortError'
        reject(err)
      })
    })
    return { summary: 'unused' }
  }
  const git = new StubGitClient()
  const orch = makeOrchestrator({ db, runner, git })

  await orch.tick()
  await started

  const running = db.select().from(tasks).where(eq(tasks.column, 'progress')).all()
  expect(running).toHaveLength(1)
  const targetId = running[0]!.id

  orch.abortTask(targetId)
  await orch.drain()

  const after = db.select().from(tasks).all()
  expect(after[0]?.column).toBe('human_review')
  expect(after[0]?.lastFailureReason).toBe('aborted')
})

test('recoverFromCrash moves orphaned active tasks to HUMAN_REVIEW with error', () => {
  const db = makeDb()
  const repo = seedRepo(db)
  insertTask(db, repo.id, { title: 'x', column: 'progress', position: 0 })
  insertTask(db, repo.id, {
    title: 'y',
    column: 'ai_review_in_progress',
    position: 0,
  })

  const runner = new FakeAIRunner()
  const git = new StubGitClient()
  const orch = makeOrchestrator({ db, runner, git })
  orch.recoverFromCrash()

  const after = db.select().from(tasks).all()
  expect(after.every((t) => t.column === 'human_review')).toBe(true)
  expect(after.every((t) => t.lastFailureReason === 'error')).toBe(true)
})
