import { Hono } from 'hono'
import type { Config } from '../../shared/config'

export function createConfigRoutes(deps: { config: Config }) {
  const app = new Hono()

  app.get('/', (c) => {
    return c.json({
      progressLimit: deps.config.progressLimit,
      aiReviewLimit: deps.config.aiReviewLimit,
      maxAttempts: deps.config.maxAttempts,
    })
  })

  return app
}
