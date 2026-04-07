import { useDroppable } from '@dnd-kit/core'
import type { TaskColumn, TaskWithRun } from '../../shared/types'
import { MANUAL_COLUMNS } from '../../shared/types'
import { TaskCard } from './task-card'

const LABELS: Record<TaskColumn, string> = {
  backlog: 'BACKLOG',
  todo: 'TODO',
  progress: 'PROGRESS',
  ai_review: 'AI REVIEW',
  ai_review_in_progress: 'AI REVIEW IN PROGRESS',
  human_review: 'HUMAN REVIEW',
  done: 'DONE',
}

interface ColumnProps {
  column: TaskColumn
  tasks: TaskWithRun[]
  wipLimit?: number
  onOpenTask: (task: TaskWithRun) => void
  maxAttempts: number
}

export function Column({
  column,
  tasks,
  wipLimit,
  onOpenTask,
  maxAttempts,
}: ColumnProps) {
  const isManual = (MANUAL_COLUMNS as readonly string[]).includes(column)
  const { setNodeRef, isOver } = useDroppable({
    id: column,
    disabled: !isManual,
  })

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col min-w-[280px] max-w-[280px] rounded-lg p-3 ${
        isOver ? 'bg-slate-200' : 'bg-slate-100'
      }`}
      data-testid={`column-${column}`}
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-slate-700">
          {LABELS[column]}
        </h3>
        {wipLimit !== undefined && (
          <span className="text-xs text-slate-500">
            {tasks.length}/{wipLimit}
          </span>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        {tasks.map((t) => (
          <TaskCard
            key={t.id}
            task={t}
            onOpen={onOpenTask}
            maxAttempts={maxAttempts}
          />
        ))}
      </div>
    </div>
  )
}
