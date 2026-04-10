import type { ReviewVerdict } from '../shared/types'

export interface AIRunnerInput {
  prompt: string
  cwd: string
  signal: AbortSignal
  taskId: number
  runId: number
  taskTitle: string
  taskDescription: string
}

export interface ExecutorResult {
  summary: string
}

export interface ReviewerResult {
  verdict: ReviewVerdict
  summary: string
}

export interface AIRunner {
  execute(input: AIRunnerInput): Promise<ExecutorResult>
  review(input: AIRunnerInput): Promise<ReviewerResult>
}

export class FakeAIRunner implements AIRunner {
  private executorQueue: ExecutorResult[] = []
  private reviewerQueue: ReviewerResult[] = []
  executorCalls: AIRunnerInput[] = []
  reviewerCalls: AIRunnerInput[] = []

  queueExecutor(result: ExecutorResult): void {
    this.executorQueue.push(result)
  }

  queueReviewer(result: ReviewerResult): void {
    this.reviewerQueue.push(result)
  }

  async execute(input: AIRunnerInput): Promise<ExecutorResult> {
    this.executorCalls.push(input)
    throwIfAborted(input.signal)
    const next = this.executorQueue.shift()
    if (!next) throw new Error('no queued executor result')
    return next
  }

  async review(input: AIRunnerInput): Promise<ReviewerResult> {
    this.reviewerCalls.push(input)
    throwIfAborted(input.signal)
    const next = this.reviewerQueue.shift()
    if (!next) throw new Error('no queued reviewer result')
    return next
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    const err = new Error('aborted')
    ;(err as Error & { name: string }).name = 'AbortError'
    throw err
  }
}
