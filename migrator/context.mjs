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
  to:       parseInt(args.includes('--to')   ? args[args.indexOf('--to')   + 1] : '21'),
  from:     args.includes('--from') ? parseInt(args[args.indexOf('--from') + 1]) : null,
  dest:     args.includes('--dest') ? resolve(args[args.indexOf('--dest')  + 1]) : null,
  dryRun:   args.includes('--dry-run'),
  modernize: !args.includes('--no-modernize'),
};

// Steps to skip (passed via env var from ng-migrator-ui or --skip-steps CLI)
export const skipSteps = new Set((process.env.NG_MIGRATOR_SKIP_STEPS ?? '').split(',').filter(Boolean));

export const sourcePath = resolve(sourceArg);
export const destPath   = opts.dest ?? `${sourcePath}-ng${opts.to}`;
export const migratorDir = join(destPath, '.ng-migrator');

// Accumulated during the pipeline; written to MIGRATION-REPORT.md at the end.
export const report = {
  date: new Date().toISOString().slice(0, 10),
  sourceVersion: null,
  targetVersion: opts.to,
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
  details: {},   // key → [{path, action, lines}]
};

export const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.angular', 'coverage', '.cache', 'e2e']);

// SQLite DB for diff storage; opened after migratorDir is created.
// IMPORTANT: diffDb is export let with a setter because it's assigned after initialisation.
// In ES modules, live bindings work — other modules that import diffDb will see the updated
// value when setDiffDb() is called.
export let diffDb = null;
export function setDiffDb(db) { diffDb = db; }
