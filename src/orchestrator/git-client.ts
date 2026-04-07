import { $ } from 'bun'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'

export interface RepositoryInfo {
  name: string
  localPath: string
  defaultBranch: string
}

export interface GitClient {
  cloneRepository(input: {
    name: string
    url: string
  }): Promise<RepositoryInfo>

  fetchRepository(localPath: string): Promise<void>

  createWorktree(input: {
    localPath: string
    defaultBranch: string
    taskId: number
  }): Promise<string>

  removeWorktree(input: {
    localPath: string
    taskId: number
  }): Promise<void>
}

export class BunGitClient implements GitClient {
  constructor(
    private readonly reposDir: string,
    private readonly worktreesDir: string,
  ) {}

  async cloneRepository(input: {
    name: string
    url: string
  }): Promise<RepositoryInfo> {
    mkdirSync(this.reposDir, { recursive: true })
    const localPath = join(this.reposDir, input.name)
    await $`git clone ${input.url} ${localPath}`.quiet()
    const defaultBranch = await this.detectDefaultBranch(localPath)
    return { name: input.name, localPath, defaultBranch }
  }

  async fetchRepository(localPath: string): Promise<void> {
    await $`git -C ${localPath} fetch origin`.quiet()
  }

  async createWorktree(input: {
    localPath: string
    defaultBranch: string
    taskId: number
  }): Promise<string> {
    mkdirSync(this.worktreesDir, { recursive: true })
    const path = join(this.worktreesDir, `task-${input.taskId}`)
    const branch = `kaban/task-${input.taskId}`
    await $`git -C ${input.localPath} worktree add ${path} -b ${branch} origin/${input.defaultBranch}`.quiet()
    return path
  }

  async removeWorktree(input: {
    localPath: string
    taskId: number
  }): Promise<void> {
    const path = join(this.worktreesDir, `task-${input.taskId}`)
    const branch = `kaban/task-${input.taskId}`
    await $`git -C ${input.localPath} worktree remove ${path} --force`
      .quiet()
      .nothrow()
    await $`git -C ${input.localPath} branch -D ${branch}`
      .quiet()
      .nothrow()
  }

  private async detectDefaultBranch(localPath: string): Promise<string> {
    const result =
      await $`git -C ${localPath} symbolic-ref refs/remotes/origin/HEAD`
        .quiet()
        .text()
    const ref = result.trim()
    const prefix = 'refs/remotes/origin/'
    return ref.startsWith(prefix) ? ref.slice(prefix.length) : 'main'
  }
}
