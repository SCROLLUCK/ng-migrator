import { useState } from 'react'
import type { StepDetail } from '../types'
import { cn } from '@/lib/utils'
import { parseDiff, highlightPath, DiffPanel, type TabType, type ExpandedState } from './DiffPanel'

interface Props {
  files: StepDetail[]
  destPath: string
  query?: string
}

export function StepFileList({ files, destPath, query = '' }: Props) {
  const [expanded, setExpanded] = useState<Record<string, ExpandedState>>({})

  const displayed = query.trim()
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

  if (displayed.length === 0) return (
    <div className="px-4 py-3 text-[#4A4A70] text-[0.78rem]">Nenhum arquivo encontrado.</div>
  )

  return (
    <div className="flex flex-col overflow-x-hidden">
      {displayed.map(f => {
        const key = `${f.path}::${f.h0 ?? ''}::${f.h1 ?? ''}`
        const isOpen = !!expanded[key]
        const hasDiff = !!f.h0 && !!f.h1
        const firstLine = f.lines?.[0] ?? 1
        const absPath = `${destPath}/${f.path}`.replace(/\/+/g, '/')
        const vscodeUrl = `vscode://file/${absPath}:${firstLine}`
        const lineCount = f.lines?.length ?? 0

        const badge = f.action === 'created'
          ? <span className="shrink-0 text-[0.62rem] font-bold px-[0.3rem] rounded-[3px] bg-green/15 text-green border border-green/30 leading-[1.6]">new</span>
          : f.action === 'deleted'
          ? <span className="shrink-0 text-[0.62rem] font-bold px-[0.3rem] rounded-[3px] bg-[#EF5350]/15 text-[#EF5350] border border-[#EF5350]/30 leading-[1.6]">del</span>
          : <span className="shrink-0 w-6" />

        return (
          <div key={key} className="min-w-0">
            <div
              onClick={() => hasDiff && toggleFile(key, f)}
              className={cn(
                'flex items-center gap-2 px-3 py-[0.3rem] border-l-2 transition-colors min-w-0',
                isOpen
                  ? 'bg-blue/5 border-blue/35'
                  : cn('border-transparent', hasDiff ? 'cursor-pointer hover:bg-white/4' : 'cursor-default'),
              )}
            >
              <span className="shrink-0 text-[0.58rem] text-[#3A3A60] w-2.5 text-center">
                {hasDiff ? (isOpen ? '▼' : '▶') : ''}
              </span>
              {badge}
              <div className="flex-1 min-w-0 overflow-hidden">
                <code title={f.path} className="font-mono text-[0.78rem] bg-[#0A0A18] px-1.5 py-0.5 rounded-[3px] block whitespace-nowrap text-[#B0B0D0]">
                  {highlightPath(f.path, query)}
                </code>
              </div>
              {lineCount > 0 && (
                <span className="shrink-0 text-[#4A4A70] text-[0.68rem] font-mono">+{lineCount}</span>
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
  )
}
