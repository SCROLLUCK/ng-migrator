import { useState } from 'react'
import type { MigrationData, StepDetail } from '../types'
import { FileModal } from './FileModal'
import { cn } from '@/lib/utils'

interface Props {
  data: MigrationData
}

export function NgUpdateCard({ data }: Props) {
  const [modal, setModal] = useState<{ title: string; files: StepDetail[] } | null>(null)

  const totalVersions = data.sourceVersion
    ? data.targetVersion - data.sourceVersion
    : data.ngUpdateSteps.length

  const doneVersions = data.ngUpdateSteps.length
  const pct = totalVersions > 0 ? Math.round((doneVersions / totalVersions) * 100) : 0

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

        <table className="w-full border-collapse">
          <tbody>
            {data.ngUpdateSteps.map((step) => {
              const files = data.details[`ngUpdate_${step.version}`] ?? []
              return (
                <tr key={step.version} className="border-b border-[#2A2A45]">
                  <td className={cn('w-[2.2rem] text-center px-2 pl-4 py-2 text-base', step.ok ? 'text-green' : 'text-amber')}>
                    {step.ok ? '✓' : '⚠'}
                  </td>
                  <td className={cn('px-2 py-2 text-[0.855rem]', step.ok ? 'text-green' : 'text-amber')}>
                    Angular {step.version}
                  </td>
                  <td className="px-4 py-2 text-right pr-4">
                    {files.length > 0 ? (
                      <button
                        onClick={() => setModal({ title: `Angular ${step.version}`, files })}
                        className="border border-blue/20 rounded-[5px] text-blue text-[0.72rem] cursor-pointer px-2 py-0.5 whitespace-nowrap hover:border-blue hover:bg-blue/7 transition-colors"
                      >
                        {files.length} file{files.length !== 1 ? 's' : ''}
                      </button>
                    ) : !step.ok ? (
                      <span className="text-amber text-[0.75rem]">warnings</span>
                    ) : null}
                  </td>
                </tr>
              )
            })}
            {data.sourceVersion && Array.from({
              length: Math.max(0, totalVersions - doneVersions)
            }, (_, i) => {
              const v = (data.sourceVersion ?? 11) + doneVersions + i + 1
              return (
                <tr key={`pending-${v}`} className="border-b border-[#2A2A45] opacity-38">
                  <td className="w-[2.2rem] text-center px-2 pl-4 py-2">·</td>
                  <td className="px-2 py-2 text-[0.855rem]">Angular {v}</td>
                  <td />
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}
