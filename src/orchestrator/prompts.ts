import type { Task, Run } from '../shared/types'

interface ExecutorInput {
  task: Task
  defaultBranch: string
  previousRuns: Run[]
}

export function buildExecutorPrompt({
  task,
  defaultBranch,
  previousRuns,
}: ExecutorInput): string {
  const branch = task.branchName ?? `kaban/task-${task.id}`
  const worktree = task.worktreePath ?? '<worktree not yet created>'

  const attempts = renderPreviousAttempts(previousRuns)

  return `You are a coding agent working inside a git worktree.

## Working directory
${worktree}

## Current branch
${branch} (already created and checked out from origin/${defaultBranch})

## Task
### Title
${task.title}

### Description
${task.description}
${attempts ? `\n## Previous attempts\n${attempts}\n` : ''}
## Your job
1. Read the task description carefully.
2. Implement the changes in this worktree.
3. Run the project's tests if they exist, and make sure they pass.
4. Commit your changes with a clear message.
5. Push your branch to origin: \`git push origin ${branch}\`.
6. In your final response, output a concise markdown summary of what you did:
   - Files changed
   - Key decisions
   - Anything the reviewer should pay attention to

## Rules
- Work only inside the working directory above.
- Do not touch files outside this worktree.
- Do not push to branches other than ${branch}.
- Do not force-push.
`
}

function renderPreviousAttempts(runs: Run[]): string {
  if (runs.length === 0) return ''
  const executorRuns = runs.filter((r) => r.kind === 'executor')
  const reviewerRuns = runs.filter((r) => r.kind === 'reviewer')

  const blocks: string[] = []
  executorRuns
    .slice()
    .sort((a, b) => b.startedAt - a.startedAt)
    .forEach((run, idx) => {
      const attemptNumber = executorRuns.length - idx
      blocks.push(
        `Attempt #${attemptNumber} summary:\n${run.summary ?? '(no summary)'}`,
      )
      const feedback = reviewerRuns.find((r) => r.startedAt > run.startedAt)
      if (feedback) {
        blocks.push(
          `Reviewer feedback on attempt #${attemptNumber}:\n` +
            `verdict: ${feedback.verdict ?? 'unknown'}\n` +
            `${feedback.summary ?? '(no summary)'}`,
        )
      }
    })
  return blocks.join('\n\n')
}

interface ReviewerInput {
  task: Task
  defaultBranch: string
  latestExecutorRun: Run
}

export function buildReviewerPrompt({
  task,
  defaultBranch,
  latestExecutorRun,
}: ReviewerInput): string {
  const branch = task.branchName ?? `kaban/task-${task.id}`
  const worktree = task.worktreePath ?? '<worktree not yet created>'

  return `You are a code reviewer agent.

## Working directory
${worktree}

## Current branch
${branch}

## Original task
### Title
${task.title}

### Description
${task.description}

## What the executor agent did
${latestExecutorRun.summary ?? '(no summary)'}

## Your job
Review the work done by the executor agent. You have shell access inside
the working directory and can inspect files, run \`git log\`, \`git diff\`,
run tests, etc.

Check specifically:
1. Did the executor actually make changes? Compare HEAD to
   origin/${defaultBranch}. If there are no meaningful changes, this is a
   rejection.
2. Do the changes fulfill what the task description asked for?
3. Is the code quality acceptable? (no obvious bugs, no dead code, follows
   existing project conventions)
4. Do tests pass, if there are tests?

Return a structured verdict:
- "approved" if the work looks good and should move to human review.
- "rejected" if the work is incomplete, wrong, or poor quality.

Provide a markdown summary explaining your decision.
`
}
