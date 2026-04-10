import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import type { ApprovalDecision } from '../../shared/types'

export function useApprovalDecide() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { approvalId: number; decision: ApprovalDecision }) =>
      api.decideApproval(input.approvalId, input.decision),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
    onError: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  })
}
