import type { BuildCheck, MigrationData } from '../types'
import { useTranslation } from '../lib/i18n'
import { cn } from '@/lib/utils'
import { Check, TriangleAlert, CircleCheckBig, ArrowRight } from 'lucide-react'

export function BuildBadge({ check }: { check: BuildCheck }) {
  const { t } = useTranslation()
  if (check.total === 0 && check.new.length === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-[0.68rem] px-1.5 py-0.5 rounded border border-green/40 bg-green/10 text-green font-bold shadow-[0_0_8px_rgba(76,175,80,0.15)] whitespace-nowrap">
        build <Check className="size-3" />
      </span>
    )
  }
  if (check.new.length > 0) {
    return (
      <span
        title={`${t('introduced')}: ${check.new.join(', ')}`}
        className="text-[0.68rem] px-1.5 py-0.5 rounded border border-red/50 bg-red/15 text-[#FF5252] font-bold shadow-[0_0_8px_rgba(255,82,82,0.15)] whitespace-nowrap cursor-help"
      >
        +{t('errorsCount', { count: check.new.length })} (Total: {check.total})
      </span>
    )
  }
  if (check.fixed.length > 0) {
    return (
      <span
        title={`${t('resolved')}: ${check.fixed.join(', ')}`}
        className="text-[0.68rem] px-1.5 py-0.5 rounded border border-green/50 bg-green/15 text-[#81C784] font-bold shadow-[0_0_8px_rgba(129,199,132,0.15)] whitespace-nowrap cursor-help"
      >
        -{t('errorsCount', { count: check.fixed.length })} (Total: {check.total})
      </span>
    )
  }
  return (
    <span className="text-[0.68rem] px-1.5 py-0.5 rounded border border-amber/45 bg-amber/12 text-[#FFB74D] font-bold shadow-[0_0_8px_rgba(255,183,77,0.15)] whitespace-nowrap">
      Total: {t('errorsCount', { count: check.total })}
    </span>
  )
}

export function FinalBuildStatus({ data }: { data: MigrationData }) {
  const checks = data.buildChecks ?? {}
  const keys = Object.keys(checks)
  if (!keys.length) return null

  const remaining = new Set<string>()
  let lastTotal = 0
  for (const key of keys) {
    const check = checks[key]
    for (const c of check.new) remaining.add(c)
    for (const c of check.fixed) remaining.delete(c)
    lastTotal = check.total
  }

  const isClean = lastTotal === 0
  const lastStep = keys[keys.length - 1]
  const isRunning = data.status === 'running'

  return (
    <div className={cn(
      'rounded-[10px] border px-4 py-3',
      isClean ? 'bg-green/5 border-green/30' : 'bg-red/5 border-red/30',
    )}>
      <div className="flex items-center gap-2">
        <span className={cn(
          'inline-flex items-center gap-1.5 text-[0.72rem] font-bold tracking-[0.07em] uppercase',
          isClean ? 'text-green' : 'text-[#FF5252]',
        )}>
          {isClean ? <><Check className="size-3.5" /> Build clean</> : <><TriangleAlert className="size-3.5" /> Build errors</>}
        </span>
        {!isClean && (
          <span className="text-[0.72rem] text-[#7070A0]">
            — {lastTotal} error type{lastTotal !== 1 ? 's' : ''} remaining
          </span>
        )}
        {isRunning && (
          <span className="ml-auto text-[0.65rem] text-[#4A4A70] animate-pulse-custom">updating…</span>
        )}
      </div>
      {!isClean && remaining.size > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {Array.from(remaining).map(code => (
            <span key={code} className="text-[0.72rem] px-1.5 py-0.5 rounded bg-red/8 border border-red/25 text-[#FF5252]/80 font-mono">
              {code}
            </span>
          ))}
        </div>
      )}
      <div className="text-[0.65rem] text-[#3A3A60] mt-1.5">
        {isRunning ? 'current state' : 'final state'} · last check: {lastStep}
      </div>
    </div>
  )
}

export function BuildCheckDetail({ check }: { check: BuildCheck }) {
  const { t } = useTranslation()
  if (check.new.length === 0 && check.fixed.length === 0) {
    return (
      <div className="px-4 py-2 inline-flex items-center gap-1.5 text-[0.75rem] text-[#4A4A70]">
        {check.total === 0
          ? <><CircleCheckBig className="size-3.5 text-green" /> {t('buildClean')}</>
          : <><ArrowRight className="size-3.5" /> {t('buildNoChange', { count: check.total })}</>}
      </div>
    )
  }
  return (
    <div className="px-4 py-2 flex flex-col gap-1.5">
      {check.new.length > 0 && (
        <div>
          <span className="text-[0.68rem] font-bold text-red/80 uppercase tracking-wider">
            {t('introduced')} ({check.new.length})
          </span>
          <div className="flex flex-wrap gap-1 mt-1">
            {check.new.map(c => (
              <span key={c} className="text-[0.72rem] px-1.5 py-0.5 rounded bg-red/8 border border-red/25 text-red/80 font-mono">{c}</span>
            ))}
          </div>
        </div>
      )}
      {check.fixed.length > 0 && (
        <div>
          <span className="text-[0.68rem] font-bold text-green/70 uppercase tracking-wider">
            {t('resolved')} ({check.fixed.length})
          </span>
          <div className="flex flex-wrap gap-1 mt-1">
            {check.fixed.map(c => (
              <span key={c} className="text-[0.72rem] px-1.5 py-0.5 rounded bg-green/8 border border-green/25 text-green/70 font-mono">{c}</span>
            ))}
          </div>
        </div>
      )}
      {check.total > 0 && (
        <div className="text-[0.68rem] text-[#4A4A70] mt-0.5">{t('totalErrorsAfterStep', { count: check.total })}</div>
      )}
    </div>
  )
}
