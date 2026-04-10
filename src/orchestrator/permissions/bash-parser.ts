import { parse } from 'shell-quote'
import type { ParseEntry } from 'shell-quote'
import { resolve, sep } from 'path'
import { homedir } from 'os'

export type BashClassification = 'allow' | 'deny' | 'grey'

const SAFE_GIT_SUBCOMMANDS = new Set([
  'status', 'diff', 'log', 'show', 'add', 'commit', 'checkout', 'branch', 'stash',
])

const SAFE_READONLY_COMMANDS = new Set([
  'ls', 'pwd', 'cat', 'head', 'tail', 'wc', 'file', 'which', 'echo',
])

const PATH_COMMANDS = new Set(['mkdir', 'touch', 'cp', 'mv'])

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

const PROTECTED_PREFIXES = [
  () => homedir() + '/.ssh',
  () => homedir() + '/.claude',
  () => homedir() + '/.aws',
  () => '/etc',
]

// Also protect the kaban database specifically
const PROTECTED_EXACT = [
  () => '.data/kaban.db',
]

function hitsProtectedPath(arg: string): boolean {
  const expanded = expandTilde(arg)
  const resolved = resolve(expanded)

  for (const prefixFn of PROTECTED_PREFIXES) {
    const prefix = prefixFn()
    if (resolved === prefix || resolved.startsWith(prefix + sep)) return true
  }

  for (const exactFn of PROTECTED_EXACT) {
    const exact = exactFn()
    if (resolved === resolve(exact)) return true
  }

  return false
}

function hasRecursiveFlag(args: string[]): boolean {
  for (const arg of args) {
    if (arg === '--recursive') return true
    if (arg === '-r' || arg === '-rf' || arg === '-fr') return true
    // Any flag containing 'r' like -rfi, -Rf, etc.
    if (arg.startsWith('-') && !arg.startsWith('--') && arg.includes('r')) return true
  }
  return false
}

type ParsedToken = string | { op: string }

interface Segment {
  tokens: string[]
  redirectTargets: string[]
}

function splitSegments(parsed: ParsedToken[]): { segments: Segment[]; pipes: Array<{ left: Segment; right: Segment }> } {
  const segments: Segment[] = []
  const pipes: Array<{ left: Segment; right: Segment }> = []
  let current: Segment = { tokens: [], redirectTargets: [] }

  let i = 0
  while (i < parsed.length) {
    const token = parsed[i]
    if (typeof token !== 'string') {
      const op = token.op
      if (op === '>' || op === '>>') {
        // Next token is the redirect target
        i++
        if (i < parsed.length && typeof parsed[i] === 'string') {
          current.redirectTargets.push(parsed[i] as string)
        }
      } else if (op === '&&' || op === '||' || op === ';') {
        segments.push(current)
        current = { tokens: [], redirectTargets: [] }
      } else if (op === '|') {
        segments.push(current)
        const leftSegment = current
        current = { tokens: [], redirectTargets: [] }
        // We'll record the pipe relationship after we finish the next segment
        // For now, push to segments and track pipe connections
        // Actually, let's track pipes separately
        // We need to peek ahead to get the right segment
        i++
        // Collect the right segment
        while (i < parsed.length) {
          const t = parsed[i]
          if (typeof t !== 'string') {
            if (t.op === '>' || t.op === '>>') {
              i++
              if (i < parsed.length && typeof parsed[i] === 'string') {
                current.redirectTargets.push(parsed[i] as string)
              }
            } else {
              break
            }
          } else {
            current.tokens.push(t)
          }
          i++
        }
        pipes.push({ left: leftSegment, right: current })
        segments.push(current)
        current = { tokens: [], redirectTargets: [] }
        continue // skip the i++ at end
      }
    } else {
      current.tokens.push(token)
    }
    i++
  }
  if (current.tokens.length > 0 || current.redirectTargets.length > 0) {
    segments.push(current)
  }

  return { segments, pipes }
}

function stripEnvPrefix(tokens: string[]): string[] {
  if (tokens.length === 0) return tokens
  if (tokens[0] === 'env') {
    // Skip 'env' and any VAR=val tokens
    let i = 1
    while (i < tokens.length && tokens[i].includes('=')) {
      i++
    }
    return tokens.slice(i)
  }
  return tokens
}

function classifySegment(tokens: string[], redirectTargets: string[], worktreePath: string): BashClassification {
  if (tokens.length === 0) return 'allow'

  // Strip env prefix
  tokens = stripEnvPrefix(tokens)
  if (tokens.length === 0) return 'allow'

  const cmd = tokens[0]
  const args = tokens.slice(1)

  // --- DENY checks first ---

  // sudo
  if (cmd === 'sudo') return 'deny'

  // rm with recursive flags
  if (cmd === 'rm' && hasRecursiveFlag(args)) return 'deny'

  // git dangerous operations
  if (cmd === 'git' && args.length > 0) {
    const subCmd = args[0]
    if (subCmd === 'push') return 'deny'
    if (subCmd === 'clean') return 'deny'
    if (subCmd === 'reset' && args.includes('--hard')) return 'deny'
    if (subCmd === 'branch') {
      if (args.includes('-D') || args.includes('--force') || args.includes('-f')) return 'deny'
    }
    // Any git with --force or -f (except branch which is handled above)
    if (args.includes('--force') || args.includes('-f')) return 'deny'
  }

  // Check all args for protected paths
  for (const arg of args) {
    if (hitsProtectedPath(arg)) return 'deny'
  }

  // Check redirect targets for protected paths or outside worktree
  for (const target of redirectTargets) {
    if (hitsProtectedPath(target)) return 'deny'
    const expanded = expandTilde(target)
    const resolved = resolve(worktreePath, expanded)
    if (!isWithin(resolved, worktreePath)) return 'deny'
  }

  // --- ALLOW checks ---

  // bun test, bun run
  if (cmd === 'bun') {
    if (args.length === 0) return 'grey'
    if (args[0] === 'test' || args[0] === 'run') return 'allow'
    if (args[0] === 'install' && args.length === 1) return 'allow'
    // bun add, bun remove, bun install <pkg> → grey
    return 'grey'
  }

  // bunx
  if (cmd === 'bunx') return 'allow'

  // git safe subcommands
  if (cmd === 'git') {
    if (args.length === 0) return 'grey'
    const subCmd = args[0]
    if (SAFE_GIT_SUBCOMMANDS.has(subCmd)) return 'allow'
    return 'grey'
  }

  // Safe read-only commands
  if (SAFE_READONLY_COMMANDS.has(cmd)) return 'allow'

  // Path-modifying commands — all path args must be in worktree
  if (PATH_COMMANDS.has(cmd)) {
    const pathArgs = args.filter(a => !a.startsWith('-'))
    for (const p of pathArgs) {
      const resolved = resolve(worktreePath, p)
      if (!isWithin(resolved, worktreePath)) return 'grey'
    }
    return 'allow'
  }

  // cd — must stay in worktree
  if (cmd === 'cd') {
    if (args.length === 0) return 'grey'
    const target = args[0]
    const resolved = resolve(worktreePath, target)
    if (isWithin(resolved, worktreePath)) return 'allow'
    return 'grey'
  }

  // Default: grey
  return 'grey'
}

export function classifyBashCommand(command: string, worktreePath: string): BashClassification {
  // 1. Check for $() or backticks → grey
  if (command.includes('$(') || command.includes('`')) return 'grey'

  // 2. Parse with shell-quote
  const parsed = parse(command)

  // 3. Split into segments
  const { segments, pipes } = splitSegments(parsed)

  // 4. Check for pipe to shell (curl | sh/bash/zsh pattern)
  for (const pipe of pipes) {
    if (pipe.right.tokens.length > 0) {
      const rightCmd = pipe.right.tokens[0]
      if (rightCmd === 'sh' || rightCmd === 'bash' || rightCmd === 'zsh') return 'deny'
    }
  }

  // 5. Classify each segment
  let result: BashClassification = 'allow'

  for (const segment of segments) {
    const classification = classifySegment(segment.tokens, segment.redirectTargets, worktreePath)
    if (classification === 'deny') return 'deny'
    if (classification === 'grey') result = 'grey'
  }

  // 6. Pipes to non-shell commands → grey (if not already deny)
  if (pipes.length > 0 && result === 'allow') {
    result = 'grey'
  }

  return result
}
