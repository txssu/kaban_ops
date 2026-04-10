import { ACTIVE_COLUMNS, MANUAL_COLUMNS } from '../shared/types'
import type { Task, TaskColumn } from '../shared/types'

export function isActiveColumn(col: TaskColumn): boolean {
  return (ACTIVE_COLUMNS as readonly TaskColumn[]).includes(col)
}

export function isManualColumn(col: TaskColumn): boolean {
  return (MANUAL_COLUMNS as readonly TaskColumn[]).includes(col)
}

export function canManuallyMove(
  from: TaskColumn,
  to: TaskColumn,
): boolean {
  if (from === to) return false
  return isManualColumn(from) && isManualColumn(to)
}

export function canEditTask(task: Task): boolean {
  if (task.column === 'awaiting_approval') return false
  return !isActiveColumn(task.column)
}

export function canDeleteTask(task: Task): boolean {
  if (task.column === 'awaiting_approval') return false
  return !isActiveColumn(task.column)
}

export function clearFailureOnReopen(
  task: Task,
  nextColumn: TaskColumn,
): Partial<Pick<Task, 'attemptsCount' | 'lastFailureReason'>> {
  if (task.column !== 'human_review') return {}
  if (nextColumn !== 'todo' && nextColumn !== 'backlog') return {}
  return { attemptsCount: 0, lastFailureReason: null }
}
