import { Hono } from 'hono'
import type { Db } from '../db/client'
import type { SseBus } from './sse-bus'
import type { GitClient } from '../orchestrator/git-client'
import type { Config } from '../shared/config'
import { createRepositoryRoutes } from './routes/repositories'
import { createTaskRoutes } from './routes/tasks'
import { createEventRoutes } from './routes/events'
import { createConfigRoutes } from './routes/config'

export interface AppDeps {
  db: Db
  bus: SseBus
  git: GitClient
  onStopTask: (taskId: number) => void
  config: Config
}

export function createApp(deps: AppDeps) {
  const app = new Hono()

  app.route('/api/repositories', createRepositoryRoutes(deps))
  app.route('/api/tasks', createTaskRoutes(deps))
  app.route('/api/events', createEventRoutes(deps))
  app.route('/api/config', createConfigRoutes(deps))

  return app
}
