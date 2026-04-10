export const TASK_COLUMNS = [
  'backlog',
  'todo',
  'progress',
  'awaiting_approval',
  'ai_review',
  'ai_review_in_progress',
  'human_review',
  'done',
] as const

export type TaskColumn = typeof TASK_COLUMNS[number]

export const ACTIVE_COLUMNS: readonly TaskColumn[] = [
  'progress',
  'ai_review_in_progress',
] as const

export const MANUAL_COLUMNS: readonly TaskColumn[] = [
  'backlog',
  'todo',
  'ai_review',
  'human_review',
  'done',
] as const

export type FailureReason =
  | 'aborted'
  | 'timeout'
  | 'error'
  | 'max_retries'

export type RunKind = 'executor' | 'reviewer'

export type RunStatus =
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'aborted'
  | 'timeout'

export type ReviewVerdict = 'approved' | 'rejected'

export interface Repository {
  id: number
  name: string
  url: string
  localPath: string
  defaultBranch: string
  createdAt: number
}

export interface Task {
  id: number
  title: string
  description: string
  repositoryId: number
  column: TaskColumn
  position: number
  attemptsCount: number
  branchName: string | null
  worktreePath: string | null
  awaitingReturnColumn: TaskColumn | null
  lastFailureReason: FailureReason | null
  createdAt: number
  updatedAt: number
}

export interface TaskWithRun extends Task {
  activeRunStartedAt: number | null
}

export type JudgeMode = 'advisory' | 'enforcing'
export type JudgeVerdictType = 'safe' | 'dangerous' | 'ask_human'
export type ApprovalStatus = 'pending' | 'approved' | 'denied'
export type ApprovalDecision = 'allow_once' | 'allow_for_task' | 'deny'
export type ApprovalDecidedBy = 'human' | 'judge' | 'hardcoded' | 'system'

export interface Approval {
  id: number
  taskId: number
  runId: number
  toolName: string
  toolInput: string
  toolInputHash: string
  judgeVerdict: JudgeVerdictType | null
  judgeReason: string | null
  status: ApprovalStatus
  decision: ApprovalDecision | null
  decidedBy: ApprovalDecidedBy | null
  createdAt: number
  decidedAt: number | null
}

export interface Run {
  id: number
  taskId: number
  kind: RunKind
  status: RunStatus
  verdict: ReviewVerdict | null
  summary: string | null
  error: string | null
  startedAt: number
  endedAt: number | null
}
