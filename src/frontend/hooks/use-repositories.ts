import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { api } from '../api'

export function useRepositories() {
  return useQuery({
    queryKey: ['repositories'],
    queryFn: api.listRepositories,
  })
}

export function useCreateRepository() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: api.createRepository,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['repositories'] }),
  })
}
