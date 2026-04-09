import { test, expect } from 'bun:test'
import { FakeAIRunner } from './runner'
import {
  parseReviewerResult,
  buildAgentQueryOptions,
  assertBypassPermissionMode,
  EXPECTED_PERMISSION_MODE,
} from './claude-agent-runner'

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

test('parseReviewerResult accepts a multi-line block with a trailing newline', () => {
  const text =
    'some prose\n```json\n{"verdict":"approved","summary":"ok"}\n```'
  expect(parseReviewerResult(text)).toEqual({
    verdict: 'approved',
    summary: 'ok',
  })
})

test('parseReviewerResult accepts a multi-line block without a trailing newline', () => {
  const text =
    'some prose\n```json\n{"verdict":"rejected","summary":"no"}```'
  expect(parseReviewerResult(text)).toEqual({
    verdict: 'rejected',
    summary: 'no',
  })
})

test('parseReviewerResult accepts a single-line block with no newlines at all', () => {
  const text = 'prose ```json{"verdict":"approved","summary":"ok"}```'
  expect(parseReviewerResult(text)).toEqual({
    verdict: 'approved',
    summary: 'ok',
  })
})

test('parseReviewerResult picks the LAST fenced json block, not the first', () => {
  // The reviewer is instructed to put the verdict "at the very end",
  // but the model often illustrates points with inline examples. The
  // parser must match the final block, not any earlier one.
  const text = [
    'Here is an example of what a rejection might look like:',
    '```json',
    '{"verdict":"rejected","summary":"example, not real"}',
    '```',
    '',
    'My actual verdict:',
    '',
    '```json',
    '{"verdict":"approved","summary":"all good"}',
    '```',
  ].join('\n')
  expect(parseReviewerResult(text)).toEqual({
    verdict: 'approved',
    summary: 'all good',
  })
})

test('parseReviewerResult throws when no fenced JSON block is present', () => {
  expect(() => parseReviewerResult('just prose, no block')).toThrow(
    /code block/,
  )
})

test('parseReviewerResult throws with a helpful message on malformed JSON', () => {
  const text = '```json\n{not valid json}\n```'
  expect(() => parseReviewerResult(text)).toThrow(/did not parse/)
})

test('parseReviewerResult rejects JSON that does not match the schema', () => {
  const text = '```json\n{"foo":"bar"}\n```'
  expect(() => parseReviewerResult(text)).toThrow()
})

test('buildAgentQueryOptions sets both permission flags required by the SDK', () => {
  const controller = new AbortController()
  const opts = buildAgentQueryOptions('/tmp/work', controller)
  expect(opts.permissionMode).toBe('bypassPermissions')
  expect(opts.allowDangerouslySkipPermissions).toBe(true)
})

test('buildAgentQueryOptions forwards cwd and abortController', () => {
  const controller = new AbortController()
  const opts = buildAgentQueryOptions('/home/user/project', controller)
  expect(opts.cwd).toBe('/home/user/project')
  expect(opts.abortController).toBe(controller)
})

test('buildAgentQueryOptions uses the claude_code preset system prompt', () => {
  const controller = new AbortController()
  const opts = buildAgentQueryOptions('/tmp', controller)
  expect(opts.systemPrompt).toEqual({ type: 'preset', preset: 'claude_code' })
})

test('EXPECTED_PERMISSION_MODE is bypassPermissions', () => {
  // Load-bearing: if this constant drifts, the runtime assertion below
  // can silently start approving whatever mode the SDK chooses.
  expect(EXPECTED_PERMISSION_MODE).toBe('bypassPermissions')
})

test('assertBypassPermissionMode ignores non-init messages', () => {
  // Result, assistant, tool_use, etc. messages must not trip the check.
  expect(() =>
    assertBypassPermissionMode({ type: 'result', subtype: 'success' }),
  ).not.toThrow()
  expect(() =>
    assertBypassPermissionMode({ type: 'system', subtype: 'other' }),
  ).not.toThrow()
  expect(() => assertBypassPermissionMode({ type: 'assistant' })).not.toThrow()
})

test('assertBypassPermissionMode accepts system/init with bypassPermissions', () => {
  expect(() =>
    assertBypassPermissionMode({
      type: 'system',
      subtype: 'init',
      permissionMode: 'bypassPermissions',
    }),
  ).not.toThrow()
})

test('assertBypassPermissionMode throws if SDK downgraded to default mode', () => {
  expect(() =>
    assertBypassPermissionMode({
      type: 'system',
      subtype: 'init',
      permissionMode: 'default',
    }),
  ).toThrow(/permissionMode/)
})

test('assertBypassPermissionMode throws if permissionMode is missing', () => {
  expect(() =>
    assertBypassPermissionMode({ type: 'system', subtype: 'init' }),
  ).toThrow()
})
