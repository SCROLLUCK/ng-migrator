import type { RefObject } from 'react'
import { useState } from 'react'
import { cn } from '@/lib/utils'

interface Props {
  lines: string[]
  terminalRef: RefObject<HTMLDivElement | null>
  onClear: () => void
}

export function TerminalCard({ lines, terminalRef, onClear }: Props) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div className="bg-surface border border-[#2A2A45] rounded-[10px] overflow-hidden">
      <div className="bg-surface2 border-b border-[#2A2A45] px-4 py-[0.55rem] flex items-center gap-[0.6rem]">
        <span className="text-[0.72rem] font-bold tracking-[0.07em] uppercase text-[#7070A0]">
          Terminal
        </span>
        <span className="text-[0.68rem] text-[#7070A0] ml-1">
          {lines.length} line{lines.length !== 1 ? 's' : ''}
        </span>
        <div className="ml-auto flex gap-2">
          <button
            onClick={onClear}
            className="bg-white/5 border border-[#2A2A45] rounded text-[#7070A0] text-[0.68rem] px-2 py-0.5 cursor-pointer hover:text-text hover:border-[#3A3A65] transition-colors"
          >
            Clear
          </button>
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="bg-white/5 border border-[#2A2A45] rounded text-[#7070A0] text-[0.68rem] px-2 py-0.5 cursor-pointer hover:text-text hover:border-[#3A3A65] transition-colors"
          >
            {collapsed ? 'Expand' : 'Collapse'}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div
          ref={terminalRef}
          className="bg-[#0A0A0A] font-mono text-[0.78rem] leading-[1.55] px-4 py-3 max-h-[40vh] overflow-y-auto text-[#D0D0E0]"
        >
          {lines.length === 0 ? (
            <span className="text-[#3A3A60]">Waiting for output...</span>
          ) : (
            lines.map((line, i) => (
              <div key={i} className="whitespace-pre-wrap break-all">
                {colorize(line)}
              </div>
            ))
          )}
          <span
            className={cn(
              'inline-block w-2 bg-blue opacity-70',
              'h-[1em] align-text-bottom',
              'animate-[blink_1s_step-start_infinite]',
            )}
          />
        </div>
      )}
    </div>
  )
}

function colorize(line: string) {
  const stripped = line.replace(/\x1b\[[0-9;]*m/g, '')

  if (stripped.includes('✅') || stripped.includes('✓') || stripped.includes('done'))
    return <span className="text-green">{stripped}</span>
  if (stripped.includes('❌') || stripped.includes('✘') || stripped.includes('error') || stripped.includes('falhou'))
    return <span className="text-[#EF5350]">{stripped}</span>
  if (stripped.includes('⚠') || stripped.includes('warn'))
    return <span className="text-amber">{stripped}</span>
  if (stripped.startsWith('  $ ') || stripped.startsWith('$ '))
    return <span className="text-blue">{stripped}</span>
  if (stripped.startsWith('  ↳') || stripped.startsWith('↳'))
    return <span className="text-[#B0B0D0]">{stripped}</span>
  if (stripped.startsWith('━'))
    return <span className="text-red">{stripped}</span>
  if (stripped.startsWith('  🔄') || stripped.startsWith('🔄'))
    return <span className="text-amber">{stripped}</span>
  if (stripped.startsWith('  📦') || stripped.startsWith('📦'))
    return <span className="text-blue">{stripped}</span>
  return <span>{stripped}</span>
}
