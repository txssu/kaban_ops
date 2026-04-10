import { test, expect } from 'bun:test'
import { evaluateRules } from './rules'

const WORKTREE = '/tmp/wt/task-1'

// Always-allow tools
test('Read → allow', () => { expect(evaluateRules('Read', { file_path: '/anywhere' }, WORKTREE)).toEqual({ decision: 'allow' }) })
test('Grep → allow', () => { expect(evaluateRules('Grep', { pattern: 'foo' }, WORKTREE)).toEqual({ decision: 'allow' }) })
test('Glob → allow', () => { expect(evaluateRules('Glob', { pattern: '**/*.ts' }, WORKTREE)).toEqual({ decision: 'allow' }) })
test('WebSearch → allow', () => { expect(evaluateRules('WebSearch', { query: 'bun test' }, WORKTREE)).toEqual({ decision: 'allow' }) })
test('TodoWrite → allow', () => { expect(evaluateRules('TodoWrite', { content: 'x' }, WORKTREE)).toEqual({ decision: 'allow' }) })
test('NotebookRead → allow', () => { expect(evaluateRules('NotebookRead', { path: 'x.ipynb' }, WORKTREE)).toEqual({ decision: 'allow' }) })

// Write inside worktree
test('Write inside worktree → allow', () => { expect(evaluateRules('Write', { file_path: `${WORKTREE}/src/foo.ts`, content: 'x' }, WORKTREE)).toEqual({ decision: 'allow' }) })
test('Edit inside worktree → allow', () => { expect(evaluateRules('Edit', { file_path: `${WORKTREE}/src/foo.ts`, old_string: 'a', new_string: 'b' }, WORKTREE)).toEqual({ decision: 'allow' }) })

// Write outside worktree → deny
test('Write to /etc/hosts → deny', () => { expect(evaluateRules('Write', { file_path: '/etc/hosts', content: 'x' }, WORKTREE).decision).toBe('deny') })
test('Write to home dir → deny', () => { expect(evaluateRules('Write', { file_path: `${process.env.HOME}/.bashrc`, content: 'x' }, WORKTREE).decision).toBe('deny') })
test('Edit path traversal → deny', () => { expect(evaluateRules('Edit', { file_path: `${WORKTREE}/../../../etc/passwd`, old_string: 'a', new_string: 'b' }, WORKTREE).decision).toBe('deny') })

// Write to sensitive inside worktree → deny
test('Write to .env → deny', () => { expect(evaluateRules('Write', { file_path: `${WORKTREE}/.env`, content: 'x' }, WORKTREE).decision).toBe('deny') })
test('Write to .env.local → deny', () => { expect(evaluateRules('Write', { file_path: `${WORKTREE}/.env.local`, content: 'x' }, WORKTREE).decision).toBe('deny') })
test('Edit .git/config → deny', () => { expect(evaluateRules('Edit', { file_path: `${WORKTREE}/.git/config`, old_string: 'a', new_string: 'b' }, WORKTREE).decision).toBe('deny') })
test('Write to ~/.ssh/config → deny', () => { expect(evaluateRules('Write', { file_path: `${process.env.HOME}/.ssh/config`, content: 'x' }, WORKTREE).decision).toBe('deny') })
test('Write to ~/.claude/settings → deny', () => { expect(evaluateRules('Write', { file_path: `${process.env.HOME}/.claude/settings.json`, content: 'x' }, WORKTREE).decision).toBe('deny') })

// Sensitive project files → grey
test('Write to package.json → grey', () => { expect(evaluateRules('Write', { file_path: `${WORKTREE}/package.json`, content: '{}' }, WORKTREE)).toEqual({ decision: 'grey' }) })
test('Edit bunfig.toml → grey', () => { expect(evaluateRules('Edit', { file_path: `${WORKTREE}/bunfig.toml`, old_string: 'a', new_string: 'b' }, WORKTREE)).toEqual({ decision: 'grey' }) })
test('Write to .github/workflows/ci.yml → grey', () => { expect(evaluateRules('Write', { file_path: `${WORKTREE}/.github/workflows/ci.yml`, content: 'x' }, WORKTREE)).toEqual({ decision: 'grey' }) })
test('Write to .gitignore → grey', () => { expect(evaluateRules('Write', { file_path: `${WORKTREE}/.gitignore`, content: 'x' }, WORKTREE)).toEqual({ decision: 'grey' }) })
test('Write to bun.lockb → grey', () => { expect(evaluateRules('Write', { file_path: `${WORKTREE}/bun.lockb`, content: 'x' }, WORKTREE)).toEqual({ decision: 'grey' }) })

// Bash delegates to bash-parser
test('Bash bun test → allow', () => { expect(evaluateRules('Bash', { command: 'bun test' }, WORKTREE)).toEqual({ decision: 'allow' }) })
test('Bash rm -rf / → deny', () => { expect(evaluateRules('Bash', { command: 'rm -rf /' }, WORKTREE).decision).toBe('deny') })
test('Bash bun add foo → grey', () => { expect(evaluateRules('Bash', { command: 'bun add foo' }, WORKTREE)).toEqual({ decision: 'grey' }) })

// WebFetch SSRF guard
test('WebFetch localhost → deny', () => { expect(evaluateRules('WebFetch', { url: 'http://localhost:3000/api' }, WORKTREE).decision).toBe('deny') })
test('WebFetch 127.0.0.1 → deny', () => { expect(evaluateRules('WebFetch', { url: 'http://127.0.0.1:8080/' }, WORKTREE).decision).toBe('deny') })
test('WebFetch 169.254.169.254 → deny', () => { expect(evaluateRules('WebFetch', { url: 'http://169.254.169.254/latest/meta-data' }, WORKTREE).decision).toBe('deny') })
test('WebFetch 10.0.0.1 → deny', () => { expect(evaluateRules('WebFetch', { url: 'http://10.0.0.1/internal' }, WORKTREE).decision).toBe('deny') })
test('WebFetch 172.16.0.1 → deny', () => { expect(evaluateRules('WebFetch', { url: 'http://172.16.0.1/' }, WORKTREE).decision).toBe('deny') })
test('WebFetch 192.168.1.1 → deny', () => { expect(evaluateRules('WebFetch', { url: 'http://192.168.1.1/' }, WORKTREE).decision).toBe('deny') })
test('WebFetch external → grey', () => { expect(evaluateRules('WebFetch', { url: 'https://example.com/api' }, WORKTREE)).toEqual({ decision: 'grey' }) })

// Unknown tools
test('unknown tool → grey', () => { expect(evaluateRules('SomeNewTool', { foo: 'bar' }, WORKTREE)).toEqual({ decision: 'grey' }) })
