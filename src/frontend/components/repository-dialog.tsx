import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { Label } from './ui/label'
import { Input } from './ui/input'
import { Button } from './ui/button'
import { useCreateRepository } from '../hooks/use-repositories'

interface RepositoryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function RepositoryDialog({
  open,
  onOpenChange,
}: RepositoryDialogProps) {
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const create = useCreateRepository()

  function handleSubmit() {
    setError(null)
    create.mutate(
      { url, name: name || undefined },
      {
        onSuccess: () => {
          setUrl('')
          setName('')
          onOpenChange(false)
        },
        onError: (err) => setError((err as Error).message),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add repository</DialogTitle>
          <DialogDescription>
            Clone a git repository so tasks can target it. The clone is stored
            locally inside the app's data directory.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="url">Git URL</Label>
            <Input
              id="url"
              value={url}
              disabled={create.isPending}
              placeholder="git@github.com:user/repo.git"
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="name">Name (optional)</Label>
            <Input
              id="name"
              value={name}
              disabled={create.isPending}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={create.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!url || create.isPending}
          >
            {create.isPending ? 'Cloning…' : 'Add'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
