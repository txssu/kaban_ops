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

test('ClaudeAgentRunner reviewer regex is tolerant of a missing trailing newline', async () => {
  // Lock in the tolerant fenced-JSON pattern. If anyone tightens it back
  // to requiring \n before the closing fence, agents that drop trailing
  // newlines will silently lose their verdict.
  const source = await Bun.file(
    new URL('./claude-agent-runner.ts', import.meta.url),
  ).text()
  // Tolerant: \s*``` (the fix from Task A4b).
  expect(source).toContain('([\\s\\S]*?)\\s*```')
  // Strict: \n``` would be a regression.
  expect(source).not.toContain('([\\s\\S]*?)\\n```')
})

test('ClaudeAgentRunner sets BOTH permissionMode and allowDangerouslySkipPermissions per SDK requirement', async () => {
  // SDK v0.2.92 sdk.d.ts:1184-1196 requires allowDangerouslySkipPermissions
  // to be set to true alongside permissionMode: 'bypassPermissions'.
  // Guard against future "cleanup" attempts that remove either flag.
  const source = await Bun.file(
    new URL('./claude-agent-runner.ts', import.meta.url),
  ).text()
  expect(source).toContain("permissionMode: 'bypassPermissions'")
  expect(source).toContain('allowDangerouslySkipPermissions: true')
})
