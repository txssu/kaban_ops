import { test, expect } from 'bun:test'
import { buildExecutorPrompt, buildReviewerPrompt } from './prompts'
import type { Task, Run } from '../shared/types'

const baseTask: Task = {
  id: 42,
  title: 'Add settings page',
  description: 'We need a /settings route that shows current config.',
  repositoryId: 1,
  column: 'progress',
  position: 0,
  attemptsCount: 1,
  branchName: 'kaban/task-42',
  worktreePath: '/tmp/wt/task-42',
  lastFailureReason: null,
  createdAt: 1,
  updatedAt: 1,
}

test('executor prompt includes title, description, worktree, and branch', () => {
  const prompt = buildExecutorPrompt({
    task: baseTask,
    defaultBranch: 'main',
    previousRuns: [],
  })
  expect(prompt).toContain('Add settings page')
  expect(prompt).toContain('We need a /settings route')
  expect(prompt).toContain('/tmp/wt/task-42')
  expect(prompt).toContain('kaban/task-42')
  expect(prompt).toContain('origin/main')
})

test('executor prompt surfaces previous attempts and reviewer feedback', () => {
  const runs: Run[] = [
    {
      id: 10,
      taskId: 42,
      kind: 'executor',
      status: 'succeeded',
      verdict: null,
      summary: 'Created Settings component',
      error: null,
      startedAt: 1,
      endedAt: 2,
    },
    {
      id: 11,
      taskId: 42,
      kind: 'reviewer',
      status: 'succeeded',
      verdict: 'rejected',
      summary: 'Missing styling, no tests.',
      error: null,
      startedAt: 3,
      endedAt: 4,
    },
  ]
  const prompt = buildExecutorPrompt({
    task: baseTask,
    defaultBranch: 'main',
    previousRuns: runs,
  })
  expect(prompt).toContain('Created Settings component')
  expect(prompt).toContain('Missing styling')
  expect(prompt).toContain('rejected')
})

test('reviewer prompt includes task and executor summary', () => {
  const run: Run = {
    id: 10,
    taskId: 42,
    kind: 'executor',
    status: 'succeeded',
    verdict: null,
    summary: 'Created Settings component and pushed.',
    error: null,
    startedAt: 1,
    endedAt: 2,
  }
  const prompt = buildReviewerPrompt({
    task: baseTask,
    defaultBranch: 'main',
    latestExecutorRun: run,
  })
  expect(prompt).toContain('Add settings page')
  expect(prompt).toContain('Created Settings component and pushed.')
  expect(prompt).toContain('kaban/task-42')
  expect(prompt).toContain('origin/main')
  expect(prompt).toMatch(/approved.*rejected|verdict/i)
})
