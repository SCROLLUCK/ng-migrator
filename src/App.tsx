import { useState, useEffect, useRef, useCallback } from 'react'
import type { MigrationData } from './types'
import { LeftColumn } from './components/LeftColumn'
import { RightColumn } from './components/RightColumn'
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarRail,
  SidebarTrigger,
  SidebarInset,
} from '@/components/ui/sidebar'
import { useTranslation } from './lib/i18n'
import { cn } from '@/lib/utils'
import { X, Check, Undo2 } from 'lucide-react'

const EMPTY_DATA: MigrationData = {
  status: 'idle',
  sourceVersion: null,
  targetVersion: 22,
  sourcePath: '',
  destPath: '',
  date: '',
  ngUpdateSteps: [],
  modernize: {
    flexLayoutMigrated: null,
    inject: false,
    signals: false,
    reservedKeywordsFixed: 0,
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
  const { t, language, setLanguage } = useTranslation()
  const [data, setData] = useState<MigrationData>(EMPTY_DATA)
  const [viewedData, setViewedData] = useState<MigrationData | null>(null)
  const [terminalLines, setTerminalLines] = useState<string[]>([])
  const [terminalTotal, setTerminalTotal] = useState(0)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const sseRef = useRef<EventSource | null>(null)
  const reconnectTimeoutRef = useRef<any>(null)
  const prevStatusRef = useRef<string>('idle')

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
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
    }
    sseRef.current?.close()
    const es = new EventSource('/api/terminal')
    es.onmessage = (ev) => {
      try {
        const parsed = JSON.parse(ev.data)
        if (parsed && typeof parsed === 'object' && 'done' in parsed) return
        setTerminalTotal(n => n + 1)
        setTerminalLines((prev) => {
          const next = [...prev, String(parsed)]
          if (next.length > 2000) return next.slice(next.length - 2000)
          return next
        })
      } catch {
        setTerminalTotal(n => n + 1)
        setTerminalLines((prev) => {
          const next = [...prev, ev.data]
          if (next.length > 2000) return next.slice(next.length - 2000)
          return next
        })
      }
    }
    es.onerror = () => {
      es.close()
      reconnectTimeoutRef.current = setTimeout(connectSSE, 3000)
    }
    sseRef.current = es
  }, [])

  useEffect(() => {
    connectSSE()
    return () => {
      sseRef.current?.close()
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
    }
  }, [connectSSE])

  useEffect(() => {
    if (data.status === 'running' && prevStatusRef.current !== 'running') {
      setTerminalLines([])
      connectSSE()
    }
    prevStatusRef.current = data.status
  }, [data.status, connectSSE])

  const handleClearTerminal = useCallback(() => { setTerminalLines([]); setTerminalTotal(0) }, [])

  const handleLoadMigration = useCallback((loaded: MigrationData) => {
    setViewedData(loaded)
    setSidebarOpen(false)
  }, [])

  const displayData = viewedData ?? data
  const isViewingLoaded = viewedData !== null

  return (
    <SidebarProvider
      open={sidebarOpen}
      onOpenChange={setSidebarOpen}
      style={{ '--sidebar-width': '390px' } as React.CSSProperties}
    >
      {/* Left sidebar */}
      <Sidebar
        collapsible="offcanvas"
        className="border-r border-[#2A2A45] bg-[#0F0F1A]"
      >
        <SidebarHeader className="h-14 flex-row items-center gap-2.5 px-4 border-b border-[#2A2A45] shrink-0">
          <svg width="26" height="26" viewBox="0 0 250 250" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
            <polygon fill="#DD0031" points="125,30 125,30 125,30 31.9,63.2 46.1,186.3 125,230 203.9,186.3 218.1,63.2" />
            <polygon fill="#C3002F" points="125,30 125,52.2 125,52.1 125,153.4 125,153.4 125,230 203.9,186.3 218.1,63.2" />
            <path fill="#FFFFFF" d="M125,52.1L66.8,182.6h21.7l11.7-29.2h49.4l11.7,29.2H183L125,52.1z M142,135.4H108l17-40.9L142,135.4z" />
          </svg>
          <span className="text-[1.05rem] font-bold tracking-[-0.2px] text-text">{t('appTitle')}</span>
        </SidebarHeader>
        <SidebarContent className="bg-[#0F0F1A] p-4 gap-5">
          <LeftColumn data={data} onDataChange={setData} onLoadMigration={handleLoadMigration} />
        </SidebarContent>
        <SidebarRail />
      </Sidebar>

      {/* Main content */}
      <SidebarInset className="bg-[#0F0F1A] min-h-svh overflow-x-hidden">
        <header className="sticky top-0 z-50 h-14 flex items-center gap-3.5 px-6 bg-surface border-b border-[#2A2A45] shadow-[0_1px_0_rgba(221,0,49,0.25)]">
          <SidebarTrigger className="text-[#7070A0] hover:text-text hover:bg-white/5 -ml-1 shrink-0" />

          <div className="w-px h-4.5 bg-[#2A2A45]" />

          <span className="text-[0.72rem] text-[#4A4A70] tracking-[0.03em]">{t('appSubtitle')}</span>

          {displayData.sourceVersion && (
            <span className="ml-1 bg-red/10 text-red border border-red/25 rounded px-1.75 py-px text-[0.68rem] font-semibold">
              v{displayData.sourceVersion} → v{displayData.targetVersion}
            </span>
          )}

          {isViewingLoaded && (
            <span className="ml-1 bg-blue/10 text-blue border border-blue/25 rounded px-1.75 py-px text-[0.68rem] font-semibold flex items-center gap-1">
              {t('reportLoaded')}
              <button
                onClick={() => { setViewedData(null); setSidebarOpen(true) }}
                className="ml-0.5 inline-flex text-blue/60 hover:text-blue transition-colors leading-none cursor-pointer"
                title={t('closeReport')}
              ><X className="size-3" /></button>
            </span>
          )}

          <div className="ml-auto flex items-center gap-4 text-[0.72rem]">
            {/* Rollback marker */}
            {data.rolledBackTo && (
              <span
                title={t('rolledBackAt', { at: new Date(data.rolledBackTo.at).toLocaleString() })}
                className="inline-flex items-center gap-1 bg-amber/15 text-amber border border-amber/30 rounded px-1.75 py-px font-semibold shrink-0"
              >
                <Undo2 className="size-3" /> {t('rolledBackTo')}: <span className="font-mono">{data.rolledBackTo.step}</span>
              </span>
            )}

            {/* Language Selector */}
            <div className="flex items-center bg-[#0F0F1A] border border-[#2A2A45] rounded-md overflow-hidden shrink-0">
              <button
                onClick={() => setLanguage('en')}
                className={cn(
                  'px-2 py-0.5 text-[0.65rem] font-bold cursor-pointer transition-colors',
                  language === 'en' ? 'bg-[#2A2A45] text-text' : 'text-[#505075] hover:text-[#7070A0]'
                )}
              >
                EN
              </button>
              <button
                onClick={() => setLanguage('pt')}
                className={cn(
                  'px-2 py-0.5 text-[0.65rem] font-bold cursor-pointer transition-colors',
                  language === 'pt' ? 'bg-[#2A2A45] text-text' : 'text-[#505075] hover:text-[#7070A0]'
                )}
              >
                PT
              </button>
            </div>

            {/* Status */}
            <div className="flex items-center gap-1.5 font-semibold shrink-0">
              {data.status === 'running' && (
                <>
                  <span className="animate-pulse-custom size-1.75 rounded-full bg-amber inline-block" />
                  <span className="text-amber">{t('statusRunning')}</span>
                </>
              )}
              {data.status === 'serving' && (
                <>
                  <span className="animate-pulse-custom size-1.75 rounded-full bg-green inline-block" />
                  <span className="text-green">{t('statusServing')}</span>
                </>
              )}
              {data.status === 'done'  && <span className="inline-flex items-center gap-1 text-green"><Check className="size-3.5" /> {t('statusDone')}</span>}
              {data.status === 'error' && <span className="inline-flex items-center gap-1 text-red"><X className="size-3.5" /> {t('statusError')}</span>}
              {data.status === 'idle'  && <span className="text-[#4A4A70]">{t('statusIdle')}</span>}
            </div>
          </div>
        </header>

        <div className="px-6 py-6">
          <RightColumn
            data={displayData}
            terminalLines={terminalLines}
            terminalTotal={terminalTotal}
            onClearTerminal={handleClearTerminal}
          />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

