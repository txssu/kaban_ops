interface ApprovalToolInputProps {
  toolName: string
  toolInput: string
}

export function ApprovalToolInput({
  toolName,
  toolInput,
}: ApprovalToolInputProps) {
  let parsed: Record<string, unknown> | null = null
  try {
    const value = JSON.parse(toolInput)
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      parsed = value as Record<string, unknown>
    }
  } catch {
    // fall through to raw text
  }

  if (!parsed) {
    return <RawInput text={toolInput} />
  }

  switch (toolName) {
    case 'Bash':
      return (
        <Fields>
          {typeof parsed.description === 'string' && parsed.description && (
            <Field label="Description" value={parsed.description} />
          )}
          {typeof parsed.command === 'string' && (
            <Field label="Command" value={parsed.command} mono />
          )}
        </Fields>
      )
    case 'WebFetch':
      return (
        <Fields>
          {typeof parsed.url === 'string' && (
            <Field label="URL" value={parsed.url} mono link />
          )}
          {typeof parsed.prompt === 'string' && (
            <Field label="Prompt" value={parsed.prompt} />
          )}
        </Fields>
      )
    case 'WebSearch':
      return (
        <Fields>
          {typeof parsed.query === 'string' && (
            <Field label="Query" value={parsed.query} />
          )}
        </Fields>
      )
    case 'Read':
    case 'Glob':
      return (
        <Fields>
          {typeof parsed.file_path === 'string' && (
            <Field label="File" value={parsed.file_path} mono />
          )}
          {typeof parsed.pattern === 'string' && (
            <Field label="Pattern" value={parsed.pattern} mono />
          )}
          {typeof parsed.path === 'string' && (
            <Field label="Path" value={parsed.path} mono />
          )}
        </Fields>
      )
    case 'Grep':
      return (
        <Fields>
          {typeof parsed.pattern === 'string' && (
            <Field label="Pattern" value={parsed.pattern} mono />
          )}
          {typeof parsed.path === 'string' && (
            <Field label="Path" value={parsed.path} mono />
          )}
          {typeof parsed.glob === 'string' && (
            <Field label="Glob" value={parsed.glob} mono />
          )}
        </Fields>
      )
    case 'Write':
      return (
        <Fields>
          {typeof parsed.file_path === 'string' && (
            <Field label="File" value={parsed.file_path} mono />
          )}
          {typeof parsed.content === 'string' && (
            <Field label="Content" value={parsed.content} mono block />
          )}
        </Fields>
      )
    case 'Edit':
      return (
        <Fields>
          {typeof parsed.file_path === 'string' && (
            <Field label="File" value={parsed.file_path} mono />
          )}
          {typeof parsed.old_string === 'string' && (
            <Field label="Replace" value={parsed.old_string} mono block />
          )}
          {typeof parsed.new_string === 'string' && (
            <Field label="With" value={parsed.new_string} mono block />
          )}
        </Fields>
      )
    default:
      return <RawInput text={JSON.stringify(parsed, null, 2)} />
  }
}

function Fields({ children }: { children: React.ReactNode }) {
  return <div className="space-y-3">{children}</div>
}

interface FieldProps {
  label: string
  value: string
  mono?: boolean
  block?: boolean
  link?: boolean
}

function Field({ label, value, mono, block, link }: FieldProps) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </div>
      <div
        className={
          mono
            ? 'rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-mono break-words whitespace-pre-wrap dark:border-slate-800 dark:bg-slate-900/60' +
              (block ? ' max-h-48 overflow-auto' : '')
            : 'text-sm break-words whitespace-pre-wrap'
        }
      >
        {link ? (
          <a
            href={value}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sky-600 hover:underline dark:text-sky-400"
          >
            {value}
          </a>
        ) : (
          value
        )}
      </div>
    </div>
  )
}

function RawInput({ text }: { text: string }) {
  return (
    <pre className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-mono whitespace-pre-wrap break-words dark:border-slate-800 dark:bg-slate-900/60">
      {text}
    </pre>
  )
}
