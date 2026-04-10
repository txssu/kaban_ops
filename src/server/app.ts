import { Hono } from 'hono'
import type { Db } from '../db/client'
import type { SseBus } from './sse-bus'
import type { GitClient } from '../orchestrator/git-client'
import type { PermissionCoordinator } from '../orchestrator/permissions/coordinator'
import { createRepositoryRoutes } from './routes/repositories'
import { createTaskRoutes } from './routes/tasks'
import { createApprovalRoutes } from './routes/approvals'
import { createEventRoutes } from './routes/events'

export interface AppDeps {
  db: Db
  bus: SseBus
  git: GitClient
  coordinator?: PermissionCoordinator
  onStopTask: (taskId: number) => void
}

export function createApp(deps: AppDeps) {
  const app = new Hono()

  app.route('/api/repositories', createRepositoryRoutes(deps))
  app.route('/api/tasks', createTaskRoutes(deps))
  if (deps.coordinator) {
    app.route(
      '/api/approvals',
      createApprovalRoutes({ db: deps.db, coordinator: deps.coordinator }),
    )
  }
  app.route('/api/events', createEventRoutes(deps))

  return app
}
