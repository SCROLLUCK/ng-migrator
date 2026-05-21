import { useState, useEffect } from 'react'
import type { MigrationData } from '../types'
import { cn } from '@/lib/utils'

const STEP_LABELS: Record<string, string> = {
  flexLayout: '@angular/flex-layout → Tailwind CSS',
  inject: 'inject() — constructor DI',
  signals: 'Signals — @Input/@Output/@ViewChild',
  untypedForms: 'UntypedForm* → typed forms',
  throwError: 'throwError() → factory (RxJS 7)',
  standalone: 'Standalone migration',
  controlFlow: 'Control flow (@if/@for/@switch)',
  ngClassToClass: '[ngClass] → [class]',
  ngStyleToStyle: '[ngStyle] → [style]',
  appConfig: 'app.config.ts + app.routes.ts',
  lazyRoutes: 'Lazy routes → .routes.ts',
  builder: 'Builder → esbuild/Vite',
  polyfills: 'polyfills.ts → inline',
  tsconfig: 'tsconfig ES2022/bundler',
  pathAliases: 'Path aliases (@app, @core…)',
  eslint: 'ESLint via @angular/eslint',
  lintFix: 'ESLint --fix (passo final)',
  sass: 'SCSS @import → @use',
  modules: 'Remove unused modules',
  styleUrl: 'styleUrls → styleUrl',
  selfClosing: 'Self-closing tags',
  cleanupImports: 'Cleanup unused imports',
}

const ALL_STEPS = Object.keys(STEP_LABELS)

interface Props {
  data: MigrationData
  isRunning: boolean
  onStart: () => void
  onStop: () => void
  onDataChange: (data: MigrationData) => void
  onLoadMigration: (data: MigrationData) => void
}

export function ConfigCard({ data, isRunning, onStart, onStop, onLoadMigration }: Props) {
  const [sourcePath, setSourcePath] = useState(() => localStorage.getItem('ng-migrator.sourcePath') ?? '')
  const [targetVersion, setTargetVersion] = useState(() => {
    const v = localStorage.getItem('ng-migrator.targetVersion')
    return v ? parseInt(v) : 21
  })
  const [modernize, setModernize] = useState(() => localStorage.getItem('ng-migrator.modernize') !== 'false')
  const [cleanDest, setCleanDest] = useState(() => localStorage.getItem('ng-migrator.cleanDest') !== 'false')
  const [runAfter, setRunAfter] = useState(() => localStorage.getItem('ng-migrator.runAfter') === 'true')
  const [stepsOpen, setStepsOpen] = useState(false)
  const [selectedSteps, setSelectedSteps] = useState<Set<string>>(new Set(ALL_STEPS))
  const [error, setError] = useState<string | null>(null)
  const [browsing, setBrowsing] = useState(false)
  const [loadPath, setLoadPath] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadBrowsing, setLoadBrowsing] = useState(false)

  useEffect(() => { localStorage.setItem('ng-migrator.sourcePath', sourcePath) }, [sourcePath])
  useEffect(() => { localStorage.setItem('ng-migrator.targetVersion', String(targetVersion)) }, [targetVersion])
  useEffect(() => { localStorage.setItem('ng-migrator.modernize', String(modernize)) }, [modernize])
  useEffect(() => { localStorage.setItem('ng-migrator.cleanDest', String(cleanDest)) }, [cleanDest])
  useEffect(() => { localStorage.setItem('ng-migrator.runAfter', String(runAfter)) }, [runAfter])

  const handleBrowse = async () => {
    setBrowsing(true)
    try {
      const res = await fetch('/api/browse')
      const json = await res.json()
      if (json.path) setSourcePath(json.path)
    } catch {
      // ignore
    } finally {
      setBrowsing(false)
    }
  }

  const handleLoadBrowse = async () => {
    setLoadBrowsing(true)
    try {
      const res = await fetch('/api/browse')
      const json = await res.json()
      if (json.path) setLoadPath(json.path)
    } catch {
      // ignore
    } finally {
      setLoadBrowsing(false)
    }
  }

  const handleLoad = async () => {
    setLoadError(null)
    if (!loadPath.trim()) {
      setLoadError('Enter the migrated project path.')
      return
    }
    try {
      const res = await fetch(`/api/load-migration?path=${encodeURIComponent(loadPath.trim())}`)
      const json = await res.json()
      if (!res.ok) {
        setLoadError(json.error || 'Could not load migration data.')
        return
      }
      onLoadMigration(json)
    } catch {
      setLoadError('Failed to connect to server.')
    }
  }

  const toggleStep = (key: string) => {
    setSelectedSteps((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const handleStart = async () => {
    setError(null)
    if (!sourcePath.trim()) {
      setError('Please enter a source project path.')
      return
    }

    const skippedSteps = ALL_STEPS.filter((s) => !selectedSteps.has(s))

    try {
      const res = await fetch('/api/migrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: sourcePath.trim(),
          to: targetVersion,
          modernize,
          steps: skippedSteps,
          cleanDest,
          runAfter,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error || 'Failed to start migration.')
        return
      }
      onStart()
    } catch {
      setError('Failed to connect to server.')
    }
  }

  const inputBase = cn(
    'w-full bg-[#0F0F1A] border border-[#2A2A45] rounded-[6px] text-text px-[0.65rem] py-[0.45rem]',
    'text-[0.82rem] outline-none transition-colors focus:border-blue',
  )

  return (
    <div className="bg-surface border border-[#2A2A45] rounded-[10px] overflow-hidden shrink-0">
      <div className="bg-surface2 border-b border-[#2A2A45] px-4 py-[0.55rem] flex items-center gap-[0.6rem]">
        <span className="text-[0.72rem] font-bold tracking-[0.07em] uppercase text-[#7070A0]">
          Configuration
        </span>
        {data.sourcePath && (
          <span className="ml-auto bg-red/18 text-red border border-red/30 rounded px-1.75 py-px text-[0.68rem] font-semibold">
            {data.status}
          </span>
        )}
      </div>

      <div className="px-4 py-[0.85rem] flex flex-col gap-3">
        {/* Source path */}
        <div>
          <label className="text-[0.78rem] text-[#7070A0] block mb-1">
            Source project path
          </label>
          <div className="flex gap-1.5">
            <input
              className={cn(inputBase, 'flex-1', isRunning && 'cursor-not-allowed opacity-60')}
              type="text"
              placeholder="/path/to/my-angular-app"
              value={sourcePath}
              onChange={(e) => setSourcePath(e.target.value)}
              disabled={isRunning}
            />
            <button
              onClick={handleBrowse}
              disabled={isRunning || browsing}
              title="Selecionar pasta"
              className={cn(
                'bg-surface2 border border-[#2A2A45] rounded-[6px] px-[0.65rem] text-base flex items-center shrink-0 transition-colors',
                isRunning || browsing ? 'text-[#4A4A70] cursor-not-allowed' : 'text-[#7070A0] cursor-pointer hover:text-text',
              )}
            >
              📁
            </button>
          </div>
        </div>

        {/* Target version */}
        <div>
          <label className="text-[0.78rem] text-[#7070A0] block mb-1">
            Target version
          </label>
          <select
            className={cn(
              'w-full bg-[#0F0F1A] border border-[#2A2A45] rounded-[6px] text-text px-[0.65rem] py-[0.45rem] text-[0.82rem] outline-none transition-colors focus:border-blue',
              isRunning ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
            )}
            value={targetVersion}
            onChange={(e) => setTargetVersion(parseInt(e.target.value))}
            disabled={isRunning}
          >
            {[12, 13, 14, 15, 16, 17, 18, 19, 20, 21].map((v) => (
              <option key={v} value={v}>Angular {v}</option>
            ))}
          </select>
        </div>

        {/* Toggles */}
        {[
          { id: 'modernize', label: 'Run modernization steps', checked: modernize, onChange: setModernize },
          { id: 'cleanDest', label: 'Delete destination folder if it exists', checked: cleanDest, onChange: setCleanDest },
          { id: 'runAfter', label: 'Install & serve after migration', checked: runAfter, onChange: setRunAfter },
        ].map(({ id, label, checked, onChange }) => (
          <div key={id} className="flex items-center gap-2">
            <input
              type="checkbox"
              id={id}
              checked={checked}
              onChange={(e) => onChange(e.target.checked)}
              disabled={isRunning}
              className={cn('accent-red w-3.75 h-3.75', isRunning ? 'cursor-not-allowed' : 'cursor-pointer')}
            />
            <label
              htmlFor={id}
              className={cn('text-[0.82rem] text-text', isRunning ? 'cursor-not-allowed' : 'cursor-pointer')}
            >
              {label}
            </label>
          </div>
        ))}

        {/* Collapsible steps */}
        {modernize && (
          <div>
            <button
              onClick={() => setStepsOpen((o) => !o)}
              disabled={isRunning}
              className={cn(
                'w-full bg-transparent border border-[#2A2A45] rounded-[6px] text-[#7070A0] text-[0.75rem] px-[0.65rem] py-[0.35rem] flex justify-between transition-colors',
                isRunning ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:border-[#3A3A65] hover:text-text',
              )}
            >
              <span>Modernization steps</span>
              <span>{stepsOpen ? '▲' : '▾'}</span>
            </button>
            {stepsOpen && (
              <div className="bg-[#0F0F1A] border border-[#2A2A45] rounded-[6px] px-3 py-2 mt-1 flex flex-col gap-[0.35rem] max-h-55 overflow-y-auto">
                {ALL_STEPS.map((key) => (
                  <label
                    key={key}
                    className={cn(
                      'flex items-center gap-[0.4rem] text-[0.75rem] text-[#B0B0D0]',
                      isRunning ? 'cursor-not-allowed' : 'cursor-pointer',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={selectedSteps.has(key)}
                      onChange={() => toggleStep(key)}
                      disabled={isRunning}
                      className={cn('accent-red w-3.25 h-3.25', isRunning ? 'cursor-not-allowed' : 'cursor-pointer')}
                    />
                    {STEP_LABELS[key]}
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-[#EF5350]/10 border border-[#EF5350]/30 rounded-[6px] px-[0.65rem] py-[0.45rem] text-[0.78rem] text-[#EF5350]">
            {error}
          </div>
        )}

        {/* Start / Stop */}
        {!isRunning ? (
          <button
            onClick={handleStart}
            className="w-full bg-linear-to-br from-[#2E7D32] to-green text-white border-none rounded-[6px] py-[0.6rem] text-[0.88rem] font-semibold cursor-pointer hover:opacity-90 transition-opacity"
          >
            Start Migration
          </button>
        ) : (
          <button
            onClick={onStop}
            className="w-full bg-linear-to-br from-[#C62828] to-[#EF5350] text-white border-none rounded-[6px] py-[0.6rem] text-[0.88rem] font-semibold cursor-pointer hover:opacity-90 transition-opacity"
          >
            Stop
          </button>
        )}

        {/* Destination path info */}
        {data.destPath && (
          <div className="text-[0.72rem] text-[#7070A0] break-all leading-normal">
            <span className="text-text">Destination: </span>
            {data.destPath}
          </div>
        )}

        {/* Load report */}
        {!isRunning && (
          <div className="border-t border-[#2A2A45] pt-3 flex flex-col gap-2">
            <span className="text-[0.72rem] font-bold tracking-[0.07em] uppercase text-[#7070A0]">
              Carregar relatório
            </span>
            <div className="flex gap-1.5">
              <input
                className={cn(inputBase, 'flex-1')}
                type="text"
                placeholder="/path/to/migrated-project"
                value={loadPath}
                onChange={(e) => setLoadPath(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleLoad()}
              />
              <button
                onClick={handleLoadBrowse}
                disabled={loadBrowsing}
                title="Selecionar pasta"
                className={cn(
                  'bg-surface2 border border-[#2A2A45] rounded-[6px] px-[0.65rem] text-base flex items-center shrink-0 transition-colors',
                  loadBrowsing ? 'text-[#4A4A70] cursor-not-allowed' : 'text-[#7070A0] cursor-pointer hover:text-text',
                )}
              >
                📁
              </button>
            </div>
            {loadError && (
              <div className="bg-[#EF5350]/10 border border-[#EF5350]/30 rounded-[6px] px-[0.65rem] py-[0.45rem] text-[0.78rem] text-[#EF5350]">
                {loadError}
              </div>
            )}
            <button
              onClick={handleLoad}
              className="w-full bg-surface2 border border-[#2A2A45] text-[#B0B0D0] rounded-[6px] py-2 text-[0.82rem] font-semibold cursor-pointer hover:border-blue hover:text-blue transition-colors"
            >
              Carregar
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
