import { readFileSync, existsSync } from 'node:fs'
import { z } from 'zod'

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
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  )
}

export function loadConfig(file: string): Config {
  if (!existsSync(file)) return { ...defaultConfig }
  const raw = readFileSync(file, 'utf8')
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
  return configSchema.parse(merged)
}
