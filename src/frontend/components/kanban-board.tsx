import { useMemo, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import { Column } from './column'
import { TaskDialog } from './task-dialog'
import { TaskCard } from './task-card'
import { useTasks, useUpdateTask } from '../hooks/use-tasks'
import {
  TASK_COLUMNS,
  MANUAL_COLUMNS,
} from '../../shared/types'
import type { TaskColumn, TaskWithRun } from '../../shared/types'

const WIP_LIMITS: Partial<Record<TaskColumn, number>> = {
  progress: 2,
  ai_review_in_progress: 1,
}
const MAX_ATTEMPTS = 3

export function KanbanBoard() {
  const { data: tasks = [] } = useTasks()
  const updateTask = useUpdateTask()
  const [openTask, setOpenTask] = useState<TaskWithRun | null>(null)
  const [draggingTask, setDraggingTask] = useState<TaskWithRun | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

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

  function handleDragStart(event: DragStartEvent) {
    const task = tasks.find((t) => t.id === Number(event.active.id))
    setDraggingTask(task ?? null)
  }

  function handleDragEnd(event: DragEndEvent) {
    setDraggingTask(null)
    const { active, over } = event
    if (!over) return
    const task = tasks.find((t) => t.id === Number(active.id))
    if (!task) return
    const targetCol = over.id as TaskColumn
    if (!(MANUAL_COLUMNS as readonly string[]).includes(targetCol)) return
    if (!(MANUAL_COLUMNS as readonly string[]).includes(task.column)) return
    if (task.column === targetCol) return
    updateTask.mutate({ id: task.id, patch: { column: targetCol } })
  }

  return (
    <>
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
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
        <DragOverlay>
          {draggingTask && (
            <TaskCard
              task={draggingTask}
              onOpen={() => {}}
              maxAttempts={MAX_ATTEMPTS}
            />
          )}
        </DragOverlay>
      </DndContext>
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
