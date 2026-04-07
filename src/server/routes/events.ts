import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { SseBus } from '../sse-bus'

export function createEventRoutes(deps: { bus: SseBus }) {
  const app = new Hono()

  app.get('/', (c) => {
    return streamSSE(c, async (stream) => {
      let id = 0
      const unsub = deps.bus.subscribe((event) => {
        stream
          .writeSSE({
            event: event.type,
            data: JSON.stringify(event.payload),
            id: String(++id),
          })
          .catch(() => {})
      })
      c.req.raw.signal.addEventListener('abort', () => unsub())
      // Keep the stream open until the client disconnects
      await new Promise<void>((resolve) => {
        c.req.raw.signal.addEventListener('abort', () => resolve())
      })
    })
  })

  return app
}
