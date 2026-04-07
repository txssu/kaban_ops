import { $ } from 'bun'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

export interface TempRepoPair {
  dir: string
  bareDir: string
  workDir: string
  cleanup: () => void
}

export async function createTempRepoPair(): Promise<TempRepoPair> {
  const dir = mkdtempSync(join(tmpdir(), 'kaban-git-'))
  const bareDir = join(dir, 'remote.git')
  const workDir = join(dir, 'work')

  await $`git init --bare ${bareDir}`.quiet()
  await $`git clone ${bareDir} ${workDir}`.quiet()
  await $`git -C ${workDir} config user.email test@example.com`.quiet()
  await $`git -C ${workDir} config user.name Test`.quiet()

  writeFileSync(join(workDir, 'README.md'), '# temp\n')
  await $`git -C ${workDir} add README.md`.quiet()
  await $`git -C ${workDir} commit -m initial`.quiet()
  await $`git -C ${workDir} branch -M main`.quiet()
  await $`git -C ${workDir} push -u origin main`.quiet()

  return {
    dir,
    bareDir,
    workDir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}
