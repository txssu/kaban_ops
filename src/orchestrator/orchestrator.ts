import { and, eq, sql, desc, asc } from 'drizzle-orm'
import { tasks, runs, repositories } from '../db/schema'
import type { Db } from '../db/client'
import type { AIRunner } from './runner'
import type { GitClient } from './git-client'
import type { SseBus, SseEvent } from '../server/sse-bus'
import { buildExecutorPrompt, buildReviewerPrompt } from './prompts'
import type { FailureReason, TaskColumn } from '../shared/types'

export interface OrchestratorConfig {
  progressLimit: number
  aiReviewLimit: number
  maxAttempts: number
  taskTimeoutMs: number
}

interface ActiveRun {
  taskId: number
  kind: 'executor' | 'reviewer'
  abortController: AbortController
  startedAt: number
  timeoutMs: number
  promise: Promise<void>
}

export interface OrchestratorDeps {
  db: Db
  runner: AIRunner
  git: GitClient
  bus: SseBus
  config: OrchestratorConfig
}

export class Orchestrator {
  private readonly active = new Map<number, ActiveRun>()
  private interval: ReturnType<typeof setInterval> | null = null

  constructor(private readonly deps: OrchestratorDeps) {}

  start(tickMs: number = 500): void {
    if (this.interval) return
    this.interval = setInterval(() => {
      this.tick().catch((err) => console.error('tick error', err))
    }, tickMs)
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval)
    this.interval = null
    for (const run of this.active.values()) {
      run.abortController.abort('shutdown')
    }
  }

  async drain(): Promise<void> {
    const promises = Array.from(this.active.values()).map((r) => r.promise)
    await Promise.allSettled(promises)
  }

  abortTask(taskId: number): void {
    const run = this.active.get(taskId)
    if (!run) return
    run.abortController.abort('user_abort')
  }

  async tick(): Promise<void> {
    // 1. Enforce timeouts
    const now = Date.now()
    for (const run of this.active.values()) {
      if (now - run.startedAt > run.timeoutMs) {
        run.abortController.abort('timeout')
      }
    }

    // 2. Fill executor slots
    let execBusy = Array.from(this.active.values()).filter(
      (r) => r.kind === 'executor',
    ).length
    while (execBusy < this.deps.config.progressLimit) {
      const task = this.pullNext('todo', 'progress')
      if (!task) break
      this.publish({ type: 'task.updated', payload: { taskId: task.id } })
      this.startExecutor(task.id)
      execBusy += 1
    }

    // 3. Fill reviewer slots
    let revBusy = Array.from(this.active.values()).filter(
      (r) => r.kind === 'reviewer',
    ).length
    while (revBusy < this.deps.config.aiReviewLimit) {
      const task = this.pullNext('ai_review', 'ai_review_in_progress')
      if (!task) break
      this.publish({ type: 'task.updated', payload: { taskId: task.id } })
      this.startReviewer(task.id)
      revBusy += 1
    }
  }

  recoverFromCrash(): void {
    const orphaned = this.deps.db
      .select()
      .from(tasks)
      .where(
        sql`${tasks.column} IN ('progress', 'ai_review_in_progress')`,
      )
      .all()
    for (const task of orphaned) {
      const nextPos = this.nextPosition('human_review')
      this.deps.db
        .update(tasks)
        .set({
          column: 'human_review',
          position: nextPos,
          lastFailureReason: 'error',
          updatedAt: Date.now(),
        })
        .where(eq(tasks.id, task.id))
        .run()
      this.deps.db
        .insert(runs)
        .values({
          taskId: task.id,
          kind: 'executor',
          status: 'failed',
          error: 'interrupted by restart',
          startedAt: Date.now(),
          endedAt: Date.now(),
        })
        .run()
    }
  }

  private pullNext(from: TaskColumn, to: TaskColumn) {
    return this.deps.db.transaction((tx) => {
      const [candidate] = tx
        .select()
        .from(tasks)
        .where(eq(tasks.column, from))
        .orderBy(asc(tasks.position))
        .limit(1)
        .all()
      if (!candidate) return null
      const position = this.nextPositionTx(tx, to)
      tx.update(tasks)
        .set({ column: to, position, updatedAt: Date.now() })
        .where(and(eq(tasks.id, candidate.id), eq(tasks.column, from)))
        .run()
      return { ...candidate, column: to, position }
    })
  }

  private nextPosition(col: TaskColumn): number {
    return this.nextPositionTx(this.deps.db, col)
  }

  private nextPositionTx(
    tx: { select: Db['select'] },
    col: TaskColumn,
  ): number {
    const result = (
      tx as unknown as Db
    )
      .select({ max: sql<number>`COALESCE(MAX(${tasks.position}), -1)` })
      .from(tasks)
      .where(eq(tasks.column, col))
      .all()
    return (result[0]?.max ?? -1) + 1
  }

  private startExecutor(taskId: number): void {
    const controller = new AbortController()
    const startedAt = Date.now()
    const promise = this.runExecutor(taskId, controller).finally(() => {
      this.active.delete(taskId)
    })
    this.active.set(taskId, {
      taskId,
      kind: 'executor',
      abortController: controller,
      startedAt,
      timeoutMs: this.deps.config.taskTimeoutMs,
      promise,
    })
  }

  private async runExecutor(
    taskId: number,
    controller: AbortController,
  ): Promise<void> {
    let runId: number | null = null
    try {
      const task = this.requireTask(taskId)
      const repo = this.requireRepo(task.repositoryId)

      if (!task.worktreePath) {
        await this.deps.git.fetchRepository(repo.localPath)
        const path = await this.deps.git.createWorktree({
          localPath: repo.localPath,
          defaultBranch: repo.defaultBranch,
          taskId,
        })
        this.deps.db
          .update(tasks)
          .set({
            worktreePath: path,
            branchName: `kaban/task-${taskId}`,
            updatedAt: Date.now(),
          })
          .where(eq(tasks.id, taskId))
          .run()
      }

      const refreshedTask = this.requireTask(taskId)
      const previousRuns = this.deps.db
        .select()
        .from(runs)
        .where(eq(runs.taskId, taskId))
        .orderBy(desc(runs.startedAt))
        .all()
      const prompt = buildExecutorPrompt({
        task: refreshedTask as any,
        defaultBranch: repo.defaultBranch,
        previousRuns: previousRuns as any,
      })

      const [run] = this.deps.db
        .insert(runs)
        .values({
          taskId,
          kind: 'executor',
          status: 'running',
          startedAt: Date.now(),
        })
        .returning()
        .all()
      runId = run!.id

      const result = await this.deps.runner.execute({
        prompt,
        cwd: refreshedTask.worktreePath!,
        signal: controller.signal,
      })

      this.deps.db
        .update(runs)
        .set({
          status: 'succeeded',
          summary: result.summary,
          endedAt: Date.now(),
        })
        .where(eq(runs.id, runId))
        .run()

      const nextPos = this.nextPosition('ai_review')
      this.deps.db
        .update(tasks)
        .set({
          column: 'ai_review',
          position: nextPos,
          updatedAt: Date.now(),
        })
        .where(eq(tasks.id, taskId))
        .run()
      this.publish({ type: 'task.updated', payload: { taskId } })
    } catch (err) {
      const reason: FailureReason = classifyError(err, controller.signal)
      if (runId) {
        this.deps.db
          .update(runs)
          .set({
            status: reason === 'error' ? 'failed' : reason,
            error: (err as Error).message,
            endedAt: Date.now(),
          })
          .where(eq(runs.id, runId))
          .run()
      }
      this.moveToHumanReview(taskId, reason)
    }
  }

  private startReviewer(taskId: number): void {
    const controller = new AbortController()
    const startedAt = Date.now()
    const promise = this.runReviewer(taskId, controller).finally(() => {
      this.active.delete(taskId)
    })
    this.active.set(taskId, {
      taskId,
      kind: 'reviewer',
      abortController: controller,
      startedAt,
      timeoutMs: this.deps.config.taskTimeoutMs,
      promise,
    })
  }

  private async runReviewer(
    taskId: number,
    controller: AbortController,
  ): Promise<void> {
    let runId: number | null = null
    try {
      const task = this.requireTask(taskId)
      const repo = this.requireRepo(task.repositoryId)
      const [latestExecutor] = this.deps.db
        .select()
        .from(runs)
        .where(and(eq(runs.taskId, taskId), eq(runs.kind, 'executor')))
        .orderBy(desc(runs.startedAt))
        .limit(1)
        .all()
      if (!latestExecutor) {
        throw new Error(`no executor run for task ${taskId}`)
      }

      const prompt = buildReviewerPrompt({
        task: task as any,
        defaultBranch: repo.defaultBranch,
        latestExecutorRun: latestExecutor as any,
      })

      const [run] = this.deps.db
        .insert(runs)
        .values({
          taskId,
          kind: 'reviewer',
          status: 'running',
          startedAt: Date.now(),
        })
        .returning()
        .all()
      runId = run!.id

      const result = await this.deps.runner.review({
        prompt,
        cwd: task.worktreePath!,
        signal: controller.signal,
      })

      this.deps.db
        .update(runs)
        .set({
          status: 'succeeded',
          verdict: result.verdict,
          summary: result.summary,
          endedAt: Date.now(),
        })
        .where(eq(runs.id, runId))
        .run()

      if (result.verdict === 'approved') {
        const nextPos = this.nextPosition('human_review')
        this.deps.db
          .update(tasks)
          .set({
            column: 'human_review',
            position: nextPos,
            updatedAt: Date.now(),
          })
          .where(eq(tasks.id, taskId))
          .run()
      } else {
        const newAttempts = task.attemptsCount + 1
        if (newAttempts >= this.deps.config.maxAttempts) {
          const nextPos = this.nextPosition('human_review')
          this.deps.db
            .update(tasks)
            .set({
              column: 'human_review',
              position: nextPos,
              attemptsCount: newAttempts,
              lastFailureReason: 'max_retries',
              updatedAt: Date.now(),
            })
            .where(eq(tasks.id, taskId))
            .run()
        } else {
          const nextPos = this.nextPosition('todo')
          this.deps.db
            .update(tasks)
            .set({
              column: 'todo',
              position: nextPos,
              attemptsCount: newAttempts,
              updatedAt: Date.now(),
            })
            .where(eq(tasks.id, taskId))
            .run()
        }
      }
      this.publish({ type: 'task.updated', payload: { taskId } })
    } catch (err) {
      const reason: FailureReason = classifyError(err, controller.signal)
      if (runId) {
        this.deps.db
          .update(runs)
          .set({
            status: reason === 'error' ? 'failed' : reason,
            error: (err as Error).message,
            endedAt: Date.now(),
          })
          .where(eq(runs.id, runId))
          .run()
      }
      this.moveToHumanReview(taskId, reason)
    }
  }

  private moveToHumanReview(taskId: number, reason: FailureReason): void {
    const nextPos = this.nextPosition('human_review')
    this.deps.db
      .update(tasks)
      .set({
        column: 'human_review',
        position: nextPos,
        lastFailureReason: reason,
        updatedAt: Date.now(),
      })
      .where(eq(tasks.id, taskId))
      .run()
    this.publish({ type: 'task.updated', payload: { taskId } })
  }

  private requireTask(taskId: number) {
    const [task] = this.deps.db
      .select()
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .all()
    if (!task) throw new Error(`task ${taskId} not found`)
    return task
  }

  private requireRepo(repoId: number) {
    const [repo] = this.deps.db
      .select()
      .from(repositories)
      .where(eq(repositories.id, repoId))
      .all()
    if (!repo) throw new Error(`repository ${repoId} not found`)
    return repo
  }

  private publish(event: SseEvent): void {
    this.deps.bus.publish(event)
  }
}

function classifyError(err: unknown, signal: AbortSignal): FailureReason {
  if (signal.aborted) {
    const reason = signal.reason
    if (reason === 'timeout') return 'timeout'
    if (reason === 'user_abort') return 'aborted'
  }
  if (
    err instanceof Error &&
    (err.name === 'AbortError' || err.message === 'aborted')
  ) {
    return 'aborted'
  }
  return 'error'
}
