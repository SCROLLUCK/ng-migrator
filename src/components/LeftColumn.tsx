import { useState, useCallback } from 'react'
import type { MigrationData } from '../types'
import { ConfigCard } from './ConfigCard'
import { CorrectionsManagerCard } from './CorrectionsManagerCard'

interface Props {
  data: MigrationData
  onDataChange: (data: MigrationData) => void
  onLoadMigration: (data: MigrationData) => void
}

export function LeftColumn({ data, onDataChange, onLoadMigration }: Props) {
  const [isRunning, setIsRunning] = useState(false)

  const handleStop = useCallback(async () => {
    try {
      await fetch('/api/stop', { method: 'POST' })
      setIsRunning(false)
    } catch {
      // ignore
    }
  }, [])

  return (
    <div className="flex flex-col gap-5">
      <ConfigCard
        data={data}
        isRunning={isRunning || data.status === 'running'}
        onStart={() => setIsRunning(true)}
        onStop={handleStop}
        onDataChange={onDataChange}
        onLoadMigration={onLoadMigration}
      />
      <CorrectionsManagerCard />
    </div>
  )
}
