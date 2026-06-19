import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from '../lib/i18n'
import { glossaryList, type ErrorInfo } from '../lib/errorGlossary'
import { parseDiff, DiffPanel, type ExpandedState } from './DiffPanel'
import { cn } from '@/lib/utils'
import { X, ChevronDown, ChevronRight } from 'lucide-react'

/** Uma ocorrência de um erro: em qual step, arquivo, quantas vezes, linhas e hashes do diff. */
export interface ErrorOccurrence {
  step: string
  file: string
  count: number
  lines?: number[]
  action?: string
  h0?: string
  h1?: string
}

interface Props {
  /** Mapa código → ocorrências (arquivos/steps/linhas) da migração atual. */
  occurrences?: Record<string, ErrorOccurrence[]>
  /** Raiz do projeto migrado (para buscar os diffs). */
  destPath?: string
  /** Código para focar/scrollar ao abrir. */
  focusCode?: string
  onClose: () => void
}

const FAMILY_STYLE: Record<string, string> = {
  ng: 'bg-red/12 text-red border-red/30',
  ts: 'bg-blue/12 text-blue border-blue/30',
}

function fmtLines(lines?: number[]): string {
  if (!lines || !lines.length) return ''
  const s = [...lines].sort((a, b) => a - b)
  const out: string[] = []
  let start = s[0], prev = s[0]
  for (let i = 1; i <= s.length; i++) {
    if (i < s.length && s[i] === prev + 1) { prev = s[i]; continue }
    out.push(start === prev ? `${start}` : `${start}–${prev}`)
    if (i < s.length) { start = s[i]; prev = s[i] }
  }
  return out.join(', ')
}

function OccurrenceList({ occ, destPath }: { occ: ErrorOccurrence[]; destPath: string }) {
  const [expanded, setExpanded] = useState<Record<string, ExpandedState>>({})
  const total = occ.reduce((n, o) => n + o.count, 0)

  async function toggle(key: string, o: ErrorOccurrence) {
    if (expanded[key]) { setExpanded(p => { const n = { ...p }; delete n[key]; return n }); return }
    if (!o.h0 || !o.h1) { setExpanded(p => ({ ...p, [key]: { lines: [], loading: false, tab: 'diff' } })); return }
    setExpanded(p => ({ ...p, [key]: { lines: null, loading: true, tab: 'diff' } }))
    try {
      const params = new URLSearchParams({ dest: destPath, path: o.file, h0: o.h0, h1: o.h1 })
      const res = await fetch(`/api/diff?${params}`)
      const json = await res.json()
      setExpanded(p => ({ ...p, [key]: { ...p[key], lines: parseDiff(json.diff || ''), loading: false } }))
    } catch {
      setExpanded(p => ({ ...p, [key]: { lines: [], loading: false, tab: 'diff' } }))
    }
  }

  return (
    <div className="mt-2 border-t border-[#2A2A45] pt-2 flex flex-col gap-0.5">
      <span className="text-[0.64rem] uppercase tracking-wider text-muted font-semibold mb-0.5">
        {occ.length} file{occ.length !== 1 ? 's' : ''} · {total} occurrence{total !== 1 ? 's' : ''}
      </span>
      <div className="flex flex-col gap-0.5 max-h-[55vh] overflow-y-auto">
        {occ.map((o, i) => {
          const key = `${o.step}::${o.file}::${i}`
          const isOpen = !!expanded[key]
          const hasDiff = !!o.h0 && !!o.h1
          return (
            <div key={key} className="min-w-0">
              <div
                onClick={() => hasDiff && toggle(key, o)}
                className={cn(
                  'flex items-baseline gap-2 text-[0.7rem] px-1 py-0.5 rounded',
                  hasDiff ? 'cursor-pointer hover:bg-white/4' : '',
                  isOpen && 'bg-blue/5',
                )}
              >
                <span className="text-[#3A3A60] w-2.5 shrink-0 inline-flex justify-center self-center">
                  {hasDiff ? (isOpen ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />) : null}
                </span>
                <span className="text-red/80 font-mono shrink-0">×{o.count}</span>
                <span className="font-mono text-[#B0B0D0] wrap-break-word flex-1" title={o.file}>{o.file}</span>
                <span className="text-[#5A5A85] shrink-0">{o.step}</span>
                {o.lines && o.lines.length > 0 && (
                  <span className="text-amber/70 font-mono shrink-0" title="linhas alteradas neste step">L{fmtLines(o.lines)}</span>
                )}
              </div>
              {isOpen && (
                <DiffPanel state={expanded[key]} onTabChange={tab => setExpanded(p => ({ ...p, [key]: { ...p[key], tab } }))} />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function KnownErrorsModal({ occurrences, destPath = '', focusCode, onClose }: Props) {
  const { t, language } = useTranslation()
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const focusRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  useEffect(() => {
    if (focusCode && focusRef.current) focusRef.current.scrollIntoView({ block: 'center' })
    else inputRef.current?.focus()
  }, [focusCode])

  // Entradas: glossário + códigos com ocorrências que ainda não estão documentados.
  const entries = useMemo(() => {
    const base = glossaryList()
    const known = new Set(base.map(e => e.code))
    const extra = Object.keys(occurrences ?? {})
      .filter(c => !known.has(c))
      .sort()
      .map((code): { code: string } & ErrorInfo => ({
        code,
        family: code.startsWith('NG') ? 'ng' : 'ts',
        title: { en: '(undocumented)', pt: '(sem descrição)' },
        desc: {
          en: 'Not in the glossary yet — see the affected files below.',
          pt: 'Ainda não está no glossário — veja os arquivos afetados abaixo.',
        },
      }))
    // Códigos com ocorrências primeiro, depois o resto.
    const occ = occurrences ?? {}
    return [...base, ...extra].sort((a, b) => {
      const ao = occ[a.code] ? 0 : 1, bo = occ[b.code] ? 0 : 1
      return ao !== bo ? ao - bo : 0
    })
  }, [occurrences])

  const q = query.trim().toLowerCase()
  const list = q
    ? entries.filter(e =>
        e.code.toLowerCase().includes(q) ||
        e.title[language].toLowerCase().includes(q) ||
        e.desc[language].toLowerCase().includes(q))
    : entries

  const occCount = Object.keys(occurrences ?? {}).length

  return createPortal(
    <div
      onClick={onClose}
      className="fixed inset-0 z-1000 bg-black/65 backdrop-blur-[2px] flex items-center justify-center p-[2vh_2vw]"
    >
      <div
        onClick={e => e.stopPropagation()}
        className="bg-surface border border-[#2A2A45] rounded-[12px] w-[78vw] max-w-225 h-[88vh] flex flex-col shadow-[0_24px_64px_rgba(0,0,0,0.6)]"
      >
        <div className="bg-surface2 border-b border-[#2A2A45] rounded-t-[12px] px-4 py-3 flex items-center gap-3 shrink-0">
          <span className="text-[0.72rem] font-bold tracking-[0.07em] uppercase text-muted">{t('knownErrorsTitle')}</span>
          {occCount > 0 && (
            <span className="bg-red/12 text-red border border-red/25 rounded px-2 py-px text-[0.68rem] font-semibold shrink-0">
              {occCount} {t('knownErrorsPresent')}
            </span>
          )}
          <button
            onClick={onClose}
            className="ml-auto inline-flex items-center bg-transparent border border-[#2A2A45] rounded-[6px] text-muted cursor-pointer px-2 py-1 leading-none shrink-0 hover:text-text hover:border-[#3A3A65] transition-colors"
            title={t('closeEsc')}
          >
            <X className="size-3.5" />
          </button>
        </div>

        <div className="px-4 py-[0.6rem] border-b border-[#2A2A45] shrink-0">
          <input
            ref={inputRef}
            type="text"
            placeholder={t('knownErrorsFilter')}
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="w-full bg-[#0F0F1A] border border-[#2A2A45] rounded-[6px] text-text px-[0.65rem] py-[0.4rem] text-[0.82rem] outline-none font-mono box-border focus:border-blue transition-colors"
          />
        </div>

        <div className="overflow-y-auto overflow-x-hidden flex flex-col gap-2 px-4 py-3">
          {list.map(e => {
            const occ = occurrences?.[e.code]
            const here = !!occ?.length
            return (
              <div
                key={e.code}
                ref={focusCode === e.code ? focusRef : undefined}
                className={cn(
                  'border rounded-md px-3 py-2',
                  here ? 'border-red/40 bg-red/8' : 'border-[#2A2A45] bg-[#0F0F1A]',
                  focusCode === e.code && 'ring-1 ring-blue/60',
                )}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={cn('font-mono text-[0.78rem] font-bold rounded px-1.5 py-px border', FAMILY_STYLE[e.family])}>
                    {e.code}
                  </span>
                  <span className="text-[0.8rem] text-text font-semibold">{e.title[language]}</span>
                  {here && (
                    <span className="ml-auto text-[0.62rem] font-semibold text-red border border-red/30 bg-red/10 rounded px-1.5 py-px">
                      {t('knownErrorsPresent')}
                    </span>
                  )}
                </div>
                <p className="text-[0.76rem] text-[#9090C0] mt-1 leading-snug wrap-break-word">{e.desc[language]}</p>
                {here && <OccurrenceList occ={occ!} destPath={destPath} />}
              </div>
            )
          })}
          {list.length === 0 && (
            <p className="text-[0.78rem] text-muted text-center py-6">{t('knownErrorsNoMatch')}</p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
