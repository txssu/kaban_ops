import { query, AbortError } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type {
  AIRunner,
  AIRunnerInput,
  ExecutorResult,
  ReviewerResult,
} from './runner'

const reviewerSchema = z.object({
  verdict: z.enum(['approved', 'rejected']),
  summary: z.string(),
})

const REVIEWER_JSON_INSTRUCTION = `

## Output format

After your review, output exactly one fenced JSON code block at the very end
of your response, matching this schema:

\`\`\`json
{"verdict": "approved" | "rejected", "summary": "markdown text"}
\`\`\`

The "verdict" field must be exactly the string "approved" or "rejected".
The "summary" field must contain your full markdown explanation.
`

// Symmetric tolerance: allow any whitespace (including none) on both
// sides of the JSON body, so single-line and multi-line blocks parse.
// We scan with the /g flag and take the LAST match, because the
// instruction tells the reviewer to put the verdict "at the very end"
// of its response — if the model illustrates a point with an earlier
// inline `json` example, the earlier block is narrative and the last
// one is the verdict. Matching the first block turned a
// false-negative failure ("couldn't find JSON") into the much more
// dangerous silent-wrong-answer ("parsed the example instead").
const REVIEWER_JSON_RE = /```json\s*([\s\S]*?)\s*```/g

/**
 * Parse a reviewer agent's final message into a structured verdict.
 * Throws a descriptive error on any of the three failure modes:
 *   1. No fenced JSON block present
 *   2. JSON body is not valid JSON
 *   3. Parsed JSON does not match the reviewer schema
 *
 * Exported as a pure function so behaviour can be tested without
 * standing up a real Claude Agent SDK query.
 */
export function parseReviewerResult(text: string): ReviewerResult {
  // Take the LAST fenced json block — the verdict lives "at the very
  // end" per REVIEWER_JSON_INSTRUCTION; any earlier blocks are illustrative.
  const matches = Array.from(text.matchAll(REVIEWER_JSON_RE))
  const match = matches[matches.length - 1]
  if (!match || !match[1]) {
    throw new Error('reviewer did not return a JSON code block')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(match[1])
  } catch (err) {
    throw new Error(
      `reviewer JSON block did not parse: ${(err as Error).message}`,
    )
  }
  return reviewerSchema.parse(parsed)
}

type QueryOptions = NonNullable<Parameters<typeof query>[0]['options']>

export const EXPECTED_PERMISSION_MODE = 'bypassPermissions' as const

/**
 * Build the Agent SDK options object for a single run.
 *
 * Both `permissionMode: 'bypassPermissions'` and
 * `allowDangerouslySkipPermissions: true` are required per SDK v0.2.92
 * (see `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` lines
 * 1184-1196). Shipping these flags without empirical evidence would be
 * hope-based security — see `assertBypassPermissionMode` below, which
 * reads the SDK's own `system/init` message on every run and fails
 * hard if the realised permission mode is not the one we requested.
 * That assertion is the runtime probe; this helper only composes the
 * request.
 *
 * Exported as a pure function so tests can inspect the options shape.
 */
export function buildAgentQueryOptions(
  cwd: string,
  controller: AbortController,
): QueryOptions {
  return {
    cwd,
    abortController: controller,
    permissionMode: EXPECTED_PERMISSION_MODE,
    allowDangerouslySkipPermissions: true,
    systemPrompt: { type: 'preset', preset: 'claude_code' },
    settingSources: ['user', 'project', 'local'],
  }
}

/**
 * Verify that the SDK actually entered the permission mode we asked
 * for. The Agent SDK emits a `system/init` message at the start of
 * every query whose `permissionMode` field reflects the *realised*
 * mode — if the SDK silently downgraded our request (version skew,
 * deprecated flag, typo in the type declarations, etc.), this field
 * will disagree with what we sent. Throwing here is strictly safer
 * than continuing: the alternative is running an executor under
 * whatever weaker mode the SDK chose, which is exactly the
 * hope-based posture the reviewer flagged.
 *
 * Exported so tests can cover the assertion without standing up a
 * real query.
 */
export function assertBypassPermissionMode(msg: {
  type: string
  subtype?: string
  permissionMode?: string
}): void {
  if (msg.type !== 'system' || msg.subtype !== 'init') return
  if (msg.permissionMode !== EXPECTED_PERMISSION_MODE) {
    throw new Error(
      `claude agent SDK entered permissionMode=${JSON.stringify(msg.permissionMode)}, ` +
        `expected ${JSON.stringify(EXPECTED_PERMISSION_MODE)}. Refusing to run: ` +
        `either the SDK silently downgraded the request or the requested mode is no ` +
        `longer supported. Investigate before removing this assertion.`,
    )
  }
}

export class ClaudeAgentRunner implements AIRunner {
  async execute(input: AIRunnerInput): Promise<ExecutorResult> {
    const finalText = await this.runQuery(input.prompt, input)
    return { summary: finalText }
  }

  async review(input: AIRunnerInput): Promise<ReviewerResult> {
    const finalText = await this.runQuery(
      input.prompt + REVIEWER_JSON_INSTRUCTION,
      input,
    )
    return parseReviewerResult(finalText)
  }

  private async runQuery(
    prompt: string,
    input: AIRunnerInput,
  ): Promise<string> {
    // Bridge the AIRunnerInput.signal into a fresh AbortController for the SDK.
    const controller = new AbortController()
    const onAbort = () => controller.abort(input.signal.reason)
    if (input.signal.aborted) {
      controller.abort(input.signal.reason)
    } else {
      input.signal.addEventListener('abort', onAbort, { once: true })
    }

    try {
      const q = query({
        prompt,
        options: buildAgentQueryOptions(input.cwd, controller),
      })

      let finalText = ''
      for await (const msg of q) {
        // Runtime verification of the requested permission mode. The
        // SDK echoes the realised mode on every init message; throwing
        // aborts the query before any tool can run.
        assertBypassPermissionMode(msg as never)
        if (msg.type === 'result') {
          if (msg.subtype === 'success') {
            finalText = msg.result
          } else {
            throw new Error(
              `claude agent returned non-success result: ${msg.subtype}`,
            )
          }
        }
      }
      return finalText
    } catch (err) {
      if (err instanceof AbortError || (err as Error).name === 'AbortError') {
        const e = new Error('aborted')
        e.name = 'AbortError'
        throw e
      }
      throw err
    } finally {
      input.signal.removeEventListener('abort', onAbort)
    }
  }
}
