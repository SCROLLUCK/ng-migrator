# ng-migrator

CLI that migrates Angular projects incrementally from old versions (v11+) to Angular 21, using the official `ng update` schematics at each step.

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
| `--no-modernize` | Skip the modernization step (inject/signals/standalone) | off |

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
Copies the project (excluding `node_modules`, `dist`, `.git`) to the destination folder, removes old lockfiles, and strips obsolete packages (`ngcc`, `codelyzer`, `tslint`, `protractor`) from `package.json`.

### 2. Incremental ng update
Runs `ng update @angular/core@N @angular/cli@N` for each major version from the detected source up to the target. Angular Material and CDK are included automatically if present. After each step, out-of-sync packages are forced to the right version and `npm install` is re-run.

### 3. Modernization (can be skipped with `--no-modernize`)

| Step | What it does |
|---|---|
| `inject()` | Converts constructor DI to `inject()` |
| Signals | Converts `@Input`/`@Output`/`@ViewChild` to signal APIs |
| Standalone | Converts all components/directives/pipes to standalone, removes NgModules |
| `app.config.ts` | Creates `app.config.ts` with functional providers (`provideRouter`, `provideAnimationsAsync`, etc.) |
| `app.routes.ts` | Extracts routes from `app-routing.module.ts` |
| esbuild builder | Switches from Webpack (`browser`) to esbuild (`application`) |
| Path aliases | Adds `@app/*`, `@core/*`, `@shared/*`, `@features/*`, `@environments/*` to `tsconfig.json` |

## Output

```
my-project-ng21/
├── MIGRATION-REPORT.md   ← summary of every change made
├── src/
│   ├── main.ts           ← simplified to 4 lines
│   └── app/
│       ├── app.config.ts ← new (functional providers)
│       └── app.routes.ts ← new (extracted routes)
└── ...
```

## After migration

```bash
cd my-project-ng21
ng build    # check for compilation errors
ng serve    # test the app
```

## Known limitations

- **Internal state signals** (`isLoading`, `data`, etc.) are not migrated — no official Angular schematic exists for this. Requires manual refactoring.
- **Lazy-loaded module routes** (`loadChildren: () => import('./module')`) are kept as-is. Consider converting to `loadComponent` manually.
- Modules that cannot be converted automatically (e.g. `CoreModule` with complex providers) are wrapped in `importProvidersFrom()` in `app.config.ts`.
