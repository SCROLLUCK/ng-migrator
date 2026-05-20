import type { RefObject } from 'react'
import type { MigrationData } from '../types'
import { TerminalCard } from './TerminalCard'
import { ModernizationCard } from './ModernizationCard'
import { FileSearchCard } from './FileSearchCard'

interface Props {
  data: MigrationData
  terminalLines: string[]
  terminalRef: RefObject<HTMLDivElement | null>
  onClearTerminal: () => void
}

export function RightColumn({ data, terminalLines, terminalRef, onClearTerminal }: Props) {
  const hasDetails = Object.keys(data.details).length > 0
  return (
    <div className="flex flex-col gap-5">
      <TerminalCard
        lines={terminalLines}
        terminalRef={terminalRef}
        onClear={onClearTerminal}
      />
      {data.status !== 'idle' && (
        <ModernizationCard data={data} />
      )}
      {hasDetails && (
        <FileSearchCard data={data} />
      )}
    </div>
  )
}
