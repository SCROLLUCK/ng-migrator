import { useState } from 'react'
import type { MigrationData, BuildCheck } from '../types'
import { cn } from '@/lib/utils'
import { useTranslation } from '../lib/i18n'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Check, TriangleAlert, RotateCcw, RotateCw, Undo2 } from 'lucide-react'

interface Props {
  data: MigrationData
  step: string             // 'ng14' ou key de modernização (ex: 'signals')
  stepLabel?: string       // rótulo amigável exibido no modal
  buildCheck?: BuildCheck  // status de build DESTE step (se verificado)
  disabled?: boolean
}

type Mode = 'resume' | 'rollback'

// Botão de ações por step → Dialog (shadcn/base-ui: ESC/foco/overlay nativos) com duas opções:
//  - Retomar daqui (resume): reset ANTES do step + re-roda.
//  - Voltar pra este estado (rollback): reset NO commit do step + reinstala, sem re-rodar.
//    O status de build deste step aparece DENTRO desse botão (e a cor reflete o estado),
//    pra não voltar a um ponto achando que builda quando não builda.
export function ResumeStepButton({ data, step, stepLabel, buildCheck, disabled }: Props) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<Mode | null>(null)
  const [error, setError] = useState<string | null>(null)

  const buildState: 'clean' | 'errors' | 'unknown' =
    buildCheck == null ? 'unknown' : buildCheck.total === 0 ? 'clean' : 'errors'
  const stateBox = {
    clean:   'border-green/30 bg-green/5 hover:bg-green/10',
    errors:  'border-red/30 bg-red/5 hover:bg-red/10',
    unknown: 'border-amber/30 bg-amber/5 hover:bg-amber/10',
  }[buildState]
  const stateText = { clean: 'text-green', errors: 'text-red', unknown: 'text-amber' }[buildState]
  const buildStatusLabel =
    buildState === 'clean' ? <><Check className="size-3" /> {t('buildClean')}</>
    : buildState === 'errors' ? <><TriangleAlert className="size-3" /> {t('buildErrors', { count: buildCheck!.total })}</>
    : <>{t('buildUnknown')}</>

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
          'inline-flex items-center gap-1 border border-[#2A2A45] rounded-[5px] text-[#7070A0] text-[0.66rem] px-1.5 py-0.5 whitespace-nowrap transition-colors',
          disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:border-blue hover:text-blue',
        )}
      >
        <RotateCcw className="size-3" /> {t('stepActions')}
      </button>

      <Dialog open={open} onOpenChange={(o) => { if (!busy) setOpen(o) }}>
        <DialogContent className="sm:max-w-lg">
          <DialogTitle>{t('stepActionsTitle')}</DialogTitle>
          <DialogDescription>
            {t('stepLabel')}: <span className="font-mono text-blue">{stepLabel || step}</span>
          </DialogDescription>

          <div className="flex flex-col gap-3">
            {/* Resume */}
            <button
              onClick={() => dispatch('resume')}
              disabled={!!busy}
              className="text-left border border-blue/30 bg-blue/5 hover:bg-blue/10 rounded-md p-3 cursor-pointer transition-colors disabled:opacity-50"
            >
              <div className="inline-flex items-center gap-1.5 text-[0.85rem] font-semibold text-blue mb-0.5"><RotateCw className="size-3.5" /> {t('resumeOption')}</div>
              <div className="text-[0.76rem] text-muted">{t('resumeOptionDesc')}</div>
            </button>

            {/* Rollback — status de build DESTE step embutido, cor reflete o estado */}
            <button
              onClick={() => dispatch('rollback')}
              disabled={!!busy}
              className={cn('text-left border rounded-md p-3 cursor-pointer transition-colors disabled:opacity-50', stateBox)}
            >
              <div className="flex items-center justify-between gap-2 mb-0.5">
                <span className={cn('inline-flex items-center gap-1.5 text-[0.85rem] font-semibold', stateText)}><Undo2 className="size-3.5" /> {t('rollbackOption')}</span>
                <span className={cn('inline-flex items-center gap-1 text-[0.72rem] font-semibold shrink-0', stateText)}>{buildStatusLabel}</span>
              </div>
              <div className="text-[0.76rem] text-muted">{t('rollbackOptionDesc')}</div>
            </button>
          </div>

          <p className="flex items-start gap-1.5 text-[0.74rem] text-amber bg-amber/8 border border-amber/25 rounded-md px-2.5 py-1.5">
            <TriangleAlert className="size-3.5 shrink-0 mt-px" /> {t('resetWarn')}
          </p>
          {error && <p className="text-[0.78rem] text-red whitespace-pre-wrap">{error}</p>}
          {busy && <p className="text-[0.78rem] text-blue">{busy === 'resume' ? t('resumeOption') : t('rollbackOption')}…</p>}
        </DialogContent>
      </Dialog>
    </>
  )
}
