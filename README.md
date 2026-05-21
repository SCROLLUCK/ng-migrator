# ng-migrator

CLI that migrates Angular projects incrementally from old versions (v11+) to Angular 21, using the official `ng update` schematics at each step — then applies a full modernization pass to bring the code up to Angular 21 best practices.

Comes with a local web dashboard for monitoring progress, inspecting per-step file changes, and reviewing before/after diffs.

## Requirements

- Node.js 18+
- The source project must have a valid `package.json` with `@angular/core`

## Setup

```bash
git clone <repo>
cd ng-migrator
npm install
```

## Running the dashboard

```bash
npm start
```

Opens the dashboard at `http://localhost:5173`. The Vite dev server also starts the API server (`ng-migrator-ui.mjs`) automatically on port 4242.

The dashboard lets you:
- Configure the source project path, target Angular version, and which modernization steps to run
- Start and stop migrations
- Watch terminal output in real time as the migration runs
- Inspect per-step results (ng update phases + each modernization step), with file lists and collapsible before/after diffs
- Search all migrated files by name across all steps
- Load a previously completed migration report from a migrated project folder

## Running the CLI directly

```bash
node migrate.mjs [source] [options]
```

| Argument / Flag | Description | Default |
|---|---|---|
| `source` | Path to the Angular project | `.` (current dir) |
| `--to <version>` | Target Angular major version | `21` |
| `--from <version>` | Starting version (if auto-detection fails) | auto |
| `--dest <path>` | Custom output directory | `<source>-ng<target>` |
| `--dry-run` | Print what would happen without doing anything | off |
| `--no-modernize` | Skip the modernization steps | off |

### Examples

```bash
# Migrate to Angular 21 (default)
node migrate.mjs ./my-project

# Migrate only up to Angular 17
node migrate.mjs ./my-project --to 17

# Project already at Angular 14, migrate from there
node migrate.mjs ./my-project --from 14

# Custom output folder
node migrate.mjs ./my-project --dest ./my-project-migrated

# Just upgrade, skip modernization
node migrate.mjs ./my-project --no-modernize

# Preview without touching anything
node migrate.mjs ./my-project --dry-run
```

The migrated project is created at `<source>-ng<target>` (e.g. `my-project-ng21`). The original is never touched.

## What it does

### 1. Copy & clean

Copies the project (excluding `node_modules`, `dist`, `.git`) to the destination folder. Removes old lockfiles and strips obsolete packages (`ngcc`, `codelyzer`, `tslint`, `protractor`, `karma-coverage-istanbul-reporter`) from `package.json`. Bumps stale dev dependencies (`@types/node`, `@types/jasmine`, `jasmine-core`, `ts-node`).

### 2. Incremental ng update

Runs `ng update @angular/core@N @angular/cli@N` for each major version from the detected source up to the target. Angular Material, CDK, and other ecosystem packages are included automatically if present.

The update is attempted without `--force` first. If peer dependency conflicts are detected, the conflicting packages are added to the command and retried. Only if that also fails does it fall back to `--force`.

After each major version, out-of-sync packages are pinned to the right version and `npm install` is re-run. Each version is saved as a separate git commit.

### 3. Modernization (skippable with `--no-modernize`)

Each step runs as its own git commit, so the history shows exactly what changed at each stage.

| Step | What it does |
|---|---|
| `inject()` | Converts constructor DI to `inject()` via official schematic |
| Signals | Converts `@Input`/`@Output`/`@ViewChild` to signal APIs |
| Typed forms | Replaces `UntypedFormBuilder/Group/Control/Array` with typed equivalents |
| `throwError` | Wraps `throwError(value)` → `throwError(() => value)` for RxJS 7 |
| Standalone | Converts all components/directives/pipes to standalone, prunes NgModules, updates bootstrap |
| `standalone: true` patch | Fixes pipes/directives/components the schematic missed |
| Control flow | Converts `*ngIf`/`*ngFor`/`*ngSwitch` → `@if`/`@for`/`@switch` |
| `[ngClass]` → `[class]` | Official Angular schematic |
| `[ngStyle]` → `[style]` | Official Angular schematic |
| `app.config.ts` | Creates `app.config.ts` with functional providers (`provideRouter`, `provideAnimationsAsync`, etc.) |
| `app.routes.ts` | Extracts routes from `app-routing.module.ts` |
| Lazy routes | Converts `loadChildren: () => import('./foo.module')` to `.routes.ts` files |
| esbuild builder | Switches from Webpack (`browser`) to esbuild/Vite (`application`) |
| `polyfills.ts` | Inlines `zone.js` directly into `angular.json` and removes the file |
| `tsconfig.json` | Sets `target`/`module` → `ES2022`, `moduleResolution` → `"bundler"`, `useDefineForClassFields` → `false` |
| Path aliases | Adds `@app/*`, `@core/*`, `@shared/*`, `@features/*`, `@environments/*` to `tsconfig.json` |
| ESLint | Installs `@angular/eslint` via `ng add`, then runs `ng lint --fix` once at the end |
| SCSS `@import` | Converts `@import` → `@use … as *` |
| Unused modules | Removes `.module.ts` files no longer referenced by any TypeScript file |
| `styleUrls` | Converts `styleUrls: ['./foo.css']` → `styleUrl: './foo.css'` (Angular 19) |
| Self-closing tags | Converts `<my-comp></my-comp>` → `<my-comp />` via official schematic |
| Cleanup imports | Removes unused component imports from `imports: []` arrays via official schematic |

## Output

The migrated project is created as a sibling directory with a `-ng<version>` suffix:

```
my-project-ng21/
├── .ng-migrator/
│   ├── MIGRATION-DATA.json   ← structured data read by the dashboard
│   ├── MIGRATION-REPORT.md   ← human-readable report with file paths and line numbers
│   ├── MIGRATION.patch       ← full before/after diff
│   └── diffs.db              ← SQLite database with per-file diffs (used by the diff viewer)
├── src/
│   ├── main.ts               ← simplified to bootstrapApplication()
│   └── app/
│       ├── app.config.ts     ← new (functional providers)
│       └── app.routes.ts     ← new (extracted routes)
└── ...
```

### Loading a previous migration

In the dashboard, use the **"Carregar relatório"** section at the bottom of the Configuration panel. Enter the path to a previously migrated project folder (or use the folder picker) and click **Carregar**. The dashboard switches to showing that migration's data; click the **✕** badge in the header to return to the live view.

## After migration

```bash
cd my-project-ng21
ng build    # check for compilation errors
ng serve    # test the app
```

See `MIGRATION-REPORT.md` → **What to do next** for a prioritized checklist of manual tasks.

## Known limitations

- **Internal state signals** — converting `isLoading = false` to `isLoading = signal(false)` has no official schematic and requires manual refactoring.
- **Functional guards/interceptors** — converting `CanActivate` classes to `CanActivateFn` / `HttpInterceptor` to `HttpInterceptorFn` has no automated tool. Requires manual refactoring using `inject()` inside the function body.
- **CoreModule with complex providers** — modules that cannot be fully converted are wrapped in `importProvidersFrom()` in `app.config.ts` as an intermediate step.
