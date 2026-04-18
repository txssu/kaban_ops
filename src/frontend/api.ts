import type {
  Repository,
  Task,
  TaskColumn,
  TaskWithRun,
  Run,
  Approval,
  ApprovalDecision,
} from '../shared/types'

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
  return (await res.json()) as T
}

export const api = {
  async listTasks(): Promise<TaskWithRun[]> {
    return json(await fetch('/api/tasks'))
  },

  async createTask(input: {
    title: string
    description: string
    repositoryId: number
  }): Promise<Task> {
    return json(
      await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      }),
    )
  },

  async patchTask(
    id: number,
    patch: {
      title?: string
      description?: string
      repositoryId?: number
      column?: TaskColumn
      position?: number
    },
  ): Promise<Task> {
    return json(
      await fetch(`/api/tasks/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      }),
    )
  },

  async deleteTask(id: number): Promise<void> {
    const res = await fetch(`/api/tasks/${id}`, { method: 'DELETE' })
    if (!res.ok) throw new Error(await res.text())
  },

  async stopTask(id: number): Promise<void> {
    const res = await fetch(`/api/tasks/${id}/stop`, { method: 'POST' })
    if (!res.ok) throw new Error(await res.text())
  },

  async listRuns(taskId: number): Promise<Run[]> {
    return json(await fetch(`/api/tasks/${taskId}/runs`))
  },

  async listRepositories(): Promise<Repository[]> {
    return json(await fetch('/api/repositories'))
  },

  async getApproval(id: number): Promise<Approval> {
    return json(await fetch(`/api/approvals/${id}`))
  },

  async decideApproval(
    id: number,
    decision: ApprovalDecision,
  ): Promise<void> {
    const res = await fetch(`/api/approvals/${id}/decide`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision }),
    })
    if (!res.ok) throw new Error(await res.text())
  },

  async createRepository(input: {
    name?: string
    url: string
  }): Promise<Repository> {
    return json(
      await fetch('/api/repositories', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      }),
    )
  },
}
