import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { StepDetail } from '../types'
import { cn } from '@/lib/utils'

// ─── Diff parsing ─────────────────────────────────────────────────────────────

type DiffLineType = 'file-header' | 'hunk' | 'add' | 'del' | 'context'
interface DiffLine { type: DiffLineType; content: string }

function parseDiff(raw: string): DiffLine[] {
  if (!raw.trim()) return []
  return raw.split('\n').map(line => {
    if (/^(diff |index |--- |\+\+\+ )/.test(line)) return { type: 'file-header', content: line }
    if (line.startsWith('@@'))  return { type: 'hunk',    content: line }
    if (line.startsWith('+'))   return { type: 'add',     content: line.slice(1) }
    if (line.startsWith('-'))   return { type: 'del',     content: line.slice(1) }
    return { type: 'context', content: line.startsWith(' ') ? line.slice(1) : line }
  })
}

function hasMeaningfulContent(lines: DiffLine[]): boolean {
  return lines.some(l => l.type === 'add' || l.type === 'del' || l.type === 'hunk')
}

function reconstructBefore(lines: DiffLine[]) {
  return lines.filter(l => l.type === 'context' || l.type === 'del').map(l => l.content).join('\n')
}
function reconstructAfter(lines: DiffLine[]) {
  return lines.filter(l => l.type === 'context' || l.type === 'add').map(l => l.content).join('\n')
}

// ─── Search highlight ─────────────────────────────────────────────────────────

function highlightPath(path: string, query: string) {
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

// ─── Diff panel ───────────────────────────────────────────────────────────────

type TabType = 'diff' | 'before' | 'after'
interface ExpandedState { lines: DiffLine[] | null; loading: boolean; tab: TabType }

function UnifiedDiff({ lines }: { lines: DiffLine[] }) {
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

function PlainCode({ text }: { text: string }) {
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

function DiffPanel({ state, onTabChange }: { state: ExpandedState; onTabChange: (t: TabType) => void }) {
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
          <span className="self-center ml-auto mr-3 text-[0.63rem] text-[#3A3A60]">
            excerpt
          </span>
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

// ─── Main modal ───────────────────────────────────────────────────────────────

interface Props {
  title: string
  files: StepDetail[]
  destPath: string
  onClose: () => void
}

export function FileModal({ title, files, destPath, onClose }: Props) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const [expanded, setExpanded] = useState<Record<string, ExpandedState>>({})

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  useEffect(() => { inputRef.current?.focus() }, [])

  const filtered = query.trim()
    ? files.filter(f => f.path.toLowerCase().includes(query.toLowerCase()))
    : files

  async function toggleFile(key: string, file: StepDetail) {
    if (expanded[key]) {
      setExpanded(prev => { const n = { ...prev }; delete n[key]; return n })
      return
    }
    if (!file.h0 || !file.h1) {
      setExpanded(prev => ({ ...prev, [key]: { lines: [], loading: false, tab: 'diff' } }))
      return
    }
    setExpanded(prev => ({ ...prev, [key]: { lines: null, loading: true, tab: 'diff' } }))
    try {
      const params = new URLSearchParams({ dest: destPath, path: file.path, h0: file.h0, h1: file.h1 })
      const res = await fetch(`/api/diff?${params}`)
      const json = await res.json()
      setExpanded(prev => ({ ...prev, [key]: { ...prev[key], lines: parseDiff(json.diff || ''), loading: false } }))
    } catch {
      setExpanded(prev => ({ ...prev, [key]: { lines: [], loading: false, tab: 'diff' } }))
    }
  }

  function setTab(key: string, tab: TabType) {
    setExpanded(prev => ({ ...prev, [key]: { ...prev[key], tab } }))
  }

  return createPortal(
    <div
      onClick={onClose}
      className="fixed inset-0 z-[1000] bg-black/65 backdrop-blur-[2px] flex items-center justify-center p-[2vh_2vw]"
    >
      <div
        onClick={e => e.stopPropagation()}
        className="bg-surface border border-[#2A2A45] rounded-[12px] w-[80vw] h-[90vh] flex flex-col shadow-[0_24px_64px_rgba(0,0,0,0.6)]"
      >
        {/* Header */}
        <div className="bg-surface2 border-b border-[#2A2A45] rounded-t-[12px] px-4 py-3 flex items-center gap-3 shrink-0">
          <span className="text-[0.72rem] font-bold tracking-[0.07em] uppercase text-[#7070A0]">Files changed</span>
          <span className="text-[0.82rem] text-text font-semibold">{title}</span>
          <span className="bg-blue/12 text-blue border border-blue/25 rounded px-2 py-px text-[0.68rem] font-semibold shrink-0">
            {filtered.length}{query ? ` / ${files.length}` : ''} file{files.length !== 1 ? 's' : ''}
          </span>
          <button
            onClick={onClose}
            className="ml-auto bg-transparent border border-[#2A2A45] rounded-[6px] text-[#7070A0] cursor-pointer px-2 py-0.5 text-[0.85rem] leading-none shrink-0 hover:text-text hover:border-[#3A3A65] transition-colors"
            title="Close (Esc)"
          >
            ✕
          </button>
        </div>

        {/* Filter */}
        <div className="px-4 py-[0.6rem] border-b border-[#2A2A45] shrink-0">
          <input
            ref={inputRef}
            type="text"
            placeholder="Filter by filename…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="w-full bg-[#0F0F1A] border border-[#2A2A45] rounded-[6px] text-text px-[0.65rem] py-[0.4rem] text-[0.82rem] outline-none font-mono box-border focus:border-blue transition-colors"
          />
        </div>

        {/* File list */}
        <div className="overflow-y-auto flex flex-col">
          {filtered.length === 0 && (
            <div className="text-center text-[#4A4A70] text-[0.8rem] py-6">
              No files match "{query}"
            </div>
          )}
          {filtered.map((f) => {
            const key = `${f.path}::${f.h0 ?? ''}::${f.h1 ?? ''}`
            const isOpen = !!expanded[key]
            const hasDiff = !!f.h0 && !!f.h1
            const firstLine = f.lines?.[0] ?? 1
            const absPath = `${destPath}/${f.path}`.replace(/\/+/g, '/')
            const vscodeUrl = `vscode://file/${absPath}:${firstLine}`
            const lineCount = f.lines?.length ?? 0

            const badge =
              f.action === 'created'
                ? <span className="shrink-0 text-[0.62rem] font-bold px-1.25 rounded-[3px] bg-green/15 text-green border border-green/30 leading-[1.6]">new</span>
                : f.action === 'deleted'
                ? <span className="shrink-0 text-[0.62rem] font-bold px-1.25 rounded-[3px] bg-[#EF5350]/15 text-[#EF5350] border border-[#EF5350]/30 leading-[1.6]">del</span>
                : <span className="shrink-0 w-6" />

            return (
              <div key={key} className="shrink-0">
                <div
                  onClick={() => toggleFile(key, f)}
                  className={cn(
                    'flex items-center gap-2 px-2 py-[0.28rem] border-l-2 transition-colors',
                    isOpen
                      ? 'bg-blue/5 border-blue/35'
                      : cn(
                          'border-transparent',
                          hasDiff ? 'cursor-pointer hover:bg-white/4' : 'cursor-default',
                        ),
                  )}
                >
                  <span className="shrink-0 text-[0.58rem] text-[#3A3A60] w-2.5 text-center">
                    {hasDiff ? (isOpen ? '▼' : '▶') : ''}
                  </span>
                  {badge}
                  <span className="flex-1 min-w-0">
                    <code className="font-mono text-[0.78rem] bg-[#0A0A18] px-1.5 py-0.5 rounded-[3px] block overflow-hidden text-ellipsis whitespace-nowrap text-[#B0B0D0]">
                      {highlightPath(f.path, query)}
                    </code>
                  </span>
                  {lineCount > 0 && (
                    <span className="shrink-0 text-[#4A4A70] text-[0.68rem] font-mono">
                      +{lineCount}
                    </span>
                  )}
                  <a
                    href={vscodeUrl}
                    onClick={e => e.stopPropagation()}
                    title="Open in VS Code"
                    className="shrink-0 text-[#3A3A60] no-underline leading-none p-0.5 hover:text-blue transition-colors"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" className="block">
                      <path d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm-7 3l5 5-5 5V6zm-4 0v12l-2-2V8l2-2z" />
                    </svg>
                  </a>
                </div>

                {isOpen && (
                  <DiffPanel state={expanded[key]} onTabChange={tab => setTab(key, tab)} />
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>,
    document.body,
  )
}
