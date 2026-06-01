import { Fragment, useState } from 'react'
import type { MigrationData, StepDetail } from '../types'
import { FileModal } from './FileModal'
import { StepFileList } from './StepFileList'
import { cn } from '@/lib/utils'
import { BuildBadge, BuildCheckDetail } from './BuildCheckViews'
import { PeerBadge, PeerResolutionDetail, hasPeerInfo } from './PeerResolutionView'
import { ResumeStepButton } from './ResumeStepButton'
import { useTranslation } from '../lib/i18n'

interface Props {
  data: MigrationData
  query: string
}

export function NgUpdateCard({ data, query = '' }: Props) {
  const { t } = useTranslation()
  const [modal, setModal] = useState<{ title: string; files: StepDetail[]; errorsByFile?: Record<string, number | string[]> } | null>(null)
  const [expandedStep, setExpandedStep] = useState<string | null>(null)

  const buildChecks = data.buildChecks ?? {}

  const totalVersions = data.sourceVersion
    ? data.targetVersion - data.sourceVersion
    : data.ngUpdateSteps.length

  const doneVersions = data.ngUpdateSteps.length
  const pct = totalVersions > 0 ? Math.round((doneVersions / totalVersions) * 100) : 0
  const q = query.toLowerCase()

  const visibleSteps = data.ngUpdateSteps.filter(step => {
    if (!query.trim()) return true
    const files = data.details[`ngUpdate_${step.version}`] ?? []
    return files.some(f => f.path.toLowerCase().includes(q))
  })

  function toggleStep(key: string) {
    setExpandedStep(prev => prev === key ? null : key)
  }

  return (
    <>
      {modal && (
        <FileModal
          title={modal.title}
          files={modal.files}
          destPath={data.destPath}
          errorsByFile={modal.errorsByFile}
          onClose={() => setModal(null)}
        />
      )}

      <div className="bg-surface border border-[#2A2A45] rounded-[10px] overflow-hidden shrink-0">
        <div className="bg-surface2 border-b border-[#2A2A45] px-4 py-[0.55rem] flex items-center gap-[0.6rem]">
          <span className="text-[0.72rem] font-bold tracking-[0.07em] uppercase text-[#7070A0]">
            ng update
          </span>
          <span className="ml-auto bg-red/18 text-red border border-red/30 rounded px-1.75 py-px text-[0.68rem] font-semibold">
            {doneVersions} / {t('versions', { count: totalVersions })}
          </span>
        </div>

        <div className="px-4 py-3 border-b border-[#2A2A45]">
          <div className="bg-[#2A2A45] rounded-full h-2 overflow-hidden">
            <div
              className="bg-linear-to-r from-red to-[#E91E63] h-full rounded-full transition-[width] duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="text-[0.72rem] text-[#7070A0] mt-[0.4rem]">{pct}% {t('complete')}</div>
        </div>

        {query.trim() && visibleSteps.length === 0 && (
          <div className="px-4 py-3 text-[#4A4A70] text-[0.78rem]">
            {t('noNgUpdateMatched', { query })}
          </div>
        )}

        <div className="flex flex-col">
          {visibleSteps.map((step) => {
            const key = `v${step.version}`
            const stepKey = `ngUpdate_${step.version}`
            const buildCheck = buildChecks[stepKey]
            const allFiles = data.details[stepKey] ?? []
            const matchFiles = query.trim()
              ? allFiles.filter(f => f.path.toLowerCase().includes(q))
              : allFiles
            const isOpen = expandedStep === key
            const hasFiles = allFiles.length > 0
            const showPeer = hasPeerInfo(step.peer)
            const isExpandable = hasFiles || !!buildCheck || showPeer

            return (
              <Fragment key={step.version}>
                <div
                  onClick={() => isExpandable && toggleStep(key)}
                  className={cn(
                    'flex items-center gap-2 px-4 py-[0.45rem] border-b border-[#2A2A45] transition-colors',
                    isExpandable ? 'cursor-pointer' : '',
                    isOpen ? 'bg-blue/4' : isExpandable ? 'hover:bg-white/3' : '',
                  )}
                >
                  <span className="shrink-0 text-[0.58rem] text-[#3A3A60] w-2.5 text-center">
                    {isExpandable ? (isOpen ? '▼' : '▶') : ''}
                  </span>
                  <span className={cn('text-base w-5 text-center shrink-0', step.ok ? 'text-green' : 'text-amber')}>
                    {step.ok ? '✓' : '⚠'}
                  </span>
                  <span className={cn('flex-1 text-[0.855rem]', step.ok ? 'text-green' : 'text-amber')}>
                    Angular {step.version}
                  </span>
                  <span className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                    {data.status !== 'running' && data.sourcePath && (
                      <ResumeStepButton data={data} step={`ng${step.version}`} stepLabel={`Angular ${step.version}`} />
                    )}
                    {showPeer && step.peer && <PeerBadge peer={step.peer} />}
                    {buildCheck && <BuildBadge check={buildCheck} />}
                    {hasFiles ? (
                      <button
                        onClick={() => setModal({ title: `Angular ${step.version}`, files: allFiles, errorsByFile: buildCheck?.errorsByFile })}
                        title={t('openModal')}
                        className="border border-blue/20 rounded-[5px] text-blue text-[0.72rem] cursor-pointer px-2 py-0.5 whitespace-nowrap hover:border-blue hover:bg-blue/7 transition-colors"
                      >
                        {query.trim() ? `${matchFiles.length} / ${t('filesCount', { count: allFiles.length })}` : t('filesCount', { count: allFiles.length })}
                      </button>
                    ) : !step.ok ? (
                      <span className="text-amber text-[0.75rem]">{t('warnings')}</span>
                    ) : null}
                  </span>
                </div>
                {isOpen && (
                  <div className="border-b border-[#2A2A45] bg-[#07070F] overflow-hidden">
                    {showPeer && step.peer && (
                      <div className="border-b border-[#2A2A45]">
                        <PeerResolutionDetail peer={step.peer} />
                      </div>
                    )}
                    {buildCheck && (
                      <div className="border-b border-[#2A2A45]">
                        <div className="px-4 pt-2 pb-0.5 text-[0.65rem] font-bold tracking-widest uppercase text-[#3A3A60] flex items-center justify-between">
                          <span>{t('buildCheck')}</span>
                          <span className="text-[0.62rem] font-semibold text-[#505080] normal-case tracking-normal">
                            (Total: {buildCheck.total})
                          </span>
                        </div>
                        <BuildCheckDetail check={buildCheck} />
                      </div>
                    )}
                    {hasFiles && <StepFileList files={matchFiles} destPath={data.destPath} query={query} errorsByFile={buildCheck?.errorsByFile} />}
                  </div>
                )}
              </Fragment>
            )
          })}

          {!query.trim() && data.sourceVersion && Array.from({
            length: Math.max(0, totalVersions - doneVersions)
          }, (_, i) => {
            const v = (data.sourceVersion ?? 11) + doneVersions + i + 1
            return (
              <div key={`pending-${v}`} className="flex items-center gap-2 px-4 py-[0.45rem] border-b border-[#2A2A45] opacity-38">
                <span className="shrink-0 w-2.5" />
                <span className="w-5 text-center shrink-0 text-[#3A3A60]">·</span>
                <span className="flex-1 text-[0.855rem]">Angular {v}</span>
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
