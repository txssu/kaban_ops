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
const REVIEWER_JSON_RE = /```json\s*([\s\S]*?)\s*```/

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
  const match = text.match(REVIEWER_JSON_RE)
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

/**
 * Build the Agent SDK options object for a single run.
 *
 * Both `permissionMode: 'bypassPermissions'` and
 * `allowDangerouslySkipPermissions: true` are required per SDK v0.2.92
 * (see `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` lines
 * 1184-1196). This is a reading of the type declarations; it has not
 * been verified end-to-end at runtime. Do not remove either flag
 * without first confirming the SDK still enters bypass mode.
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
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    systemPrompt: { type: 'preset', preset: 'claude_code' },
    settingSources: ['user', 'project', 'local'],
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
