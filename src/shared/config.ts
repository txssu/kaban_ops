import { readFileSync } from 'node:fs'
import { z } from 'zod'

// Field order mirrors `defaultConfig` below — keep them in sync.
const configSchema = z.object({
  progressLimit: z.number().int().nonnegative(),
  aiReviewLimit: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  taskTimeoutMs: z.number().int().positive(),
  bindHost: z.string().min(1),
  port: z.number().int().min(1).max(65535),
})

export type Config = z.infer<typeof configSchema>

// Frozen to make accidental mutation by test setup or consumers an
// immediate error rather than a silent corruption of the shared default.
export const defaultConfig: Readonly<Config> = Object.freeze({
  progressLimit: 2,
  aiReviewLimit: 1,
  maxAttempts: 3,
  taskTimeoutMs: 30 * 60 * 1000,
  bindHost: '127.0.0.1',
  port: 3000,
})

function isPlainObject(value: unknown): value is Record<string, unknown> {
  // JSON.parse only ever produces arrays, objects, or primitives — we
  // just need to exclude arrays and non-objects. No prototype check.
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export interface LoadConfigResult {
  /** Frozen, validated config. Consumers can destructure/copy but not mutate. */
  config: Readonly<Config>
  /** True when the file existed and was parsed; false when defaults were used. */
  fromFile: boolean
}

/**
 * Load config from `file`, falling back to `defaultConfig` when the
 * file does not exist. The returned `config` is always frozen so that
 * the "defaults are immutable" invariant holds for every caller —
 * tests included.
 *
 * A single `readFileSync` is used; there is no separate `existsSync`
 * probe, so there is no TOCTOU window between "does the file exist?"
 * and "read it". `fromFile` reflects the outcome of the read itself,
 * not a prior stat call.
 */
export function loadConfig(file: string): LoadConfigResult {
  let raw: string
  try {
    raw = readFileSync(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { config: defaultConfig, fromFile: false }
    }
    throw err
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(
      `failed to parse config at ${file}: ${(err as Error).message}`,
    )
  }
  if (!isPlainObject(parsed)) {
    throw new Error(
      `config at ${file} must be a JSON object, got ${Array.isArray(parsed) ? 'array' : typeof parsed}`,
    )
  }
  const merged = { ...defaultConfig, ...parsed }
  return { config: Object.freeze(configSchema.parse(merged)), fromFile: true }
}
