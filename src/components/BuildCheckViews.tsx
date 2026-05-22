import type { BuildCheck } from '../types'
import { useTranslation } from '../lib/i18n'

export function BuildBadge({ check }: { check: BuildCheck }) {
  const { t } = useTranslation()
  if (check.total === 0 && check.new.length === 0) {
    return (
      <span className="text-[0.68rem] px-1.5 py-0.5 rounded border border-green/40 bg-green/10 text-green font-bold shadow-[0_0_8px_rgba(76,175,80,0.15)] whitespace-nowrap">
        build ✓
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

export function BuildCheckDetail({ check }: { check: BuildCheck }) {
  const { t } = useTranslation()
  if (check.new.length === 0 && check.fixed.length === 0) {
    return (
      <div className="px-4 py-2 text-[0.75rem] text-[#4A4A70]">
        {check.total === 0 ? `✅ ${t('buildClean')}` : `➡ ${t('buildNoChange', { count: check.total })}`}
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
