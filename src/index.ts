import index from './index.html'
import { createDb } from './db/client'
import { createApp } from './server/app'
import { SseBus } from './server/sse-bus'
import { BunGitClient } from './orchestrator/git-client'
import { Orchestrator } from './orchestrator/orchestrator'
import { ClaudeAgentRunner } from './orchestrator/claude-agent-runner'
import { ClaudeJudge } from './orchestrator/permissions/judge'
import { PermissionCoordinator } from './orchestrator/permissions/coordinator'
import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk'
import { loadConfig } from './shared/config'
import { paths } from './shared/paths'

const db = createDb()
const bus = new SseBus()
const git = new BunGitClient(paths.reposDir, paths.worktreesDir)
const config = loadConfig(paths.configFile)

const judge = new ClaudeJudge({
  queryFn: sdkQuery as any,
  model: config.judgeModel,
  timeoutMs: config.judgeTimeoutMs,
})

// Create orchestrator first (coordinator needs slot hooks)
const orchestrator = new Orchestrator({ db, runner: null as any, git, bus, config })

const coordinator = new PermissionCoordinator(db, judge, config, bus, orchestrator)
const runner = new ClaudeAgentRunner(coordinator)

// Patch runner into orchestrator deps
;(orchestrator as any).deps.runner = runner
;(orchestrator as any).deps.coordinator = coordinator

orchestrator.recoverFromCrash()
orchestrator.start()

const app = createApp({
  db,
  bus,
  git,
  coordinator,
  onStopTask: (taskId) => orchestrator.abortTask(taskId),
})

Bun.serve({
  port: 3000,
  routes: {
    '/': index,
  },
  fetch: (req) => app.fetch(req),
  development: {
    hmr: true,
    console: true,
  },
})

console.log('Kaban Ops listening on http://localhost:3000')
