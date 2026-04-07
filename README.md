# Kaban Ops

A local AI orchestrator that looks like a kanban board. You write coding
tasks into columns. An agent picks them up, makes the changes inside an
isolated git worktree, pushes to your remote, and a second agent reviews
the result before handing it to you.

It's a single-user app. One Bun process, one SQLite file in `.data/`, no
cloud, no Docker. It uses whatever Claude account you're already logged
into via the Claude Code CLI.

## How it works

```
BACKLOG → TODO → PROGRESS → AI REVIEW → AI REVIEW IN PROGRESS → HUMAN REVIEW → DONE
                  (executor)              (reviewer)              (you decide)
```

You drag a task into TODO. When there's a free slot, the orchestrator
fetches the repo, creates a worktree on a fresh `kaban/task-N` branch,
and spawns the executor agent inside it. The agent does its thing,
commits, and pushes the branch to your origin.

Then the reviewer takes over. It looks at the diff, runs `git log` or
`xxd` or whatever else it wants, and returns approved or rejected. If
it's rejected and you have retries left, the task goes back to TODO with
the reviewer's feedback so the next attempt isn't blind. If a run
crashes, times out, or you hit Stop, the task lands in HUMAN REVIEW with
a visible failure reason and you decide what to do.

## Quick start

```bash
# install Claude Code CLI and log in (one-time)
curl -fsSL https://claude.ai/install.sh | bash
claude auth login

# install and run
bun install
bun src/index.ts
```

Open http://localhost:3000. Add a repository by URL, create a task, drag
it into TODO.

## Stack

Bun, Hono, React 19, Tailwind v4, shadcn/ui, TanStack Query, dnd-kit,
SQLite via `bun:sqlite`, Drizzle ORM, and `@anthropic-ai/claude-agent-sdk`
for the actual Claude calls.

## Configuration

Edit `.data/config.json` and restart:

```json
{
  "progressLimit": 2,
  "aiReviewLimit": 1,
  "maxAttempts": 3,
  "taskTimeoutMs": 1800000
}
```

`progressLimit` and `aiReviewLimit` are WIP caps. The orchestrator will
not start more agents than that, no matter how many tasks pile up in
TODO or AI REVIEW.

## Status

It's an MVP. Single user, local only, no auth, no PR creation, no live
streaming of agent output in the UI. The full loop has been smoke-tested
end-to-end against a real GitHub repo.

Inspired by [OpenAI Symphony](https://github.com/openai/symphony).

## License

AGPL-3.0-or-later. See [LICENSE](LICENSE).
