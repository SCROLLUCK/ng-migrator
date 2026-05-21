import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { StepDetail } from '../types'
import { StepFileList } from './StepFileList'

interface Props {
  title: string
  files: StepDetail[]
  destPath: string
  onClose: () => void
}

export function FileModal({ title, files, destPath, onClose }: Props) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  useEffect(() => { inputRef.current?.focus() }, [])

  const matchCount = query.trim()
    ? files.filter(f => f.path.toLowerCase().includes(query.toLowerCase())).length
    : files.length

  return createPortal(
    <div
      onClick={onClose}
      className="fixed inset-0 z-1000 bg-black/65 backdrop-blur-[2px] flex items-center justify-center p-[2vh_2vw]"
    >
      <div
        onClick={e => e.stopPropagation()}
        className="bg-surface border border-[#2A2A45] rounded-[12px] w-[80vw] h-[90vh] flex flex-col shadow-[0_24px_64px_rgba(0,0,0,0.6)]"
      >
        <div className="bg-surface2 border-b border-[#2A2A45] rounded-t-[12px] px-4 py-3 flex items-center gap-3 shrink-0">
          <span className="text-[0.72rem] font-bold tracking-[0.07em] uppercase text-[#7070A0]">Files changed</span>
          <span className="text-[0.82rem] text-text font-semibold">{title}</span>
          <span className="bg-blue/12 text-blue border border-blue/25 rounded px-2 py-px text-[0.68rem] font-semibold shrink-0">
            {matchCount}{query ? ` / ${files.length}` : ''} file{files.length !== 1 ? 's' : ''}
          </span>
          <button
            onClick={onClose}
            className="ml-auto bg-transparent border border-[#2A2A45] rounded-[6px] text-[#7070A0] cursor-pointer px-2 py-0.5 text-[0.85rem] leading-none shrink-0 hover:text-text hover:border-[#3A3A65] transition-colors"
            title="Close (Esc)"
          >
            ✕
          </button>
        </div>

        <div className="px-4 py-[0.6rem] border-b border-[#2A2A45] shrink-0">
          <input
            ref={inputRef}
            type="text"
            placeholder="Filter by filename…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="w-full bg-[#0F0F1A] border border-[#2A2A45] rounded-[6px] text-text px-[0.65rem] py-[0.4rem] text-[0.82rem] outline-none font-mono box-border focus:border-blue transition-colors"
          />
        </div>

        <div className="overflow-y-auto overflow-x-hidden flex flex-col">
          <StepFileList files={files} destPath={destPath} query={query} />
        </div>
      </div>
    </div>,
    document.body,
  )
}
