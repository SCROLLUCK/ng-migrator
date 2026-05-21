import { Fragment, useState } from 'react'
import type { MigrationData, StepDetail } from '../types'
import { FileModal } from './FileModal'
import { StepFileList } from './StepFileList'
import { cn } from '@/lib/utils'

interface Props {
  data: MigrationData
  query: string
}

export function NgUpdateCard({ data, query = '' }: Props) {
  const [modal, setModal] = useState<{ title: string; files: StepDetail[] } | null>(null)
  const [expandedStep, setExpandedStep] = useState<string | null>(null)

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
          onClose={() => setModal(null)}
        />
      )}

      <div className="bg-surface border border-[#2A2A45] rounded-[10px] overflow-hidden shrink-0">
        <div className="bg-surface2 border-b border-[#2A2A45] px-4 py-[0.55rem] flex items-center gap-[0.6rem]">
          <span className="text-[0.72rem] font-bold tracking-[0.07em] uppercase text-[#7070A0]">
            ng update
          </span>
          <span className="ml-auto bg-red/18 text-red border border-red/30 rounded px-1.75 py-px text-[0.68rem] font-semibold">
            {doneVersions} / {totalVersions} versions
          </span>
        </div>

        <div className="px-4 py-3 border-b border-[#2A2A45]">
          <div className="bg-[#2A2A45] rounded-full h-2 overflow-hidden">
            <div
              className="bg-linear-to-r from-red to-[#E91E63] h-full rounded-full transition-[width] duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="text-[0.72rem] text-[#7070A0] mt-[0.4rem]">{pct}% complete</div>
        </div>

        {query.trim() && visibleSteps.length === 0 && (
          <div className="px-4 py-3 text-[#4A4A70] text-[0.78rem]">
            No ng update steps matched "{query}".
          </div>
        )}

        <div className="flex flex-col">
          {visibleSteps.map((step) => {
            const key = `v${step.version}`
            const allFiles = data.details[`ngUpdate_${step.version}`] ?? []
            const matchFiles = query.trim()
              ? allFiles.filter(f => f.path.toLowerCase().includes(q))
              : allFiles
            const isOpen = expandedStep === key
            const hasFiles = allFiles.length > 0

            return (
              <Fragment key={step.version}>
                <div
                  onClick={() => hasFiles && toggleStep(key)}
                  className={cn(
                    'flex items-center gap-2 px-4 py-[0.45rem] border-b border-[#2A2A45] transition-colors',
                    hasFiles ? 'cursor-pointer' : '',
                    isOpen ? 'bg-blue/4' : hasFiles ? 'hover:bg-white/3' : '',
                  )}
                >
                  <span className="shrink-0 text-[0.58rem] text-[#3A3A60] w-2.5 text-center">
                    {hasFiles ? (isOpen ? '▼' : '▶') : ''}
                  </span>
                  <span className={cn('text-base w-5 text-center shrink-0', step.ok ? 'text-green' : 'text-amber')}>
                    {step.ok ? '✓' : '⚠'}
                  </span>
                  <span className={cn('flex-1 text-[0.855rem]', step.ok ? 'text-green' : 'text-amber')}>
                    Angular {step.version}
                  </span>
                  <span onClick={e => e.stopPropagation()}>
                    {hasFiles ? (
                      <button
                        onClick={() => setModal({ title: `Angular ${step.version}`, files: allFiles })}
                        title="Open in modal"
                        className="border border-blue/20 rounded-[5px] text-blue text-[0.72rem] cursor-pointer px-2 py-0.5 whitespace-nowrap hover:border-blue hover:bg-blue/7 transition-colors"
                      >
                        {query.trim() ? `${matchFiles.length} / ${allFiles.length}` : `${allFiles.length}`} file{allFiles.length !== 1 ? 's' : ''}
                      </button>
                    ) : !step.ok ? (
                      <span className="text-amber text-[0.75rem]">warnings</span>
                    ) : null}
                  </span>
                </div>
                {isOpen && (
                  <div className="border-b border-[#2A2A45] bg-[#07070F] overflow-hidden">
                    <StepFileList files={matchFiles} destPath={data.destPath} query={query} />
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
