import { test, expect } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadConfig, defaultConfig } from './config'

test('loadConfig returns defaults when file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kaban-cfg-'))
  const result = loadConfig(join(dir, 'missing.json'))
  expect(result).toEqual(defaultConfig)
  rmSync(dir, { recursive: true })
})

test('loadConfig merges partial file over defaults', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kaban-cfg-'))
  const file = join(dir, 'config.json')
  writeFileSync(file, JSON.stringify({ progressLimit: 5 }))
  const result = loadConfig(file)
  expect(result.progressLimit).toBe(5)
  expect(result.aiReviewLimit).toBe(defaultConfig.aiReviewLimit)
  expect(result.maxAttempts).toBe(defaultConfig.maxAttempts)
  expect(result.taskTimeoutMs).toBe(defaultConfig.taskTimeoutMs)
  rmSync(dir, { recursive: true })
})

test('loadConfig throws on invalid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kaban-cfg-'))
  const file = join(dir, 'config.json')
  writeFileSync(file, '{ not json')
  expect(() => loadConfig(file)).toThrow()
  rmSync(dir, { recursive: true })
})
