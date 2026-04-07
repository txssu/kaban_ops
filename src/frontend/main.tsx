import React from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import { KanbanBoard } from './components/kanban-board'
import { Header } from './components/header'
import { useTaskEvents } from './hooks/use-task-events'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 5_000,
    },
  },
})

function App() {
  useTaskEvents()
  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-slate-50">
      <Header />
      <KanbanBoard />
    </div>
  )
}

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </React.StrictMode>,
  )
}
