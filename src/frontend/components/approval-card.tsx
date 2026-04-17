import { useState } from 'react'
import { Card, CardContent } from './ui/card'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { useApprovalDecide } from '../hooks/use-approvals'
import { ApprovalDetailDialog } from './approval-detail-dialog'
import { VERDICT_COLORS } from '../lib/verdict'
import type { TaskWithRun } from '../../shared/types'

interface PendingApproval {
  id: number
  toolName: string
  toolInputPreview: string
  judgeVerdict: string | null
  judgeReason: string | null
}

interface ApprovalCardProps {
  task: TaskWithRun & { pendingApproval?: PendingApproval }
}

function toolPreview(toolName: string, preview: string): string {
  try {
    const parsed = JSON.parse(preview)
    if (toolName === 'Bash' && parsed.command) return `$ ${parsed.command}`
    if ((toolName === 'Write' || toolName === 'Edit') && parsed.file_path)
      return parsed.file_path
    if (toolName === 'WebFetch' && parsed.url) return parsed.url
  } catch {
    // ignore
  }
  return preview.slice(0, 100)
}

export function ApprovalCard({ task }: ApprovalCardProps) {
  const decide = useApprovalDecide()
  const [showDetail, setShowDetail] = useState(false)
  const approval = task.pendingApproval

  if (!approval) return null

  return (
    <>
      <div>
        <Card
          className="mb-2 cursor-pointer border-amber-300 dark:border-amber-700"
          onClick={() => setShowDetail(true)}
        >
          <CardContent className="p-3 space-y-2">
            <div className="font-medium text-sm">{task.title}</div>
            <div className="text-xs text-amber-700 dark:text-amber-400 font-medium">
              Agent needs approval
            </div>
            <div className="space-y-1">
              <Badge variant="outline">{approval.toolName}</Badge>
              <pre className="text-xs text-slate-600 dark:text-slate-400 whitespace-pre-wrap break-all mt-1 max-h-16 overflow-hidden">
                {toolPreview(approval.toolName, approval.toolInputPreview)}
              </pre>
            </div>
            {approval.judgeVerdict && (
              <div className="flex items-center gap-1">
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Haiku:
                </span>
                <span
                  className={`text-xs px-1.5 py-0.5 rounded ${VERDICT_COLORS[approval.judgeVerdict] ?? ''}`}
                >
                  {approval.judgeVerdict}
                </span>
                {approval.judgeReason && (
                  <span
                    className="text-xs text-slate-500 dark:text-slate-400 truncate"
                    title={approval.judgeReason}
                  >
                    {approval.judgeReason}
                  </span>
                )}
              </div>
            )}
            <div className="flex gap-1 pt-1">
              <Button
                size="sm"
                variant="outline"
                className="flex-1 text-xs"
                onClick={(e) => {
                  e.stopPropagation()
                  decide.mutate({
                    approvalId: approval.id,
                    decision: 'allow_once',
                  })
                }}
              >
                Allow once
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="flex-1 text-xs"
                onClick={(e) => {
                  e.stopPropagation()
                  decide.mutate({
                    approvalId: approval.id,
                    decision: 'allow_for_task',
                  })
                }}
              >
                Allow for task
              </Button>
              <Button
                size="sm"
                variant="destructive"
                className="flex-1 text-xs"
                onClick={(e) => {
                  e.stopPropagation()
                  decide.mutate({
                    approvalId: approval.id,
                    decision: 'deny',
                  })
                }}
              >
                Deny
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
      {showDetail && (
        <ApprovalDetailDialog
          approvalId={approval.id}
          open={showDetail}
          onOpenChange={setShowDetail}
        />
      )}
    </>
  )
}
