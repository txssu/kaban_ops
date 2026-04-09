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

test('loadConfig defaults bindHost to 127.0.0.1 and port to 3000', () => {
  expect(defaultConfig.bindHost).toBe('127.0.0.1')
  expect(defaultConfig.port).toBe(3000)
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
  expect(result.bindHost).toBe(defaultConfig.bindHost)
  expect(result.port).toBe(defaultConfig.port)
  rmSync(dir, { recursive: true })
})

test('loadConfig accepts custom bindHost and port', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kaban-cfg-'))
  const file = join(dir, 'config.json')
  writeFileSync(file, JSON.stringify({ bindHost: '0.0.0.0', port: 4500 }))
  const result = loadConfig(file)
  expect(result.bindHost).toBe('0.0.0.0')
  expect(result.port).toBe(4500)
  rmSync(dir, { recursive: true })
})

test('loadConfig throws on invalid JSON with a message that includes the file path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kaban-cfg-'))
  const file = join(dir, 'config.json')
  writeFileSync(file, '{ not json')
  // Use the file-path fragment to verify the helpful wrapper error
  // fired rather than the raw SyntaxError.
  expect(() => loadConfig(file)).toThrow(/config.json/)
  expect(() => loadConfig(file)).toThrow(/failed to parse/)
  rmSync(dir, { recursive: true })
})

test('loadConfig throws when the JSON root is not an object', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kaban-cfg-'))
  const file = join(dir, 'config.json')
  for (const content of ['42', '"hello"', 'null', 'true', '[]']) {
    writeFileSync(file, content)
    expect(() => loadConfig(file)).toThrow(/must be a JSON object/)
  }
  rmSync(dir, { recursive: true })
})

test('defaultConfig is frozen and cannot be mutated', () => {
  // Runtime check: assigning to a frozen object throws in strict mode
  // (which Bun modules run under by default).
  expect(() => {
    // Cast through unknown to bypass the Readonly type guard and
    // actually attempt the runtime mutation.
    ;(defaultConfig as unknown as { port: number }).port = 9999
  }).toThrow()
})

test('loadConfig throws a helpful error on type-wrong values', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kaban-cfg-'))
  const file = join(dir, 'config.json')
  writeFileSync(file, JSON.stringify({ progressLimit: 'two' }))
  expect(() => loadConfig(file)).toThrow(/progressLimit/)
  rmSync(dir, { recursive: true })
})

test('loadConfig rejects negative limits', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kaban-cfg-'))
  const file = join(dir, 'config.json')
  writeFileSync(file, JSON.stringify({ progressLimit: -1 }))
  expect(() => loadConfig(file)).toThrow()
  rmSync(dir, { recursive: true })
})

test('loadConfig rejects an out-of-range port', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kaban-cfg-'))
  const file = join(dir, 'config.json')
  writeFileSync(file, JSON.stringify({ port: 99999 }))
  expect(() => loadConfig(file)).toThrow()
  rmSync(dir, { recursive: true })
})
