# ng-migrator

CLI that migrates Angular projects incrementally from old versions (v11+) to Angular 22, using the official `ng update` schematics at each step — then applies a full modernization pass to bring the code up to Angular 22 best practices.

Comes with a local web dashboard for monitoring progress, inspecting per-step file changes, and reviewing before/after diffs.

## Requirements

- Node.js 18+ (on host to run the dashboard and CLI runner)
- **Docker** (installed and running) — Strictly required to execute Angular migrations in isolated Node.js containers and prevent host environment pollution.
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
| `--split-versions` | Generate separate version-specific folders (e.g. `ng11`, `ng12`, etc.) inside a parent directory named `<project-name>-ng-versions` | off (single folder) |
| `--dry-run` | Print what would happen without doing anything | off |
| `--no-modernize` | Skip the modernization steps | off |
| `--ng-update-checks` | Run `ng build` after each major `ng update` step to surface compilation errors early | off |

**Environment variables:**

| Variable | Description |
|---|---|
| `NG_MIGRATOR_SKIP_STEPS` | Comma-separated list of modernization step keys to skip (e.g. `signals,flexLayout`). Used by the dashboard UI; can also be set manually. |

### Examples

```bash
# Migrate to Angular 22 (default)
node migrate.mjs ./my-project

# Migrate only up to Angular 17
node migrate.mjs ./my-project --to 17

# Project already at Angular 14, migrate from there
node migrate.mjs ./my-project --from 14

# Custom output folder
node migrate.mjs ./my-project --dest ./my-project-migrated

# Generate separate version-specific folders for each incremental major step
node migrate.mjs ./my-project --split-versions

# Just upgrade, skip modernization
node migrate.mjs ./my-project --no-modernize

# Preview without touching anything
node migrate.mjs ./my-project --dry-run
```

By default, the migrated project is created at `<source>-ng<target>` (e.g. `my-project-ng21`). When `--split-versions` is active, it creates separate folders for each major upgrade step (e.g., `ng11`, `ng12`, `ng13`...) inside a parent directory named `<project-name>-ng-versions` (e.g., `my-project-ng-versions/`). The original project is never touched.

## Node.js Version Isolation (Docker)

To prevent package incompatibilities and avoid modifying or polluting your local host environment, `ng-migrator` runs each step of the Angular upgrade pipeline inside isolated Docker containers using the correct Node.js version mapped to that Angular version:

* **Angular 11-12**: Node.js v14
* **Angular 13-14**: Node.js v16
* **Angular 15-16**: Node.js v18
* **Angular 17-18**: Node.js v20
* **Angular 19-21**: Node.js v22

### How it works
1. **Preflight Check**: The CLI checks if Docker is running (`docker ps`). If not, it halts with an error to prevent accidental local execution.
2. **Container Execution**: Commands (`npm`, `npx`, `node`, `ng`) are run inside short-lived `node:<version>` Docker containers named `ng-migrator-runner` (`docker run --rm --name ng-migrator-runner`).
3. **Permissions Preservation**: The container matches your host's UID and GID dynamically (`--user uid:gid`), ensuring that all generated files in the destination directory are owned by your host user rather than `root`.
4. **Caching**: The host `~/.npm` directory is mounted into the container to cache packages and speed up `npm install` runs.

### Configuration (`ng-migrator.config.json`)

You can customize this behavior by creating an `ng-migrator.config.json` file in the current working directory or the source project root.

Example configuration:
```json
{
  "nodeVersionManager": "docker",
  "nodeVersions": {
    "11": "14",
    "12": "14",
    "13": "16",
    "14": "16",
    "15": "18",
    "16": "18",
    "17": "20",
    "18": "20",
    "19": "22",
    "20": "22",
    "21": "22"
  },
  "customManagerCommand": ""
}
```

#### Configuration Options

* **`nodeVersionManager`**:
  * `"docker"` (default): Runs Node commands inside isolated Docker containers.
  * `"auto"`: Auto-detects Docker (exits if Docker is not running).
  * `"nvm"`, `"fnm"`, `"n"`, `"asdf"`: Local manager fallbacks (use at your own risk; requires the tool to be installed locally).
  * `"none"`: Disables version isolation entirely and runs all commands using the host's global Node version.
* **`nodeVersions`**: An object mapping Angular major versions to specific Node.js versions.
* **`customManagerCommand`**: A custom wrapper command if you use a proprietary or unsupported tool. Supports placeholders `{{version}}` and `{{command}}` (e.g. `"myswitcher run -v {{version}} -- {{command}}"`).

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
| `app.config.ts` | Creates `app.config.ts` with functional providers (`provideRouter`, `provideAnimations`, etc.) |
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

## Corrections (library-specific, error-driven)

Most fixes in ng-migrator are **generic** (Angular/TypeScript/RxJS patterns). But some build errors come from a **specific library** that had a breaking change between Angular majors — e.g. `ngx-mask` v15+ removed `NgxMaskModule` (it became the standalone `NgxMaskDirective` + `provideNgxMask()`). The generic engine can only *neutralize* these (remove the broken import → **builds but the feature is dead at runtime**).

**Corrections** are a separate, opt-in category that may be **library-specific**. They migrate the API **for real** (runtime-safe). Each correction is a self-contained file in [`migrator/corrections/`](migrator/corrections/) and is **auto-discovered** — adding one is just dropping a file (a future UI will let users upload their own).

A correction declares exactly **one trigger**:

- **`detect(ctx)` — error-driven** (most corrections): runs when the error shows up in the build. Fired by `runCorrections(v)` from the build-check (in the loop and at the end of modernization). Example: `ngx-mask` removed `NgxMaskModule`.
- **`gate(angularMajor)` — proactive / "ceiling"**: runs at a specific major **before** the `ng update`, without waiting for an error — for libraries with **no version at the target major**, where waiting would be too late (the update's `npm install` would already have failed). Fired by `runProactiveCorrections(v)` at the top of the loop. Example: `@angular/flex-layout` → Tailwind at v16 ([`angular-flex-layout-tailwind.mjs`](migrator/corrections/angular-flex-layout-tailwind.mjs)).

### Writing a correction

Create `migrator/corrections/<your-name>.mjs` with a default export of this exact shape (see [`ngx-mask.mjs`](migrator/corrections/ngx-mask.mjs) for a fully-commented reference, and the JSDoc typedefs in [`index.mjs`](migrator/corrections/index.mjs)):

```js
/** @type {import('./index.mjs').Correction} */
export default {
  // Unique id, kebab-case.
  name: 'my-lib-fix',

  // One line for the report (what this correction does).
  description: 'my-lib vN: OldThing → NewThing',

  // TRIGGER — pick ONE. Error-driven: should this run for the current error? Keep it CHEAP/SPECIFIC.
  // ctx: { raw, codes:Set<string>, angularMajor, hasPackage(name), getInstalledMajor(name) }
  detect({ raw, codes, hasPackage }) {
    return hasPackage('my-lib') && /OldThing/.test(raw) && codes.has('TS2305');
  },
  // ...OR proactive (runs before the update at a given major, no error needed):
  // gate: (angularMajor) => angularMajor === 16,

  // Apply the fix. Use ONLY ctx (no migrator internals → portable / safe for UI-submitted files).
  // ctx: { destPath, srcDir, transformTs(fn), setCompilerOption(key, value) }
  //   transformTs((content, path) => newContent) → walks every .ts in src/, writes the changed ones,
  //   returns the list of changed file paths.
  //   setCompilerOption(key, value) → ensures a tsconfig.json compilerOptions entry (returns true if changed).
  apply({ transformTs }) {
    const files = transformTs((content) => {
      if (!content.includes('OldThing')) return content;     // file not affected → return unchanged
      return content.replace(/\bOldThing\b/g, 'NewThing');   // the surgical transform
    });
    return { files, summary: `OldThing → NewThing in ${files.length} file(s)` };
  },
};
```

| Field | Type | Purpose |
|---|---|---|
| `name` | `string` | Unique kebab-case id. |
| `description` | `string` | One line shown in the report. |
| `detect(ctx)` | `(DetectContext) => boolean` | **Error-driven** trigger: whether to run, given the current error state. Keep it cheap/specific. |
| `gate(major)` | `(number) => boolean` | **Proactive** trigger: whether to run at this major, before the update (use instead of `detect` for ceiling cases). |
| `apply(ctx)` | `(ApplyContext) => { files, summary }` | The surgical transform; returns the changed files + a summary. |

`detect` receives a read-only `DetectContext` (`raw` build output, `codes` set, `angularMajor`, `hasPackage`, `getInstalledMajor`). `apply` receives an `ApplyContext` with `transformTs(fn)` / `transformHtml(fn)` (read/rewrite every `.ts` / `.html` in `src/`), `setCompilerOption(key, value)` (patch `tsconfig.json`), and `installDevDeps(packages)` (install dev dependencies, Docker-isolated). **Every correction is self-contained**: the bug-specific logic lives entirely in its file — it uses only the ctx mechanisms, the shared helpers in `_lib.mjs`, plus Node builtins (`fs`/`path`), and **never imports migrator internals**. The ctx provides the generic *how* (walk files, install a dep in isolation, set a tsconfig option); the correction provides the specific *what*. The flex-layout correction, for example, inlines the whole fxLayout→Tailwind conversion and calls `ctx.installDevDeps([...])` instead of running npm itself. Applied corrections are recorded in `report.corrections` and surfaced in the report, separate from neutralized/manual items.

#### Shared helpers (`_lib.mjs`)

So corrections don't reinvent the wheel, generic **bug-agnostic** helpers live in [`migrator/corrections/_lib.mjs`](migrator/corrections/_lib.mjs) — import them with `import { ... } from './_lib.mjs'`:

| Helper | Purpose |
|---|---|
| `rewriteNamedImport(content, module, { add, remove })` | Add/remove named symbols in an existing `import { ... } from 'module'` (drops the import if empty). |
| `removeImport(content, module)` | Remove any `import … from 'module'` (default / named / namespace), incl. the newline. |
| `renameIdentifiers(content, { from: to })` | Whole-word rename of identifiers. |
| `removeSymbolFromArrays(content, symbol)` | Remove a bare symbol from arrays (e.g. `imports: [...]`), cleaning leftover commas. |
| `addProviderToNgModule(content, expr)` | Ensure a provider expression in the `@NgModule` `providers` array (creates it if missing). |
| `readPackageJson` / `writePackageJson` / `hasDependency` / `removeDependencies` | `package.json` reads/edits. |

Files prefixed with `_` are **not** corrections — the auto-discovery skips them. `_lib.mjs` is itself self-contained (only `fs`/`path`), so the whole `corrections/` folder stays portable.

## Known limitations

- **Internal state signals** — converting `isLoading = false` to `isLoading = signal(false)` has no official schematic and requires manual refactoring.
- **Functional guards/interceptors** — converting `CanActivate` classes to `CanActivateFn` / `HttpInterceptor` to `HttpInterceptorFn` has no automated tool. Requires manual refactoring using `inject()` inside the function body.
- **CoreModule with complex providers** — modules that cannot be fully converted are wrapped in `importProvidersFrom()` in `app.config.ts` as an intermediate step.
