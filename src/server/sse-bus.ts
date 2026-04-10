export type SseEvent =
  | { type: 'task.created'; payload: { taskId: number } }
  | { type: 'task.updated'; payload: { taskId: number } }
  | { type: 'task.deleted'; payload: { taskId: number } }
  | { type: 'repository.created'; payload: { repositoryId: number } }
  | { type: 'repository.deleted'; payload: { repositoryId: number } }
  | { type: 'approval.pending'; payload: { approvalId: number; taskId: number } }
  | { type: 'approval.resolved'; payload: { approvalId: number; taskId: number } }

export type SseSubscriber = (event: SseEvent) => void

export class SseBus {
  private subscribers = new Set<SseSubscriber>()

  subscribe(fn: SseSubscriber): () => void {
    this.subscribers.add(fn)
    return () => this.subscribers.delete(fn)
  }

  publish(event: SseEvent): void {
    for (const fn of this.subscribers) {
      try {
        fn(event)
      } catch {
        // swallow subscriber errors — one bad subscriber must not block the rest
      }
    }
  }
}
