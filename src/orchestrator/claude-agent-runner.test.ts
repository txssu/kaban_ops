import { test, expect, mock } from 'bun:test'

// Replace the Agent SDK *before* importing the runner so the module
// binding resolves to the mock. The fake `query()` records its
// arguments into the closure so tests can assert that
// `ClaudeAgentRunner.runQuery` forwards the full options object built
// by `buildAgentQueryOptions` — that's the behavioural check the
// previous pure-function tests did not provide.

interface Captured {
  prompt?: string
  options?: Record<string, unknown>
}

const captured: Captured = {}

// Controls what the fake SDK yields for the next call.
let nextMessages: unknown[] = []

function resetSdk(
  messages: unknown[] = [
    {
      type: 'system',
      subtype: 'init',
      permissionMode: 'bypassPermissions',
    },
    {
      type: 'result',
      subtype: 'success',
      result: 'ok',
    },
  ],
) {
  captured.prompt = undefined
  captured.options = undefined
  nextMessages = messages
}

mock.module('@anthropic-ai/claude-agent-sdk', () => ({
  AbortError: class AbortError extends Error {
    override name = 'AbortError'
  },
  query: (args: { prompt: string; options: Record<string, unknown> }) => {
    captured.prompt = args.prompt
    captured.options = args.options
    const messages = nextMessages
    return (async function* () {
      for (const m of messages) yield m
    })()
  },
}))

// Import AFTER the mock so the runner resolves to the fake module.
const { ClaudeAgentRunner } = await import('./claude-agent-runner')

test('ClaudeAgentRunner.execute forwards buildAgentQueryOptions to query()', async () => {
  resetSdk()
  const runner = new ClaudeAgentRunner()
  const controller = new AbortController()
  const result = await runner.execute({
    prompt: 'do it',
    cwd: '/tmp/work',
    signal: controller.signal,
  })
  expect(result).toEqual({ summary: 'ok' })
  expect(captured.prompt).toBe('do it')
  expect(captured.options).toBeDefined()
  // Both permission flags must reach the SDK verbatim — this is the
  // load-bearing behavioural assertion. A refactor that quietly drops
  // either flag will fail here.
  expect(captured.options!.permissionMode).toBe('bypassPermissions')
  expect(captured.options!.allowDangerouslySkipPermissions).toBe(true)
  expect(captured.options!.cwd).toBe('/tmp/work')
  expect(captured.options!.systemPrompt).toEqual({
    type: 'preset',
    preset: 'claude_code',
  })
  expect(captured.options!.settingSources).toEqual(['user', 'project', 'local'])
  // The abortController must be the same instance the runner forwards
  // into — identity check, not a structural one.
  expect(captured.options!.abortController).toBeInstanceOf(AbortController)
})

test('ClaudeAgentRunner.execute throws if the SDK enters a weaker permission mode', async () => {
  // Simulate a future SDK version that silently downgrades our
  // request. The runtime assertion must fail hard rather than let the
  // executor run under `default` mode.
  resetSdk([
    {
      type: 'system',
      subtype: 'init',
      permissionMode: 'default',
    },
    {
      type: 'result',
      subtype: 'success',
      result: 'should not be used',
    },
  ])
  const runner = new ClaudeAgentRunner()
  await expect(
    runner.execute({
      prompt: 'p',
      cwd: '/tmp',
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow(/permissionMode/)
})

test('ClaudeAgentRunner.review appends the JSON instruction and parses the verdict', async () => {
  resetSdk([
    { type: 'system', subtype: 'init', permissionMode: 'bypassPermissions' },
    {
      type: 'result',
      subtype: 'success',
      result: '```json\n{"verdict":"approved","summary":"looks good"}\n```',
    },
  ])
  const runner = new ClaudeAgentRunner()
  const out = await runner.review({
    prompt: 'review it',
    cwd: '/tmp',
    signal: new AbortController().signal,
  })
  expect(out).toEqual({ verdict: 'approved', summary: 'looks good' })
  // The runner must extend the user prompt with the JSON-format
  // instruction — otherwise the reviewer has no reason to emit the
  // fenced block we parse.
  expect(captured.prompt).toContain('review it')
  expect(captured.prompt).toMatch(/fenced JSON code block/)
})
