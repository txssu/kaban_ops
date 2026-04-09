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
const { config, fromFile: configFromFile } = loadConfig(paths.configFile)
if (!configFromFile && config.bindHost === '127.0.0.1') {
  // First-run UX: make the (intentional) loopback-only default visible
  // so an operator running this on a remote box / inside a container
  // knows why the server is unreachable from outside.
  //
  // Crucially, the warning must repeat the threat-model hazard — this
  // process runs an agent with bypassed permissions and has no HTTP
  // auth, so flipping bindHost off 127.0.0.1 exposes an unauthenticated
  // RCE to that interface. An operator debugging connectivity at 11pm
  // should not be able to read the "how" without also reading the "why not".
  console.warn(
    `[kaban] no ${paths.configFile} found; bindHost defaulted to 127.0.0.1 (loopback only).\n` +
      `[kaban] DO NOT change bindHost to 0.0.0.0 or a public interface:\n` +
      `[kaban]   this server has NO authentication and runs an AI agent with\n` +
      `[kaban]   bypassed permissions. Changing bindHost exposes an\n` +
      `[kaban]   unauthenticated remote code execution to that interface.\n` +
      `[kaban] For remote access, use an SSH tunnel or a reverse proxy that\n` +
      `[kaban] performs its own authentication. See CLAUDE.md ("Threat model").`,
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
