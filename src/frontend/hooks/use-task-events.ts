import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'

export function useTaskEvents() {
  const qc = useQueryClient()
  useEffect(() => {
    const source = new EventSource('/api/events')
    const invalidateTasks = () =>
      qc.invalidateQueries({ queryKey: ['tasks'] })
    const invalidateRepos = () =>
      qc.invalidateQueries({ queryKey: ['repositories'] })
    source.addEventListener('task.created', invalidateTasks)
    source.addEventListener('task.updated', invalidateTasks)
    source.addEventListener('task.deleted', invalidateTasks)
    source.addEventListener('repository.created', invalidateRepos)
    source.addEventListener('repository.deleted', invalidateRepos)
    source.addEventListener('approval.pending', invalidateTasks)
    source.addEventListener('approval.resolved', invalidateTasks)
    return () => source.close()
  }, [qc])
}
