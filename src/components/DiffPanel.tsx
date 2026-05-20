import { cn } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

export type DiffLineType = 'file-header' | 'hunk' | 'add' | 'del' | 'context'
export interface DiffLine { type: DiffLineType; content: string }
export type TabType = 'diff' | 'before' | 'after'
export interface ExpandedState { lines: DiffLine[] | null; loading: boolean; tab: TabType }

// ─── Parsing ──────────────────────────────────────────────────────────────────

export function parseDiff(raw: string): DiffLine[] {
  if (!raw.trim()) return []
  return raw.split('\n').map(line => {
    if (/^(diff |index |--- |\+\+\+ )/.test(line)) return { type: 'file-header' as const, content: line }
    if (line.startsWith('@@'))  return { type: 'hunk' as const,    content: line }
    if (line.startsWith('+'))   return { type: 'add' as const,     content: line.slice(1) }
    if (line.startsWith('-'))   return { type: 'del' as const,     content: line.slice(1) }
    return { type: 'context' as const, content: line.startsWith(' ') ? line.slice(1) : line }
  })
}

export function hasMeaningfulContent(lines: DiffLine[]): boolean {
  return lines.some(l => l.type === 'add' || l.type === 'del' || l.type === 'hunk')
}

export function reconstructBefore(lines: DiffLine[]) {
  return lines.filter(l => l.type === 'context' || l.type === 'del').map(l => l.content).join('\n')
}
export function reconstructAfter(lines: DiffLine[]) {
  return lines.filter(l => l.type === 'context' || l.type === 'add').map(l => l.content).join('\n')
}

// ─── Highlight ────────────────────────────────────────────────────────────────

export function highlightPath(path: string, query: string) {
  if (!query.trim()) return <>{path}</>
  const lower = path.toLowerCase()
  const q = query.toLowerCase()
  const parts: React.ReactNode[] = []
  let i = 0
  while (i < path.length) {
    const idx = lower.indexOf(q, i)
    if (idx === -1) { parts.push(path.slice(i)); break }
    if (idx > i) parts.push(path.slice(i, idx))
    parts.push(<mark key={idx} className="bg-amber/40 text-text rounded-xs px-0">{path.slice(idx, idx + q.length)}</mark>)
    i = idx + q.length
  }
  return <>{parts}</>
}

// ─── Renderers ────────────────────────────────────────────────────────────────

export function UnifiedDiff({ lines }: { lines: DiffLine[] }) {
  return (
    <table className="border-collapse w-full">
      <tbody>
        {lines.map((line, i) => {
          if (line.type === 'file-header') return null
          if (line.type === 'hunk') return (
            <tr key={i} className="bg-blue/7">
              <td colSpan={2} className="px-3 text-blue font-mono text-[0.72rem] whitespace-pre">
                {line.content}
              </td>
            </tr>
          )
          const isAdd = line.type === 'add'
          const isDel = line.type === 'del'
          return (
            <tr key={i} className={cn(isAdd ? 'bg-green/10' : isDel ? 'bg-[#EF5350]/10' : 'bg-transparent')}>
              <td className={cn(
                'w-4 px-1.5 select-none font-bold font-mono text-[0.72rem]',
                isAdd ? 'text-green' : isDel ? 'text-[#EF5350]' : 'text-[#3A3A60]',
              )}>
                {isAdd ? '+' : isDel ? '-' : ' '}
              </td>
              <td className={cn(
                'pr-2.5 whitespace-pre font-mono text-[0.72rem] overflow-hidden',
                isAdd ? 'text-[#88D58A]' : isDel ? 'text-[#EF8080]' : 'text-[#8080A0]',
              )}>
                {line.content}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

export function PlainCode({ text }: { text: string }) {
  const lines = text.split('\n')
  return (
    <table className="border-collapse w-full">
      <tbody>
        {lines.map((line, i) => (
          <tr key={i}>
            <td className="w-9 px-2 select-none text-right text-[#3A3A60] font-mono text-[0.65rem]">
              {i + 1}
            </td>
            <td className="pr-2.5 text-[#8080A0] whitespace-pre font-mono text-[0.72rem] overflow-hidden">
              {line}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ─── DiffPanel ────────────────────────────────────────────────────────────────

export function DiffPanel({ state, onTabChange }: { state: ExpandedState; onTabChange: (t: TabType) => void }) {
  const TABS: { key: TabType; label: string }[] = [
    { key: 'diff',   label: 'Diff' },
    { key: 'before', label: 'Before' },
    { key: 'after',  label: 'After' },
  ]
  const { lines, loading, tab } = state
  const hasContent = lines && hasMeaningfulContent(lines)
  return (
    <div className="bg-[#090914] border-t border-b border-surface2">
      <div className="flex border-b border-surface2 pl-2">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => onTabChange(t.key)}
            className={cn(
              'bg-transparent border-none border-b-2 text-[0.7rem] font-semibold px-[0.65rem] py-[0.35rem] cursor-pointer tracking-[0.04em] transition-colors',
              tab === t.key
                ? 'border-blue text-blue'
                : 'border-transparent text-[#4A4A70] hover:text-[#7070A0]',
            )}
          >
            {t.label}
          </button>
        ))}
        {(tab === 'before' || tab === 'after') && (
          <span className="self-center ml-auto mr-3 text-[0.63rem] text-[#3A3A60]">excerpt</span>
        )}
      </div>
      <div className="max-h-[520px] overflow-y-auto overflow-x-auto">
        {loading && (
          <div className="text-[#4A4A70] px-4 py-3 text-[0.75rem] font-mono">Loading…</div>
        )}
        {!loading && !hasContent && (
          <div className="text-[#4A4A70] px-4 py-3 text-[0.75rem]">No diff available.</div>
        )}
        {!loading && hasContent && (
          tab === 'diff'   ? <UnifiedDiff lines={lines!} /> :
          tab === 'before' ? <PlainCode text={reconstructBefore(lines!)} /> :
                             <PlainCode text={reconstructAfter(lines!)} />
        )}
      </div>
    </div>
  )
}
