import { writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { destPath, report, opts, migratorDir } from './context.mjs';
import { capture, formatRanges } from './utils.mjs';

export function writeMigrationData() {
  if (!existsSync(destPath)) return;
  try {
    const dataPath = join(migratorDir, 'MIGRATION-DATA.json');
    writeFileSync(dataPath, JSON.stringify(report, null, 2) + '\n');
  } catch {
    // non-fatal — UI polling will just show stale data
  }
}

export function writeReport() {
  const check = (v) => v ? '✅' : '—';
  const lines = [];

  lines.push(`# Migration Report`);
  lines.push(``);
  lines.push(`**Date:** ${report.date}  `);
  lines.push(`**Source:** \`${report.sourcePath}\` (Angular ${report.sourceVersion ?? '?'})  `);
  lines.push(`**Target:** \`${report.destPath}\` (Angular ${report.targetVersion})  `);
  lines.push(``);
  lines.push(`---`);
  lines.push(``);

  // ng update steps
  lines.push(`## ng update — Incremental steps`);
  lines.push(``);
  lines.push(`| Version | Status |`);
  lines.push(`|---------|--------|`);
  for (const { version, ok } of report.ngUpdateSteps) {
    lines.push(`| Angular ${version} | ${ok ? '✅ ok' : '⚠️  warnings'} |`);
  }
  lines.push(``);

  // Material legacy
  if (report.materialLegacyFixed > 0) {
    lines.push(`## Angular Material`);
    lines.push(``);
    lines.push(`✅ \`MatLegacy*\` imports and \`@angular/material/legacy-*\` paths converted in **${report.materialLegacyFixed}** file(s).`);
    lines.push(``);
  }

  // Modernization
  if (opts.modernize) {
    lines.push(`## Modernization`);
    lines.push(``);
    lines.push(`| Step | Status |`);
    lines.push(`|------|--------|`);
    lines.push(`| Step | Result |`);
    lines.push(`|------|--------|`);
    if (report.modernize.flexLayoutMigrated !== null) {
      const fl = report.modernize.flexLayoutMigrated;
      lines.push(`| \`@angular/flex-layout\` → Tailwind CSS | ${fl ? `✅ ${fl.htmlCount} template(s), ${fl.tsCount} TS` : '—'} |`);
    }
    lines.push(`| \`inject()\` — constructor DI → \`inject()\` | ${check(report.modernize.inject)} |`);
    lines.push(`| Signals — \`@Input\`/\`@Output\`/\`@ViewChild\` → signal APIs | ${check(report.modernize.signals)} |`);
    lines.push(`| \`UntypedForm*\` → typed \`FormBuilder\`/\`FormGroup\`/\`FormControl\` | ${report.modernize.untypedFormsFixed > 0 ? `✅ ${report.modernize.untypedFormsFixed} file(s)` : '—'} |`);
    lines.push(`| \`throwError(value)\` → \`throwError(() => value)\` (RxJS 7) | ${report.modernize.throwErrorFixed > 0 ? `✅ ${report.modernize.throwErrorFixed} file(s)` : '—'} |`);
    lines.push(`| Standalone components (convert → prune → bootstrap) | ${check(report.modernize.standalone)} |`);
    lines.push(`| \`standalone: true\` patched in missed pipes/directives/components | ${report.modernize.standaloneFixed > 0 ? `✅ ${report.modernize.standaloneFixed} file(s)` : '—'} |`);
    lines.push(`| Control flow — \`*ngIf\`/\`*ngFor\`/\`*ngSwitch\` → \`@if\`/\`@for\`/\`@switch\` | ${check(report.modernize.controlFlow)} |`);
    lines.push(`| \`[ngClass]\` → \`[class]\` bindings | ${check(report.modernize.ngClassToClass)} |`);
    lines.push(`| \`[ngStyle]\` → \`[style]\` bindings | ${check(report.modernize.ngStyleToStyle)} |`);
    lines.push(`| Self-closing tags (\`<my-comp />\`) | ${check(report.modernize.selfClosingTags)} |`);
    lines.push(`| Cleanup unused component imports | ${check(report.modernize.cleanupImports)} |`);
    lines.push(`| \`app.config.ts\` with functional providers | ${check(report.modernize.appConfig)} |`);
    lines.push(`| \`app.routes.ts\` extracted from routing module | ${check(report.modernize.appRoutes)} |`);
    lines.push(`| Lazy NgModules → routes files (fixes NG0200 circular dep) | ${report.modernize.lazyRoutesConverted > 0 ? `✅ ${report.modernize.lazyRoutesConverted} module(s)` : '—'} |`);
    lines.push(`| \`main.ts\` simplified to \`bootstrapApplication()\` | ${check(report.modernize.mainSimplified)} |`);
    lines.push(`| Builder → esbuild/Vite (\`application\` builder) | ${check(report.modernize.builder)} |`);
    lines.push(`| \`polyfills.ts\` → \`"zone.js"\` inline em \`angular.json\` | ${check(report.modernize.polyfillsInlined)} |`);
    lines.push(`| \`styleUrls: []\` → \`styleUrl\` singular (Angular 19) | ${report.modernize.styleUrlFixed > 0 ? `✅ ${report.modernize.styleUrlFixed} file(s)` : '—'} |`);
    lines.push(`| \`tsconfig.json\` — ES2022 target/module, \`moduleResolution: "bundler"\` | ${check(report.modernize.tsconfigModernized)} |`);
    lines.push(`| Path aliases (\`@app\`, \`@core\`, \`@shared\`…) no \`tsconfig.json\` | ${check(report.modernize.pathAliases)} |`);
    lines.push(`| ESLint (\`@angular/eslint\`) | ${check(report.modernize.eslintAdded)} |`);
    lines.push(`| SCSS \`@import\` → \`@use … as *\` | ${report.modernize.sassImports > 0 ? `✅ ${report.modernize.sassImports} file(s)` : '—'} |`);
    lines.push(`| Unused \`.module.ts\` files removed | ${report.modernize.modulesRemoved > 0 ? `✅ ${report.modernize.modulesRemoved} file(s)` : '—'} |`);
    lines.push(``);

    // Detalhes por step (arquivos e linhas modificadas)
    const STEP_LABELS = {
      inject:        '`inject()` — constructor DI → inject()',
      signals:       'Signals — @Input/@Output/@ViewChild',
      untypedForms:  '`UntypedForm*` → typed forms',
      throwError:    '`throwError()` → factory function',
      standalone:    'Standalone migration',
      standaloneFixed: '`standalone: true` patch',
      controlFlow:   'Control flow — @if/@for/@switch',
      ngClassToClass:'`[ngClass]` → `[class]`',
      ngStyleToStyle:'`[ngStyle]` → `[style]`',
      appConfig:     '`app.config.ts` + `app.routes.ts`',
      lazyRoutes:    'Lazy NgModules → routes files',
      builder:       'Builder → esbuild/Vite',
      polyfills:     '`polyfills.ts` → zone.js inline',
      tsconfig:      '`tsconfig.json` modernization',
      pathAliases:   'Path aliases',
      eslint:        'ESLint',
      sass:          'SCSS `@import` → `@use`',
      modules:       'Unused `.module.ts` removed',
      styleUrl:      '`styleUrls` → `styleUrl`',
      selfClosing:   'Self-closing tags',
      cleanupImports:'Cleanup unused imports',
    };

    const detailEntries = Object.entries(report.details).filter(([, files]) => files?.length > 0);
    if (detailEntries.length > 0) {
      lines.push(`## File changes per step`);
      lines.push(``);
      for (const [key, files] of detailEntries) {
        const label = STEP_LABELS[key] ?? key;
        lines.push(`### ${label}`);
        lines.push(``);
        for (const { path, action, lines: changedLines } of files) {
          const lineStr = changedLines?.length ? ` — lines ${formatRanges(changedLines)}` : '';
          const actionStr = action === 'created' ? ' *(new)*' : action === 'deleted' ? ' *(deleted)*' : '';
          lines.push(`- \`${path}\`${actionStr}${lineStr}`);
        }
        lines.push(``);
      }
    }
  }

  // Files created
  if (report.filesCreated.length > 0) {
    lines.push(`## Files created by the migrator`);
    lines.push(``);
    for (const f of report.filesCreated) lines.push(`- \`${f}\``);
    lines.push(``);
  }

  // Notes
  if (report.notes.length > 0) {
    lines.push(`## Notes`);
    lines.push(``);
    for (const n of report.notes) lines.push(`> ${n}`);
    lines.push(``);
  }

  // Manual action items — grouped by priority
  lines.push(`## What to do next`);
  lines.push(``);

  lines.push(`### 🔴 Verify first (may block the build)`);
  lines.push(``);
  lines.push(`- [ ] Run \`ng build\` — fix any TypeScript errors before continuing`);
  lines.push(`- [ ] Run \`ng serve\` — smoke-test the app at runtime`);
  if (report.modernize.standalone) {
    lines.push(`- [ ] **NG0302** — If you see "Component X is not a known element", add the missing component/pipe/directive to the \`imports: []\` array of the component that uses it`);
  }
  if (report.modernize.untypedFormsFixed > 0) {
    lines.push(`- [ ] **Typed forms** — \`UntypedForm*\` was replaced with typed equivalents. \`ng build\` will surface any \`form.get('field')\` calls that now need an explicit generic type`);
  }
  lines.push(``);

  lines.push(`### 🟠 High priority`);
  lines.push(``);
  lines.push(`- [ ] **Signals** — Convert internal component state to \`signal()\` manually (\`isLoading\`, \`items\`, etc.) — no official schematic exists for this`);
  lines.push(`- [ ] **viewChild.required()** — Use \`viewChild.required(Foo)\` when the queried element is always present in the DOM (not inside \`@if\`/\`*ngIf\`). It gives you a non-nullable \`Signal<T>\` instead of \`Signal<T | undefined>\``);
  lines.push(`- [ ] **Memory leaks** — Review \`valueChanges.subscribe()\` and other long-lived observables. Add \`.pipe(takeUntilDestroyed(this.destroyRef))\` to avoid leaks when the component is destroyed`);
  if (report.notes.some(n => n.includes('importProvidersFrom'))) {
    lines.push(`- [ ] **importProvidersFrom()** in \`app.config.ts\` — convert remaining NgModule wrappers to functional providers (\`provideHttpClient()\`, \`provideRouter()\`, etc.)`);
  }
  lines.push(``);

  lines.push(`### 🟡 Medium priority`);
  lines.push(``);
  if (!report.modernize.eslintAdded) {
    lines.push(`- [ ] **ESLint** — Run \`ng add @angular/eslint\` to enable linting (TSLint was removed during migration)`);
  }
  if (report.modernize.standalone) {
    if (report.modernize.lazyRoutesConverted > 0) {
      lines.push(`- [ ] **Lazy routes** — NgModule-based routes were converted to routes files. Consider \`loadComponent\` for leaf routes to reduce bundle granularity further`);
    } else {
      lines.push(`- [ ] **Lazy routes** — Check for \`loadChildren: () => import('./foo.module')\` still pointing to NgModules. Convert to \`.routes.ts\` files or \`loadComponent\``);
    }
  }
  lines.push(`- [ ] **ChangeDetectionStrategy.OnPush** — Add \`changeDetection: ChangeDetectionStrategy.OnPush\` to components that only update via signal/async inputs, especially those rendering large lists`);
  if (existsSync(join(destPath, 'src', 'app', 'app-routing.module.ts'))) {
    lines.push(`- [ ] Delete \`app-routing.module.ts\` — routes are now in \`app.routes.ts\``);
  }
  lines.push(``);

  // Files changed (git diff --stat between initial snapshot and HEAD) — only on final write
  if (report.initialCommit) {
    const stat = capture(`git diff --stat ${report.initialCommit} HEAD -- ':(exclude)package-lock.json'`);
    if (stat) {
      lines.push(`## Files changed`);
      lines.push(``);
      lines.push('```');
      lines.push(stat);
      lines.push('```');
      lines.push(``);
    }

    // Full diff saved as patch for before/after inspection
    const fullDiff = capture(`git diff ${report.initialCommit} HEAD -- ':(exclude)package-lock.json'`);
    if (fullDiff) {
      const patchPath = join(migratorDir, 'MIGRATION.patch');
      writeFileSync(patchPath, fullDiff);
      lines.push(`> Full before/after diff saved to \`.ng-migrator/MIGRATION.patch\``);
      lines.push(``);
      console.log(`  📄 Diff completo salvo em: ${patchPath}`);
    }
  }

  const reportPath = join(migratorDir, 'MIGRATION-REPORT.md');
  writeFileSync(reportPath, lines.join('\n'));
  console.log(`\n  📄 Relatório final gravado em: ${reportPath}`);
}
