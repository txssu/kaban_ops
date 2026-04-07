import { useEffect, useState } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { Card, CardContent } from './ui/card'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { StopCircle } from 'lucide-react'
import { useStopTask } from '../hooks/use-tasks'
import { useRepositories } from '../hooks/use-repositories'
import { ACTIVE_COLUMNS, MANUAL_COLUMNS } from '../../shared/types'
import type { TaskWithRun } from '../../shared/types'

function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000)
  const mm = String(Math.floor(total / 60)).padStart(2, '0')
  const ss = String(total % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

interface TaskCardProps {
  task: TaskWithRun
  onOpen: (task: TaskWithRun) => void
  maxAttempts: number
}

export function TaskCard({ task, onOpen, maxAttempts }: TaskCardProps) {
  const stop = useStopTask()
  const repositories = useRepositories().data ?? []
  const repo = repositories.find((r) => r.id === task.repositoryId)
  const isActive = (ACTIVE_COLUMNS as readonly string[]).includes(task.column)
  const isDraggable = (MANUAL_COLUMNS as readonly string[]).includes(
    task.column,
  )

  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: task.id,
      disabled: !isDraggable,
    })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      {...attributes}
      {...listeners}
    >
      <Card
        className={`mb-2 cursor-pointer ${isDragging ? 'opacity-50' : ''}`}
        onClick={() => onOpen(task)}
        data-testid={`task-card-${task.id}`}
      >
      <CardContent className="p-3 space-y-2">
        <div className="font-medium text-sm">{task.title}</div>
        <div className="flex items-center gap-2 flex-wrap">
          {repo && <Badge variant="secondary">{repo.name}</Badge>}
          {task.attemptsCount > 0 && (
            <Badge variant="outline">
              {task.attemptsCount}/{maxAttempts}
            </Badge>
          )}
          {task.lastFailureReason && (
            <Badge variant="destructive">{task.lastFailureReason}</Badge>
          )}
        </div>
        {isActive && (
          <div className="flex items-center justify-between pt-2">
            <LiveTimer startedAt={task.activeRunStartedAt} />
            <Button
              size="sm"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation()
                stop.mutate(task.id)
              }}
            >
              <StopCircle className="w-4 h-4 mr-1" /> Stop
            </Button>
          </div>
        )}
      </CardContent>
      </Card>
    </div>
  )
}

function LiveTimer({ startedAt }: { startedAt: number | null }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (startedAt === null) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [startedAt])
  if (startedAt === null) return null
  return (
    <span className="text-xs text-slate-500 tabular-nums">
      {formatDuration(now - startedAt)}
    </span>
  )
}
