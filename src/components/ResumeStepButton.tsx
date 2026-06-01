import { useState } from 'react'
import type { MigrationData } from '../types'
import { cn } from '@/lib/utils'
import { useTranslation } from '../lib/i18n'

interface Props {
  data: MigrationData
  step: string        // 'ng14' ou key de modernização (ex: 'signals')
  stepLabel?: string  // rótulo amigável pra exibir no modal
  disabled?: boolean
}

// Botão "↻ retomar daqui" por step — abre um modal de confirmação (o resume faz
// git reset --hard, descartando os commits posteriores ao step).
export function ResumeStepButton({ data, step, stepLabel, disabled }: Props) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/migrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: data.sourcePath,
          to: data.targetVersion,
          resumeFrom: step,
          modernize: true,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setError(json.error || t('resumeFailed')); setBusy(false); return }
      setOpen(false)
      setBusy(false)
    } catch (e) {
      setError(String(e))
      setBusy(false)
    }
  }

  return (
    <>
      <button
        disabled={disabled}
        onClick={(e) => { e.stopPropagation(); setOpen(true) }}
        title={t('resumeFromHere')}
        className={cn(
          'border border-amber/25 rounded-[5px] text-amber text-[0.66rem] px-1.5 py-0.5 whitespace-nowrap transition-colors',
          disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:border-amber hover:bg-amber/8',
        )}
      >
        ↻ {t('resume')}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-4"
          onClick={(e) => { e.stopPropagation(); if (!busy) setOpen(false) }}
        >
          <div
            className="bg-surface border border-[#2A2A45] rounded-[10px] max-w-md w-full p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-[0.95rem] font-bold text-text mb-2">{t('resumeTitle')}</h3>
            <p className="text-[0.82rem] text-muted mb-2">
              {t('resumeBody')} <span className="font-mono text-blue">{stepLabel || step}</span>
            </p>
            <p className="text-[0.78rem] text-amber bg-amber/8 border border-amber/25 rounded-md px-2.5 py-1.5 mb-4">
              ⚠ {t('resumeWarn')}
            </p>
            {error && <p className="text-[0.78rem] text-red mb-3 whitespace-pre-wrap">{error}</p>}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setOpen(false)}
                disabled={busy}
                className="border border-[#2A2A45] rounded-md px-3 py-1.5 text-[0.8rem] text-muted hover:text-text cursor-pointer disabled:opacity-50"
              >
                {t('cancel')}
              </button>
              <button
                onClick={confirm}
                disabled={busy}
                className="bg-amber/15 border border-amber/40 text-amber rounded-md px-3 py-1.5 text-[0.8rem] font-semibold cursor-pointer hover:bg-amber/25 disabled:opacity-50"
              >
                {busy ? '…' : t('resumeConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
