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

    const match = finalText.match(/```json\s*\n([\s\S]*?)\n```/)
    if (!match || !match[1]) {
      throw new Error('reviewer did not return a JSON code block')
    }
    const parsed = JSON.parse(match[1])
    return reviewerSchema.parse(parsed)
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
      // Both permission flags are required per Agent SDK v0.2.92 docs
      // (sdk.d.ts:1184-1196): `permissionMode: 'bypassPermissions'` is the
      // named mode AND `allowDangerouslySkipPermissions: true` must be set
      // alongside it as an explicit safety acknowledgement. The original
      // review's "cargo-culting" diagnosis was wrong; both are intentional.
      const q = query({
        prompt,
        options: {
          cwd: input.cwd,
          abortController: controller,
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
          systemPrompt: { type: 'preset', preset: 'claude_code' },
          settingSources: ['user', 'project', 'local'],
        },
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
