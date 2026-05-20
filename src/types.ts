export interface StepDetail {
  path: string;
  action: 'created' | 'modified' | 'deleted';
  lines: number[];
  h0?: string;
  h1?: string;
}

export interface MigrationData {
  status: 'idle' | 'running' | 'done' | 'error';
  sourceVersion: number | null;
  targetVersion: number;
  sourcePath: string;
  destPath: string;
  date: string;
  ngUpdateSteps: { version: number; ok: boolean }[];
  modernize: {
    flexLayoutMigrated: { htmlCount: number; tsCount: number } | null;
    inject: boolean;
    signals: boolean;
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
    sassImports: number;
    modulesRemoved: number;
    styleUrlFixed: number;
    selfClosingTags: boolean;
    cleanupImports: boolean;
  };
  details: Record<string, StepDetail[]>;
  notes: string[];
  filesCreated: string[];
}
