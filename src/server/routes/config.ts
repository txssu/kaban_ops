import { Hono } from 'hono'
import type { Config } from '../../shared/config'

export function createConfigRoutes(deps: { config: Config }) {
  const app = new Hono()

  // The rule for what belongs in this response:
  //
  //   "Operational limits the *board UI* needs to render its state."
  //
  // The frontend uses `progressLimit` and `aiReviewLimit` to show WIP
  // badges and `maxAttempts` to show a task's attempt counter. Those
  // three are deliberately exposed.
  //
  // Deliberately NOT exposed:
  //
  //   - `taskTimeoutMs`   — server-side kill switch; the UI has no
  //                          concept of a task timeout and surfacing it
  //                          leaks a useful probing signal.
  //   - `bindHost`, `port` — network topology; exposing them gives an
  //                          attacker who reaches the endpoint a free
  //                          confirmation of the listening interface.
  //
  // When adding a new config field, decide which side of this line it
  // belongs on and update this comment. See `app.test.ts` for the
  // regression test that asserts nothing else leaks.
  app.get('/', (c) => {
    return c.json({
      progressLimit: deps.config.progressLimit,
      aiReviewLimit: deps.config.aiReviewLimit,
      maxAttempts: deps.config.maxAttempts,
    })
  })

  return app
}
