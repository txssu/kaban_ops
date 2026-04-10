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

  let formattedInput: string
  try {
    formattedInput = JSON.stringify(JSON.parse(approval.toolInput), null, 2)
  } catch {
    formattedInput = approval.toolInput
  }

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
      <DialogContent className="max-w-lg flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle>Approval Request</DialogTitle>
          <DialogDescription>
            The agent wants to use <strong>{approval.toolName}</strong>.
            Review the details below and decide.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-3 min-h-0">
          <div className="flex items-center gap-2">
            <Badge variant="outline">{approval.toolName}</Badge>
            {approval.judgeVerdict && (
              <Badge variant="secondary">
                Haiku: {approval.judgeVerdict}
              </Badge>
            )}
          </div>

          {approval.judgeReason && (
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {approval.judgeReason}
            </p>
          )}

          <pre className="whitespace-pre-wrap text-sm rounded bg-slate-50 p-3 dark:bg-slate-900 overflow-x-auto break-all">
            {formattedInput}
          </pre>
        </div>

        <DialogFooter className="shrink-0">
          <Button
            variant="outline"
            onClick={() => handleDecide('allow_once')}
          >
            Allow once
          </Button>
          <Button
            variant="outline"
            onClick={() => handleDecide('allow_for_task')}
          >
            Allow for task
          </Button>
          <Button
            variant="destructive"
            onClick={() => handleDecide('deny')}
          >
            Deny
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
