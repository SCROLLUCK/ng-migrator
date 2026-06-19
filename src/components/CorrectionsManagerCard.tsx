import { useState, useEffect, useCallback, useRef } from 'react'
import { cn } from '@/lib/utils'
import { useTranslation } from '../lib/i18n'
import { Wrench, Upload, RefreshCw } from 'lucide-react'

interface AvailableCorrection {
  name: string
  description: string
  trigger: 'error-driven' | 'proactive'
}

const TRIGGER_STYLE: Record<string, string> = {
  'error-driven': 'bg-blue/15 text-blue border-blue/30',
  proactive: 'bg-amber/15 text-amber border-amber/30',
}

export function CorrectionsManagerCard() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<AvailableCorrection[]>([])
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const [unavailable, setUnavailable] = useState(false)
  const load = useCallback(async () => {
    setLoading(true)
    setUnavailable(false)
    try {
      const res = await fetch('/api/corrections')
      const ct = res.headers.get('content-type') || ''
      // Servidor antigo (sem o endpoint) devolve o index.html → não é JSON.
      if (!res.ok || !ct.includes('application/json')) { setUnavailable(true); return }
      const json = await res.json()
      setItems(json.corrections ?? [])
    } catch {
      setUnavailable(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { if (open && items.length === 0) load() }, [open, items.length, load])

  const handleFile = useCallback(async (file: File) => {
    setMsg(null)
    try {
      const content = await file.text()
      const res = await fetch('/api/corrections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, content }),
      })
      const json = await res.json()
      if (!res.ok) {
        setMsg({ kind: 'err', text: json.error || t('uploadFailed') })
        return
      }
      setMsg({ kind: 'ok', text: `${json.name} (${json.trigger}) ✓` })
      load()
    } catch {
      setMsg({ kind: 'err', text: t('uploadFailed') })
    }
  }, [load, t])

  return (
    <div className="bg-surface border border-[#2A2A45] rounded-[10px] overflow-hidden shrink-0">
      <div
        onClick={() => setOpen(o => !o)}
        className="bg-surface2 border-b border-[#2A2A45] px-4 py-[0.55rem] flex items-center gap-[0.6rem] cursor-pointer hover:bg-white/3 transition-colors"
      >
        <Wrench className="size-3.5 text-green" />
        <span className="text-[0.72rem] font-bold tracking-[0.07em] uppercase text-muted">
          {t('correctionsLibrary')}
        </span>
        {items.length > 0 && (
          <span className="bg-green/18 text-green border border-green/30 rounded px-1.75 py-px text-[0.68rem] font-semibold">
            {items.length}
          </span>
        )}
        <span className="ml-auto text-[0.58rem] text-[#3A3A60] w-2.5 text-center">{open ? '▼' : '▶'}</span>
      </div>

      {open && (
        <div className="flex flex-col gap-2 px-4 py-3">
          <p className="text-[0.72rem] text-muted -mt-0.5">{t('correctionsLibraryHint')}</p>

          {loading && <p className="text-[0.74rem] text-muted">…</p>}
          {!loading && unavailable && (
            <div className="border border-amber/30 bg-amber/8 text-amber rounded-md px-3 py-2 text-[0.74rem] wrap-break-word">
              {t('correctionsUnavailable')}
            </div>
          )}
          {!loading && !unavailable && items.map(c => (
            <div key={c.name} className="border border-[#2A2A45] bg-[#0F0F1A] rounded-md px-3 py-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-[0.76rem] text-text font-semibold">{c.name}</span>
                <span className={cn('rounded px-1.5 py-px text-[0.62rem] font-semibold border', TRIGGER_STYLE[c.trigger])}>
                  {c.trigger}
                </span>
              </div>
              {c.description && <p className="text-[0.72rem] text-[#9090C0] mt-0.5 wrap-break-word">{c.description}</p>}
            </div>
          ))}

          <div className="flex items-center gap-2 mt-1">
            <input
              ref={fileRef}
              type="file"
              accept=".mjs"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.currentTarget.value = '' }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-1.5 text-[0.78rem] text-green border border-green/30 bg-green/10 hover:bg-green/18 rounded-md px-2.5 py-1.5 cursor-pointer transition-colors"
            >
              <Upload className="size-3.5" /> {t('uploadCorrection')}
            </button>
            <button
              onClick={load}
              className="inline-flex items-center text-muted hover:text-text rounded-md p-1.5 cursor-pointer transition-colors"
              title={t('refresh')}
            >
              <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
            </button>
          </div>

          {msg && (
            <div className={cn(
              'border rounded-md px-3 py-2 text-[0.76rem] wrap-break-word',
              msg.kind === 'ok' ? 'border-green/30 bg-green/8 text-green' : 'border-red/30 bg-red/8 text-red',
            )}>
              {msg.text}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
