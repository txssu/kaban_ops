import type { TaskWithRun } from '../../shared/types'

interface TaskDialogProps {
  mode: 'create' | 'view'
  task?: TaskWithRun
  open: boolean
  onOpenChange: (open: boolean) => void
}

// Stub: real implementation in Plan Task 19
export function TaskDialog(_props: TaskDialogProps) {
  return null
}
