import { Hono } from 'hono'
import type { Db } from '../db/client'
import type { SseBus } from './sse-bus'
import type { GitClient } from '../orchestrator/git-client'
import { createRepositoryRoutes } from './routes/repositories'
import { createTaskRoutes } from './routes/tasks'

export interface AppDeps {
  db: Db
  bus: SseBus
  git: GitClient
  onStopTask: (taskId: number) => void
}

export function createApp(deps: AppDeps) {
  const app = new Hono()

  app.route('/api/repositories', createRepositoryRoutes(deps))
  app.route('/api/tasks', createTaskRoutes(deps))

  return app
}
