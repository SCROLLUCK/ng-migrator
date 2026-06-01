import { createContext, useContext, useState, useEffect } from 'react'
import type { ReactNode } from 'react'

export type Language = 'en' | 'pt'

export const translations = {
  en: {
    // App Header / Status
    appTitle: 'ng-migrator',
    appSubtitle: 'Angular migration tool',
    statusRunning: 'Running',
    statusServing: 'Serving',
    statusDone: 'Done',
    statusError: 'Error',
    statusIdle: 'Idle',
    reportLoaded: 'Report loaded',
    closeReport: 'Close report',

    // Config Card
    configTitle: 'Configuration',
    sourceProjectPath: 'Source project path',
    targetVersion: 'Target version',
    migrationStrategy: 'Migration Strategy',
    singleFolder: 'Single target folder (Default)',
    splitVersions: 'Separate folders by version',
    runModernization: 'Run modernization steps',
    deleteDestFolder: 'Delete destination folder if it exists',
    installServe: 'Install & serve after migration',
    ngUpdateChecks: 'Run build check after each ng update step (slower)',
    forcePeerDeps: 'Force peer deps (skip compatible-version resolution, use --force)',
    peerDeps: 'Peer dependencies',
    peerResolved: '{{count}} resolved',
    peerResolved_plural: '{{count}} resolved',
    peerPrePinned: 'Pre-resolved via registry:',
    peerInitialAttempt: 'Initial attempt',
    peerRetry: 'Retry {{n}}',
    peerForcedFallback: 'Forced fallback (--force)',
    peerForcedConflicts: 'No compatible version found — forced:',
    peerNonPeerFail: 'failed (non-peer)',
    peerNonPeerFailTitle: 'ng update failed for a non-peer reason — not forced',
    notesTitle: 'Notes / manual actions',
    notesSubtitle: 'Items the migrator could not resolve generically — review and apply manually.',
    modernizationTitle: 'Modernization',
    modernizationSteps: 'Modernization steps',
    startMigration: 'Start Migration',
    stop: 'Stop',
    destination: 'Destination',
    loadReport: 'Load report',
    load: 'Load',
    enterMigratedPath: 'Enter the migrated project path.',
    couldNotLoadMigration: 'Could not load migration data.',
    failedConnectServer: 'Failed to connect to server.',
    enterSourcePath: 'Please enter a source project path.',
    failedStartMigration: 'Failed to start migration.',
    selectFolder: 'Select folder',

    // Terminal
    terminalTitle: 'Terminal',
    terminalLines: '{{count}} line',
    terminalLines_plural: '{{count}} lines',
    terminalNewLines: '{{count}} new line',
    terminalNewLines_plural: '{{count}} new lines',
    clear: 'Clear',
    expand: 'Expand',
    collapse: 'Collapse',
    scrollToBottom: 'Scroll to bottom',
    waitingOutput: 'Waiting for output...',

    // NgUpdate / Modernization
    versions: '{{count}} version',
    versions_plural: '{{count}} versions',
    complete: 'complete',
    noNgUpdateMatched: 'No ng update steps matched "{{query}}".',
    noModernizationMatched: 'No modernization steps matched "{{query}}".',
    warnings: 'warnings',
    buildCheck: 'Build check',
    filesCount: '{{count}} file',
    filesCount_plural: '{{count}} files',
    modulesCount: '{{count}} module',
    modulesCount_plural: '{{count}} modules',
    openModal: 'Open in modal',
    stepsCompleted: '{{count}} step completed',
    stepsCompleted_plural: '{{count}} steps completed',

    // Build Check Views
    buildClean: 'Clean build after this step.',
    buildNoChange: '{{count}} error(s) — no changes from previous step.',
    introduced: 'Introduced',
    resolved: 'Resolved',
    totalErrorsAfterStep: '{{count}} total error(s) after this step.',
    errorsCount: '{{count}} err',
    errorsCount_plural: '{{count}} errs',
    fixedCount: '-{{count}} fixed',
    fixedCount_plural: '-{{count}} fixed',

    // Step File List
    noFilesFound: 'No files found.',
    openVSCode: 'Open in VS Code',

    // File Modal
    filesChanged: 'Files changed',
    filterByFilename: 'Filter by filename…',
    closeEsc: 'Close (Esc)',

    // Diff Panel
    diff: 'Diff',
    before: 'Before',
    after: 'After',
    excerpt: 'excerpt',
    loading: 'Loading…',
    noDiffAvailable: 'No diff available.',
  },
  pt: {
    // App Header / Status
    appTitle: 'ng-migrator',
    appSubtitle: 'Ferramenta de migração Angular',
    statusRunning: 'Executando',
    statusServing: 'Servindo',
    statusDone: 'Concluído',
    statusError: 'Erro',
    statusIdle: 'Ocioso',
    reportLoaded: 'Relatório carregado',
    closeReport: 'Fechar relatório',

    // Config Card
    configTitle: 'Configuração',
    sourceProjectPath: 'Caminho do projeto de origem',
    targetVersion: 'Versão de destino',
    migrationStrategy: 'Estratégia de Migração',
    singleFolder: 'Pasta única de destino (Padrão)',
    splitVersions: 'Pastas separadas por versão',
    runModernization: 'Executar passos de modernização',
    deleteDestFolder: 'Excluir pasta de destino se ela existir',
    installServe: 'Instalar e servir após a migração',
    ngUpdateChecks: 'Build check após cada ng update (mais lento)',
    forcePeerDeps: 'Forçar peer deps (pula resolução de versão compatível, usa --force)',
    peerDeps: 'Peer dependencies',
    peerResolved: '{{count}} resolvido',
    peerResolved_plural: '{{count}} resolvidos',
    peerPrePinned: 'Pré-resolvido via registry:',
    peerInitialAttempt: 'Tentativa inicial',
    peerRetry: 'Retry {{n}}',
    peerForcedFallback: 'Fallback forçado (--force)',
    peerForcedConflicts: 'Sem versão compatível — forçado:',
    peerNonPeerFail: 'falhou (não-peer)',
    peerNonPeerFailTitle: 'ng update falhou por motivo não-peer — não forçado',
    notesTitle: 'Notas / ações manuais',
    notesSubtitle: 'Itens que o migrador não resolveu de forma genérica — revise e aplique manualmente.',
    modernizationTitle: 'Modernização',
    modernizationSteps: 'Passos de modernização',
    startMigration: 'Iniciar Migração',
    stop: 'Parar',
    destination: 'Destino',
    loadReport: 'Carregar relatório',
    load: 'Carregar',
    enterMigratedPath: 'Digite o caminho do projeto migrado.',
    couldNotLoadMigration: 'Não foi possível carregar os dados da migração.',
    failedConnectServer: 'Falha ao conectar ao servidor.',
    enterSourcePath: 'Por favor, insira o caminho do projeto de origem.',
    failedStartMigration: 'Falha ao iniciar a migração.',
    selectFolder: 'Selecionar pasta',

    // Terminal
    terminalTitle: 'Terminal',
    terminalLines: '{{count}} linha',
    terminalLines_plural: '{{count}} linhas',
    terminalNewLines: '{{count}} nova linha',
    terminalNewLines_plural: '{{count}} novas linhas',
    clear: 'Limpar',
    expand: 'Expandir',
    collapse: 'Recolher',
    scrollToBottom: 'Rolar para o final',
    waitingOutput: 'Aguardando saída...',

    // NgUpdate / Modernization
    versions: '{{count}} versão',
    versions_plural: '{{count}} versões',
    complete: 'concluído',
    noNgUpdateMatched: 'Nenhum passo de ng update correspondeu a "{{query}}".',
    noModernizationMatched: 'Nenhum passo de modernização correspondeu a "{{query}}".',
    warnings: 'avisos',
    buildCheck: 'Verificação de build',
    filesCount: '{{count}} arquivo',
    filesCount_plural: '{{count}} arquivos',
    modulesCount: '{{count}} módulo',
    modulesCount_plural: '{{count}} módulos',
    openModal: 'Abrir no modal',
    stepsCompleted: '{{count}} passo concluído',
    stepsCompleted_plural: '{{count}} passos concluídos',

    // Build Check Views
    buildClean: 'Build limpo após este step.',
    buildNoChange: '{{count}} erro(s) — sem mudança em relação ao step anterior.',
    introduced: 'Introduzidos',
    resolved: 'Resolvidos',
    totalErrorsAfterStep: '{{count}} erro(s) total após este step.',
    errorsCount: '{{count}} erro',
    errorsCount_plural: '{{count}} erros',
    fixedCount: '-{{count}} corrigido',
    fixedCount_plural: '-{{count}} corrigidos',

    // Step File List
    noFilesFound: 'Nenhum arquivo encontrado.',
    openVSCode: 'Abrir no VS Code',

    // File Modal
    filesChanged: 'Arquivos alterados',
    filterByFilename: 'Filtrar por nome do arquivo…',
    closeEsc: 'Fechar (Esc)',

    // Diff Panel
    diff: 'Diff',
    before: 'Antes',
    after: 'Depois',
    excerpt: 'trecho',
    loading: 'Carregando…',
    noDiffAvailable: 'Nenhum diff disponível.',
  }
}

export type TranslationKey = keyof typeof translations.en

interface I18nContextType {
  language: Language
  setLanguage: (lang: Language) => void
  t: (key: TranslationKey, variables?: Record<string, string | number>) => string
}

const I18nContext = createContext<I18nContextType | undefined>(undefined)

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(() => {
    const saved = localStorage.getItem('ng-migrator.lang')
    if (saved === 'en' || saved === 'pt') return saved
    return 'en'
  })

  useEffect(() => {
    localStorage.setItem('ng-migrator.lang', language)
  }, [language])

  function t(key: TranslationKey, variables?: Record<string, string | number>): string {
    let text = translations[language][key] || translations['en'][key] || ''

    // Simple Pluralization check if variables has "count"
    if (variables && 'count' in variables && typeof variables.count === 'number' && variables.count !== 1) {
      const pluralKey = `${key}_plural` as TranslationKey
      if (translations[language][pluralKey]) {
        text = translations[language][pluralKey]
      } else if (translations['en'][pluralKey]) {
        text = translations['en'][pluralKey]
      }
    }

    if (variables) {
      Object.entries(variables).forEach(([k, v]) => {
        text = text.replace(new RegExp(`{{${k}}}`, 'g'), String(v))
      })
    }
    return text
  }

  return (
    <I18nContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useTranslation() {
  const context = useContext(I18nContext)
  if (!context) {
    throw new Error('useTranslation must be used within a LanguageProvider')
  }
  return context
}
