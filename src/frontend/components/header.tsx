import { useState } from 'react'
import { Button } from './ui/button'
import { Plus, GitBranch, Moon, Sun } from 'lucide-react'
import { TaskDialog } from './task-dialog'
import { RepositoryDialog } from './repository-dialog'
import { useTheme } from '../hooks/use-theme'

export function Header() {
  const [taskOpen, setTaskOpen] = useState(false)
  const [repoOpen, setRepoOpen] = useState(false)
  const { theme, toggle } = useTheme()
  return (
    <header className="border-b border-slate-200 bg-white px-4 py-3 flex items-center justify-between dark:border-slate-800 dark:bg-slate-950">
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
        <Button variant="ghost" size="icon-sm" onClick={toggle} aria-label="Toggle theme">
          {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </Button>
      </div>
      <TaskDialog mode="create" open={taskOpen} onOpenChange={setTaskOpen} />
      <RepositoryDialog open={repoOpen} onOpenChange={setRepoOpen} />
    </header>
  )
}
