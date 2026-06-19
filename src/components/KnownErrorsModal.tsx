import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from '../lib/i18n'
import { glossaryList, ERROR_GLOSSARY } from '../lib/errorGlossary'
import { cn } from '@/lib/utils'
import { X } from 'lucide-react'

interface Props {
  /** Códigos presentes na migração atual (destacados). */
  present?: Set<string>
  /** Código para focar/scrollar ao abrir (ex: clicou num chip). */
  focusCode?: string
  onClose: () => void
}

const FAMILY_STYLE: Record<string, string> = {
  ng: 'bg-red/12 text-red border-red/30',
  ts: 'bg-blue/12 text-blue border-blue/30',
}

export function KnownErrorsModal({ present, focusCode, onClose }: Props) {
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

  const all = useMemo(() => glossaryList(), [])
  const q = query.trim().toLowerCase()
  const list = q
    ? all.filter(e =>
        e.code.toLowerCase().includes(q) ||
        e.title[language].toLowerCase().includes(q) ||
        e.desc[language].toLowerCase().includes(q))
    : all

  // Códigos presentes na migração que não estão no glossário (mostra pra não perder).
  const undocumented = present ? [...present].filter(c => !ERROR_GLOSSARY[c]).sort() : []

  return createPortal(
    <div
      onClick={onClose}
      className="fixed inset-0 z-1000 bg-black/65 backdrop-blur-[2px] flex items-center justify-center p-[2vh_2vw]"
    >
      <div
        onClick={e => e.stopPropagation()}
        className="bg-surface border border-[#2A2A45] rounded-[12px] w-[72vw] max-w-[820px] h-[88vh] flex flex-col shadow-[0_24px_64px_rgba(0,0,0,0.6)]"
      >
        <div className="bg-surface2 border-b border-[#2A2A45] rounded-t-[12px] px-4 py-3 flex items-center gap-3 shrink-0">
          <span className="text-[0.72rem] font-bold tracking-[0.07em] uppercase text-muted">{t('knownErrorsTitle')}</span>
          <span className="bg-blue/12 text-blue border border-blue/25 rounded px-2 py-px text-[0.68rem] font-semibold shrink-0">
            {q ? `${list.length} / ` : ''}{all.length}
          </span>
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
          {undocumented.length > 0 && !q && (
            <div className="border border-amber/30 bg-amber/8 rounded-md px-3 py-2 text-[0.74rem] text-amber">
              {t('knownErrorsUndocumented')}: <span className="font-mono">{undocumented.join(', ')}</span>
            </div>
          )}

          {list.map(e => {
            const here = present?.has(e.code)
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
