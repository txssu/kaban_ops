import { test, expect } from 'bun:test'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createTempRepoPair } from '../../tests/helpers/temp-repo'
import { BunGitClient } from './git-client'

test('cloneRepository clones a remote into the target directory and detects default branch', async () => {
  const pair = await createTempRepoPair()
  try {
    const reposDir = mkdtempSync(join(tmpdir(), 'kaban-repos-'))
    const client = new BunGitClient(reposDir, reposDir)
    const info = await client.cloneRepository({
      name: 'work',
      url: pair.bareDir,
    })

    expect(existsSync(info.localPath)).toBe(true)
    expect(existsSync(join(info.localPath, '.git'))).toBe(true)
    expect(info.defaultBranch).toBe('main')

    rmSync(reposDir, { recursive: true, force: true })
  } finally {
    pair.cleanup()
  }
})

test('fetchRepository updates origin refs without throwing', async () => {
  const pair = await createTempRepoPair()
  try {
    const reposDir = mkdtempSync(join(tmpdir(), 'kaban-repos-'))
    const worktreesDir = mkdtempSync(join(tmpdir(), 'kaban-wt-'))
    const client = new BunGitClient(reposDir, worktreesDir)
    const info = await client.cloneRepository({
      name: 'work',
      url: pair.bareDir,
    })
    await client.fetchRepository(info.localPath)

    rmSync(reposDir, { recursive: true, force: true })
    rmSync(worktreesDir, { recursive: true, force: true })
  } finally {
    pair.cleanup()
  }
})

test('createWorktree branches from origin/<default_branch> and places worktree in the worktrees dir', async () => {
  const pair = await createTempRepoPair()
  try {
    const reposDir = mkdtempSync(join(tmpdir(), 'kaban-repos-'))
    const worktreesDir = mkdtempSync(join(tmpdir(), 'kaban-wt-'))
    const client = new BunGitClient(reposDir, worktreesDir)
    const info = await client.cloneRepository({
      name: 'work',
      url: pair.bareDir,
    })

    const worktreePath = await client.createWorktree({
      localPath: info.localPath,
      defaultBranch: info.defaultBranch,
      taskId: 7,
    })

    expect(worktreePath).toBe(join(worktreesDir, 'task-7'))
    expect(existsSync(worktreePath)).toBe(true)
    expect(existsSync(join(worktreePath, 'README.md'))).toBe(true)

    rmSync(reposDir, { recursive: true, force: true })
    rmSync(worktreesDir, { recursive: true, force: true })
  } finally {
    pair.cleanup()
  }
})

test('removeWorktree deletes the worktree directory and branch', async () => {
  const pair = await createTempRepoPair()
  try {
    const reposDir = mkdtempSync(join(tmpdir(), 'kaban-repos-'))
    const worktreesDir = mkdtempSync(join(tmpdir(), 'kaban-wt-'))
    const client = new BunGitClient(reposDir, worktreesDir)
    const info = await client.cloneRepository({
      name: 'work',
      url: pair.bareDir,
    })
    const worktreePath = await client.createWorktree({
      localPath: info.localPath,
      defaultBranch: info.defaultBranch,
      taskId: 11,
    })
    await client.removeWorktree({
      localPath: info.localPath,
      taskId: 11,
    })

    expect(existsSync(worktreePath)).toBe(false)

    rmSync(reposDir, { recursive: true, force: true })
    rmSync(worktreesDir, { recursive: true, force: true })
  } finally {
    pair.cleanup()
  }
})

test('cloneRepository rejects a name that escapes reposDir', async () => {
  const reposDir = mkdtempSync(join(tmpdir(), 'kaban-repos-'))
  const worktreesDir = mkdtempSync(join(tmpdir(), 'kaban-wt-'))
  try {
    const client = new BunGitClient(reposDir, worktreesDir)
    await expect(
      client.cloneRepository({
        name: '../escape',
        url: 'https://example.com/repo.git',
      }),
    ).rejects.toThrow(/inside/)
  } finally {
    rmSync(reposDir, { recursive: true, force: true })
    rmSync(worktreesDir, { recursive: true, force: true })
  }
})
