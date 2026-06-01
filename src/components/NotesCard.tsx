import { useState } from 'react'
import type { MigrationData } from '../types'
import { cn } from '@/lib/utils'
import { useTranslation } from '../lib/i18n'

type Kind = 'critical' | 'warning' | 'info'

function classify(note: string): Kind {
  if (note.includes('[CRÍTICO]') || note.includes('[CRITICAL]')) return 'critical'
  if (note.includes('[ATENÇÃO]') || note.includes('[ATTENTION]')) return 'warning'
  return 'info'
}

const STYLES: Record<Kind, string> = {
  critical: 'border-red/30 bg-red/8 text-red',
  warning:  'border-amber/30 bg-amber/8 text-amber',
  info:     'border-blue/25 bg-blue/8 text-blue',
}
const ICON: Record<Kind, string> = { critical: '⛔', warning: '⚠', info: 'ℹ' }
const RANK: Record<Kind, number> = { critical: 0, warning: 1, info: 2 }

export function NotesCard({ data }: { data: MigrationData }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(true)

  // Dedupe: notas que só diferem pelo número da versão ("Angular 12", "Angular 13"…)
  // são a mesma ação manual — colapsa para uma só.
  const seen = new Map<string, { text: string; kind: Kind }>()
  for (const raw of data.notes ?? []) {
    const key = raw.replace(/Angular \d+/g, 'Angular N')
    if (seen.has(key)) continue
    const text = key.replace(/^\[(CRÍTICO|CRITICAL|ATENÇÃO|ATTENTION)\]\s*/, '')
    seen.set(key, { text, kind: classify(raw) })
  }
  const notes = [...seen.values()].sort((a, b) => RANK[a.kind] - RANK[b.kind])
  if (notes.length === 0) return null

  return (
    <div className="bg-surface border border-[#2A2A45] rounded-[10px] overflow-hidden shrink-0">
      <div
        onClick={() => setOpen(o => !o)}
        className="bg-surface2 border-b border-[#2A2A45] px-4 py-[0.55rem] flex items-center gap-[0.6rem] cursor-pointer hover:bg-white/3 transition-colors"
      >
        <span className="text-[0.72rem] font-bold tracking-[0.07em] uppercase text-[#7070A0]">
          {t('notesTitle')}
        </span>
        <span className="ml-auto bg-amber/18 text-amber border border-amber/30 rounded px-1.75 py-px text-[0.68rem] font-semibold">
          {notes.length}
        </span>
        <span className="text-[0.58rem] text-[#3A3A60] w-2.5 text-center">{open ? '▼' : '▶'}</span>
      </div>

      {open && (
        <div className="flex flex-col gap-2 px-4 py-3">
          <p className="text-[0.72rem] text-[#7070A0] -mt-0.5 mb-0.5">{t('notesSubtitle')}</p>
          {notes.map((n, i) => (
            <div key={i} className={cn('border rounded-md px-3 py-2 text-[0.8rem] leading-snug flex gap-2', STYLES[n.kind])}>
              <span className="shrink-0 leading-none mt-px">{ICON[n.kind]}</span>
              <span className="text-foreground whitespace-pre-wrap break-words">{n.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
