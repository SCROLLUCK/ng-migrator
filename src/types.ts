export interface StepDetail {
  path: string;
  action: 'created' | 'modified' | 'deleted';
  lines: number[];
  h0?: string;
  h1?: string;
}

export interface BuildCheck {
  total: number;
  new: string[];
  fixed: string[];
  errorsByFile?: Record<string, number | string[]>;
}

export interface PeerPin {
  name: string;
  from: string;
  to: string;
}

export interface PeerAttempt {
  iteration: number;
  kind: 'initial' | 'resolve';
  added: string[];      // pacotes (com versão resolvida) incluídos nesta tentativa
  ok: boolean;
}

export interface PeerLog {
  strategy: 'resolve' | 'force';
  prePinned: PeerPin[];        // libs fixadas antes do update (pinCompatibleThirdParty)
  attempts: PeerAttempt[];     // tentativas de ng update (inicial + retries)
  forced: boolean;             // houve fallback --force?
  forcedConflicts: string[];   // pacotes ainda em conflito no momento do --force
  failedNonPeer?: boolean;     // ng update falhou por motivo NÃO relacionado a peer deps
  failureTail?: string;        // cauda do output quando failedNonPeer (diagnóstico)
}

export interface NgUpdateStep {
  version: number;
  ok: boolean;
  peer?: PeerLog;
}

export interface MigrationData {
  status: 'idle' | 'running' | 'done' | 'error' | 'serving';
  sourceVersion: number | null;
  targetVersion: number;
  sourcePath: string;
  destPath: string;
  date: string;
  ngUpdateSteps: NgUpdateStep[];
  modernize: {
    flexLayoutMigrated: { htmlCount: number; tsCount: number } | null;
    inject: boolean;
    signals: boolean;
    reservedKeywordsFixed: number;
    untypedFormsFixed: number;
    throwErrorFixed: number;
    standalone: boolean;
    standaloneFixed: number;
    controlFlow: boolean;
    ngClassToClass: boolean;
    ngStyleToStyle: boolean;
    appConfig: boolean;
    appRoutes: boolean;
    lazyRoutesConverted: number;
    mainSimplified: boolean;
    builder: boolean;
    polyfillsInlined: boolean;
    tsconfigModernized: boolean;
    pathAliases: boolean;
    eslintAdded: boolean;
    lintFixed: number;
    sassImports: number;
    modulesRemoved: number;
    styleUrlFixed: number;
    selfClosingTags: boolean;
    cleanupImports: boolean;
  };
  details: Record<string, StepDetail[]>;
  buildChecks?: Record<string, BuildCheck>;
  notes: string[];
  skippedSteps?: string[];
  filesCreated: string[];
}
