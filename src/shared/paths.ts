import { join, resolve } from 'node:path'

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..')
const DATA_DIR = join(PROJECT_ROOT, '.data')
const REPOS_DIR = join(DATA_DIR, 'repos')
const WORKTREES_DIR = join(DATA_DIR, 'worktrees')

export const paths = {
  projectRoot: PROJECT_ROOT,
  dataDir: DATA_DIR,
  dbFile: join(DATA_DIR, 'kaban.db'),
  reposDir: REPOS_DIR,
  worktreesDir: WORKTREES_DIR,
  configFile: join(DATA_DIR, 'config.json'),
  repoDir(name: string): string {
    return join(REPOS_DIR, name)
  },
  worktreeDir(taskId: number): string {
    return join(WORKTREES_DIR, `task-${taskId}`)
  },
}
