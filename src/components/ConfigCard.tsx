import { useState, useEffect } from 'react'
import type { MigrationData } from '../types'
import { cn } from '@/lib/utils'
import { useTranslation } from '../lib/i18n'
import { FolderOpen, ChevronDown, ChevronUp, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const STEP_LABELS: Record<string, string> = {
  flexLayout: '@angular/flex-layout → Tailwind CSS',
  inject: 'inject() — constructor DI',
  signals: 'Signals — @Input/@Output/@ViewChild',
  reservedKeywords: 'Reserved keyword variables (const for → forValue)',
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
  const { t } = useTranslation()
  const [sourcePath, setSourcePath] = useState(() => localStorage.getItem('ng-migrator.sourcePath') ?? '')
  const [targetVersion, setTargetVersion] = useState(() => {
    const v = localStorage.getItem('ng-migrator.targetVersion')
    return v ? parseInt(v) : 21
  })
  const [modernize, setModernize] = useState(() => localStorage.getItem('ng-migrator.modernize') !== 'false')
  const [cleanDest, setCleanDest] = useState(() => localStorage.getItem('ng-migrator.cleanDest') !== 'false')
  const [runAfter, setRunAfter] = useState(() => localStorage.getItem('ng-migrator.runAfter') === 'true')
  const [splitVersions, setSplitVersions] = useState(() => localStorage.getItem('ng-migrator.splitVersions') === 'true')
  const [ngUpdateChecks, setNgUpdateChecks] = useState(() => localStorage.getItem('ng-migrator.ngUpdateChecks') === 'true')
  // 'resolve' (default): resolve compatible versions via registry; 'force': skip resolution, use --force
  const [forcePeerDeps, setForcePeerDeps] = useState(() => localStorage.getItem('ng-migrator.forcePeerDeps') === 'true')
  const [stepsOpen, setStepsOpen] = useState(false)
  const [selectedSteps, setSelectedSteps] = useState<Set<string>>(new Set(ALL_STEPS))
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [browsing, setBrowsing] = useState(false)
  const [loadPath, setLoadPath] = useState(() => localStorage.getItem('ng-migrator.loadPath') ?? '')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadBrowsing, setLoadBrowsing] = useState(false)

  useEffect(() => { localStorage.setItem('ng-migrator.sourcePath', sourcePath) }, [sourcePath])
  useEffect(() => { localStorage.setItem('ng-migrator.targetVersion', String(targetVersion)) }, [targetVersion])
  useEffect(() => { localStorage.setItem('ng-migrator.modernize', String(modernize)) }, [modernize])
  useEffect(() => { localStorage.setItem('ng-migrator.cleanDest', String(cleanDest)) }, [cleanDest])
  useEffect(() => { localStorage.setItem('ng-migrator.runAfter', String(runAfter)) }, [runAfter])
  useEffect(() => { localStorage.setItem('ng-migrator.splitVersions', String(splitVersions)) }, [splitVersions])
  useEffect(() => { localStorage.setItem('ng-migrator.ngUpdateChecks', String(ngUpdateChecks)) }, [ngUpdateChecks])
  useEffect(() => { localStorage.setItem('ng-migrator.forcePeerDeps', String(forcePeerDeps)) }, [forcePeerDeps])
  useEffect(() => { localStorage.setItem('ng-migrator.loadPath', loadPath) }, [loadPath])

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
      setLoadError(t('enterMigratedPath'))
      return
    }
    try {
      const res = await fetch(`/api/load-migration?path=${encodeURIComponent(loadPath.trim())}`)
      const json = await res.json()
      if (!res.ok) {
        setLoadError(json.error || t('couldNotLoadMigration'))
        return
      }
      onLoadMigration(json)
    } catch {
      setLoadError(t('failedConnectServer'))
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
      setError(t('enterSourcePath'))
      return
    }

    const skippedSteps = ALL_STEPS.filter((s) => !selectedSteps.has(s))

    setStarting(true)
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
          splitVersions,
          ngUpdateChecks,
          peerStrategy: forcePeerDeps ? 'force' : 'resolve',
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error || t('failedStartMigration'))
        return
      }
      onStart()
    } catch {
      setError(t('failedConnectServer'))
    } finally {
      setStarting(false)
    }
  }

  const labelCls = 'text-[0.78rem] text-[#7070A0] block mb-1'

  return (
    <div className="bg-surface border border-[#2A2A45] rounded-[10px] overflow-hidden shrink-0">
      <div className="bg-surface2 border-b border-[#2A2A45] px-4 py-[0.55rem] flex items-center gap-[0.6rem]">
        <span className="text-[0.72rem] font-bold tracking-[0.07em] uppercase text-[#7070A0]">
          {t('configTitle')}
        </span>
        {data.sourcePath && (
          <span className="ml-auto bg-red/18 text-red border border-red/30 rounded px-1.75 py-px text-[0.68rem] font-semibold">
            {t(data.status === 'running' ? 'statusRunning' : data.status === 'serving' ? 'statusServing' : data.status === 'done' ? 'statusDone' : data.status === 'error' ? 'statusError' : 'statusIdle')}
          </span>
        )}
      </div>

      <div className="px-4 py-[0.85rem] flex flex-col gap-3">
        {/* Source path */}
        <div>
          <label className={labelCls}>{t('sourceProjectPath')}</label>
          <div className="flex gap-1.5">
            <Input
              className="flex-1"
              type="text"
              placeholder="/path/to/my-angular-app"
              value={sourcePath}
              onChange={(e) => setSourcePath(e.target.value)}
              disabled={isRunning}
            />
            <Button
              variant="outline"
              size="icon"
              onClick={handleBrowse}
              disabled={isRunning || browsing}
              title={t('selectFolder')}
            >
              <FolderOpen className="size-4" />
            </Button>
          </div>
        </div>

        {/* Target version */}
        <div>
          <label className={labelCls}>{t('targetVersion')}</label>
          <Select
            value={String(targetVersion)}
            onValueChange={(v) => v && setTargetVersion(parseInt(v))}
            disabled={isRunning}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t('targetVersion')} />
            </SelectTrigger>
            <SelectContent>
              {[12, 13, 14, 15, 16, 17, 18, 19, 20, 21].map((v) => (
                <SelectItem key={v} value={String(v)}>Angular {v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Migration Strategy */}
        <div>
          <label className="text-[0.78rem] text-[#7070A0] block mb-1.5">
            {t('migrationStrategy')}
          </label>
          <RadioGroup
            value={splitVersions ? 'split' : 'single'}
            onValueChange={(v) => setSplitVersions(v === 'split')}
            disabled={isRunning}
            className="gap-2 bg-[#0F0F1A] border border-[#2A2A45] rounded-[6px] p-2.5"
          >
            <label className={cn('flex items-center gap-2 text-[0.82rem] text-text', isRunning ? 'cursor-not-allowed opacity-60' : 'cursor-pointer')}>
              <RadioGroupItem value="single" disabled={isRunning} />
              <span>{t('singleFolder')}</span>
            </label>
            <label className={cn('flex items-center gap-2 text-[0.82rem] text-text', isRunning ? 'cursor-not-allowed opacity-60' : 'cursor-pointer')}>
              <RadioGroupItem value="split" disabled={isRunning} />
              <span>{t('splitVersions')}</span>
            </label>
          </RadioGroup>
        </div>

        {/* Toggles */}
        {[
          { id: 'modernize', label: t('runModernization'), checked: modernize, onChange: setModernize },
          { id: 'cleanDest', label: t('deleteDestFolder'), checked: cleanDest, onChange: setCleanDest },
          { id: 'runAfter', label: t('installServe'), checked: runAfter, onChange: setRunAfter },
          { id: 'ngUpdateChecks', label: t('ngUpdateChecks'), checked: ngUpdateChecks, onChange: setNgUpdateChecks },
          { id: 'forcePeerDeps', label: t('forcePeerDeps'), checked: forcePeerDeps, onChange: setForcePeerDeps },
        ].map(({ id, label, checked, onChange }) => (
          <label
            key={id}
            htmlFor={id}
            className={cn('flex items-center gap-2 text-[0.82rem] text-text', isRunning ? 'cursor-not-allowed opacity-60' : 'cursor-pointer')}
          >
            <Checkbox
              id={id}
              checked={checked}
              onCheckedChange={(c) => onChange(!!c)}
              disabled={isRunning}
            />
            {label}
          </label>
        ))}

        {/* Collapsible steps */}
        {modernize && (
          <div>
            <Button
              variant="outline"
              onClick={() => setStepsOpen((o) => !o)}
              disabled={isRunning}
              className="w-full justify-between text-[#7070A0] text-[0.75rem]"
            >
              <span>{t('modernizationSteps')}</span>
              {stepsOpen ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            </Button>
            {stepsOpen && (
              <div className="bg-[#0F0F1A] border border-[#2A2A45] rounded-[6px] px-3 py-2 mt-1 flex flex-col gap-2 max-h-55 overflow-y-auto">
                {ALL_STEPS.map((key) => (
                  <label
                    key={key}
                    className={cn(
                      'flex items-center gap-2 text-[0.75rem] text-[#B0B0D0]',
                      isRunning ? 'cursor-not-allowed' : 'cursor-pointer',
                    )}
                  >
                    <Checkbox
                      checked={selectedSteps.has(key)}
                      onCheckedChange={() => toggleStep(key)}
                      disabled={isRunning}
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
          <div className="bg-red/10 border border-red/30 rounded-[6px] px-[0.65rem] py-[0.45rem] text-[0.78rem] text-red">
            {error}
          </div>
        )}

        {/* Start / Stop */}
        {!isRunning ? (
          <Button
            onClick={handleStart}
            disabled={starting}
            size="lg"
            className="w-full bg-linear-to-br from-[#2E7D32] to-green text-white font-semibold hover:opacity-90 disabled:opacity-70"
          >
            {starting ? (
              <><LoaderCircle className="size-4 animate-spin" /> {t('startingMigration')}</>
            ) : (
              t('startMigration')
            )}
          </Button>
        ) : (
          <Button
            onClick={onStop}
            size="lg"
            className="w-full bg-linear-to-br from-[#C62828] to-[#EF5350] text-white font-semibold hover:opacity-90"
          >
            {t('stop')}
          </Button>
        )}

        {/* Destination path info */}
        {data.destPath && (
          <div className="text-[0.72rem] text-[#7070A0] break-all leading-normal">
            <span className="text-text">{t('destination')}: </span>
            {data.destPath}
          </div>
        )}

        {/* Load report */}
        {!isRunning && (
          <div className="border-t border-[#2A2A45] pt-3 flex flex-col gap-2">
            <span className="text-[0.72rem] font-bold tracking-[0.07em] uppercase text-[#7070A0]">
              {t('loadReport')}
            </span>
            <div className="flex gap-1.5">
              <Input
                className="flex-1"
                type="text"
                placeholder="/path/to/migrated-project"
                value={loadPath}
                onChange={(e) => setLoadPath(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleLoad()}
              />
              <Button
                variant="outline"
                size="icon"
                onClick={handleLoadBrowse}
                disabled={loadBrowsing}
                title={t('selectFolder')}
              >
                <FolderOpen className="size-4" />
              </Button>
            </div>
            {loadError && (
              <div className="bg-red/10 border border-red/30 rounded-[6px] px-[0.65rem] py-[0.45rem] text-[0.78rem] text-red">
                {loadError}
              </div>
            )}
            <Button variant="outline" onClick={handleLoad} className="w-full">
              {t('load')}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
