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

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch('/api/status')
        if (res.ok) setData(await res.json())
      } catch { /* server not available yet */ }
    }
    fetchStatus()
    const interval = setInterval(fetchStatus, 3000)
    return () => clearInterval(interval)
  }, [])

  const connectSSE = useCallback(() => {
    sseRef.current?.close()
    const es = new EventSource('/api/terminal')
    es.onmessage = (ev) => {
      try {
        const parsed = JSON.parse(ev.data)
        if (parsed && typeof parsed === 'object' && 'done' in parsed) return
        setTerminalLines((prev) => [...prev, String(parsed)])
      } catch {
        setTerminalLines((prev) => [...prev, ev.data])
      }
    }
    es.onerror = () => es.close()
    sseRef.current = es
  }, [])

  useEffect(() => {
    connectSSE()
    return () => sseRef.current?.close()
  }, [connectSSE])

  useEffect(() => {
    if (terminalRef.current)
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight
  }, [terminalLines])

  const handleClearTerminal = useCallback(() => setTerminalLines([]), [])

  return (
    <div className="min-h-screen bg-[#0F0F1A] text-text">
      {/* Header */}
      <header className="sticky top-0 z-50 h-14 flex items-center gap-3.5 px-8 bg-surface border-b border-[#2A2A45] shadow-[0_1px_0_rgba(221,0,49,0.25)]">
        <svg width="30" height="30" viewBox="0 0 250 250" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
          <polygon fill="#DD0031" points="125,30 125,30 125,30 31.9,63.2 46.1,186.3 125,230 203.9,186.3 218.1,63.2" />
          <polygon fill="#C3002F" points="125,30 125,52.2 125,52.1 125,153.4 125,153.4 125,230 203.9,186.3 218.1,63.2" />
          <path fill="#FFFFFF" d="M125,52.1L66.8,182.6h21.7l11.7-29.2h49.4l11.7,29.2H183L125,52.1z M142,135.4H108l17-40.9L142,135.4z" />
        </svg>

        <span className="text-[1.05rem] font-bold tracking-[-0.2px]">ng-migrator</span>

        <div className="w-px h-4.5 bg-[#2A2A45]" />

        <span className="text-[0.72rem] text-[#4A4A70] tracking-[0.03em]">Angular migration tool</span>

        {data.sourceVersion && (
          <span className="ml-1 bg-red/10 text-red border border-red/25 rounded px-1.75 py-px text-[0.68rem] font-semibold">
            v{data.sourceVersion} → v{data.targetVersion}
          </span>
        )}

        <div className="ml-auto flex items-center gap-1.5 text-[0.72rem]">
          {data.status === 'running' && (
            <>
              <span className="animate-pulse-custom size-1.75 rounded-full bg-amber inline-block" />
              <span className="text-amber">Running</span>
            </>
          )}
          {data.status === 'serving' && (
            <>
              <span className="animate-pulse-custom size-1.75 rounded-full bg-green inline-block" />
              <span className="text-green">Serving</span>
            </>
          )}
          {data.status === 'done'  && <span className="text-green">✓ Done</span>}
          {data.status === 'error' && <span className="text-red">✗ Error</span>}
          {data.status === 'idle'  && <span className="text-[#4A4A70]">Idle</span>}
        </div>
      </header>

      {/* Main two-column layout */}
      <main className="max-w-400 mx-auto px-8 py-6 grid grid-cols-[380px_1fr] gap-5 items-start">
        <div className="sticky top-20 max-h-[calc(100vh-3.5rem-3rem)] overflow-y-auto flex flex-col gap-5">
          <LeftColumn data={data} onDataChange={setData} />
        </div>

        <div>
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
