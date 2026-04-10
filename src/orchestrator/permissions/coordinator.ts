import { eq, and } from 'drizzle-orm'
import { createHash } from 'node:crypto'
import { tasks, approvals } from '../../db/schema'
import type { Db } from '../../db/client'
import type { Judge, JudgeVerdict } from './judge'
import type { SseBus } from '../../server/sse-bus'
import { evaluateRules } from './rules'

export interface PermissionContext {
  taskId: number
  runId: number
  worktreePath: string
  taskTitle: string
  taskDescription: string
}

export type PermissionDecision =
  | { behavior: 'allow'; updatedInput: Record<string, unknown> }
  | { behavior: 'deny'; message: string }

export interface OrchestratorSlotHooks {
  releaseSlot(taskId: number): void
  reacquireSlot(taskId: number): void
}

export interface PermissionConfig {
  judgeMode: 'advisory' | 'enforcing'
  judgeModel: string
  judgeTimeoutMs: number
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
}

function makeDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function computeHash(toolName: string, toolInput: unknown): string {
  const canonical = JSON.stringify({ tool: toolName, input: toolInput })
  return createHash('sha256').update(canonical).digest('hex')
}

export class PermissionCoordinator {
  private taskAllowlists = new Map<number, Set<string>>()
  private judgeCache = new Map<number, Map<string, JudgeVerdict>>()
  private pending = new Map<number, Deferred<PermissionDecision>>()

  constructor(
    private db: Db,
    private judge: Judge,
    private config: PermissionConfig,
    private bus: SseBus,
    private slots: OrchestratorSlotHooks,
  ) {}

  async evaluate(
    ctx: PermissionContext,
    toolName: string,
    toolInput: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<PermissionDecision> {
    // Layer 1: Hardcoded deny
    const ruleResult = evaluateRules(toolName, toolInput, ctx.worktreePath)
    if (ruleResult.decision === 'deny') {
      this.logApproval(ctx, toolName, toolInput, null, 'denied', null, 'hardcoded')
      return { behavior: 'deny', message: ruleResult.reason ?? 'denied by policy' }
    }

    // Layer 2: Hardcoded allow
    if (ruleResult.decision === 'allow') {
      return { behavior: 'allow', updatedInput: toolInput }
    }

    // Layer 3: Task allowlist
    const hash = computeHash(toolName, toolInput)
    if (this.taskAllowlists.get(ctx.taskId)?.has(hash)) {
      return { behavior: 'allow', updatedInput: toolInput }
    }

    // Layer 4: Judge (with cache)
    let verdict: JudgeVerdict
    const cached = this.judgeCache.get(ctx.taskId)?.get(hash)
    if (cached) {
      verdict = cached
    } else {
      verdict = await this.judge.classify(
        {
          toolName,
          toolInput,
          worktreePath: ctx.worktreePath,
          taskTitle: ctx.taskTitle,
          taskDescription: ctx.taskDescription,
        },
        signal,
      )
      if (!this.judgeCache.has(ctx.taskId)) {
        this.judgeCache.set(ctx.taskId, new Map())
      }
      this.judgeCache.get(ctx.taskId)!.set(hash, verdict)
    }

    const mode = this.config.judgeMode

    // Enforcing mode auto-decisions
    if (mode === 'enforcing' && verdict.verdict === 'safe') {
      this.logApproval(ctx, toolName, toolInput, verdict, 'approved', null, 'judge')
      return { behavior: 'allow', updatedInput: toolInput }
    }
    if (mode === 'enforcing' && verdict.verdict === 'dangerous') {
      this.logApproval(ctx, toolName, toolInput, verdict, 'denied', null, 'judge')
      return { behavior: 'deny', message: verdict.reason }
    }

    // Layer 5: Human approval (advisory always, or enforcing ask_human)
    return this.requestHumanApproval(ctx, toolName, toolInput, hash, verdict, signal)
  }

  async resolve(
    approvalId: number,
    decision: 'allow_once' | 'allow_for_task' | 'deny',
  ): Promise<void> {
    const status = decision === 'deny' ? 'denied' : 'approved'

    const result = this.db
      .update(approvals)
      .set({
        status,
        decision,
        decidedBy: 'human',
        decidedAt: Date.now(),
      })
      .where(and(eq(approvals.id, approvalId), eq(approvals.status, 'pending')))
      .run() as unknown as { changes: number }

    if (result.changes === 0) {
      throw new Error('approval is not pending')
    }

    const [approval] = this.db
      .select()
      .from(approvals)
      .where(eq(approvals.id, approvalId))
      .all()
    if (!approval) throw new Error('approval not found')

    // Move task back to its return column
    const [taskRow] = this.db
      .select()
      .from(tasks)
      .where(eq(tasks.id, approval.taskId))
      .all()
    if (taskRow) {
      this.db
        .update(tasks)
        .set({
          column: taskRow.awaitingReturnColumn ?? 'progress',
          awaitingReturnColumn: null,
          updatedAt: Date.now(),
        })
        .where(eq(tasks.id, approval.taskId))
        .run()
    }

    // If allow_for_task, add to allowlist
    if (decision === 'allow_for_task') {
      if (!this.taskAllowlists.has(approval.taskId)) {
        this.taskAllowlists.set(approval.taskId, new Set())
      }
      this.taskAllowlists.get(approval.taskId)!.add(approval.toolInputHash)
    }

    // Reacquire slot
    this.slots.reacquireSlot(approval.taskId)

    // Resolve deferred
    const deferred = this.pending.get(approvalId)
    if (deferred) {
      if (decision === 'deny') {
        deferred.resolve({ behavior: 'deny', message: 'denied by user' })
      } else {
        const parsedInput = JSON.parse(approval.toolInput) as Record<string, unknown>
        deferred.resolve({ behavior: 'allow', updatedInput: parsedInput })
      }
      this.pending.delete(approvalId)
    }

    // Publish SSE
    this.bus.publish({ type: 'task.updated', payload: { taskId: approval.taskId } })
  }

  recoverPendingApprovals(): void {
    const pendingApprovals = this.db
      .select()
      .from(approvals)
      .where(eq(approvals.status, 'pending'))
      .all()

    for (const a of pendingApprovals) {
      this.db
        .update(approvals)
        .set({
          status: 'denied',
          decision: 'deny',
          decidedBy: 'system',
          decidedAt: Date.now(),
        })
        .where(eq(approvals.id, a.id))
        .run()
    }

    const awaitingTasks = this.db
      .select()
      .from(tasks)
      .where(eq(tasks.column, 'awaiting_approval'))
      .all()

    for (const t of awaitingTasks) {
      this.db
        .update(tasks)
        .set({
          column: 'human_review',
          position: 0,
          awaitingReturnColumn: null,
          lastFailureReason: 'error',
          updatedAt: Date.now(),
        })
        .where(eq(tasks.id, t.id))
        .run()
    }
  }

  clearTaskState(taskId: number): void {
    this.taskAllowlists.delete(taskId)
    this.judgeCache.delete(taskId)
  }

  private async requestHumanApproval(
    ctx: PermissionContext,
    toolName: string,
    toolInput: unknown,
    hash: string,
    verdict: JudgeVerdict,
    signal: AbortSignal,
  ): Promise<PermissionDecision> {
    const [taskRow] = this.db
      .select()
      .from(tasks)
      .where(eq(tasks.id, ctx.taskId))
      .all()
    if (!taskRow) throw new Error(`task ${ctx.taskId} not found`)
    const previousColumn = taskRow.column

    // Insert pending approval
    const [approval] = this.db
      .insert(approvals)
      .values({
        taskId: ctx.taskId,
        runId: ctx.runId,
        toolName,
        toolInput: JSON.stringify(toolInput),
        toolInputHash: hash,
        judgeVerdict: verdict.verdict,
        judgeReason: verdict.reason,
        status: 'pending',
        createdAt: Date.now(),
      })
      .returning()
      .all()

    // Move task to awaiting_approval
    this.db
      .update(tasks)
      .set({
        column: 'awaiting_approval',
        awaitingReturnColumn: previousColumn,
        updatedAt: Date.now(),
      })
      .where(eq(tasks.id, ctx.taskId))
      .run()

    // Release orchestrator slot
    this.slots.releaseSlot(ctx.taskId)

    // Publish SSE event
    this.bus.publish({ type: 'task.updated', payload: { taskId: ctx.taskId } })

    // Create deferred and wait
    const deferred = makeDeferred<PermissionDecision>()
    this.pending.set(approval!.id, deferred)

    // Handle abort
    const onAbort = () => {
      if (this.pending.has(approval!.id)) {
        this.pending.delete(approval!.id)
        deferred.reject(new Error('aborted'))

        this.db
          .update(approvals)
          .set({
            status: 'denied',
            decision: 'deny',
            decidedBy: 'system',
            decidedAt: Date.now(),
          })
          .where(eq(approvals.id, approval!.id))
          .run()

        this.db
          .update(tasks)
          .set({
            column: 'human_review',
            position: 0,
            awaitingReturnColumn: null,
            lastFailureReason: 'aborted',
            updatedAt: Date.now(),
          })
          .where(eq(tasks.id, ctx.taskId))
          .run()

        this.bus.publish({
          type: 'task.updated',
          payload: { taskId: ctx.taskId },
        })
      }
    }
    signal.addEventListener('abort', onAbort, { once: true })

    try {
      return await deferred.promise
    } finally {
      signal.removeEventListener('abort', onAbort)
    }
  }

  private logApproval(
    ctx: PermissionContext,
    toolName: string,
    toolInput: unknown,
    verdict: JudgeVerdict | null,
    status: string,
    decision: string | null,
    decidedBy: string,
  ): void {
    this.db
      .insert(approvals)
      .values({
        taskId: ctx.taskId,
        runId: ctx.runId,
        toolName,
        toolInput: JSON.stringify(toolInput),
        toolInputHash: computeHash(toolName, toolInput),
        judgeVerdict: verdict?.verdict ?? null,
        judgeReason: verdict?.reason ?? null,
        status,
        decision,
        decidedBy,
        createdAt: Date.now(),
        decidedAt: Date.now(),
      })
      .run()
  }
}
