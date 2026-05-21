import { useRef, useState, useEffect } from 'react'
import { cn } from '@/lib/utils'

interface Props {
  lines: string[]
  onClear: () => void
}

export function TerminalCard({ lines, onClear }: Props) {
  const [collapsed, setCollapsed] = useState(false)
  const [pendingLines, setPendingLines] = useState(0)
  const [showBtn, setShowBtn] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const isAtBottomRef = useRef(true)
  const prevLengthRef = useRef(0)

  // Auto-scroll when pinned to bottom; count new lines when user scrolled up
  useEffect(() => {
    const added = lines.length - prevLengthRef.current
    prevLengthRef.current = lines.length

    if (lines.length === 0) {
      setPendingLines(0)
      setShowBtn(false)
      isAtBottomRef.current = true
      return
    }

    if (added <= 0) return

    if (isAtBottomRef.current) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
    } else {
      setPendingLines(n => n + added)
    }
  }, [lines])

  function handleScroll() {
    const el = scrollRef.current
    if (!el) return
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 32
    if (atBottom === isAtBottomRef.current) return
    isAtBottomRef.current = atBottom
    if (atBottom) {
      setShowBtn(false)
      setPendingLines(0)
    } else {
      setShowBtn(true)
    }
  }

  function scrollToBottom() {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
    isAtBottomRef.current = true
    setShowBtn(false)
    setPendingLines(0)
  }

  const btnLabel = pendingLines > 0
    ? `${pendingLines} new line${pendingLines !== 1 ? 's' : ''}`
    : 'Scroll to bottom'

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
        <div className="relative">
          <div
            ref={scrollRef}
            onScroll={handleScroll}
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

          {showBtn && (
            <button
              onClick={scrollToBottom}
              className={cn(
                'absolute bottom-3 right-3 flex items-center gap-1.5 cursor-pointer',
                'bg-[#12122A]/90 border border-blue/35 text-blue rounded-full',
                'text-[0.7rem] font-semibold px-3 py-1 shadow-lg backdrop-blur-sm',
                'hover:bg-blue/10 hover:border-blue/60 transition-colors',
                pendingLines > 0 && 'animate-pulse-custom',
              )}
            >
              {btnLabel}
              <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" className="shrink-0">
                <path d="M5 7.5 1 3h8z" />
              </svg>
            </button>
          )}
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
