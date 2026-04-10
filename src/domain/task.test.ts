import { test, expect } from 'bun:test'
import {
  canManuallyMove,
  canEditTask,
  canDeleteTask,
  isActiveColumn,
  isManualColumn,
  clearFailureOnReopen,
} from './task'
import type { Task } from '../shared/types'

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    title: 'T',
    description: '',
    repositoryId: 1,
    column: 'backlog',
    position: 0,
    attemptsCount: 0,
    branchName: null,
    worktreePath: null,
    awaitingReturnColumn: null,
    lastFailureReason: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

test('canManuallyMove allows any transition within manual columns', () => {
  expect(canManuallyMove('backlog', 'todo')).toBe(true)
  expect(canManuallyMove('todo', 'ai_review')).toBe(true)
  expect(canManuallyMove('done', 'backlog')).toBe(true)
})

test('canManuallyMove rejects transitions into active columns', () => {
  expect(canManuallyMove('todo', 'progress')).toBe(false)
  expect(canManuallyMove('ai_review', 'ai_review_in_progress')).toBe(false)
})

test('canManuallyMove rejects transitions out of active columns', () => {
  expect(canManuallyMove('progress', 'todo')).toBe(false)
  expect(canManuallyMove('ai_review_in_progress', 'ai_review')).toBe(false)
})

test('canManuallyMove rejects self-moves (same column)', () => {
  expect(canManuallyMove('todo', 'todo')).toBe(false)
  expect(canManuallyMove('backlog', 'backlog')).toBe(false)
})

test('isManualColumn identifies the five manual columns', () => {
  expect(isManualColumn('backlog')).toBe(true)
  expect(isManualColumn('todo')).toBe(true)
  expect(isManualColumn('ai_review')).toBe(true)
  expect(isManualColumn('human_review')).toBe(true)
  expect(isManualColumn('done')).toBe(true)
  expect(isManualColumn('progress')).toBe(false)
  expect(isManualColumn('ai_review_in_progress')).toBe(false)
})

test('canEditTask returns false for tasks in active columns', () => {
  expect(canEditTask(makeTask({ column: 'progress' }))).toBe(false)
  expect(canEditTask(makeTask({ column: 'ai_review_in_progress' }))).toBe(false)
  expect(canEditTask(makeTask({ column: 'backlog' }))).toBe(true)
  expect(canEditTask(makeTask({ column: 'done' }))).toBe(true)
})

test('canDeleteTask mirrors canEditTask', () => {
  expect(canDeleteTask(makeTask({ column: 'progress' }))).toBe(false)
  expect(canDeleteTask(makeTask({ column: 'human_review' }))).toBe(true)
})

test('isActiveColumn identifies PROGRESS and AI_REVIEW_IN_PROGRESS', () => {
  expect(isActiveColumn('progress')).toBe(true)
  expect(isActiveColumn('ai_review_in_progress')).toBe(true)
  expect(isActiveColumn('ai_review')).toBe(false)
})

test('clearFailureOnReopen resets attempts and failure reason when moving from human_review to todo', () => {
  const task = makeTask({
    column: 'human_review',
    attemptsCount: 3,
    lastFailureReason: 'max_retries',
  })
  const patch = clearFailureOnReopen(task, 'todo')
  expect(patch).toEqual({ attemptsCount: 0, lastFailureReason: null })
})

test('clearFailureOnReopen also clears on human_review to backlog', () => {
  const task = makeTask({
    column: 'human_review',
    attemptsCount: 2,
    lastFailureReason: 'timeout',
  })
  expect(clearFailureOnReopen(task, 'backlog')).toEqual({
    attemptsCount: 0,
    lastFailureReason: null,
  })
})

test('clearFailureOnReopen returns empty patch for non-reopening moves', () => {
  const task = makeTask({ column: 'human_review', attemptsCount: 2 })
  expect(clearFailureOnReopen(task, 'done')).toEqual({})
})

test('awaiting_approval is not active', () => {
  expect(isActiveColumn('awaiting_approval')).toBe(false)
})

test('awaiting_approval is not manual', () => {
  expect(isManualColumn('awaiting_approval')).toBe(false)
})

test('canEditTask returns false for awaiting_approval', () => {
  expect(canEditTask(makeTask({ column: 'awaiting_approval' }))).toBe(false)
})

test('canDeleteTask returns false for awaiting_approval', () => {
  expect(canDeleteTask(makeTask({ column: 'awaiting_approval' }))).toBe(false)
})
