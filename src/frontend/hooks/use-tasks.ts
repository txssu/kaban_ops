import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { api } from '../api'
import type { TaskWithRun } from '../../shared/types'

export function useTasks() {
  return useQuery({
    queryKey: ['tasks'],
    queryFn: api.listTasks,
  })
}

export function useCreateTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: api.createTask,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  })
}

export function useUpdateTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      id: number
      patch: Parameters<typeof api.patchTask>[1]
    }) => api.patchTask(input.id, input.patch),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: ['tasks'] })
      const previous = qc.getQueryData<TaskWithRun[]>(['tasks'])
      if (previous) {
        qc.setQueryData<TaskWithRun[]>(
          ['tasks'],
          previous.map((t) =>
            t.id === input.id ? { ...t, ...input.patch } : t,
          ),
        )
      }
      return { previous }
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.previous) qc.setQueryData(['tasks'], ctx.previous)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  })
}

export function useDeleteTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: api.deleteTask,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  })
}

export function useStopTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: api.stopTask,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  })
}
