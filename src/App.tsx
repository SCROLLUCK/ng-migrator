import { useState, useEffect, useRef, useCallback } from 'react'
import type { MigrationData } from './types'
import { LeftColumn } from './components/LeftColumn'
import { RightColumn } from './components/RightColumn'

const EMPTY_DATA: MigrationData = {
  status: 'idle',
  sourceVersion: null,
  targetVersion: 21,
  sourcePath: '',
  destPath: '',
  date: '',
  ngUpdateSteps: [],
  modernize: {
    flexLayoutMigrated: null,
    inject: false,
    signals: false,
    untypedFormsFixed: 0,
    throwErrorFixed: 0,
    standalone: false,
    standaloneFixed: 0,
    controlFlow: false,
    ngClassToClass: false,
    ngStyleToStyle: false,
    appConfig: false,
    appRoutes: false,
    lazyRoutesConverted: 0,
    mainSimplified: false,
    builder: false,
    polyfillsInlined: false,
    tsconfigModernized: false,
    pathAliases: false,
    eslintAdded: false,
    lintFixed: 0,
    sassImports: 0,
    modulesRemoved: 0,
    styleUrlFixed: 0,
    selfClosingTags: false,
    cleanupImports: false,
  },
  details: {},
  notes: [],
  filesCreated: [],
}

export default function App() {
  const [data, setData] = useState<MigrationData>(EMPTY_DATA)
  const [terminalLines, setTerminalLines] = useState<string[]>([])
  const terminalRef = useRef<HTMLDivElement>(null)
  const sseRef = useRef<EventSource | null>(null)

  // Poll /api/status every 3s
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch('/api/status')
        if (res.ok) {
          const json = await res.json()
          setData(json)
        }
      } catch {
        // server not available yet
      }
    }
    fetchStatus()
    const interval = setInterval(fetchStatus, 3000)
    return () => clearInterval(interval)
  }, [])

  // Connect to /api/terminal SSE
  const connectSSE = useCallback(() => {
    if (sseRef.current) {
      sseRef.current.close()
    }
    const es = new EventSource('/api/terminal')
    es.onmessage = (ev) => {
      try {
        const parsed = JSON.parse(ev.data)
        if (parsed && typeof parsed === 'object' && 'done' in parsed) {
          return
        }
        setTerminalLines((prev) => [...prev, String(parsed)])
      } catch {
        setTerminalLines((prev) => [...prev, ev.data])
      }
    }
    es.onerror = () => {
      es.close()
    }
    sseRef.current = es
  }, [])

  useEffect(() => {
    connectSSE()
    return () => {
      sseRef.current?.close()
    }
  }, [connectSSE])

  // Auto-scroll terminal to bottom
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight
    }
  }, [terminalLines])

  const handleClearTerminal = useCallback(() => {
    setTerminalLines([])
  }, [])

  return (
    <div style={{ minHeight: '100vh', background: '#0F0F1A', color: '#E8E8F0' }}>
      {/* Header */}
      <header
        style={{
          background: '#16162A',
          borderBottom: '1px solid #2A2A45',
          boxShadow: '0 1px 0 rgba(221,0,49,0.25)',
          padding: '0 2rem',
          height: 56,
          display: 'flex',
          alignItems: 'center',
          gap: '0.875rem',
          position: 'sticky',
          top: 0,
          zIndex: 100,
        }}
      >
        {/* Official Angular shield logo */}
        <svg
          width="30"
          height="30"
          viewBox="0 0 250 250"
          xmlns="http://www.w3.org/2000/svg"
          style={{ flexShrink: 0 }}
        >
          <polygon fill="#DD0031" points="125,30 125,30 125,30 31.9,63.2 46.1,186.3 125,230 203.9,186.3 218.1,63.2" />
          <polygon fill="#C3002F" points="125,30 125,52.2 125,52.1 125,153.4 125,153.4 125,230 203.9,186.3 218.1,63.2" />
          <path fill="#FFFFFF" d="M125,52.1L66.8,182.6h21.7l11.7-29.2h49.4l11.7,29.2H183L125,52.1z M142,135.4H108l17-40.9L142,135.4z" />
        </svg>

        <span style={{ fontSize: '1.05rem', fontWeight: 700, color: '#E8E8F0', letterSpacing: '-0.2px' }}>
          ng-migrator
        </span>

        <div style={{ width: 1, height: 18, background: '#2A2A45' }} />

        <span style={{ fontSize: '0.72rem', color: '#4A4A70', letterSpacing: '0.03em' }}>
          Angular migration tool
        </span>

        {data.sourceVersion && (
          <span style={{
            marginLeft: '0.25rem',
            background: 'rgba(221,0,49,0.12)',
            color: '#DD0031',
            border: '1px solid rgba(221,0,49,0.25)',
            borderRadius: 4,
            fontSize: '0.68rem',
            fontWeight: 600,
            padding: '1px 7px',
          }}>
            v{data.sourceVersion} → v{data.targetVersion}
          </span>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.72rem' }}>
          {data.status === 'running' && (
            <>
              <span className="animate-pulse-custom" style={{ width: 7, height: 7, borderRadius: '50%', background: '#FF9800', display: 'inline-block' }} />
              <span style={{ color: '#FF9800' }}>Running</span>
            </>
          )}
          {data.status === 'serving' && (
            <>
              <span className="animate-pulse-custom" style={{ width: 7, height: 7, borderRadius: '50%', background: '#4CAF50', display: 'inline-block' }} />
              <span style={{ color: '#4CAF50' }}>Serving</span>
            </>
          )}
          {data.status === 'done' && <span style={{ color: '#4CAF50' }}>✓ Done</span>}
          {data.status === 'error' && <span style={{ color: '#EF5350' }}>✗ Error</span>}
          {data.status === 'idle' && <span style={{ color: '#4A4A70' }}>Idle</span>}
        </div>
      </header>

      {/* Main two-column layout */}
      <main
        style={{
          maxWidth: 1600,
          margin: '0 auto',
          padding: '1.5rem 2rem',
          display: 'grid',
          gridTemplateColumns: '380px 1fr',
          gap: '1.25rem',
          alignItems: 'start',
        }}
      >
        <div
          style={{
            gridColumn: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: '1.25rem',
            position: 'sticky',
            top: 'calc(56px + 1.5rem)',
            maxHeight: 'calc(100vh - 56px - 3rem)',
            overflowY: 'auto',
          }}
        >
          <LeftColumn data={data} onDataChange={setData} />
        </div>

        <div style={{ gridColumn: 2 }}>
          <RightColumn
            data={data}
            terminalLines={terminalLines}
            terminalRef={terminalRef}
            onClearTerminal={handleClearTerminal}
          />
        </div>
      </main>
    </div>
  )
}
