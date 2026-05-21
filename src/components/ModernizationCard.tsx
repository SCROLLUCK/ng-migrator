import { Fragment, useState } from 'react'
import type { MigrationData, StepDetail } from '../types'
import { FileModal } from './FileModal'
import { StepFileList } from './StepFileList'
import { cn } from '@/lib/utils'

interface Props {
  data: MigrationData
  query: string
}

type StepStatus = 'done' | 'pending' | 'skipped'

interface StepRow {
  key: string
  label: string
  status: StepStatus
  detail?: string
}

function getStepIcon(status: StepStatus) {
  if (status === 'done') return <span className="text-green">✓</span>
  if (status === 'pending') return <span className="animate-pulse-custom text-amber">◌</span>
  return <span className="opacity-38">–</span>
}

export function ModernizationCard({ data, query = '' }: Props) {
  const [modal, setModal] = useState<{ title: string; files: StepDetail[] } | null>(null)
  const [expandedStep, setExpandedStep] = useState<string | null>(null)

  const m = data.modernize
  const totalModernSteps = Object.keys(data.details).filter((k) => !k.startsWith('ngUpdate_')).length
  const isRunning = data.status === 'running'
  const ngUpdateDone = data.ngUpdateSteps.length > 0
  const q = query.toLowerCase()

  function makeStatus(done: boolean | number | null | undefined, prevDone?: boolean | number | null): StepStatus {
    if (done === true || (typeof done === 'number' && done > 0)) return 'done'
    if (isRunning && ngUpdateDone && (prevDone === true || (typeof prevDone === 'number' && prevDone > 0) || prevDone === undefined)) return 'pending'
    return 'skipped'
  }

  const rows: StepRow[] = [
    { key: 'flexLayout', label: '@angular/flex-layout → Tailwind CSS', status: m.flexLayoutMigrated ? 'done' : 'skipped', detail: m.flexLayoutMigrated ? `${m.flexLayoutMigrated.htmlCount} template(s), ${m.flexLayoutMigrated.tsCount} TS` : undefined },
    { key: 'inject', label: 'inject() — constructor DI → inject()', status: makeStatus(m.inject) },
    { key: 'signals', label: 'Signals — @Input/@Output/@ViewChild → signal APIs', status: makeStatus(m.signals, m.inject) },
    { key: 'untypedForms', label: 'UntypedForm* → typed forms', status: makeStatus(m.untypedFormsFixed, m.signals), detail: m.untypedFormsFixed > 0 ? `${m.untypedFormsFixed} file(s)` : undefined },
    { key: 'throwError', label: 'throwError() → factory function (RxJS 7)', status: makeStatus(m.throwErrorFixed, m.signals), detail: m.throwErrorFixed > 0 ? `${m.throwErrorFixed} file(s)` : undefined },
    { key: 'standalone', label: 'Standalone — convert → prune → bootstrap', status: makeStatus(m.standalone, m.throwErrorFixed !== undefined ? m.throwErrorFixed : m.signals) },
    { key: 'standaloneFixed', label: 'standalone: true patches in pipes/directives', status: makeStatus(m.standaloneFixed, m.standalone), detail: m.standaloneFixed > 0 ? `${m.standaloneFixed} file(s)` : undefined },
    { key: 'controlFlow', label: 'Control flow — @if / @for / @switch', status: makeStatus(m.controlFlow, m.standalone) },
    { key: 'ngClassToClass', label: '[ngClass] → [class]', status: makeStatus(m.ngClassToClass, m.controlFlow) },
    { key: 'ngStyleToStyle', label: '[ngStyle] → [style]', status: makeStatus(m.ngStyleToStyle, m.ngClassToClass) },
    { key: 'appConfig', label: 'app.config.ts + app.routes.ts', status: makeStatus(m.appConfig, m.ngStyleToStyle) },
    { key: 'lazyRoutes', label: 'Lazy NgModules → routes files', status: makeStatus(m.lazyRoutesConverted, m.appConfig), detail: m.lazyRoutesConverted > 0 ? `${m.lazyRoutesConverted} module(s)` : undefined },
    { key: 'builder', label: 'Builder → esbuild / Vite', status: makeStatus(m.builder, m.appConfig) },
    { key: 'polyfills', label: 'polyfills.ts → zone.js inline in angular.json', status: makeStatus(m.polyfillsInlined, m.builder) },
    { key: 'tsconfig', label: 'tsconfig — ES2022 / moduleResolution: bundler', status: makeStatus(m.tsconfigModernized, m.builder) },
    { key: 'pathAliases', label: 'Path aliases — @app / @core / @shared / @features', status: makeStatus(m.pathAliases, m.tsconfigModernized) },
    { key: 'eslint', label: 'ESLint via @angular/eslint', status: makeStatus(m.eslintAdded, m.pathAliases) },
    { key: 'lintFix', label: 'ESLint --fix (final pass)', status: makeStatus((data.details['lintFix'] ?? []).length > 0, m.eslintAdded) },
    { key: 'sass', label: 'SCSS @import → @use as *', status: makeStatus(m.sassImports, m.eslintAdded), detail: m.sassImports > 0 ? `${m.sassImports} file(s)` : undefined },
    { key: 'modules', label: 'Unused .module.ts files removed', status: makeStatus(m.modulesRemoved, m.sassImports), detail: m.modulesRemoved > 0 ? `${m.modulesRemoved} file(s)` : undefined },
    { key: 'styleUrl', label: 'styleUrls: [] → styleUrl (Angular 19)', status: makeStatus(m.styleUrlFixed, m.modulesRemoved), detail: m.styleUrlFixed > 0 ? `${m.styleUrlFixed} file(s)` : undefined },
    { key: 'selfClosing', label: 'Self-closing tags', status: makeStatus(m.selfClosingTags, m.styleUrlFixed) },
    { key: 'cleanupImports', label: 'Cleanup unused component imports', status: makeStatus(m.cleanupImports, m.selfClosingTags) },
  ]

  const visibleRows = rows.filter(row => {
    if (!query.trim()) return true
    const files = data.details[row.key] ?? []
    return files.some(f => f.path.toLowerCase().includes(q))
  })

  function toggleStep(key: string) {
    setExpandedStep(prev => prev === key ? null : key)
  }

  return (
    <>
      {modal && (
        <FileModal
          title={modal.title}
          files={modal.files}
          destPath={data.destPath}
          onClose={() => setModal(null)}
        />
      )}

      <div className="bg-surface border border-[#2A2A45] rounded-[10px] overflow-hidden">
        <div className="bg-surface2 border-b border-[#2A2A45] px-4 py-[0.55rem] flex items-center gap-[0.6rem]">
          <span className="text-[0.72rem] font-bold tracking-[0.07em] uppercase text-[#7070A0]">
            Modernization
          </span>
          <span className="ml-auto text-[0.72rem] text-[#7070A0]">
            {totalModernSteps} steps completed
          </span>
        </div>

        {query.trim() && visibleRows.length === 0 && (
          <div className="px-4 py-3 text-[#4A4A70] text-[0.78rem]">
            No modernization steps matched "{query}".
          </div>
        )}

        <div className="flex flex-col">
          {visibleRows.map((row) => {
            const allFiles = data.details[row.key] ?? []
            const matchFiles = query.trim()
              ? allFiles.filter(f => f.path.toLowerCase().includes(q))
              : allFiles
            const isOpen = expandedStep === row.key
            const hasFiles = allFiles.length > 0

            return (
              <Fragment key={row.key}>
                <div
                  onClick={() => hasFiles && toggleStep(row.key)}
                  className={cn(
                    'flex items-center gap-2 px-4 py-[0.45rem] border-b border-[#2A2A45] transition-colors',
                    row.status === 'skipped' && !query.trim() ? 'opacity-38' : '',
                    hasFiles ? 'cursor-pointer' : '',
                    isOpen ? 'bg-blue/4' : hasFiles ? 'hover:bg-white/3' : '',
                  )}
                >
                  <span className="shrink-0 text-[0.58rem] text-[#3A3A60] w-2.5 text-center">
                    {hasFiles ? (isOpen ? '▼' : '▶') : ''}
                  </span>
                  <span className="text-base w-5 text-center shrink-0">
                    {getStepIcon(row.status)}
                  </span>
                  <span className={cn(
                    'flex-1 text-[0.83rem]',
                    row.status === 'done' ? 'text-green' : row.status === 'pending' ? 'text-amber' : 'text-text',
                  )}>
                    {row.label}
                    {row.detail && (
                      <span className="text-[#7070A0] text-[0.75rem] ml-1.5">({row.detail})</span>
                    )}
                  </span>
                  <span onClick={e => e.stopPropagation()}>
                    {hasFiles && (
                      <button
                        onClick={() => setModal({ title: row.label, files: allFiles })}
                        title="Open in modal"
                        className="border border-blue/20 rounded-[5px] text-blue text-[0.72rem] cursor-pointer px-2 py-0.5 whitespace-nowrap hover:border-blue hover:bg-blue/7 transition-colors"
                      >
                        {query.trim() ? `${matchFiles.length} / ${allFiles.length}` : `${allFiles.length}`} file{allFiles.length !== 1 ? 's' : ''}
                      </button>
                    )}
                  </span>
                </div>
                {isOpen && (
                  <div className="border-b border-[#2A2A45] bg-[#07070F] overflow-hidden">
                    <StepFileList files={matchFiles} destPath={data.destPath} query={query} />
                  </div>
                )}
              </Fragment>
            )
          })}
        </div>
      </div>
    </>
  )
}
