import type { PeerLog } from '../types'
import { cn } from '@/lib/utils'
import { useTranslation } from '../lib/i18n'

// Há algo de peer-resolution que valha mostrar neste step?
export function hasPeerInfo(peer?: PeerLog): peer is PeerLog {
  if (!peer) return false
  return (
    peer.forced ||
    !!peer.failedNonPeer ||
    peer.prePinned.length > 0 ||
    peer.attempts.some(a => a.kind === 'resolve')
  )
}

// Badge compacto na linha do step.
export function PeerBadge({ peer }: { peer: PeerLog }) {
  const { t } = useTranslation()
  const retries = peer.attempts.filter(a => a.kind === 'resolve').length

  if (peer.forced) {
    return (
      <span className="bg-amber/15 text-amber border border-amber/30 rounded px-1.5 py-px text-[0.66rem] font-semibold whitespace-nowrap">
        ⚡ --force
      </span>
    )
  }
  if (peer.failedNonPeer) {
    return (
      <span className="bg-red/12 text-red border border-red/25 rounded px-1.5 py-px text-[0.66rem] font-semibold whitespace-nowrap">
        ⚠ {t('peerNonPeerFail')}
      </span>
    )
  }
  if (retries > 0 || peer.prePinned.length > 0) {
    return (
      <span className="bg-blue/12 text-blue border border-blue/25 rounded px-1.5 py-px text-[0.66rem] font-semibold whitespace-nowrap">
        ↻ {t('peerResolved', { count: retries + peer.prePinned.length })}
      </span>
    )
  }
  return null
}

// Detalhe expandido: pré-resolução, tentativas e fallback --force.
export function PeerResolutionDetail({ peer }: { peer: PeerLog }) {
  const { t } = useTranslation()

  return (
    <div className="px-4 py-2 text-[0.78rem]">
      <div className="text-[0.65rem] font-bold tracking-widest uppercase text-[#3A3A60] mb-1.5 flex items-center gap-2">
        <span>{t('peerDeps')}</span>
        <span className={cn(
          'normal-case tracking-normal font-semibold rounded px-1.5 py-px text-[0.62rem]',
          peer.strategy === 'force' ? 'bg-amber/12 text-amber' : 'bg-blue/10 text-blue',
        )}>
          {peer.strategy}
        </span>
      </div>

      {/* Versões fixadas via registry antes do update */}
      {peer.prePinned.length > 0 && (
        <div className="mb-2">
          <div className="text-[#7070A0] mb-1">{t('peerPrePinned')}</div>
          <ul className="flex flex-col gap-0.5">
            {peer.prePinned.map(p => (
              <li key={p.name} className="font-mono text-[0.72rem] text-foreground flex items-center gap-1.5 flex-wrap">
                <span className="text-blue">{p.name}</span>
                <span className="text-[#4A4A70]">{p.from}</span>
                <span className="text-[#4A4A70]">→</span>
                <span className="text-green">{p.to}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Tentativas de ng update */}
      {peer.attempts.map((a) => (
        <div key={a.iteration} className="mb-1 flex items-start gap-1.5">
          <span className={cn('shrink-0 text-base leading-none mt-px', a.ok ? 'text-green' : 'text-amber')}>
            {a.ok ? '✓' : '⚠'}
          </span>
          <div className="flex-1">
            <span className="text-[#7070A0]">
              {a.kind === 'initial' ? t('peerInitialAttempt') : t('peerRetry', { n: a.iteration })}
            </span>
            {a.added.length > 0 && (
              <span className="ml-1.5 font-mono text-[0.71rem] text-green break-all">
                + {a.added.join('  ')}
              </span>
            )}
          </div>
        </div>
      ))}

      {/* Falha não relacionada a peer deps (não forçamos) */}
      {peer.failedNonPeer && (
        <div className="mt-2 border-t border-[#2A2A45] pt-2">
          <div className="text-red font-semibold mb-1">⚠ {t('peerNonPeerFailTitle')}</div>
          {peer.failureTail && (
            <pre className="font-mono text-[0.68rem] text-[#9090C0] bg-[#0A0A14] border border-[#2A2A45] rounded p-2 overflow-x-auto whitespace-pre-wrap">
              {peer.failureTail}
            </pre>
          )}
        </div>
      )}

      {/* Fallback --force */}
      {peer.forced && (
        <div className="mt-2 border-t border-[#2A2A45] pt-2">
          <div className="text-amber font-semibold mb-1">⚡ {t('peerForcedFallback')}</div>
          {peer.forcedConflicts.length > 0 && (
            <>
              <div className="text-[#7070A0] mb-0.5">{t('peerForcedConflicts')}</div>
              <ul className="flex flex-col gap-0.5">
                {peer.forcedConflicts.map(name => (
                  <li key={name} className="font-mono text-[0.71rem] text-amber">{name}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  )
}
