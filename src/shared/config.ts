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

export const defaultConfig: Config = {
  progressLimit: 2,
  aiReviewLimit: 1,
  maxAttempts: 3,
  taskTimeoutMs: 30 * 60 * 1000,
  bindHost: '127.0.0.1',
  port: 3000,
}

export function loadConfig(file: string): Config {
  if (!existsSync(file)) return { ...defaultConfig }
  const raw = readFileSync(file, 'utf8')
  const parsed = JSON.parse(raw)
  const merged = { ...defaultConfig, ...parsed }
  return configSchema.parse(merged)
}
