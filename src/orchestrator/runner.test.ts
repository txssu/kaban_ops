import { test, expect } from 'bun:test'
import { FakeAIRunner } from './runner'

test('FakeAIRunner.execute returns the queued result and records the call', async () => {
  const runner = new FakeAIRunner()
  runner.queueExecutor({ summary: 'done' })
  const result = await runner.execute({
    prompt: 'do it',
    cwd: '/tmp',
    signal: new AbortController().signal,
  })
  expect(result).toEqual({ summary: 'done' })
  expect(runner.executorCalls).toHaveLength(1)
  expect(runner.executorCalls[0]?.prompt).toBe('do it')
})

test('FakeAIRunner.review returns the queued verdict', async () => {
  const runner = new FakeAIRunner()
  runner.queueReviewer({ verdict: 'rejected', summary: 'no good' })
  const result = await runner.review({
    prompt: 'review',
    cwd: '/tmp',
    signal: new AbortController().signal,
  })
  expect(result).toEqual({ verdict: 'rejected', summary: 'no good' })
})

test('FakeAIRunner rejects with AbortError if the signal is pre-aborted', async () => {
  const runner = new FakeAIRunner()
  runner.queueExecutor({ summary: 'ignored' })
  const controller = new AbortController()
  controller.abort('user_abort')
  await expect(
    runner.execute({ prompt: 'x', cwd: '/tmp', signal: controller.signal }),
  ).rejects.toThrow()
})

test('FakeAIRunner throws when the queue is empty', async () => {
  const runner = new FakeAIRunner()
  await expect(
    runner.execute({
      prompt: 'x',
      cwd: '/tmp',
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow('no queued executor result')
})

test('reviewer JSON matcher tolerates a missing trailing newline before the closing fence', () => {
  // The fenced-JSON regex must match both shapes — with and without
  // a trailing newline before the closing ```
  const withNewline =
    'some prose\n```json\n{"verdict":"approved","summary":"ok"}\n```'
  const withoutNewline =
    'some prose\n```json\n{"verdict":"approved","summary":"ok"}```'
  const pattern = /```json\s*\n([\s\S]*?)\s*```/
  expect(pattern.test(withNewline)).toBe(true)
  expect(pattern.test(withoutNewline)).toBe(true)
})
