import { readFileSync, existsSync } from 'node:fs'

export interface Config {
  progressLimit: number
  aiReviewLimit: number
  maxAttempts: number
  taskTimeoutMs: number
  judgeMode: 'advisory' | 'enforcing'
  judgeModel: string
  judgeTimeoutMs: number
}

export const defaultConfig: Config = {
  progressLimit: 2,
  aiReviewLimit: 1,
  maxAttempts: 3,
  taskTimeoutMs: 30 * 60 * 1000,
  judgeMode: 'advisory',
  judgeModel: 'claude-haiku-4-5-20251001',
  judgeTimeoutMs: 30_000,
}

export function loadConfig(file: string): Config {
  if (!existsSync(file)) return { ...defaultConfig }
  const raw = readFileSync(file, 'utf8')
  const parsed = JSON.parse(raw) as Partial<Config>
  return { ...defaultConfig, ...parsed }
}
