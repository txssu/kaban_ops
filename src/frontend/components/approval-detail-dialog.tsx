import { useQuery } from '@tanstack/react-query'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { api } from '../api'
import { useApprovalDecide } from '../hooks/use-approvals'
import { VERDICT_COLORS } from '../lib/verdict'
import { ApprovalToolInput } from './approval-tool-input'

interface ApprovalDetailDialogProps {
  approvalId: number
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ApprovalDetailDialog({
  approvalId,
  open,
  onOpenChange,
}: ApprovalDetailDialogProps) {
  const decide = useApprovalDecide()
  const { data: approval } = useQuery({
    queryKey: ['approval', approvalId],
    queryFn: () => api.getApproval(approvalId),
    enabled: open,
  })

  if (!approval) return null

  function handleDecide(
    decision: 'allow_once' | 'allow_for_task' | 'deny',
  ) {
    decide.mutate(
      { approvalId, decision },
      { onSuccess: () => onOpenChange(false) },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg flex flex-col gap-5">
        <DialogHeader className="shrink-0">
          <DialogTitle>Approval request</DialogTitle>
          <DialogDescription>
            The agent wants to use <strong>{approval.toolName}</strong>.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 min-h-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{approval.toolName}</Badge>
            {approval.judgeVerdict && (
              <span
                className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  VERDICT_COLORS[approval.judgeVerdict] ?? ''
                }`}
              >
                Haiku: {approval.judgeVerdict}
              </span>
            )}
          </div>

          {approval.judgeReason && (
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              {approval.judgeReason}
            </p>
          )}

          <ApprovalToolInput
            toolName={approval.toolName}
            toolInput={approval.toolInput}
          />
        </div>

        <DialogFooter className="shrink-0 sm:justify-between">
          <Button
            variant="destructive"
            onClick={() => handleDecide('deny')}
          >
            Deny
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button
              variant="outline"
              onClick={() => handleDecide('allow_once')}
            >
              Allow once
            </Button>
            <Button onClick={() => handleDecide('allow_for_task')}>
              Allow for task
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
