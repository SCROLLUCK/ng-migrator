import { useState } from 'react'
import type { MigrationData, StepDetail } from '../types'
import { FileModal } from './FileModal'
import { cn } from '@/lib/utils'

interface Props {
  data: MigrationData
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

export function ModernizationCard({ data }: Props) {
  const [modal, setModal] = useState<{ title: string; files: StepDetail[] } | null>(null)
  const m = data.modernize
  const totalModernSteps = Object.keys(data.details).filter((k) => !k.startsWith('ngUpdate_')).length
  const isRunning = data.status === 'running'
  const ngUpdateDone = data.ngUpdateSteps.length > 0

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
    { key: 'sass', label: 'SCSS @import → @use as *', status: makeStatus(m.sassImports, m.eslintAdded), detail: m.sassImports > 0 ? `${m.sassImports} file(s)` : undefined },
    { key: 'modules', label: 'Unused .module.ts files removed', status: makeStatus(m.modulesRemoved, m.sassImports), detail: m.modulesRemoved > 0 ? `${m.modulesRemoved} file(s)` : undefined },
    { key: 'styleUrl', label: 'styleUrls: [] → styleUrl (Angular 19)', status: makeStatus(m.styleUrlFixed, m.modulesRemoved), detail: m.styleUrlFixed > 0 ? `${m.styleUrlFixed} file(s)` : undefined },
    { key: 'selfClosing', label: 'Self-closing tags', status: makeStatus(m.selfClosingTags, m.styleUrlFixed) },
    { key: 'cleanupImports', label: 'Cleanup unused component imports', status: makeStatus(m.cleanupImports, m.selfClosingTags) },
  ]

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

        <table className="w-full border-collapse">
          <tbody>
            {rows.map((row) => {
              const files = data.details[row.key] ?? []
              return (
                <tr
                  key={row.key}
                  className={cn('border-b border-[#2A2A45]', row.status === 'skipped' && 'opacity-38')}
                >
                  <td className="w-[2.2rem] text-center px-2 pl-4 py-2 text-base">
                    {getStepIcon(row.status)}
                  </td>
                  <td className={cn(
                    'px-2 py-2 text-[0.83rem]',
                    row.status === 'done' ? 'text-green' : row.status === 'pending' ? 'text-amber' : 'text-text',
                  )}>
                    {row.label}
                    {row.detail && (
                      <span className="text-[#7070A0] text-[0.75rem] ml-1.5">({row.detail})</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {files.length > 0 && (
                      <button
                        onClick={() => setModal({ title: row.label, files })}
                        className="border border-blue/20 rounded-[5px] text-blue text-[0.72rem] cursor-pointer px-2 py-0.5 whitespace-nowrap hover:border-blue hover:bg-blue/7 transition-colors"
                      >
                        {files.length} file{files.length !== 1 ? 's' : ''}
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}
