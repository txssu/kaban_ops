import { test, expect } from 'bun:test'
import { eq } from 'drizzle-orm'
import { makeDb } from '../../../tests/helpers/in-memory-db'
import { repositories, tasks, runs, approvals } from '../../db/schema'
import { SseBus } from '../../server/sse-bus'
import { PermissionCoordinator } from './coordinator'
import type { Judge, JudgeInput, JudgeVerdict } from './judge'
import type { OrchestratorSlotHooks } from './coordinator'

class FakeJudge implements Judge {
  calls: JudgeInput[] = []
  private queue: JudgeVerdict[] = []

  queueVerdict(v: JudgeVerdict) {
    this.queue.push(v)
  }

  async classify(input: JudgeInput): Promise<JudgeVerdict> {
    this.calls.push(input)
    const next = this.queue.shift()
    if (!next) return { verdict: 'ask_human', reason: 'no queued verdict' }
    return next
  }
}

class StubSlotHooks implements OrchestratorSlotHooks {
  released: number[] = []
  reacquired: number[] = []
  releaseSlot(taskId: number) {
    this.released.push(taskId)
  }
  reacquireSlot(taskId: number) {
    this.reacquired.push(taskId)
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

function seedTask(
  db: ReturnType<typeof makeDb>,
  repoId: number,
  col = 'progress' as string,
) {
  const [task] = db
    .insert(tasks)
    .values({
      title: 'T',
      description: 'desc',
      repositoryId: repoId,
      column: col,
      position: 0,
      createdAt: 1,
      updatedAt: 1,
      worktreePath: '/tmp/wt/task-1',
    })
    .returning()
    .all()
  return task!
}

function seedRun(db: ReturnType<typeof makeDb>, taskId: number) {
  const [run] = db
    .insert(runs)
    .values({
      taskId,
      kind: 'executor',
      status: 'running',
      startedAt: Date.now(),
    })
    .returning()
    .all()
  return run!
}

function makeCoordinator(
  overrides: {
    db?: ReturnType<typeof makeDb>
    judge?: FakeJudge
    bus?: SseBus
    slots?: StubSlotHooks
    judgeMode?: 'advisory' | 'enforcing'
  } = {},
) {
  const db = overrides.db ?? makeDb()
  const judge = overrides.judge ?? new FakeJudge()
  const bus = overrides.bus ?? new SseBus()
  const slots = overrides.slots ?? new StubSlotHooks()
  const config = {
    judgeMode: (overrides.judgeMode ?? 'advisory') as 'advisory' | 'enforcing',
    judgeModel: 'test',
    judgeTimeoutMs: 5000,
  }
  return {
    coordinator: new PermissionCoordinator(db, judge, config, bus, slots),
    db,
    judge,
    bus,
    slots,
  }
}

function makeCtx(task: { id: number }, run: { id: number }) {
  return {
    taskId: task.id,
    runId: run.id,
    worktreePath: '/tmp/wt/task-1',
    taskTitle: 'T',
    taskDescription: 'desc',
  }
}

// --- Layer 1: Hardcoded deny ---

test('hardcoded deny: rm -rf → deny, judge not called', async () => {
  const { coordinator, db, judge } = makeCoordinator()
  const repo = seedRepo(db)
  const task = seedTask(db, repo.id)
  const run = seedRun(db, task.id)

  const result = await coordinator.evaluate(
    makeCtx(task, run),
    'Bash',
    { command: 'rm -rf /' },
    AbortSignal.timeout(5000),
  )

  expect(result.behavior).toBe('deny')
  expect(judge.calls).toHaveLength(0)
  const rows = db.select().from(approvals).all()
  expect(rows).toHaveLength(1)
  expect(rows[0]!.decidedBy).toBe('hardcoded')
  expect(rows[0]!.status).toBe('denied')
})

// --- Layer 2: Hardcoded allow ---

test('hardcoded allow: Read → allow, no approvals row', async () => {
  const { coordinator, db, judge } = makeCoordinator()
  const repo = seedRepo(db)
  const task = seedTask(db, repo.id)
  const run = seedRun(db, task.id)

  const result = await coordinator.evaluate(
    makeCtx(task, run),
    'Read',
    { file_path: '/any/path' },
    AbortSignal.timeout(5000),
  )

  expect(result.behavior).toBe('allow')
  expect(judge.calls).toHaveLength(0)
  expect(db.select().from(approvals).all()).toHaveLength(0)
})

// --- Layer 4: Judge enforcing ---

test('enforcing + safe → auto-allow with judge row', async () => {
  const { coordinator, db, judge } = makeCoordinator({ judgeMode: 'enforcing' })
  const repo = seedRepo(db)
  const task = seedTask(db, repo.id)
  const run = seedRun(db, task.id)

  judge.queueVerdict({ verdict: 'safe', reason: 'ok' })
  const result = await coordinator.evaluate(
    makeCtx(task, run),
    'WebFetch',
    { url: 'https://example.com' },
    AbortSignal.timeout(5000),
  )

  expect(result.behavior).toBe('allow')
  const rows = db.select().from(approvals).all()
  expect(rows).toHaveLength(1)
  expect(rows[0]!.decidedBy).toBe('judge')
  expect(rows[0]!.status).toBe('approved')
})

test('enforcing + dangerous → auto-deny', async () => {
  const { coordinator, db, judge } = makeCoordinator({ judgeMode: 'enforcing' })
  const repo = seedRepo(db)
  const task = seedTask(db, repo.id)
  const run = seedRun(db, task.id)

  judge.queueVerdict({ verdict: 'dangerous', reason: 'bad' })
  const result = await coordinator.evaluate(
    makeCtx(task, run),
    'WebFetch',
    { url: 'https://evil.com' },
    AbortSignal.timeout(5000),
  )

  expect(result.behavior).toBe('deny')
  const rows = db.select().from(approvals).all()
  expect(rows[0]!.decidedBy).toBe('judge')
  expect(rows[0]!.status).toBe('denied')
})

// --- Layer 5: Human approval (advisory mode) ---

test('advisory mode → creates pending approval and blocks until resolved', async () => {
  const { coordinator, db, judge, slots } = makeCoordinator({
    judgeMode: 'advisory',
  })
  const repo = seedRepo(db)
  const task = seedTask(db, repo.id)
  const run = seedRun(db, task.id)

  judge.queueVerdict({ verdict: 'safe', reason: 'looks ok' })

  let resolved = false
  const promise = coordinator
    .evaluate(
      makeCtx(task, run),
      'WebFetch',
      { url: 'https://example.com' },
      AbortSignal.timeout(10000),
    )
    .then((r) => {
      resolved = true
      return r
    })

  await Bun.sleep(50)

  // Task should be in awaiting_approval
  const taskRow = db
    .select()
    .from(tasks)
    .where(eq(tasks.id, task.id))
    .all()[0]!
  expect(taskRow.column).toBe('awaiting_approval')
  expect(taskRow.awaitingReturnColumn).toBe('progress')

  // Slot should be released
  expect(slots.released).toEqual([task.id])

  // Approval should be pending
  const approval = db.select().from(approvals).all()[0]!
  expect(approval.status).toBe('pending')
  expect(approval.judgeVerdict).toBe('safe')
  expect(approval.judgeReason).toBe('looks ok')

  expect(resolved).toBe(false)

  // Resolve it
  await coordinator.resolve(approval.id, 'allow_once')

  const result = await promise
  expect(resolved).toBe(true)
  expect(result.behavior).toBe('allow')

  // Task should be back in progress
  const taskAfter = db
    .select()
    .from(tasks)
    .where(eq(tasks.id, task.id))
    .all()[0]!
  expect(taskAfter.column).toBe('progress')
  expect(taskAfter.awaitingReturnColumn).toBeNull()

  // Slot reacquired
  expect(slots.reacquired).toEqual([task.id])
})

test('resolve with deny → deny decision', async () => {
  const { coordinator, db, judge } = makeCoordinator({ judgeMode: 'advisory' })
  const repo = seedRepo(db)
  const task = seedTask(db, repo.id)
  const run = seedRun(db, task.id)

  judge.queueVerdict({ verdict: 'ask_human', reason: 'unsure' })

  const promise = coordinator.evaluate(
    makeCtx(task, run),
    'Bash',
    { command: 'docker build .' },
    AbortSignal.timeout(10000),
  )
  await Bun.sleep(50)

  const approval = db.select().from(approvals).all()[0]!
  await coordinator.resolve(approval.id, 'deny')

  const result = await promise
  expect(result.behavior).toBe('deny')
})

test('resolve with allow_for_task → hash added to allowlist', async () => {
  const { coordinator, db, judge } = makeCoordinator({ judgeMode: 'advisory' })
  const repo = seedRepo(db)
  const task = seedTask(db, repo.id)
  const run = seedRun(db, task.id)
  const ctx = makeCtx(task, run)

  judge.queueVerdict({ verdict: 'ask_human', reason: 'unsure' })
  const promise = coordinator.evaluate(
    ctx,
    'WebFetch',
    { url: 'https://api.example.com' },
    AbortSignal.timeout(10000),
  )
  await Bun.sleep(50)

  const approval = db.select().from(approvals).all()[0]!
  await coordinator.resolve(approval.id, 'allow_for_task')
  await promise

  // Second identical call → no judge, instant allow
  const result2 = await coordinator.evaluate(
    ctx,
    'WebFetch',
    { url: 'https://api.example.com' },
    AbortSignal.timeout(5000),
  )
  expect(result2.behavior).toBe('allow')
  expect(judge.calls).toHaveLength(1) // judge was only called once
})

test('double resolve → throws', async () => {
  const { coordinator, db, judge } = makeCoordinator({ judgeMode: 'advisory' })
  const repo = seedRepo(db)
  const task = seedTask(db, repo.id)
  const run = seedRun(db, task.id)

  judge.queueVerdict({ verdict: 'ask_human', reason: 'unsure' })
  const promise = coordinator.evaluate(
    makeCtx(task, run),
    'WebFetch',
    { url: 'https://x.com' },
    AbortSignal.timeout(10000),
  )
  await Bun.sleep(50)

  const approval = db.select().from(approvals).all()[0]!
  await coordinator.resolve(approval.id, 'allow_once')
  await promise

  await expect(coordinator.resolve(approval.id, 'allow_once')).rejects.toThrow()
})

// --- Judge cache ---

test('judge cache: two identical evaluations → judge called once', async () => {
  const { coordinator, db, judge } = makeCoordinator({ judgeMode: 'enforcing' })
  const repo = seedRepo(db)
  const task = seedTask(db, repo.id)
  const run = seedRun(db, task.id)
  const ctx = makeCtx(task, run)

  judge.queueVerdict({ verdict: 'safe', reason: 'ok' })
  await coordinator.evaluate(
    ctx,
    'WebFetch',
    { url: 'https://example.com' },
    AbortSignal.timeout(5000),
  )

  // Second call — cache hit
  const result2 = await coordinator.evaluate(
    ctx,
    'WebFetch',
    { url: 'https://example.com' },
    AbortSignal.timeout(5000),
  )
  expect(result2.behavior).toBe('allow')
  expect(judge.calls).toHaveLength(1)
})

// --- Recovery ---

test('recoverPendingApprovals moves tasks to human_review', () => {
  const { coordinator, db } = makeCoordinator()
  const repo = seedRepo(db)
  const task = seedTask(db, repo.id, 'awaiting_approval')
  const run = seedRun(db, task.id)

  db.insert(approvals)
    .values({
      taskId: task.id,
      runId: run.id,
      toolName: 'Bash',
      toolInput: '{}',
      toolInputHash: 'abc',
      status: 'pending',
      createdAt: Date.now(),
    })
    .run()

  coordinator.recoverPendingApprovals()

  const taskRow = db
    .select()
    .from(tasks)
    .where(eq(tasks.id, task.id))
    .all()[0]!
  expect(taskRow.column).toBe('human_review')
  expect(taskRow.lastFailureReason).toBe('error')

  const approvalRow = db.select().from(approvals).all()[0]!
  expect(approvalRow.status).toBe('denied')
  expect(approvalRow.decidedBy).toBe('system')
})

// --- clearTaskState ---

test('clearTaskState clears allowlist and cache', async () => {
  const { coordinator, db, judge } = makeCoordinator({ judgeMode: 'enforcing' })
  const repo = seedRepo(db)
  const task = seedTask(db, repo.id)
  const run = seedRun(db, task.id)
  const ctx = makeCtx(task, run)

  judge.queueVerdict({ verdict: 'safe', reason: 'ok' })
  await coordinator.evaluate(
    ctx,
    'WebFetch',
    { url: 'https://example.com' },
    AbortSignal.timeout(5000),
  )
  expect(judge.calls).toHaveLength(1)

  coordinator.clearTaskState(task.id)

  judge.queueVerdict({ verdict: 'safe', reason: 'ok again' })
  await coordinator.evaluate(
    ctx,
    'WebFetch',
    { url: 'https://example.com' },
    AbortSignal.timeout(5000),
  )
  expect(judge.calls).toHaveLength(2)
})

// --- Abort while pending ---

test('abort while pending → reject, approval denied, task to human_review', async () => {
  const { coordinator, db, judge } = makeCoordinator({ judgeMode: 'advisory' })
  const repo = seedRepo(db)
  const task = seedTask(db, repo.id)
  const run = seedRun(db, task.id)

  judge.queueVerdict({ verdict: 'ask_human', reason: 'unsure' })

  const controller = new AbortController()
  const promise = coordinator.evaluate(
    makeCtx(task, run),
    'WebFetch',
    { url: 'https://x.com' },
    controller.signal,
  )
  await Bun.sleep(50)

  // Abort
  controller.abort('user_abort')

  await expect(promise).rejects.toThrow()

  // Approval should be denied by system
  const approvalRow = db.select().from(approvals).all()[0]!
  expect(approvalRow.status).toBe('denied')
  expect(approvalRow.decidedBy).toBe('system')

  // Task should be in human_review
  const taskRow = db
    .select()
    .from(tasks)
    .where(eq(tasks.id, task.id))
    .all()[0]!
  expect(taskRow.column).toBe('human_review')
  expect(taskRow.lastFailureReason).toBe('aborted')
})
