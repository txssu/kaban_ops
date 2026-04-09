# Kaban Ops — project notes

Local AI orchestrator with a kanban UI. One Bun process runs everything:
Hono HTTP API, the React frontend (via Bun HTML imports), the orchestrator
tick loop, and SQLite.

## Threat model

**Single operator, localhost only.** The HTTP API has no authentication
and executes arbitrary shell commands on behalf of the user through the
Claude Agent runner. The default `bindHost` is `127.0.0.1` and no endpoint
is authenticated — including `GET /api/config`. If you set `bindHost` to
anything else, you are deliberately exposing an unauthenticated RCE to
that interface. Don't. If you need remote access, put it behind an
SSH tunnel or a reverse proxy that does its own auth.

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
`query({ prompt, options: buildAgentQueryOptions(cwd, controller) })`
where `buildAgentQueryOptions` is a pure function in
`claude-agent-runner.ts` that returns `{ cwd, abortController,
permissionMode: 'bypassPermissions', allowDangerouslySkipPermissions:
true, systemPrompt: { type: 'preset', preset: 'claude_code' },
settingSources: ['user', 'project', 'local'] }`. Both permission flags
are set per the SDK v0.2.92 type declarations (`sdk.d.ts:1184-1196`),
which state that `allowDangerouslySkipPermissions: true` "must be set"
alongside `permissionMode: 'bypassPermissions'`. This is a reading of
the type declarations — end-to-end runtime verification has not been
done. Do not remove either flag without first confirming the SDK still
enters bypass mode. The reviewer asks for a fenced JSON block at the
end of its response; the parser lives in `parseReviewerResult` (also in
`claude-agent-runner.ts`) and tolerates single-line or multi-line
blocks. There is no native `generateObject` in the Agent SDK.

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
