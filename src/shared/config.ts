import { readFileSync, existsSync } from 'node:fs'
import { userInfo } from 'node:os'

export interface Config {
  progressLimit: number
  aiReviewLimit: number
  maxAttempts: number
  taskTimeoutMs: number
  judgeMode: 'advisory' | 'enforcing'
  judgeModel: string
  judgeTimeoutMs: number
  authorSlug: string
}

function slugify(raw: string): string {
  const cleaned = raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return cleaned || 'kaban'
}

function detectAuthorSlug(): string {
  try {
    return slugify(userInfo().username)
  } catch {
    return 'kaban'
  }
}

export const defaultConfig: Config = {
  progressLimit: 2,
  aiReviewLimit: 1,
  maxAttempts: 3,
  taskTimeoutMs: 30 * 60 * 1000,
  judgeMode: 'advisory',
  judgeModel: 'claude-haiku-4-5-20251001',
  judgeTimeoutMs: 30_000,
  authorSlug: detectAuthorSlug(),
}

export function loadConfig(file: string): Config {
  if (!existsSync(file)) return { ...defaultConfig }
  const raw = readFileSync(file, 'utf8')
  const parsed = JSON.parse(raw) as Partial<Config>
  const merged = { ...defaultConfig, ...parsed }
  if (parsed.authorSlug !== undefined) {
    merged.authorSlug = slugify(parsed.authorSlug)
  }
  return merged
}
