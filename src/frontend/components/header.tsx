import { useState } from 'react'
import { Button } from './ui/button'
import { Plus, GitBranch } from 'lucide-react'
import { TaskDialog } from './task-dialog'
import { RepositoryDialog } from './repository-dialog'

export function Header() {
  const [taskOpen, setTaskOpen] = useState(false)
  const [repoOpen, setRepoOpen] = useState(false)
  return (
    <header className="border-b border-slate-200 bg-white px-4 py-3 flex items-center justify-between">
      <h1 className="text-lg font-semibold">Kaban Ops</h1>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setRepoOpen(true)}
        >
          <GitBranch className="w-4 h-4 mr-1" /> Add Repo
        </Button>
        <Button size="sm" onClick={() => setTaskOpen(true)}>
          <Plus className="w-4 h-4 mr-1" /> Task
        </Button>
      </div>
      <TaskDialog mode="create" open={taskOpen} onOpenChange={setTaskOpen} />
      <RepositoryDialog open={repoOpen} onOpenChange={setRepoOpen} />
    </header>
  )
}
