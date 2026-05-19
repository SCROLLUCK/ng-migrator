# ng-migrator

CLI that migrates Angular projects incrementally from old versions (v11+) to Angular 21, using the official `ng update` schematics at each step — then applies a full modernization pass to bring the code up to Angular 21 best practices.

## Requirements

- Node.js 18+
- The source project must have a valid `package.json` with `@angular/core`

## Quick start

```bash
# Clone and enter the migrator
git clone <repo>
cd ng-migrator

# Migrate a project (creates a sibling folder with -ng21 suffix)
node migrate.mjs /path/to/my-angular-project
```

The migrated project is created at `/path/to/my-angular-project-ng21`. The original is never touched.

## Usage

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
| `--no-modernize` | Skip the modernization step | off |

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

## What it does

### 1. Copy & clean
Copies the project (excluding `node_modules`, `dist`, `.git`) to the destination folder. Removes old lockfiles and strips obsolete packages (`ngcc`, `codelyzer`, `tslint`, `protractor`, `karma-coverage-istanbul-reporter`) from `package.json`. Bumps stale dev dependencies (`@types/node`, `@types/jasmine`, `jasmine-core`, `ts-node`).

### 2. Incremental ng update
Runs `ng update @angular/core@N @angular/cli@N` for each major version from the detected source up to the target. Angular Material and CDK are included automatically if present. After each step, out-of-sync packages are forced to the right version and `npm install` is re-run. Each version is saved as a separate git commit.

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
| Lazy routes | Converts `loadChildren: () => import('./foo.module')` to `.routes.ts` files (fixes NG0200) |
| esbuild builder | Switches from Webpack (`browser`) to esbuild/Vite (`application`) |
| `polyfills.ts` | Inlines `zone.js` directly into `angular.json` and removes the file |
| `tsconfig.json` | Sets `target`/`module` → `ES2022`, `moduleResolution` → `"bundler"`, `useDefineForClassFields` → `false` |
| Path aliases | Adds `@app/*`, `@core/*`, `@shared/*`, `@features/*`, `@environments/*` to `tsconfig.json` |
| ESLint | Installs `@angular/eslint` via `ng add` |
| SCSS `@import` | Converts `@import` → `@use … as *` |
| Unused modules | Removes `.module.ts` files no longer referenced by any TypeScript file |
| `styleUrls` | Converts `styleUrls: ['./foo.css']` → `styleUrl: './foo.css'` (Angular 19) |
| Self-closing tags | Converts `<my-comp></my-comp>` → `<my-comp />` via official schematic |
| Cleanup imports | Removes unused component imports from `imports: []` arrays via official schematic |

## Output

```
my-project-ng21/
├── MIGRATION-STATUS.html    ← live progress dashboard (auto-refreshes every 4s in a browser)
├── MIGRATION-REPORT.md      ← final report with every change, file paths and line numbers
├── MIGRATION.patch          ← full before/after diff
├── src/
│   ├── main.ts              ← simplified to bootstrapApplication()
│   └── app/
│       ├── app.config.ts    ← new (functional providers)
│       └── app.routes.ts    ← new (extracted routes)
└── ...
```

### Monitoring progress

While the migration runs, open `MIGRATION-STATUS.html` in a browser — it auto-refreshes every 4 seconds and shows:

- A progress bar for the `ng update` phase
- A table with ✅ / ⏳ per modernization step
- Collapsible file lists showing exactly which files (and which lines) each step touched

The final `MIGRATION-REPORT.md` also includes a **File changes per step** section with full file paths and line ranges.

## After migration

```bash
cd my-project-ng21
ng build    # check for compilation errors
ng serve    # test the app
```

See `MIGRATION-REPORT.md` → **What to do next** for a prioritized checklist of manual tasks.

## Known limitations

- **Internal state signals** — converting `isLoading = false` to `isLoading = signal(false)` has no official schematic. Requires manual refactoring.
- **Functional guards/interceptors** — converting `CanActivate` classes to `CanActivateFn` / `HttpInterceptor` to `HttpInterceptorFn` has no automated tool. Requires manual refactoring using `inject()` inside the function body.
- **CoreModule with complex providers** — modules that cannot be fully converted are wrapped in `importProvidersFrom()` in `app.config.ts` as an intermediate step.
