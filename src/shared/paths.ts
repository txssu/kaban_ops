import { join, resolve } from 'node:path'

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..')

export const paths = {
  projectRoot: PROJECT_ROOT,
  dataDir: join(PROJECT_ROOT, '.data'),
  dbFile: join(PROJECT_ROOT, '.data', 'kaban.db'),
  reposDir: join(PROJECT_ROOT, '.data', 'repos'),
  worktreesDir: join(PROJECT_ROOT, '.data', 'worktrees'),
  configFile: join(PROJECT_ROOT, '.data', 'config.json'),
  repoDir(name: string): string {
    return join(this.reposDir, name)
  },
  worktreeDir(taskId: number): string {
    return join(this.worktreesDir, `task-${taskId}`)
  },
}
