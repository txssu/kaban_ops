import { useState } from 'react'
import { Card, CardContent } from './ui/card'
import { Badge } from './ui/badge'
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

export function ApprovalCard({ task }: ApprovalCardProps) {
  const [showDetail, setShowDetail] = useState(false)
  const approval = task.pendingApproval

  if (!approval) return null

  return (
    <>
      <Card
        className="mb-2 cursor-pointer"
        onClick={() => setShowDetail(true)}
      >
        <CardContent className="p-3 space-y-2">
          <div className="font-medium text-sm">{task.title}</div>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline">{approval.toolName}</Badge>
            {approval.judgeVerdict && (
              <span
                className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  VERDICT_COLORS[approval.judgeVerdict] ?? ''
                }`}
              >
                {approval.judgeVerdict}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
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
