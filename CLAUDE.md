# Kaban Ops — project notes

Local AI orchestrator with a kanban UI. One Bun process runs everything:
Hono HTTP API, the React frontend (via Bun HTML imports), the orchestrator
tick loop, and SQLite.

## Run

- `bun src/index.ts` — start server on http://localhost:3000
- `bun test` — full suite (50 tests, ~600ms)
- `bunx tsc --noEmit` — typecheck
- `bun scripts/seed-dev.ts` — seed `.data/kaban.db` with a fake repo and
  tasks for browser testing (`scripts/` is in `.git/info/exclude`)

## State on disk

Everything mutable lives in `.data/` (gitignored):

- `.data/kaban.db` — SQLite, Drizzle schema in `src/db/schema.ts`
- `.data/repos/<name>/` — git clones added through the UI
- `.data/worktrees/task-<id>/` — per-task worktrees on `kaban/task-<id>` branches
- `.data/config.json` — `{ progressLimit, aiReviewLimit, maxAttempts, taskTimeoutMs }`

## Stack

Bun, Hono, React 19, Tailwind v4, shadcn/ui, TanStack Query, dnd-kit,
SQLite via `bun:sqlite`, Drizzle ORM, `Bun.$` for git, and
`@anthropic-ai/claude-agent-sdk` (`query()` directly, no Vercel AI SDK).

## Folder structure

```
src/
  index.ts             # entry: boots Bun.serve + orchestrator
  index.html           # loaded by Bun HTML imports
  shared/              # paths, config, types (cross-cutting, no deps)
  db/                  # schema, client, in-memory test helper
  domain/              # pure transition rules
  orchestrator/        # tick loop, runners, git client, prompts
  server/              # Hono app, routes, SSE bus
  frontend/
    main.tsx           # React root
    index.css          # imported from main.tsx (NOT via <link>)
    api.ts             # typed fetch wrappers
    hooks/             # TanStack Query hooks + SSE subscription
    components/        # board, column, card, dialogs
    components/ui/     # shadcn (generated)
    lib/utils.ts       # cn() helper
tests/helpers/         # makeDb, createTempRepoPair
```

## Conventions and gotchas

**TypeScript strict + `verbatimModuleSyntax: true`.** Split runtime and
type-only imports: `import { foo }` for values, `import type { Bar }` for
types. `paths` mapping uses `@/*` → `src/frontend/*` (no `baseUrl` —
deprecated in TS 7). shadcn-generated files use the `@/*` alias; the rest
of the source uses relative imports.

**Tailwind v4 needs `bun-plugin-tailwind`.** Registered in `bunfig.toml`
as `[serve.static] plugins = ["bun-plugin-tailwind"]`. CSS must be
imported from JavaScript (`import './index.css'` in `main.tsx`), NOT via
`<link rel="stylesheet">` in `index.html` — Bun's HTML loader bypasses
the bundler plugin chain for `<link>` tags, so utility classes don't get
generated.

**shadcn `Card` does not forwardRef.** When using dnd-kit with a card,
wrap `<Card>` in a plain `<div ref={setNodeRef} {...listeners}>` and put
the transform/listeners on the div, not the Card.

**Drizzle `extraConfig` uses the array form.** `(t) => [index(...).on(...)]`,
not the deprecated object form `(t) => ({ name: index(...) })`.

**Atomic queue pull.** `Orchestrator.pullNext()` wraps SELECT + UPDATE in
`db.transaction(...)` and the UPDATE includes a `column = from` guard.

**Agent SDK call shape.** `ClaudeAgentRunner` calls
`query({ prompt, options: { cwd, abortController, permissionMode:
'bypassPermissions', allowDangerouslySkipPermissions: true,
systemPrompt: { type: 'preset', preset: 'claude_code' },
settingSources: ['user', 'project', 'local'] } })`. **Both permission
flags are required** per SDK v0.2.92 docs (`sdk.d.ts:1184-1196`):
`bypassPermissions` is the named mode AND `allowDangerouslySkipPermissions`
must be set as an explicit safety acknowledgement. Removing either silently
degrades to a less-permissive mode at runtime. The reviewer asks for
a fenced JSON block at the end of its response and parses it with Zod —
there is no native `generateObject` in the Agent SDK.

**Abort signal bridging.** The runner creates a fresh `AbortController`
and forwards `input.signal` into it via an event listener cleaned up in
`finally`.

## Test strategy

TDD. Real SQLite (`:memory:`) for DB tests, real git in temporary
bare+clone pairs for git client tests, `FakeAIRunner` only for the
orchestrator. No mocking of internal layers. No automated tests for
React components — the frontend is verified via Playwright smoke tests
during development.

## Things to avoid

- Don't add `ai` (Vercel AI SDK) or `ai-sdk-provider-claude-code` back.
  They were removed because of a version mismatch and the abstraction
  isn't needed.
- Don't put `<link rel="stylesheet">` in `index.html` (see Tailwind
  note).
- Don't `forwardRef` shadcn `Card` directly — wrap it in a div instead.
- Don't put per-developer ignores in `.gitignore` — they go in
  `.git/info/exclude`.
