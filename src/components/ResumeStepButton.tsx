import { useState, useEffect } from 'react'
import type { MigrationData, BuildCheck } from '../types'
import { cn } from '@/lib/utils'
import { useTranslation } from '../lib/i18n'

interface Props {
  data: MigrationData
  step: string             // 'ng14' ou key de modernização (ex: 'signals')
  stepLabel?: string       // rótulo amigável exibido no modal
  buildCheck?: BuildCheck  // status de build DESTE step (se verificado), p/ mostrar no modal
  disabled?: boolean
}

type Mode = 'resume' | 'rollback'

// Botão de ações por step → modal com duas opções:
//  - Retomar daqui (resume): reset ANTES do step + re-roda.
//  - Voltar pra este estado (rollback): reset NO commit do step + reinstala, sem re-rodar.
// Ambos fazem git reset --hard (destrutivo), por isso o modal de confirmação.
export function ResumeStepButton({ data, step, stepLabel, buildCheck, disabled }: Props) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<Mode | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Estado de build DESTE step → guia as cores (ponto bom × ruim de voltar).
  const buildState: 'clean' | 'errors' | 'unknown' =
    buildCheck == null ? 'unknown' : buildCheck.total === 0 ? 'clean' : 'errors'
  const trigger = {
    clean:   { base: 'border-green/30 text-green',   hover: 'hover:border-green hover:bg-green/8' },
    errors:  { base: 'border-red/30 text-red',       hover: 'hover:border-red hover:bg-red/8' },
    unknown: { base: 'border-[#2A2A45] text-[#7070A0]', hover: 'hover:border-blue hover:text-blue' },
  }[buildState]
  const rollbackColor = {
    clean:   'border-green/30 bg-green/5 hover:bg-green/10 text-green',
    errors:  'border-red/30 bg-red/5 hover:bg-red/10 text-red',
    unknown: 'border-amber/30 bg-amber/5 hover:bg-amber/10 text-amber',
  }[buildState]

  // Fecha o modal no ESC (só quando não está executando uma ação).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, busy])

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
        title={`${t('stepActionsTitle')} — ${t('stepBuild')}: ${buildState === 'clean' ? t('buildClean') : buildState === 'errors' ? t('buildErrors', { count: buildCheck!.total }) : t('buildUnknown')}`}
        className={cn(
          'border rounded-[5px] text-[0.66rem] px-1.5 py-0.5 whitespace-nowrap transition-colors flex items-center gap-1',
          trigger.base,
          disabled ? 'opacity-40 cursor-not-allowed' : cn('cursor-pointer', trigger.hover),
        )}
      >
        <span>↺</span>
        {/* status de build do step embutido no botão */}
        {buildState === 'clean' && <span>✓</span>}
        {buildState === 'errors' && <span>⚠ {buildCheck!.total}</span>}
        {buildState === 'unknown' && <span>{t('stepActions')}</span>}
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
            <p className="text-[0.8rem] text-muted mb-1">
              {t('stepLabel')}: <span className="font-mono text-blue">{stepLabel || step}</span>
            </p>
            {/* Status real de build DESTE step — pra não voltar achando que builda e não builda */}
            <p className="text-[0.78rem] mb-4">
              {t('stepBuild')}:{' '}
              {buildCheck == null ? (
                <span className="text-muted">{t('buildUnknown')}</span>
              ) : buildCheck.total === 0 ? (
                <span className="text-green font-semibold">✓ {t('buildClean')}</span>
              ) : (
                <span className="text-red font-semibold">⚠ {t('buildErrors', { count: buildCheck.total })}</span>
              )}
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
              {/* Rollback — cor reflete o estado de build deste step (bom × ruim de voltar) */}
              <button
                onClick={() => dispatch('rollback')}
                disabled={!!busy}
                className={cn('text-left border rounded-md p-3 cursor-pointer transition-colors disabled:opacity-50', rollbackColor)}
              >
                <div className="text-[0.85rem] font-semibold mb-0.5">⏪ {t('rollbackOption')}</div>
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
