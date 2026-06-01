import { useState } from 'react'
import type { MigrationData } from '../types'
import { cn } from '@/lib/utils'
import { useTranslation } from '../lib/i18n'

interface Props {
  data: MigrationData
  step: string        // 'ng14' ou key de modernização (ex: 'signals')
  stepLabel?: string  // rótulo amigável exibido no modal
  disabled?: boolean
}

type Mode = 'resume' | 'rollback'

// Botão de ações por step → modal com duas opções:
//  - Retomar daqui (resume): reset ANTES do step + re-roda.
//  - Voltar pra este estado (rollback): reset NO commit do step + reinstala, sem re-rodar.
// Ambos fazem git reset --hard (destrutivo), por isso o modal de confirmação.
export function ResumeStepButton({ data, step, stepLabel, disabled }: Props) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<Mode | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function dispatch(mode: Mode) {
    setBusy(mode)
    setError(null)
    try {
      const res = await fetch('/api/migrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: data.sourcePath,
          to: data.targetVersion,
          modernize: true,
          ...(mode === 'resume' ? { resumeFrom: step } : { rollbackTo: step }),
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setError(json.error || t('resumeFailed')); setBusy(null); return }
      setOpen(false)
      setBusy(null)
    } catch (e) {
      setError(String(e))
      setBusy(null)
    }
  }

  return (
    <>
      <button
        disabled={disabled}
        onClick={(e) => { e.stopPropagation(); setOpen(true) }}
        title={t('stepActionsTitle')}
        className={cn(
          'border border-[#2A2A45] rounded-[5px] text-[#7070A0] text-[0.66rem] px-1.5 py-0.5 whitespace-nowrap transition-colors',
          disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:border-blue hover:text-blue',
        )}
      >
        ↺ {t('stepActions')}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-100 flex items-center justify-center bg-black/60 px-4"
          onClick={(e) => { e.stopPropagation(); if (!busy) setOpen(false) }}
        >
          <div
            className="bg-surface border border-[#2A2A45] rounded-[10px] max-w-lg w-full p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-[0.95rem] font-bold text-text mb-1">{t('stepActionsTitle')}</h3>
            <p className="text-[0.8rem] text-muted mb-4">
              {t('stepLabel')}: <span className="font-mono text-blue">{stepLabel || step}</span>
            </p>

            <div className="flex flex-col gap-3 mb-4">
              {/* Resume */}
              <button
                onClick={() => dispatch('resume')}
                disabled={!!busy}
                className="text-left border border-blue/30 bg-blue/5 hover:bg-blue/10 rounded-md p-3 cursor-pointer transition-colors disabled:opacity-50"
              >
                <div className="text-[0.85rem] font-semibold text-blue mb-0.5">↻ {t('resumeOption')}</div>
                <div className="text-[0.76rem] text-muted">{t('resumeOptionDesc')}</div>
              </button>
              {/* Rollback */}
              <button
                onClick={() => dispatch('rollback')}
                disabled={!!busy}
                className="text-left border border-amber/30 bg-amber/5 hover:bg-amber/10 rounded-md p-3 cursor-pointer transition-colors disabled:opacity-50"
              >
                <div className="text-[0.85rem] font-semibold text-amber mb-0.5">⏪ {t('rollbackOption')}</div>
                <div className="text-[0.76rem] text-muted">{t('rollbackOptionDesc')}</div>
              </button>
            </div>

            <p className="text-[0.74rem] text-amber bg-amber/8 border border-amber/25 rounded-md px-2.5 py-1.5 mb-3">
              ⚠ {t('resetWarn')}
            </p>
            {error && <p className="text-[0.78rem] text-red mb-3 whitespace-pre-wrap">{error}</p>}
            {busy && <p className="text-[0.78rem] text-blue mb-3">{busy === 'resume' ? t('resumeOption') : t('rollbackOption')}…</p>}

            <div className="flex justify-end">
              <button
                onClick={() => setOpen(false)}
                disabled={!!busy}
                className="border border-[#2A2A45] rounded-md px-3 py-1.5 text-[0.8rem] text-muted hover:text-text cursor-pointer disabled:opacity-50"
              >
                {t('cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
