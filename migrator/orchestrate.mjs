import { spawnSync } from 'child_process';
import { existsSync, readdirSync, statSync, readFileSync } from 'fs';
import { join } from 'path';
import { destPath, report, skipSteps, SKIP_DIRS } from './context.mjs';
import { capture, run, runUntilStable, captureGitDiff } from './utils.mjs';
import { hasPackage } from './packages.mjs';
import { writeMigrationData } from './report.mjs';
import {
  fixNgModuleImports, copyModuleImportsToComponents, fixStandaloneImports,
  fixMissingStandalone, removeImportsFromNonStandalone, cleanupStandaloneTodos,
  convertOrphanedNonStandalone, collectStandaloneFalseCount, fixCircularStandaloneImports,
  invalidateProjectIndex,
} from './standalone.mjs';
import { convertLazyModulesToRoutes, convertRemainingRoutingModules, removeUnusedModules } from './modules.mjs';
import {
  fixUntypedForms, fixReservedKeywordVariables, fixThrowError, fixTsCompat,
  fixMomentImport, fixSubjectVoid, fixSassImports, fixStyleUrls, inlinePolyfills,
  modernizeTsconfig, addTsconfigPathAliases, migrateToApplicationBuilder, addEslint,
} from './transforms.mjs';
import { createAppConfigAndRoutes } from './app-config.mjs';
import { migrateFlexLayoutToTailwind } from './flex-layout.mjs';

export function runModernizationMigrations() {
  let prevHash = capture('git rev-parse HEAD');

  function hasEslintConfig() {
    return existsSync(join(destPath, 'eslint.config.js'))
      || existsSync(join(destPath, '.eslintrc.json'))
      || existsSync(join(destPath, '.eslintrc.js'))
      || existsSync(join(destPath, '.eslintrc.cjs'));
  }

  // Grava o passo atual no git, captura o diff vs passo anterior e atualiza o relatório
  function commitStep(key, label) {
    run('git add -A');
    run(`git commit --allow-empty -m "refactor: ${label ?? key}"`, { ignoreError: true });
    const h = capture('git rev-parse HEAD');
    report.details[key] = captureGitDiff(prevHash, h);
    prevHash = h;
    writeMigrationData();
  }

  // 0. @angular/flex-layout → Tailwind CSS
  if (!skipSteps.has('flexLayout') && (hasPackage('@angular/flex-layout') || (() => {
    // Verifica se há atributos fx* nos templates (o pacote já foi removido do package.json no preflight)
    const hasFx = (dir) => {
      try {
        for (const e of readdirSync(dir)) {
          const full = join(dir, e);
          if (statSync(full).isDirectory() && !SKIP_DIRS.has(e)) { if (hasFx(full)) return true; continue; }
          if (e.endsWith('.html') && readFileSync(full, 'utf8').match(/\bfx[A-Z]/)) return true;
        }
      } catch { }
      return false;
    };
    return hasFx(join(destPath, 'src'));
  })())) {
    console.log(`\n  🔄 @angular/flex-layout → Tailwind CSS...`);
    report.modernize.flexLayoutMigrated = migrateFlexLayoutToTailwind();
    commitStep('flexLayout', '@angular/flex-layout → Tailwind');
  }

  // 1. inject(): constructor DI → inject()
  if (!skipSteps.has('inject')) {
    console.log(`\n  🔄 inject()  (constructor DI → inject())...`);
    run('npx ng generate @angular/core:inject-migration --defaults', { ignoreError: true });
    report.modernize.inject = true;
    commitStep('inject', 'inject()');
  }

  // 2. signals: @Input/@Output/@ViewChild → signal APIs
  if (!skipSteps.has('signals')) {
    console.log(`\n  🔄 signals  (@Input/@Output/@ViewChild → signal APIs)...`);
    run('npx ng generate @angular/core:signals --defaults --best-effort-mode', { ignoreError: true });
    report.modernize.signals = true;
    commitStep('signals', 'signals');
  }

  // 2b-extra. Renomeia variáveis geradas com nomes de palavras reservadas (ex: `const for = ...`)
  if (!skipSteps.has('reservedKeywords')) {
    console.log(`\n  🔄 reserved keywords  (renomeia variáveis com nomes reservados)...`);
    report.modernize.reservedKeywordsFixed = fixReservedKeywordVariables();
    if (report.modernize.reservedKeywordsFixed > 0) commitStep('reservedKeywords', 'reserved keyword variables');
  }

  // 2b. UntypedForm* → typed forms (ponte de migração v14, obsoleta no v21)
  if (!skipSteps.has('untypedForms')) {
    report.modernize.untypedFormsFixed = fixUntypedForms();
    commitStep('untypedForms', 'untyped forms');
  }

  // 2c. throwError() → factory function (RxJS 7) + fixes RxJS/TS compat
  if (!skipSteps.has('throwError')) {
    console.log(`\n  🔄 throwError  (RxJS 7 factory function)...`);
    report.modernize.throwErrorFixed = fixThrowError();
    fixSubjectVoid();
    fixMomentImport();
    fixTsCompat();
    commitStep('throwError', 'throwError factory + RxJS/TS fixes');
  }

  // 3. standalone migration (3 passos obrigatórios em sequência)
  if (!skipSteps.has('standalone')) {
    console.log(`\n  🔄 standalone  (pre-fix NgModule imports)...`);
    fixNgModuleImports();

    runUntilStable(
      'npx ng generate @angular/core:standalone-migration --mode convert-to-standalone --defaults',
      'standalone  (convert-to-standalone)',
    );
    console.log(`\n  🔄 standalone  (copy all module imports to components)...`);
    copyModuleImportsToComponents();

    console.log(`\n  🔄 standalone  (prune-ng-modules)...`);
    run('npx ng generate @angular/core:standalone-migration --mode prune-ng-modules --defaults', { ignoreError: true });
    cleanupStandaloneTodos();
    convertOrphanedNonStandalone();
    console.log(`\n  🔄 standalone  (standalone-bootstrap)...`);
    run('npx ng generate @angular/core:standalone-migration --mode standalone-bootstrap --defaults', { ignoreError: true });
    report.modernize.standalone = true;
    invalidateProjectIndex(); // invalidate cache: new standalone components were just created
    commitStep('standalone', 'standalone migration');
  }

  // 3b. Garante standalone: true em pipes/directives que o schematic ignorou
  if (!skipSteps.has('standaloneFixed')) {
    console.log(`\n  🔄 standalone  (fix missing standalone: true in pipes/directives)...`);
    report.modernize.standaloneFixed = fixMissingStandalone();
    removeImportsFromNonStandalone();
    console.log(`\n  🔄 standalone  (add missing Material/Angular imports)...`);
    report.modernize.standaloneFixed += fixStandaloneImports();
    console.log(`\n  🔄 standalone  (fix remaining NgModule imports for standalone:false components)...`);
    fixNgModuleImports();
    console.log(`\n  🔄 standalone  (fix circular imports with forwardRef)...`);
    fixCircularStandaloneImports();
    commitStep('standaloneFixed', 'standalone: true patch + imports');
  }

  // 3c. control-flow: *ngIf/*ngFor/*ngSwitch → @if/@for/@switch
  if (!skipSteps.has('controlFlow')) {
    runUntilStable(
      'npx ng generate @angular/core:control-flow',
      'control-flow  (*ngIf/*ngFor → @if/@for)',
    );
    report.modernize.controlFlow = true;
    commitStep('controlFlow', 'control-flow');
  }

  // 3d. [ngClass] → [class] bindings
  if (!skipSteps.has('ngClassToClass')) {
    console.log(`\n  🔄 ngClass → class bindings...`);
    run('npx ng generate @angular/core:ngclass-to-class', { ignoreError: true });
    report.modernize.ngClassToClass = true;
    commitStep('ngClassToClass', 'ngClass → class');
  }

  // 3e. [ngStyle] → [style] bindings
  if (!skipSteps.has('ngStyleToStyle')) {
    console.log(`\n  🔄 ngStyle → style bindings...`);
    run('npx ng generate @angular/core:ngstyle-to-style --best-effort-mode', { ignoreError: true });
    report.modernize.ngStyleToStyle = true;
    commitStep('ngStyleToStyle', 'ngStyle → style');
  }

  // 4. app.config.ts + app.routes.ts
  if (!skipSteps.has('appConfig')) {
    console.log(`\n  🔄 app.config.ts + app.routes.ts...`);
    createAppConfigAndRoutes();
    commitStep('appConfig', 'app.config.ts + app.routes.ts');
  }

  // 4b. Lazy NgModule → routes file (resolve NG0200)
  if (!skipSteps.has('lazyRoutes')) {
    console.log(`\n  🔄 lazy routes  (NgModule → routes file)...`);
    report.modernize.lazyRoutesConverted = convertLazyModulesToRoutes();
    if (report.modernize.standalone) {
      console.log(`\n  🔄 routing modules  (restantes → .routes.ts)...`);
      convertRemainingRoutingModules();
    }
    commitStep('lazyRoutes', 'lazy routes');
  }

  // 5. Vite/esbuild builder
  if (!skipSteps.has('builder')) {
    migrateToApplicationBuilder();
    report.modernize.builder = true;
    commitStep('builder', 'application builder');
  }

  // 5b. polyfills.ts → inline zone.js em angular.json
  if (!skipSteps.has('polyfills')) {
    console.log(`\n  🔄 polyfills  (inline zone.js em angular.json)...`);
    report.modernize.polyfillsInlined = inlinePolyfills();
    commitStep('polyfills', 'polyfills inline');
  }

  // 6. Moderniza tsconfig (ES2022 / bundler / useDefineForClassFields)
  if (!skipSteps.has('tsconfig')) {
    console.log(`\n  🔄 tsconfig  (ES2022, moduleResolution→bundler)...`);
    report.modernize.tsconfigModernized = modernizeTsconfig();
    commitStep('tsconfig', 'tsconfig ES2022/bundler');
  }

  // 6b. Path aliases
  if (!skipSteps.has('pathAliases')) {
    console.log(`\n  🔄 path aliases no tsconfig...`);
    addTsconfigPathAliases();
    report.modernize.pathAliases = true;
    commitStep('pathAliases', 'tsconfig path aliases');
  }

  // 6c. ESLint
  if (!skipSteps.has('eslint')) {
    console.log(`\n  🔄 ESLint  (@angular/eslint)...`);
    report.modernize.eslintAdded = addEslint();
    commitStep('eslint', 'ESLint');
  }

  // 7. SCSS @import → @use as *
  if (!skipSteps.has('sass')) {
    console.log(`\n  🔄 SCSS  (@import → @use as *)...`);
    report.modernize.sassImports = fixSassImports();
    commitStep('sass', 'SCSS @use');
  }

  // 8. Remove .module.ts que não são mais referenciados
  if (!skipSteps.has('modules')) {
    console.log(`\n  🔄 módulos  (removendo .module.ts obsoletos)...`);
    report.modernize.modulesRemoved = removeUnusedModules();
    if (report.modernize.standalone) {
      const newlyConverted = convertOrphanedNonStandalone();
      if (newlyConverted > 0) {
        console.log(`\n  🔄 standalone  (fix imports for ${newlyConverted} component(s) promoted after module removal)...`);
        fixStandaloneImports();
      }
      // Second standalone pass: now that lazy-routing modules and unused modules are gone,
      // the Angular schematic can convert components it previously marked standalone: false.
      const remaining = collectStandaloneFalseCount();
      if (remaining > 0) {
        console.log(`\n  🔄 standalone  (second pass — ${remaining} component(s) still standalone: false)...`);
        runUntilStable(
          'npx ng generate @angular/core:standalone-migration --mode convert-to-standalone --defaults',
          'standalone  (second pass — convert-to-standalone)',
        );
        run('npx ng generate @angular/core:standalone-migration --mode prune-ng-modules --defaults', { ignoreError: true });
        cleanupStandaloneTodos();
        const secondPassConverted = convertOrphanedNonStandalone();
        invalidateProjectIndex(); // freshly-converted components need a rebuilt index
        if (secondPassConverted > 0) fixStandaloneImports();
        fixMissingStandalone(); // handles standalone: false + no imports (Angular 19 case)
        removeImportsFromNonStandalone();
        fixStandaloneImports(); // populate imports for components just promoted by fixMissingStandalone
      }
    }
    commitStep('modules', 'remove unused modules');
  }

  // 9. styleUrls → styleUrl (Angular 19+)
  if (!skipSteps.has('styleUrl')) {
    console.log(`\n  🔄 styleUrls → styleUrl...`);
    report.modernize.styleUrlFixed = fixStyleUrls();
    commitStep('styleUrl', 'styleUrls → styleUrl');
  }

  // 10. self-closing tags
  if (!skipSteps.has('selfClosing')) {
    console.log(`\n  🔄 self-closing tags...`);
    run('npx ng generate @angular/core:self-closing-tag', { ignoreError: true });
    report.modernize.selfClosingTags = true;
    commitStep('selfClosing', 'self-closing tags');
  }

  // 11. cleanup unused imports (deve rodar por último, após todas as migrações de template)
  if (!skipSteps.has('cleanupImports')) {
    console.log(`\n  🔄 cleanup unused imports...`);
    run('npx ng generate @angular/core:cleanup-unused-imports', { ignoreError: true });
    fixMissingStandalone();
    removeImportsFromNonStandalone();
    fixTsCompat();
    const reFixed = fixStandaloneImports();
    if (reFixed > 0) {
      run('git add -A');
      run('git commit -m "fix: restore standalone imports removed by cleanup" --allow-empty');
    }
    report.modernize.cleanupImports = true;
    commitStep('cleanupImports', 'cleanup unused imports');
  }

  // Lint fix único no final — não contamina diffs de steps individuais
  if (!skipSteps.has('lintFix') && hasEslintConfig()) {
    console.log(`\n  🔄 ESLint --fix  (passo final)...`);
    run('npx ng lint --fix', { ignoreError: true });
    run('git add -A');
    const staged = spawnSync('git', ['diff', '--staged', '--quiet'], { cwd: destPath });
    if (staged.status !== 0) {
      run('git commit -m "chore: eslint --fix"', { ignoreError: true });
      const h = capture('git rev-parse HEAD');
      report.details['lintFix'] = captureGitDiff(prevHash, h);
      prevHash = h;
      report.modernize.lintFixed = 1;
    }
    writeMigrationData();
  }
}
