import { spawnSync } from 'child_process';
import {
  readFileSync, writeFileSync, existsSync,
  readdirSync, statSync, mkdirSync, copyFileSync, unlinkSync,
} from 'fs';
import { join, resolve, dirname, basename, relative } from 'path';
import { fileURLToPath } from 'url';

export { spawnSync };
export { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync, copyFileSync, unlinkSync };
export { join, resolve, dirname, basename, relative };

export const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── CLI args ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const sourceArg = args.find(a => !a.startsWith('--')) ?? '.';

export const opts = {
  to:            parseInt(args.includes('--to')   ? args[args.indexOf('--to')   + 1] : '21'),
  from:          args.includes('--from') ? parseInt(args[args.indexOf('--from') + 1]) : null,
  dest:          args.includes('--dest') ? resolve(args[args.indexOf('--dest')  + 1]) : null,
  versionsDir:   args.includes('--versions-dir') ? resolve(args[args.indexOf('--versions-dir') + 1]) : null,
  dryRun:          args.includes('--dry-run'),
  modernize:       !args.includes('--no-modernize'),
  splitVersions:   args.includes('--split-versions'),
  ngUpdateChecks:  args.includes('--ng-update-checks'),
  // Estratégia para conflitos de peer dependency no ng update:
  //   'resolve' (default) — loop iterativo resolvendo versões compatíveis via registry,
  //                         --force só como último recurso para libs sem versão compatível.
  //   'force'             — pula a resolução; usa --force assim que o update falha.
  peerStrategy:    (args.includes('--peer-strategy')
                     ? args[args.indexOf('--peer-strategy') + 1]
                     : 'resolve') === 'force' ? 'force' : 'resolve',
  // Retoma uma migração existente a partir de um step (ex: 'ng14', 'signals', 'builder').
  // Faz git reset --hard pro commit ANTES do step no destino e continua dali — sem refazer
  // o que já passou. Útil ao corrigir o migrador e re-rodar só de um ponto.
  resumeFrom:      args.includes('--resume-from') ? args[args.indexOf('--resume-from') + 1] : null,
  // Volta o destino pro ESTADO de um step (git reset --hard no commit DO step, não no
  // anterior) + reinstala node_modules, e PARA — recupera um ponto que buildava limpo,
  // sem re-rodar a migração. Diferente de --resume-from (que reseta antes e re-roda).
  rollbackTo:      args.includes('--rollback-to') ? args[args.indexOf('--rollback-to') + 1] : null,
};

// Ordem canônica dos steps de modernização (= ordem em runModernizationMigrations).
// Usada por --resume-from para saber o que pular ao retomar de um step.
export const MODERNIZATION_STEPS = [
  'flexLayout', 'inject', 'signals', 'reservedKeywords', 'untypedForms', 'throwError',
  'fixMoment', 'standalone', 'standaloneFixed', 'controlFlow', 'ngClassToClass',
  'ngStyleToStyle', 'appConfig', 'lazyRoutes', 'builder', 'polyfills', 'tsconfig',
  'pathAliases', 'eslint', 'sass', 'modules', 'styleUrl', 'selfClosing',
  'cleanupImports', 'thirdPartyVersions', 'lintFix',
];

// Mapeia cada step de modernização para o(s) campo(s) de `report.modernize` que ele preenche,
// com o valor de "não-feito". Usado pelo --rollback-to para zerar no report os steps posteriores
// ao ponto de retorno (mantendo o dashboard fiel ao estado real da árvore). Steps sem flag própria
// (fixMoment, thirdPartyVersions) não aparecem aqui — basta limpar details/buildChecks deles.
export const MODERNIZATION_STEP_FIELDS = {
  flexLayout: { flexLayoutMigrated: null },
  inject: { inject: false },
  signals: { signals: false },
  reservedKeywords: { reservedKeywordsFixed: 0 },
  untypedForms: { untypedFormsFixed: 0 },
  throwError: { throwErrorFixed: 0 },
  standalone: { standalone: false },
  standaloneFixed: { standaloneFixed: 0 },
  controlFlow: { controlFlow: false },
  ngClassToClass: { ngClassToClass: false },
  ngStyleToStyle: { ngStyleToStyle: false },
  appConfig: { appConfig: false, appRoutes: false, mainSimplified: false },
  lazyRoutes: { lazyRoutesConverted: 0 },
  builder: { builder: false },
  polyfills: { polyfillsInlined: false },
  tsconfig: { tsconfigModernized: false },
  pathAliases: { pathAliases: false },
  eslint: { eslintAdded: false },
  sass: { sassImports: 0 },
  modules: { modulesRemoved: 0 },
  styleUrl: { styleUrlFixed: 0 },
  selfClosing: { selfClosingTags: false },
  cleanupImports: { cleanupImports: false },
  lintFix: { lintFixed: 0 },
};

// Steps to skip (passed via env var from ng-migrator-ui or --skip-steps CLI)
export const skipSteps = new Set((process.env.NG_MIGRATOR_SKIP_STEPS ?? '').split(',').filter(Boolean));

export const sourcePath = resolve(sourceArg);

// Dynamically detect source version from source project's package.json
let detectedVersion = 11;
try {
  const pkgPath = join(sourcePath, 'package.json');
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    const v = pkg.dependencies?.['@angular/core'] ?? pkg.devDependencies?.['@angular/core'] ?? '';
    const m = v.match(/(\d+)/);
    if (m) detectedVersion = parseInt(m[1], 10);
  }
} catch (e) {}

export let destPath = '';
if (opts.splitVersions) {
  const parentDir = opts.versionsDir ?? join(dirname(sourcePath), `${basename(sourcePath)}-ng-versions`);
  const startVer = opts.from ?? detectedVersion;
  destPath = join(parentDir, `ng${startVer}`);
} else {
  destPath = opts.dest ?? `${sourcePath}-ng${opts.to}`;
}

export let migratorDir = join(destPath, '.ng-migrator');

export function setDestPath(newPath) {
  destPath = resolve(newPath);
  migratorDir = join(destPath, '.ng-migrator');
  report.destPath = destPath;
}

// Accumulated during the pipeline; written to MIGRATION-REPORT.md at the end.
export const report = {
  date: new Date().toISOString().slice(0, 10),
  sourceVersion: null,
  targetVersion: opts.to,
  splitVersions: opts.splitVersions,   // resume/rollback (git por step) não se aplica a split-versions
  sourcePath,
  destPath,
  initialCommit: null,
  ngUpdateSteps: [],       // { version, ok }
  materialLegacyFixed: 0,
  modernize: {
    inject: false,
    signals: false,
    reservedKeywordsFixed: 0,
    untypedFormsFixed: 0,
    throwErrorFixed: 0,
    polyfillsInlined: false,
    styleUrlFixed: 0,
    controlFlow: false,
    ngClassToClass: false,
    ngStyleToStyle: false,
    selfClosingTags: false,
    cleanupImports: false,
    standalone: false,
    standaloneFixed: 0,
    appConfig: false,
    appRoutes: false,
    lazyRoutesConverted: 0,
    mainSimplified: false,
    builder: false,
    pathAliases: false,
    tsconfigModernized: false,
    eslintAdded: false,
    lintFixed: 0,
    sassImports: 0,
    modulesRemoved: 0,
    flexLayoutMigrated: null,   // { htmlCount, tsCount } quando executado
  },
  filesCreated: [],
  notes: [],
  corrections: [],   // steps de correção específicos aplicados (lib, arquivos) — runtime-safe

  skippedSteps: [],  // steps that were intentionally skipped via NG_MIGRATOR_SKIP_STEPS
  details: {},   // key → [{path, action, lines}]
};

export const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.angular', 'coverage', '.cache', 'e2e']);

// SQLite DB for diff storage; opened after migratorDir is created.
// IMPORTANT: diffDb is export let with a setter because it's assigned after initialisation.
// In ES modules, live bindings work — other modules that import diffDb will see the updated
// value when setDiffDb() is called.
export let diffDb = null;
export function setDiffDb(db) { diffDb = db; }

// ─── Configuração e Contexto Dinâmico de Versões Node ────────────────────────
export let currentAngularVersion = null;
export function setCurrentAngularVersion(v) {
  currentAngularVersion = v;
}

export const config = {
  nodeVersionManager: 'docker', // Default to docker
  nodeVersions: {
    '11': '14',
    '12': '14',
    '13': '16',
    '14': '16',
    '15': '18',
    '16': '18',
    '17': '20',
    '18': '20',
    '19': '22',
    '20': '22',
    '21': '22',
  },
  customManagerCommand: '',
};

// Check for custom config in current dir or source directory
const configPaths = [
  join(process.cwd(), 'ng-migrator.config.json'),
  join(sourcePath, 'ng-migrator.config.json')
];

for (const p of configPaths) {
  if (existsSync(p)) {
    try {
      const userConfig = JSON.parse(readFileSync(p, 'utf8'));
      if (userConfig.nodeVersionManager) {
        config.nodeVersionManager = userConfig.nodeVersionManager;
      }
      if (userConfig.nodeVersions) {
        config.nodeVersions = { ...config.nodeVersions, ...userConfig.nodeVersions };
      }
      if (userConfig.customManagerCommand) {
        config.customManagerCommand = userConfig.customManagerCommand;
      }
      console.log(`\n⚙  Configuração carregada de: ${p}`);
      break;
    } catch (e) {
      console.error(`Erro ao ler arquivo de configuração em ${p}:`, e);
    }
  }
}

