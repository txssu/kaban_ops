import { test, expect } from 'bun:test'
import { paths } from './paths'

test('paths.dataDir is under project root', () => {
  expect(paths.dataDir.endsWith('/.data')).toBe(true)
  expect(paths.dataDir.startsWith(paths.projectRoot)).toBe(true)
})

test('paths.repoDir composes under reposDir', () => {
  expect(paths.repoDir('foo')).toBe(`${paths.reposDir}/foo`)
})

test('paths.worktreeDir uses task-<id>', () => {
  expect(paths.worktreeDir(42)).toBe(`${paths.worktreesDir}/task-42`)
})
