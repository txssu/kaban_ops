import { resolve, sep, basename } from 'path'
import { homedir } from 'os'
import { classifyBashCommand } from './bash-parser'

export interface RuleResult {
  decision: 'allow' | 'deny' | 'grey'
  reason?: string
}

const ALWAYS_ALLOW_TOOLS = new Set([
  'Read', 'Grep', 'Glob', 'WebSearch', 'TodoWrite', 'NotebookRead',
])

const WRITE_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit'])

const PROTECTED_SYSTEM_PREFIXES = [
  () => homedir() + '/.ssh',
  () => homedir() + '/.claude',
  () => homedir() + '/.aws',
  () => '/etc',
]

function isWithin(candidate: string, parent: string): boolean {
  const a = resolve(parent) + sep
  const b = resolve(candidate) + sep
  return b.startsWith(a)
}

function expandTilde(p: string): string {
  if (p === '~') return homedir()
  if (p.startsWith('~/')) return homedir() + p.slice(1)
  return p
}

function isProtectedSystemPath(resolvedPath: string): boolean {
  for (const prefixFn of PROTECTED_SYSTEM_PREFIXES) {
    const prefix = prefixFn()
    if (resolvedPath === prefix || resolvedPath.startsWith(prefix + sep)) return true
  }
  return false
}

// Patterns that are denied inside the worktree
function isDeniedInsideWorktree(resolvedPath: string, worktreePath: string): boolean {
  // Must compute relative-like path from worktree root
  const worktreeRoot = resolve(worktreePath)
  const candidate = resolve(resolvedPath)

  // Check .git/ directory
  const gitDir = worktreeRoot + sep + '.git' + sep
  if (candidate === worktreeRoot + sep + '.git' || candidate.startsWith(gitDir)) return true

  // Check files starting with .env
  const name = basename(candidate)
  if (name === '.env' || name.startsWith('.env.')) return true

  return false
}

// Sensitive files inside worktree → grey
function isSensitiveInsideWorktree(resolvedPath: string, worktreePath: string): boolean {
  const worktreeRoot = resolve(worktreePath)
  const candidate = resolve(resolvedPath)

  // Get the relative path from worktree root
  const rel = candidate.slice(worktreeRoot.length + 1) // strip leading sep

  const name = basename(candidate)

  // Exact sensitive filenames
  if (name === 'package.json') return true
  if (name === 'bun.lockb') return true
  if (name === 'bunfig.toml') return true
  if (name === '.gitignore') return true

  // .github/workflows/**
  if (rel.startsWith('.github' + sep + 'workflows' + sep) || rel === '.github' + sep + 'workflows') return true

  return false
}

function evaluateWriteTool(toolInput: unknown, worktreePath: string): RuleResult {
  // Extract file_path or path
  const input = toolInput as Record<string, unknown>
  const rawPath = (typeof input['file_path'] === 'string' ? input['file_path'] : null)
    ?? (typeof input['path'] === 'string' ? input['path'] : null)

  if (rawPath === null || rawPath === undefined) {
    return { decision: 'grey', reason: 'no file_path provided' }
  }

  // Expand tilde
  const expanded = expandTilde(rawPath)

  // Resolve relative to worktreePath
  const resolved = resolve(worktreePath, expanded)

  // 1. Check protected system paths
  if (isProtectedSystemPath(resolved)) {
    return { decision: 'deny', reason: `protected system path: ${resolved}` }
  }

  // 2. Check if within worktree
  if (!isWithin(resolved, worktreePath)) {
    return { decision: 'deny', reason: `path outside worktree: ${resolved}` }
  }

  // 3. Check denied patterns inside worktree
  if (isDeniedInsideWorktree(resolved, worktreePath)) {
    return { decision: 'deny', reason: `denied path inside worktree: ${resolved}` }
  }

  // 4. Check sensitive files inside worktree → grey
  if (isSensitiveInsideWorktree(resolved, worktreePath)) {
    return { decision: 'grey' }
  }

  return { decision: 'allow' }
}

function isPrivateIP(hostname: string): boolean {
  // localhost / loopback
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return true

  // Parse IPv4 octets
  const parts = hostname.split('.').map(Number)
  if (parts.length === 4 && parts.every(n => !isNaN(n) && n >= 0 && n <= 255)) {
    const [a, b] = parts as [number, number, number, number]
    // 10.0.0.0/8
    if (a === 10) return true
    // 172.16.0.0/12
    if (a === 172 && b >= 16 && b <= 31) return true
    // 192.168.0.0/16
    if (a === 192 && b === 168) return true
    // 169.254.0.0/16 (link-local)
    if (a === 169 && b === 254) return true
  }

  return false
}

function evaluateWebFetch(toolInput: unknown): RuleResult {
  const input = toolInput as Record<string, unknown>
  const url = typeof input['url'] === 'string' ? input['url'] : null

  if (!url) {
    return { decision: 'grey', reason: 'no url provided' }
  }

  let hostname: string
  try {
    hostname = new URL(url).hostname
  } catch {
    return { decision: 'grey', reason: 'invalid url' }
  }

  if (isPrivateIP(hostname)) {
    return { decision: 'deny', reason: `SSRF: blocked private/loopback host: ${hostname}` }
  }

  return { decision: 'grey' }
}

function evaluateBash(toolInput: unknown, worktreePath: string): RuleResult {
  const input = toolInput as Record<string, unknown>
  const command = typeof input['command'] === 'string' ? input['command'] : ''

  const classification = classifyBashCommand(command, worktreePath)

  if (classification === 'deny') {
    return { decision: 'deny', reason: `dangerous bash command: ${command.slice(0, 200)}` }
  }

  if (classification === 'allow') {
    return { decision: 'allow' }
  }

  return { decision: 'grey' }
}

export function evaluateRules(toolName: string, toolInput: unknown, worktreePath: string): RuleResult {
  if (ALWAYS_ALLOW_TOOLS.has(toolName)) {
    return { decision: 'allow' }
  }

  if (WRITE_TOOLS.has(toolName)) {
    return evaluateWriteTool(toolInput, worktreePath)
  }

  if (toolName === 'Bash') {
    return evaluateBash(toolInput, worktreePath)
  }

  if (toolName === 'WebFetch') {
    return evaluateWebFetch(toolInput)
  }

  return { decision: 'grey' }
}
