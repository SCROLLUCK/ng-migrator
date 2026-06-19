import { createContext, useContext, useState, useMemo, useCallback } from 'react'
import type { ReactNode } from 'react'
import type { MigrationData } from '../types'
import { KnownErrorsModal, type ErrorOccurrence } from './KnownErrorsModal'

interface Ctx { open: (code?: string) => void }
const ErrorModalContext = createContext<Ctx>({ open: () => {} })

/** Qualquer badge de erro chama `open(code?)` para abrir o glossário (focando no código). */
export const useErrorModal = () => useContext(ErrorModalContext)

/** Inverte buildChecks (arquivo → códigos) em código → [{step, arquivo, contagem, linhas}]. */
function buildOccurrences(data: MigrationData): Record<string, ErrorOccurrence[]> {
  const out: Record<string, ErrorOccurrence[]> = {}
  const checks = data.buildChecks ?? {}
  for (const [step, check] of Object.entries(checks)) {
    const ebf = check.errorsByFile ?? {}
    const detail = data.details?.[step] ?? []
    for (const [file, codes] of Object.entries(ebf)) {
      if (!Array.isArray(codes)) continue
      const counts: Record<string, number> = {}
      for (const c of codes) counts[c] = (counts[c] ?? 0) + 1
      const d = detail.find(x => x.path === file)
      for (const [code, count] of Object.entries(counts)) {
        (out[code] ??= []).push({ step, file, count, lines: d?.lines, action: d?.action })
      }
    }
  }
  for (const code of Object.keys(out)) out[code].sort((a, b) => b.count - a.count)
  return out
}

export function ErrorModalProvider({ data, children }: { data: MigrationData; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [focus, setFocus] = useState<string | undefined>(undefined)
  const occurrences = useMemo(() => buildOccurrences(data), [data])
  const openModal = useCallback((code?: string) => { setFocus(code); setOpen(true) }, [])

  return (
    <ErrorModalContext.Provider value={{ open: openModal }}>
      {children}
      {open && (
        <KnownErrorsModal occurrences={occurrences} focusCode={focus} onClose={() => setOpen(false)} />
      )}
    </ErrorModalContext.Provider>
  )
}
