import { useState, useEffect } from 'react'
import type { MigrationData } from '../types'

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
  lintFix: 'ESLint --fix após cada passo',
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
}

export function ConfigCard({ data, isRunning, onStart, onStop }: Props) {
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

  return (
    <div style={{ background: '#16162A', border: '1px solid #2A2A45', borderRadius: 10, overflow: 'hidden', flexShrink: 0 }}>
      <div style={{ background: '#1E1E35', borderBottom: '1px solid #2A2A45', padding: '0.55rem 1rem', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
        <span style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: '#7070A0' }}>
          Configuration
        </span>
        {data.sourcePath && (
          <span style={{ marginLeft: 'auto', background: 'rgba(221,0,49,0.18)', color: '#DD0031', border: '1px solid rgba(221,0,49,0.3)', borderRadius: 4, fontSize: '0.68rem', fontWeight: 600, padding: '1px 7px' }}>
            {data.status}
          </span>
        )}
      </div>

      <div style={{ padding: '0.85rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {/* Source path */}
        <div>
          <label style={{ fontSize: '0.78rem', color: '#7070A0', display: 'block', marginBottom: 4 }}>
            Source project path
          </label>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              style={{ flex: 1, background: '#0F0F1A', border: '1px solid #2A2A45', borderRadius: 6, color: '#E8E8F0', padding: '0.45rem 0.65rem', fontSize: '0.82rem', outline: 'none' }}
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
              style={{ background: '#1E1E35', border: '1px solid #2A2A45', borderRadius: 6, color: browsing ? '#4A4A70' : '#7070A0', padding: '0 0.65rem', fontSize: '1rem', cursor: isRunning || browsing ? 'default' : 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center' }}
            >
              📁
            </button>
          </div>
        </div>

        {/* Target version */}
        <div>
          <label style={{ fontSize: '0.78rem', color: '#7070A0', display: 'block', marginBottom: 4 }}>
            Target version
          </label>
          <select
            style={{ width: '100%', background: '#0F0F1A', border: '1px solid #2A2A45', borderRadius: 6, color: '#E8E8F0', padding: '0.45rem 0.65rem', fontSize: '0.82rem', outline: 'none', cursor: 'pointer' }}
            value={targetVersion}
            onChange={(e) => setTargetVersion(parseInt(e.target.value))}
            disabled={isRunning}
          >
            {[12, 13, 14, 15, 16, 17, 18, 19, 20, 21].map((v) => (
              <option key={v} value={v}>Angular {v}</option>
            ))}
          </select>
        </div>

        {/* Modernization toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <input
            type="checkbox"
            id="modernize-check"
            checked={modernize}
            onChange={(e) => setModernize(e.target.checked)}
            disabled={isRunning}
            style={{ accentColor: '#DD0031', width: 15, height: 15, cursor: 'pointer' }}
          />
          <label htmlFor="modernize-check" style={{ fontSize: '0.82rem', color: '#E8E8F0', cursor: 'pointer' }}>
            Run modernization steps
          </label>
        </div>

        {/* Clean destination toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <input
            type="checkbox"
            id="clean-dest-check"
            checked={cleanDest}
            onChange={(e) => setCleanDest(e.target.checked)}
            disabled={isRunning}
            style={{ accentColor: '#DD0031', width: 15, height: 15, cursor: 'pointer' }}
          />
          <label htmlFor="clean-dest-check" style={{ fontSize: '0.82rem', color: '#E8E8F0', cursor: 'pointer' }}>
            Delete destination folder if it exists
          </label>
        </div>

        {/* Run after toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <input
            type="checkbox"
            id="run-after-check"
            checked={runAfter}
            onChange={(e) => setRunAfter(e.target.checked)}
            disabled={isRunning}
            style={{ accentColor: '#DD0031', width: 15, height: 15, cursor: 'pointer' }}
          />
          <label htmlFor="run-after-check" style={{ fontSize: '0.82rem', color: '#E8E8F0', cursor: 'pointer' }}>
            Install &amp; serve after migration
          </label>
        </div>

        {/* Collapsible steps */}
        {modernize && (
          <div>
            <button
              onClick={() => setStepsOpen((o) => !o)}
              style={{ background: 'none', border: '1px solid #2A2A45', borderRadius: 6, color: '#7070A0', fontSize: '0.75rem', padding: '0.35rem 0.65rem', cursor: 'pointer', width: '100%', textAlign: 'left', display: 'flex', justifyContent: 'space-between' }}
              disabled={isRunning}
            >
              <span>Modernization steps</span>
              <span>{stepsOpen ? '▲' : '▾'}</span>
            </button>
            {stepsOpen && (
              <div style={{ background: '#0F0F1A', border: '1px solid #2A2A45', borderRadius: 6, padding: '0.5rem 0.75rem', marginTop: 4, display: 'flex', flexDirection: 'column', gap: '0.35rem', maxHeight: '220px', overflowY: 'auto' }}>
                {ALL_STEPS.map((key) => (
                  <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem', color: '#B0B0D0', cursor: isRunning ? 'default' : 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={selectedSteps.has(key)}
                      onChange={() => toggleStep(key)}
                      disabled={isRunning}
                      style={{ accentColor: '#DD0031', width: 13, height: 13 }}
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
          <div style={{ background: 'rgba(239,83,80,0.1)', border: '1px solid rgba(239,83,80,0.3)', borderRadius: 6, padding: '0.45rem 0.65rem', fontSize: '0.78rem', color: '#EF5350' }}>
            {error}
          </div>
        )}

        {/* Buttons */}
        {!isRunning ? (
          <button
            onClick={handleStart}
            style={{ background: 'linear-gradient(135deg, #2E7D32, #4CAF50)', color: '#fff', border: 'none', borderRadius: 6, padding: '0.6rem 1rem', fontSize: '0.88rem', fontWeight: 600, cursor: 'pointer', width: '100%' }}
          >
            Start Migration
          </button>
        ) : (
          <button
            onClick={onStop}
            style={{ background: 'linear-gradient(135deg, #C62828, #EF5350)', color: '#fff', border: 'none', borderRadius: 6, padding: '0.6rem 1rem', fontSize: '0.88rem', fontWeight: 600, cursor: 'pointer', width: '100%' }}
          >
            Stop
          </button>
        )}

        {/* Current dest info */}
        {data.destPath && (
          <div style={{ fontSize: '0.72rem', color: '#7070A0', wordBreak: 'break-all', lineHeight: 1.5 }}>
            <span style={{ color: '#E8E8F0' }}>Destination: </span>
            {data.destPath}
          </div>
        )}
      </div>
    </div>
  )
}
