import { useState } from 'react'
import type { MigrationData, AppliedCorrection } from '../types'
import { cn } from '@/lib/utils'
import { useTranslation } from '../lib/i18n'
import { Wrench } from 'lucide-react'

function CorrectionRow({ c }: { c: AppliedCorrection }) {
  const [open, setOpen] = useState(false)
  const files = c.files ?? []
  return (
    <div className="border border-green/25 bg-green/8 rounded-md overflow-hidden">
      <div
        onClick={() => files.length && setOpen(o => !o)}
        className={cn(
          'flex items-start gap-2 px-3 py-2',
          files.length ? 'cursor-pointer hover:bg-white/3 transition-colors' : '',
        )}
      >
        <Wrench className="size-3.5 text-green shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[0.78rem] text-green font-semibold">{c.name}</span>
            {Number.isFinite(c.angularMajor) && c.angularMajor > 0 && (
              <span className="bg-blue/15 text-blue border border-blue/30 rounded px-1.5 py-px text-[0.62rem] font-semibold">
                ng{c.angularMajor}
              </span>
            )}
            {files.length > 0 && (
              <span className="ml-auto text-[0.66rem] text-[#7070A0]">
                {files.length} {files.length === 1 ? 'arquivo' : 'arquivos'} {open ? '▼' : '▶'}
              </span>
            )}
          </div>
          {c.description && <p className="text-[0.74rem] text-[#9090C0] mt-0.5 wrap-break-word">{c.description}</p>}
          {c.summary && <p className="text-[0.72rem] text-text/80 mt-0.5 wrap-break-word">{c.summary}</p>}
        </div>
      </div>
      {open && files.length > 0 && (
        <div className="border-t border-green/20 px-3 py-1.5 flex flex-col gap-0.5 max-h-44 overflow-y-auto">
          {files.map((f, i) => (
            <span key={i} className="font-mono text-[0.7rem] text-[#9090C0] wrap-break-word">{f}</span>
          ))}
        </div>
      )}
    </div>
  )
}

export function CorrectionsCard({ data }: { data: MigrationData }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(true)
  const corrections = data.corrections ?? []
  if (corrections.length === 0) return null

  return (
    <div className="bg-surface border border-[#2A2A45] rounded-[10px] overflow-hidden shrink-0">
      <div
        onClick={() => setOpen(o => !o)}
        className="bg-surface2 border-b border-[#2A2A45] px-4 py-[0.55rem] flex items-center gap-[0.6rem] cursor-pointer hover:bg-white/3 transition-colors"
      >
        <span className="text-[0.72rem] font-bold tracking-[0.07em] uppercase text-[#7070A0]">
          {t('correctionsTitle')}
        </span>
        <span className="ml-auto bg-green/18 text-green border border-green/30 rounded px-1.75 py-px text-[0.68rem] font-semibold">
          {corrections.length}
        </span>
        <span className="text-[0.58rem] text-[#3A3A60] w-2.5 text-center">{open ? '▼' : '▶'}</span>
      </div>

      {open && (
        <div className="flex flex-col gap-2 px-4 py-3">
          <p className="text-[0.72rem] text-[#7070A0] -mt-0.5 mb-0.5">{t('correctionsSubtitle')}</p>
          {corrections.map((c, i) => (
            <CorrectionRow key={`${c.name}-${i}`} c={c} />
          ))}
        </div>
      )}
    </div>
  )
}
