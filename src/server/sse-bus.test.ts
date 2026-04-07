import { test, expect } from 'bun:test'
import { SseBus } from './sse-bus'

test('publish delivers messages to all subscribers', () => {
  const bus = new SseBus()
  const seenA: string[] = []
  const seenB: string[] = []
  const unsubA = bus.subscribe((e) => seenA.push(e.type))
  const unsubB = bus.subscribe((e) => seenB.push(e.type))

  bus.publish({ type: 'task.updated', payload: { taskId: 1 } })
  bus.publish({ type: 'repository.created', payload: { repositoryId: 2 } })

  expect(seenA).toEqual(['task.updated', 'repository.created'])
  expect(seenB).toEqual(['task.updated', 'repository.created'])

  unsubA()
  unsubB()
})

test('unsubscribing stops delivery for that subscriber', () => {
  const bus = new SseBus()
  const seen: string[] = []
  const unsub = bus.subscribe((e) => seen.push(e.type))
  bus.publish({ type: 'task.updated', payload: { taskId: 1 } })
  unsub()
  bus.publish({ type: 'task.updated', payload: { taskId: 2 } })
  expect(seen).toEqual(['task.updated'])
})
