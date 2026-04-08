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
const config = loadConfig(paths.configFile)
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
