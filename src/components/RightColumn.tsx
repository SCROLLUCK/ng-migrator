import { useState } from 'react'
import type { MigrationData } from '../types'
import { TerminalCard } from './TerminalCard'
import { ModernizationCard } from './ModernizationCard'
import { NgUpdateCard } from './NgUpdateCard'
import { FinalBuildStatus } from './BuildCheckViews'
import { useTranslation } from '../lib/i18n'

interface Props {
  data: MigrationData
  terminalLines: string[]
  terminalTotal: number
  onClearTerminal: () => void
}

export function RightColumn({ data, terminalLines, terminalTotal, onClearTerminal }: Props) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')

  const hasDetails = Object.keys(data.details).length > 0
  const showNgUpdate = data.ngUpdateSteps.length > 0 || data.status === 'running'
  const showStepCards = showNgUpdate || data.status !== 'idle'

  return (
    <div className="flex flex-col gap-5 overflow-x-hidden">
      <TerminalCard
        lines={terminalLines}
        totalLines={terminalTotal}
        onClear={onClearTerminal}
      />

      {showStepCards && hasDetails && (
        <div className="bg-surface border border-[#2A2A45] rounded-[8px] px-3 py-[0.45rem] flex items-center gap-2">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-[#4A4A70] shrink-0">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
          <input
            type="text"
            placeholder={t('filterByFilename')}
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="flex-1 bg-transparent outline-none text-[0.82rem] text-text placeholder:text-[#3A3A60] font-mono"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="text-[#4A4A70] hover:text-text text-[0.75rem] leading-none cursor-pointer transition-colors"
            >
              ✕
            </button>
          )}
        </div>
      )}

      {showNgUpdate && (
        <NgUpdateCard data={data} query={query} />
      )}
      {data.status !== 'idle' && (
        <ModernizationCard data={data} query={query} />
      )}
      {data.status !== 'idle' && (
        <FinalBuildStatus data={data} />
      )}
    </div>
  )
}
