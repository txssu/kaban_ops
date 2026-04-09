import { $ } from 'bun'
import { join, resolve, sep } from 'node:path'
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
    const reposRoot = resolve(this.reposDir)
    const localPath = resolve(join(this.reposDir, input.name))
    // Containment guard. Two distinct conditions:
    //   1. Reject anything that does NOT live strictly inside reposRoot
    //      (the `+ sep` suffix blocks sibling-prefix attacks where
    //      reposDir=/tmp/foo and name resolves to /tmp/foobar/evil —
    //      startsWith alone would let that through).
    //   2. Reject `reposRoot` itself as the clone target (happens when
    //      name is "." or "" — we never want to clone INTO the parent
    //      of all repos, that would shadow every other clone).
    if (localPath === reposRoot) {
      throw new Error(
        `resolved clone path must be inside ${reposRoot}, got the root itself`,
      )
    }
    if (!localPath.startsWith(reposRoot + sep)) {
      throw new Error(
        `resolved clone path must be inside ${reposRoot}, got ${localPath}`,
      )
    }
    // `--` terminates git option parsing so a hypothetical URL starting
    // with `-` (blocked at the route level by the regex, but belt and
    // braces) cannot be interpreted as `--upload-pack=...` or similar.
    await $`git clone -- ${input.url} ${localPath}`.quiet()
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
