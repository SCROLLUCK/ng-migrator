import { useState, useCallback } from 'react'
import type { MigrationData } from '../types'
import { ConfigCard } from './ConfigCard'
import { NgUpdateCard } from './NgUpdateCard'

interface Props {
  data: MigrationData
  onDataChange: (data: MigrationData) => void
}

export function LeftColumn({ data, onDataChange }: Props) {
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
    <>
      <ConfigCard
        data={data}
        isRunning={isRunning || data.status === 'running'}
        onStart={() => setIsRunning(true)}
        onStop={handleStop}
        onDataChange={onDataChange}
      />
      {(data.status !== 'idle' || data.ngUpdateSteps.length > 0) && (
        <NgUpdateCard data={data} />
      )}
    </>
  )
}
