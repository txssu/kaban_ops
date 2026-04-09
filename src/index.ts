import { existsSync } from 'node:fs'
import index from './index.html'
import { createDb } from './db/client'
import { createApp } from './server/app'
import { SseBus } from './server/sse-bus'
import { BunGitClient } from './orchestrator/git-client'
import { Orchestrator } from './orchestrator/orchestrator'
import { ClaudeAgentRunner } from './orchestrator/claude-agent-runner'
import { loadConfig } from './shared/config'
import { paths } from './shared/paths'

const db = createDb()
const bus = new SseBus()
const git = new BunGitClient(paths.reposDir, paths.worktreesDir)
const runner = new ClaudeAgentRunner()
const configFilePresent = existsSync(paths.configFile)
const config = loadConfig(paths.configFile)
if (!configFilePresent && config.bindHost === '127.0.0.1') {
  // First-run UX: make the (intentional) loopback-only default visible
  // so an operator running this on a remote box / inside a container
  // knows why the server is unreachable from outside.
  console.warn(
    `[kaban] no ${paths.configFile} found; bindHost defaulted to 127.0.0.1. ` +
      `Set { "bindHost": "0.0.0.0" } in config.json for external access.`,
  )
}
const orchestrator = new Orchestrator({ db, runner, git, bus, config })
orchestrator.recoverFromCrash()
orchestrator.start()

const app = createApp({
  db,
  bus,
  git,
  onStopTask: (taskId) => orchestrator.abortTask(taskId),
  config,
})

Bun.serve({
  hostname: config.bindHost,
  port: config.port,
  routes: {
    '/': index,
  },
  fetch: (req) => app.fetch(req),
  development: {
    hmr: true,
    console: true,
  },
})

console.log(
  `Kaban Ops listening on http://${config.bindHost}:${config.port}`,
)
