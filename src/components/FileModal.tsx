import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { StepDetail } from '../types'

// ─── Diff parsing ─────────────────────────────────────────────────────────────

type DiffLineType = 'file-header' | 'hunk' | 'add' | 'del' | 'context'
interface DiffLine { type: DiffLineType; content: string }

function parseDiff(raw: string): DiffLine[] {
  return raw.split('\n').map(line => {
    if (/^(diff |index |--- |\+\+\+ )/.test(line)) return { type: 'file-header', content: line }
    if (line.startsWith('@@'))  return { type: 'hunk',    content: line }
    if (line.startsWith('+'))   return { type: 'add',     content: line.slice(1) }
    if (line.startsWith('-'))   return { type: 'del',     content: line.slice(1) }
    return { type: 'context', content: line.startsWith(' ') ? line.slice(1) : line }
  })
}

function reconstructBefore(lines: DiffLine[]) {
  return lines.filter(l => l.type === 'context' || l.type === 'del').map(l => l.content).join('\n')
}
function reconstructAfter(lines: DiffLine[]) {
  return lines.filter(l => l.type === 'context' || l.type === 'add').map(l => l.content).join('\n')
}

// ─── Diff panel ───────────────────────────────────────────────────────────────

type TabType = 'diff' | 'before' | 'after'
interface ExpandedState { lines: DiffLine[] | null; loading: boolean; tab: TabType }

function UnifiedDiff({ lines }: { lines: DiffLine[] }) {
  return (
    <table style={{ borderCollapse: 'collapse', width: '100%' }}>
      <tbody>
        {lines.map((line, i) => {
          if (line.type === 'file-header') return null
          if (line.type === 'hunk') return (
            <tr key={i} style={{ background: 'rgba(92,184,245,0.07)' }}>
              <td colSpan={2} style={{ padding: '0 0.75rem', color: '#5CB8F5', fontFamily: 'monospace', fontSize: '0.72rem', whiteSpace: 'pre' }}>
                {line.content}
              </td>
            </tr>
          )
          const isAdd = line.type === 'add'
          const isDel = line.type === 'del'
          return (
            <tr key={i} style={{ background: isAdd ? 'rgba(76,175,80,0.10)' : isDel ? 'rgba(239,83,80,0.10)' : 'transparent' }}>
              <td style={{ width: 16, padding: '0 6px 0 4px', userSelect: 'none', color: isAdd ? '#4CAF50' : isDel ? '#EF5350' : '#3A3A60', fontWeight: 700, fontFamily: 'monospace', fontSize: '0.72rem' }}>
                {isAdd ? '+' : isDel ? '-' : ' '}
              </td>
              <td style={{ padding: '0 10px 0 0', color: isAdd ? '#88D58A' : isDel ? '#EF8080' : '#8080A0', whiteSpace: 'pre', fontFamily: 'monospace', fontSize: '0.72rem', overflow: 'hidden' }}>
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
    <table style={{ borderCollapse: 'collapse', width: '100%' }}>
      <tbody>
        {lines.map((line, i) => (
          <tr key={i}>
            <td style={{ width: 36, padding: '0 8px 0 4px', userSelect: 'none', color: '#3A3A60', textAlign: 'right', fontFamily: 'monospace', fontSize: '0.65rem' }}>
              {i + 1}
            </td>
            <td style={{ padding: '0 10px 0 0', color: '#8080A0', whiteSpace: 'pre', fontFamily: 'monospace', fontSize: '0.72rem', overflow: 'hidden' }}>
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
  return (
    <div style={{ background: '#090914', borderTop: '1px solid #1E1E35', borderBottom: '1px solid #1E1E35' }}>
      <div style={{ display: 'flex', borderBottom: '1px solid #1E1E35', paddingLeft: '0.5rem' }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => onTabChange(t.key)} style={{
            background: 'none', border: 'none',
            borderBottom: tab === t.key ? '2px solid #5CB8F5' : '2px solid transparent',
            color: tab === t.key ? '#5CB8F5' : '#4A4A70',
            fontSize: '0.7rem', fontWeight: 600, padding: '0.35rem 0.65rem',
            cursor: 'pointer', letterSpacing: '0.04em',
          }}>
            {t.label}
          </button>
        ))}
        {(tab === 'before' || tab === 'after') && (
          <span style={{ alignSelf: 'center', marginLeft: 'auto', marginRight: '0.75rem', fontSize: '0.63rem', color: '#3A3A60' }}>
            excerpt
          </span>
        )}
      </div>
      <div style={{ maxHeight: 520, overflowY: 'auto', overflowX: 'auto' }}>
        {loading && <div style={{ color: '#4A4A70', padding: '0.75rem 1rem', fontSize: '0.75rem', fontFamily: 'monospace' }}>Loading…</div>}
        {!loading && (!lines || lines.length === 0) && (
          <div style={{ color: '#4A4A70', padding: '0.75rem 1rem', fontSize: '0.75rem' }}>No diff available.</div>
        )}
        {!loading && lines && lines.length > 0 && (
          tab === 'diff'   ? <UnifiedDiff lines={lines} /> :
          tab === 'before' ? <PlainCode text={reconstructBefore(lines)} /> :
                             <PlainCode text={reconstructAfter(lines)} />
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
  const [expanded, setExpanded] = useState<Record<number, ExpandedState>>({})

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  useEffect(() => { inputRef.current?.focus() }, [])

  const filtered = query.trim()
    ? files.filter(f => f.path.toLowerCase().includes(query.toLowerCase()))
    : files

  async function toggleFile(idx: number, file: StepDetail) {
    if (expanded[idx]) {
      setExpanded(prev => { const n = { ...prev }; delete n[idx]; return n })
      return
    }
    if (!file.h0 || !file.h1) {
      setExpanded(prev => ({ ...prev, [idx]: { lines: [], loading: false, tab: 'diff' } }))
      return
    }
    setExpanded(prev => ({ ...prev, [idx]: { lines: null, loading: true, tab: 'diff' } }))
    try {
      const params = new URLSearchParams({ dest: destPath, path: file.path, h0: file.h0, h1: file.h1 })
      const res = await fetch(`/api/diff?${params}`)
      const json = await res.json()
      setExpanded(prev => ({ ...prev, [idx]: { ...prev[idx], lines: parseDiff(json.diff || ''), loading: false } }))
    } catch {
      setExpanded(prev => ({ ...prev, [idx]: { lines: [], loading: false, tab: 'diff' } }))
    }
  }

  function setTab(idx: number, tab: TabType) {
    setExpanded(prev => ({ ...prev, [idx]: { ...prev[idx], tab } }))
  }

  return createPortal(
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2vh 2vw' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: '#16162A', border: '1px solid #2A2A45', borderRadius: 12, width: '80vw', height: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 64px rgba(0,0,0,0.6)' }}
      >
        {/* Header */}
        <div style={{ background: '#1E1E35', borderBottom: '1px solid #2A2A45', borderRadius: '12px 12px 0 0', padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0 }}>
          <span style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: '#7070A0' }}>Files changed</span>
          <span style={{ fontSize: '0.82rem', color: '#E8E8F0', fontWeight: 600 }}>{title}</span>
          <span style={{ background: 'rgba(92,184,245,0.12)', color: '#5CB8F5', border: '1px solid rgba(92,184,245,0.25)', borderRadius: 4, fontSize: '0.68rem', fontWeight: 600, padding: '1px 8px', flexShrink: 0 }}>
            {filtered.length}{query ? ` / ${files.length}` : ''} file{files.length !== 1 ? 's' : ''}
          </span>
          <button onClick={onClose} style={{ marginLeft: 'auto', background: 'none', border: '1px solid #2A2A45', borderRadius: 6, color: '#7070A0', cursor: 'pointer', padding: '2px 8px', fontSize: '0.85rem', lineHeight: 1, flexShrink: 0 }} title="Close (Esc)">✕</button>
        </div>

        {/* Filter */}
        <div style={{ padding: '0.6rem 1rem', borderBottom: '1px solid #2A2A45', flexShrink: 0 }}>
          <input
            ref={inputRef}
            type="text"
            placeholder="Filter by filename…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            style={{ width: '100%', background: '#0F0F1A', border: '1px solid #2A2A45', borderRadius: 6, color: '#E8E8F0', padding: '0.4rem 0.65rem', fontSize: '0.82rem', outline: 'none', fontFamily: 'monospace', boxSizing: 'border-box' }}
            onFocus={e => (e.currentTarget.style.borderColor = '#5CB8F5')}
            onBlur={e => (e.currentTarget.style.borderColor = '#2A2A45')}
          />
        </div>

        {/* File list */}
        <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          {filtered.length === 0 && (
            <div style={{ textAlign: 'center', color: '#4A4A70', fontSize: '0.8rem', padding: '1.5rem 0' }}>No files match "{query}"</div>
          )}
          {filtered.map((f, i) => {
            const isOpen = !!expanded[i]
            const hasDiff = !!f.h0 && !!f.h1
            const firstLine = f.lines?.[0] ?? 1
            const absPath = `${destPath}/${f.path}`.replace(/\/+/g, '/')
            const vscodeUrl = `vscode://file/${absPath}:${firstLine}`
            const lineCount = f.lines?.length ?? 0

            const badge =
              f.action === 'created' ? <span style={{ flexShrink: 0, fontSize: '0.62rem', fontWeight: 700, padding: '0 5px', borderRadius: 3, background: 'rgba(76,175,80,0.15)', color: '#4CAF50', border: '1px solid rgba(76,175,80,0.3)', lineHeight: '1.6' }}>new</span>
              : f.action === 'deleted' ? <span style={{ flexShrink: 0, fontSize: '0.62rem', fontWeight: 700, padding: '0 5px', borderRadius: 3, background: 'rgba(239,83,80,0.15)', color: '#EF5350', border: '1px solid rgba(239,83,80,0.3)', lineHeight: '1.6' }}>del</span>
              : <span style={{ flexShrink: 0, width: 24 }} />

            return (
              <div key={i} style={{ flexShrink: 0 }}>
                <div
                  onClick={() => toggleFile(i, f)}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.28rem 0.5rem', cursor: hasDiff ? 'pointer' : 'default', background: isOpen ? 'rgba(92,184,245,0.05)' : i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent', borderLeft: isOpen ? '2px solid rgba(92,184,245,0.35)' : '2px solid transparent' }}
                  onMouseEnter={e => { if (!isOpen) e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
                  onMouseLeave={e => { if (!isOpen) e.currentTarget.style.background = i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent' }}
                >
                  <span style={{ flexShrink: 0, fontSize: '0.58rem', color: '#3A3A60', width: 10, textAlign: 'center' }}>
                    {hasDiff ? (isOpen ? '▼' : '▶') : ''}
                  </span>
                  {badge}
                  {/* Filename — takes remaining space, truncates cleanly */}
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <code style={{ fontFamily: 'monospace', fontSize: '0.78rem', background: '#0A0A18', padding: '2px 6px', borderRadius: 3, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#B0B0D0' }}>
                      {f.path}
                    </code>
                  </span>
                  {/* Line count — compact, never wraps */}
                  {lineCount > 0 && (
                    <span style={{ flexShrink: 0, color: '#4A4A70', fontSize: '0.68rem', fontFamily: 'monospace', minWidth: 0 }}>
                      +{lineCount}
                    </span>
                  )}
                  {/* VS Code link */}
                  <a
                    href={vscodeUrl}
                    onClick={e => e.stopPropagation()}
                    title="Open in VS Code"
                    style={{ flexShrink: 0, color: '#3A3A60', textDecoration: 'none', lineHeight: 0, padding: '2px' }}
                    onMouseEnter={e => (e.currentTarget.style.color = '#5CB8F5')}
                    onMouseLeave={e => (e.currentTarget.style.color = '#3A3A60')}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" style={{ display: 'block' }}>
                      <path d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm-7 3l5 5-5 5V6zm-4 0v12l-2-2V8l2-2z" />
                    </svg>
                  </a>
                </div>

                {isOpen && (
                  <DiffPanel state={expanded[i]} onTabChange={tab => setTab(i, tab)} />
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
