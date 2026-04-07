import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { Input } from './ui/input'
import { Textarea } from './ui/textarea'
import { Label } from './ui/label'
import { Button } from './ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select'
import {
  useCreateTask,
  useDeleteTask,
  useUpdateTask,
} from '../hooks/use-tasks'
import { useRepositories } from '../hooks/use-repositories'
import { api } from '../api'
import { ACTIVE_COLUMNS } from '../../shared/types'
import type { TaskWithRun } from '../../shared/types'

type Mode = 'create' | 'view'

interface TaskDialogProps {
  mode: Mode
  task?: TaskWithRun
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function TaskDialog({
  mode,
  task,
  open,
  onOpenChange,
}: TaskDialogProps) {
  const repositories = useRepositories().data ?? []
  const createTask = useCreateTask()
  const updateTask = useUpdateTask()
  const deleteTask = useDeleteTask()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [repoId, setRepoId] = useState<number | null>(null)

  useEffect(() => {
    if (task) {
      setTitle(task.title)
      setDescription(task.description)
      setRepoId(task.repositoryId)
    } else {
      setTitle('')
      setDescription('')
      setRepoId(repositories[0]?.id ?? null)
    }
  }, [task, repositories])

  const readOnly =
    !!task &&
    (ACTIVE_COLUMNS as readonly string[]).includes(task.column)

  const runsQuery = useQuery({
    queryKey: ['runs', task?.id],
    queryFn: () => (task ? api.listRuns(task.id) : Promise.resolve([])),
    enabled: !!task,
  })

  const latestExecutor = runsQuery.data?.find((r) => r.kind === 'executor')
  const latestReviewer = runsQuery.data?.find((r) => r.kind === 'reviewer')

  function handleSave() {
    if (!repoId) return
    if (mode === 'create') {
      createTask.mutate(
        { title, description, repositoryId: repoId },
        { onSuccess: () => onOpenChange(false) },
      )
    } else if (task) {
      updateTask.mutate(
        {
          id: task.id,
          patch: { title, description, repositoryId: repoId },
        },
        { onSuccess: () => onOpenChange(false) },
      )
    }
  }

  function handleDelete() {
    if (!task) return
    deleteTask.mutate(task.id, { onSuccess: () => onOpenChange(false) })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {mode === 'create' ? 'New task' : 'Task details'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              value={title}
              disabled={readOnly}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              rows={6}
              disabled={readOnly}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div>
            <Label>Repository</Label>
            <Select
              value={repoId?.toString() ?? ''}
              onValueChange={(v) => setRepoId(Number(v))}
              disabled={readOnly}
            >
              <SelectTrigger>
                <SelectValue placeholder="Pick a repository" />
              </SelectTrigger>
              <SelectContent>
                {repositories.map((r) => (
                  <SelectItem key={r.id} value={r.id.toString()}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {latestExecutor && (
            <div className="border-t pt-3 space-y-2">
              <h4 className="text-sm font-semibold">Last run</h4>
              <div className="text-xs text-slate-500 uppercase">Executor</div>
              <pre className="whitespace-pre-wrap text-sm">
                {latestExecutor.summary ?? '(no summary)'}
              </pre>
              {latestReviewer && (
                <>
                  <div className="text-xs text-slate-500 uppercase">
                    Reviewer — {latestReviewer.verdict ?? 'unknown'}
                  </div>
                  <pre className="whitespace-pre-wrap text-sm">
                    {latestReviewer.summary ?? '(no summary)'}
                  </pre>
                </>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          {task && !readOnly && (
            <Button variant="destructive" onClick={handleDelete}>
              Delete
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {!readOnly && (
            <Button onClick={handleSave} disabled={!title || !repoId}>
              Save
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
