import { useMemo, useState } from 'react'
import { Column } from './column'
import { TaskDialog } from './task-dialog'
import { useTasks } from '../hooks/use-tasks'
import { TASK_COLUMNS } from '../../shared/types'
import type { TaskColumn, TaskWithRun } from '../../shared/types'

// These come from config.json in a future iteration — hardcoded defaults for MVP UI.
const WIP_LIMITS: Partial<Record<TaskColumn, number>> = {
  progress: 2,
  ai_review_in_progress: 1,
}
const MAX_ATTEMPTS = 3

export function KanbanBoard() {
  const { data: tasks = [] } = useTasks()
  const [openTask, setOpenTask] = useState<TaskWithRun | null>(null)

  const grouped = useMemo(() => {
    const out = Object.fromEntries(
      TASK_COLUMNS.map((c) => [c, [] as TaskWithRun[]]),
    ) as Record<TaskColumn, TaskWithRun[]>
    for (const t of tasks) {
      out[t.column].push(t)
    }
    for (const c of TASK_COLUMNS) {
      out[c].sort((a, b) => a.position - b.position)
    }
    return out
  }, [tasks])

  return (
    <>
      <div className="flex gap-3 overflow-x-auto p-4">
        {TASK_COLUMNS.map((col) => (
          <Column
            key={col}
            column={col}
            tasks={grouped[col]}
            wipLimit={WIP_LIMITS[col]}
            onOpenTask={setOpenTask}
            maxAttempts={MAX_ATTEMPTS}
          />
        ))}
      </div>
      {openTask && (
        <TaskDialog
          mode="view"
          task={openTask}
          open={!!openTask}
          onOpenChange={(open) => {
            if (!open) setOpenTask(null)
          }}
        />
      )}
    </>
  )
}
