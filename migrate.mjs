#!/usr/bin/env node
/**
 * ng-migrator — Angular gradual migration via ng update
 *
 * Copia o projeto e executa ng update incrementalmente em cada major version,
 * aproveitando os schematics oficiais do Angular para cada passo.
 *
 * Uso:
 *   node migrate.mjs                        # migra ./  → ./-ng21
 *   node migrate.mjs ./meu-projeto          # migra pasta específica
 *   node migrate.mjs ./proj --to 17         # migra até v17
 *   node migrate.mjs ./proj --dry-run       # simula sem gravar
 *   node migrate.mjs ./proj --from 14       # começa a partir de v14 (projeto já em v14)
 *   node migrate.mjs ./proj --no-modernize   # pula inject()/signals/output() migration
 */

import { spawnSync } from 'child_process';
import {
  readFileSync, writeFileSync, existsSync,
  readdirSync, statSync, mkdirSync, copyFileSync, unlinkSync,
} from 'fs';
import { join, resolve, dirname, basename, relative } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── CLI args ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const sourceArg = args.find(a => !a.startsWith('--')) ?? '.';

const opts = {
  to:     parseInt(args.includes('--to')   ? args[args.indexOf('--to')   + 1] : '21'),
  from:   args.includes('--from') ? parseInt(args[args.indexOf('--from') + 1]) : null,
  dest:   args.includes('--dest') ? resolve(args[args.indexOf('--dest')  + 1]) : null,
  dryRun: args.includes('--dry-run'),
  modernize: !args.includes('--no-modernize'),
};

const sourcePath = resolve(sourceArg);
const destPath   = opts.dest ?? `${sourcePath}-ng${opts.to}`;

// Accumulated during the pipeline; written to MIGRATION-REPORT.md at the end.
const report = {
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
    sassImports: 0,
    modulesRemoved: 0,
  },
  filesCreated: [],
  notes: [],
  details: {},   // key → [{path, action, lines}]
};

// ─── Utilitários de arquivo ───────────────────────────────────────────────────

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.angular', 'coverage', '.cache', 'e2e']);

// ─── Helpers de diff / tracking ──────────────────────────────────────────────

function parseAddedLines(diffText) {
  const lines = [];
  let cur = 0;
  for (const line of (diffText ?? '').split('\n')) {
    const m = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (m) { cur = parseInt(m[1]) - 1; continue; }
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) lines.push(cur + 1);
    if (!line.startsWith('-')) cur++;
  }
  return [...new Set(lines)];
}

function formatRanges(lines) {
  if (!lines?.length) return '';
  const sorted = [...new Set(lines)].sort((a, b) => a - b);
  const ranges = [];
  let s = sorted[0], e = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === e + 1) { e = sorted[i]; }
    else { ranges.push(s === e ? `${s}` : `${s}–${e}`); s = e = sorted[i]; }
  }
  ranges.push(s === e ? `${s}` : `${s}–${e}`);
  return ranges.join(', ');
}

function captureGitDiff(h0, h1) {
  if (!h0 || !h1 || h0 === h1) return [];
  const raw = capture(`git diff ${h0} ${h1} --name-status -- ':!package-lock.json'`);
  if (!raw) return [];
  const result = [];
  for (const line of raw.split('\n').filter(Boolean)) {
    const parts = line.split('\t');
    const status = parts[0][0];          // A/M/D/R
    const path = parts[parts.length - 1];
    if (status === 'D') { result.push({ path, action: 'deleted', lines: [] }); continue; }
    const diff = capture(`git diff ${h0} ${h1} -- "${path}"`);
    result.push({ path, action: status === 'A' ? 'created' : 'modified', lines: parseAddedLines(diff) });
  }
  return result;
}

function copyDir(src, dst) {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src)) {
    if (SKIP_DIRS.has(entry)) continue;
    const s = join(src, entry), d = join(dst, entry);
    statSync(s).isDirectory() ? copyDir(s, d) : copyFileSync(s, d);
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, obj) {
  writeFileSync(path, JSON.stringify(obj, null, 2) + '\n');
}

// ─── Execução de comandos ────────────────────────────────────────────────────

function run(cmd, { cwd = destPath, ignoreError = false } = {}) {
  console.log(`  $ ${cmd}`);
  const result = spawnSync(cmd, {
    shell: true,
    cwd,
    stdio: 'inherit',
    env: { ...process.env, FORCE_COLOR: '1', CI: '1' },
  });
  if (!ignoreError && result.status !== 0) {
    console.error(`\n  ✘ Comando falhou (exit ${result.status}): ${cmd}`);
  }
  return result;
}

function capture(cmd, cwd = destPath) {
  const result = spawnSync(cmd, {
    shell: true, cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CI: '1' },
  });
  return result.stdout?.toString().trim() ?? '';
}

function npmInstall() {
  let r = run('npm install', { ignoreError: true });
  if (r.status !== 0) {
    console.log('  ↳ Tentando com --legacy-peer-deps...');
    r = run('npm install --legacy-peer-deps', { ignoreError: true });
  }
  return r;
}

// ─── Leitura de package.json ─────────────────────────────────────────────────

function getPkg() {
  return readJson(join(destPath, 'package.json'));
}

function hasPackage(name) {
  const pkg = getPkg();
  return !!(pkg.dependencies?.[name] ?? pkg.devDependencies?.[name]);
}

function getMajor(versionStr = '') {
  const m = versionStr.match(/(\d+)/);
  return m ? parseInt(m[1]) : 0;
}

function getInstalledMajor(name) {
  const pkg = getPkg();
  const v = pkg.dependencies?.[name] ?? pkg.devDependencies?.[name] ?? '';
  return getMajor(v);
}

// ─── Pré-voo: limpa o package.json antes do primeiro install ────────────────

function preflight() {
  const pkgPath = join(destPath, 'package.json');
  const pkg = readJson(pkgPath);
  let changed = false;

  // Remove scripts com ngcc (removido no Angular 16+)
  if (pkg.scripts) {
    for (const [key, val] of Object.entries(pkg.scripts)) {
      if (typeof val === 'string' && val.includes('ngcc')) {
        delete pkg.scripts[key];
        console.log(`  ↳ scripts.${key} removido (ngcc obsoleto)`);
        changed = true;
      }
    }
  }

  // Remove pacotes completamente obsoletos
  for (const name of [
    'codelyzer', 'tslint', 'protractor',
    '@types/jasminewd2',               // tipagens WebDriver2, exclusivas do Protractor
    'jasmine-spec-reporter',            // reporter do protractor.conf.js, nunca usado pelo Karma
  ]) {
    for (const section of ['dependencies', 'devDependencies']) {
      if (pkg[section]?.[name]) {
        delete pkg[section][name];
        console.log(`  ↳ ${name} removido (obsoleto)`);
        changed = true;
      }
    }
  }

  // core-js não é necessário em Angular 12+ com evergreen browsers
  if (pkg.dependencies?.['core-js']) {
    delete pkg.dependencies['core-js'];
    console.log('  ↳ core-js removido (desnecessário em Angular 12+)');
    changed = true;
  }

  // Script e2e usa Protractor, removido do Angular no v15
  if (pkg.scripts?.e2e) {
    delete pkg.scripts.e2e;
    console.log('  ↳ scripts.e2e removido (Protractor obsoleto)');
    changed = true;
  }

  // Atualiza devDependencies com versões muito defasadas
  const DEV_BUMPS = {
    '@types/node':    '^20.0.0',  // Angular 21 requer Node 18+; ^12 é de 2019
    'ts-node':        '~10.0.0',  // ~7 é de 2018
    '@types/jasmine': '~5.1.0',   // ~3.8 é de 2021; 5.0.0 não existe, atual é 5.1.x
    'jasmine-core':   '~5.1.0',   // ~3.8 é de 2021; atual é 5.x
  };
  for (const [name, version] of Object.entries(DEV_BUMPS)) {
    for (const section of ['dependencies', 'devDependencies']) {
      if (pkg[section]?.[name] && getMajor(pkg[section][name]) < getMajor(version)) {
        pkg[section][name] = version;
        console.log(`  ↳ ${name} → ${version}`);
        changed = true;
      }
    }
  }

  // karma-coverage-istanbul-reporter (deprecated desde Angular 12) → karma-coverage
  for (const section of ['dependencies', 'devDependencies']) {
    if (pkg[section]?.['karma-coverage-istanbul-reporter']) {
      delete pkg[section]['karma-coverage-istanbul-reporter'];
      pkg[section]['karma-coverage'] = '^2.2.1';
      console.log('  ↳ karma-coverage-istanbul-reporter → karma-coverage');
      changed = true;
    }
  }

  // Remove dependências instaladas mas não utilizadas no código
  for (const name of ['toastr']) {
    for (const section of ['dependencies', 'devDependencies']) {
      if (!pkg[section]?.[name]) continue;
      const used = scanForContent(`'${name}'`) || scanForContent(`"${name}"`);
      if (!used) {
        delete pkg[section][name];
        console.log(`  ↳ ${name} removido (não utilizado no projeto)`);
        changed = true;
      }
    }
  }

  if (changed) writeJson(pkgPath, pkg);
}

// ─── Remove arquivos e entradas legadas ──────────────────────────────────────

function cleanupLegacyFiles() {
  // tslint.json (root e src/) — TSLint não tem suporte desde Angular 12
  for (const rel of ['tslint.json', 'src/tslint.json']) {
    const p = join(destPath, rel);
    if (existsSync(p)) { unlinkSync(p); console.log(`  ↳ ${rel} removido (TSLint obsoleto)`); }
  }

  // angular.json: remove projeto e2e (Protractor) e referência ao script e2e
  const ngPath = join(destPath, 'angular.json');
  if (!existsSync(ngPath)) return;
  let ng;
  try { ng = readJson(ngPath); } catch { return; }
  let changed = false;

  for (const [name, proj] of Object.entries(ng.projects ?? {})) {
    const e2eBuilder = proj.architect?.e2e?.builder ?? '';
    if (e2eBuilder.includes('protractor')) {
      delete ng.projects[name];
      console.log(`  ↳ angular.json: projeto "${name}" removido (Protractor obsoleto)`);
      changed = true;
    }
  }

  if (changed) writeJson(ngPath, ng);

  fixKarmaConf();
}

function fixKarmaConf() {
  const karmaPath = join(destPath, 'src', 'karma.conf.js');
  if (!existsSync(karmaPath)) return;
  let src = readFileSync(karmaPath, 'utf8');
  if (!src.includes('karma-coverage-istanbul-reporter')) return;

  let out = src
    .replace(/require\("karma-coverage-istanbul-reporter"\)/g, 'require("karma-coverage")')
    .replace(/"karma-coverage-istanbul-reporter"/g, '"coverage"');

  // Substitui coverageIstanbulReporter: { ... } → coverageReporter (bracket-counting)
  const keyIdx = out.indexOf('coverageIstanbulReporter');
  if (keyIdx !== -1) {
    const braceStart = out.indexOf('{', keyIdx);
    if (braceStart !== -1) {
      let depth = 0, end = -1;
      for (let i = braceStart; i < out.length; i++) {
        if (out[i] === '{') depth++;
        else if (out[i] === '}') { if (--depth === 0) { end = i; break; } }
      }
      if (end !== -1) {
        const replacement = `coverageReporter: {\n      dir: require("path").join(__dirname, "../coverage"),\n      reporters: [{ type: "html" }, { type: "lcovonly" }, { type: "text-summary" }],\n    }`;
        out = out.slice(0, keyIdx) + replacement + out.slice(end + 1);
      }
    }
  }

  if (out !== src) {
    writeFileSync(karmaPath, out);
    console.log('  ↳ karma.conf.js: coverageIstanbulReporter → coverageReporter (karma-coverage)');
  }
}

// ─── Sincroniza versões que o ng update não bumpa automaticamente ────────────
// Garante que nenhum pacote @angular/* ficou para trás após o ng update.

function syncVersions(targetVersion) {
  const pkgPath = join(destPath, 'package.json');
  const pkg = readJson(pkgPath);
  let changed = false;

  const ANGULAR_PKGS = [
    '@angular/animations', '@angular/cdk', '@angular/cli',
    '@angular/common', '@angular/compiler', '@angular/compiler-cli',
    '@angular/core', '@angular/forms', '@angular/language-service',
    '@angular/material', '@angular/platform-browser',
    '@angular/platform-browser-dynamic', '@angular/router',
    '@angular-devkit/build-angular',
  ];

  for (const section of ['dependencies', 'devDependencies']) {
    if (!pkg[section]) continue;
    for (const name of ANGULAR_PKGS) {
      if (!pkg[section][name]) continue;
      const current = getMajor(pkg[section][name]);
      if (current > 0 && current < targetVersion) {
        pkg[section][name] = `^${targetVersion}.0.0`;
        console.log(`  ↳ ${name}: ${current} → ${targetVersion} (forçado)`);
        changed = true;
      }
    }
  }

  // rxjs: garante v7 a partir do Angular 14+
  if (targetVersion >= 14 && pkg.dependencies?.rxjs) {
    if (getMajor(pkg.dependencies.rxjs) < 7) {
      pkg.dependencies.rxjs = '~7.8.0';
      console.log(`  ↳ rxjs: 6 → 7 (forçado)`);
      changed = true;
    }
  }

  // zone.js: v0.14+ para Angular 17+, v0.15+ para Angular 21+
  if (pkg.dependencies?.['zone.js']) {
    const target = targetVersion >= 21 ? '~0.15.0' : targetVersion >= 17 ? '~0.14.0' : null;
    if (target && getMajor(pkg.dependencies['zone.js']) < getMajor(target)) {
      pkg.dependencies['zone.js'] = target;
      console.log(`  ↳ zone.js → ${target} (forçado)`);
      changed = true;
    }
  }

  if (changed) {
    writeJson(pkgPath, pkg);
    console.log('  ↳ Reinstalando após sync de versões...');
    npmInstall();
  }
}

// ─── Material legacy → MDC ───────────────────────────────────────────────────
// ng update @angular/material@15 renames imports to MatLegacy*/legacy-*, but
// the v17 schematic refuses to auto-migrate them. We do it manually here.

function fixLegacyMaterial() {
  let count = 0;

  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!entry.endsWith('.ts')) continue;

      let src = readFileSync(full, 'utf8');
      if (!src.includes('legacy')) continue;

      // 1. Strip /legacy- from import paths
      let out = src.replace(/@angular\/material\/legacy-/g, '@angular/material/');

      // 2. MatLegacyFoo as MatFoo  →  MatFoo   (alias matches stripped name)
      out = out.replace(/MatLegacy([A-Z][a-zA-Z0-9]*)\s+as\s+Mat([A-Z][a-zA-Z0-9]*)/g,
        (_m, _leg, alias) => `Mat${alias}`);

      // 3. Remaining MatLegacy*  →  Mat*
      out = out.replace(/MatLegacy([A-Z][a-zA-Z0-9]*)/g, 'Mat$1');

      // 4. MAT_LEGACY_FOO as MAT_FOO  →  MAT_FOO
      out = out.replace(/MAT_LEGACY_([A-Z0-9_]+)\s+as\s+MAT_([A-Z0-9_]+)/g,
        (_m, _leg, alias) => `MAT_${alias}`);

      // 5. Remaining MAT_LEGACY_*  →  MAT_*
      out = out.replace(/MAT_LEGACY_([A-Z0-9_]+)/g, 'MAT_$1');

      if (out !== src) { writeFileSync(full, out); count++; }
    }
  }

  walk(destPath);
  if (count > 0) {
    report.materialLegacyFixed += count;
    console.log(`  ↳ Material legacy migrado: ${count} arquivo(s)`);
  }
}

// ─── Busca em arquivos do projeto ────────────────────────────────────────────

function scanForContent(needle, extensions = ['.ts', '.html']) {
  const extSet = new Set(extensions);
  let found = false;
  function walk(dir) {
    if (found) return;
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!extSet.has(full.slice(full.lastIndexOf('.')))) continue;
      if (readFileSync(full, 'utf8').includes(needle)) { found = true; }
    }
  }
  const srcDir = join(destPath, 'src');
  if (existsSync(srcDir)) walk(srcDir);
  return found;
}

// ─── Modernização: inject() + signals + standalone ──────────────────────────
// Schematics oficiais do Angular para modernizar APIs (disponíveis no v14+/v17+).
// Nota: estado interno de componente (isLoading, etc.) NÃO tem schematic oficial —
// requer refactoring manual pois envolve semântica de negócio.

function runUntilStable(cmd, label, maxPasses = 5) {
  for (let i = 0; i < maxPasses; i++) {
    console.log(`\n  🔄 ${label}${i > 0 ? ` (pass ${i + 1})` : ''}...`);
    const result = spawnSync(cmd, {
      shell: true, cwd: destPath, stdio: ['inherit', 'pipe', 'inherit'],
      env: { ...process.env, FORCE_COLOR: '1', CI: '1' },
    });
    const out = result.stdout?.toString() ?? '';
    process.stdout.write(out);
    if (out.includes('Nothing to be done')) break;
  }
}

// ─── UntypedForm* → typed forms ──────────────────────────────────────────────
// UntypedFormBuilder/Group/Control/Array existiam como ponte de migração no v14.
// No Angular 21 usa-se diretamente FormBuilder com typed forms.

function fixUntypedForms() {
  const REPLACEMENTS = [
    ['UntypedFormBuilder', 'FormBuilder'],
    ['UntypedFormGroup',   'FormGroup'],
    ['UntypedFormControl', 'FormControl'],
    ['UntypedFormArray',   'FormArray'],
  ];

  let count = 0;
  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!entry.endsWith('.ts')) continue;
      let src = readFileSync(full, 'utf8');
      if (!REPLACEMENTS.some(([from]) => src.includes(from))) continue;

      let out = src;
      for (const [from, to] of REPLACEMENTS) out = out.replaceAll(from, to);

      // Deduplica imports de @angular/forms (evita duplicatas após substituição)
      out = out.replace(
        /import\s*\{([^}]+)\}\s*from\s*'@angular\/forms'\s*;/g,
        (_, names) => {
          const unique = [...new Set(names.split(',').map(n => n.trim()).filter(Boolean))].join(', ');
          return `import { ${unique} } from '@angular/forms';`;
        },
      );

      if (out !== src) { writeFileSync(full, out); count++; }
    }
  }

  walk(join(destPath, 'src'));
  if (count > 0) console.log(`  ↳ UntypedForm* → typed forms: ${count} arquivo(s)`);
  return count;
}

// ─── Lazy NgModule → routes file ─────────────────────────────────────────────
// loadChildren que apontam para NgModules com RouterModule.forChild causam
// NG0200 (circular dependency em Location) em Angular 21 com provideRouter.
// Convertemos para o padrão moderno: routes file com array de Routes.

function convertLazyModulesToRoutes() {
  let converted = 0;

  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!entry.endsWith('.ts')) continue;
      let src = readFileSync(full, 'utf8');
      if (!src.includes('loadChildren')) continue;

      let modified = false;
      src = src.replace(
        /loadChildren\s*:\s*\(\s*\)\s*=>\s*import\(\s*['"]([^'"]+\.module)['"]\s*\)\s*\.then\s*\(\s*m\s*=>\s*m\.(\w+Module)\s*\)/g,
        (match, importPath, moduleName) => {
          const thisDir = dirname(full);
          const moduleTsPath = join(thisDir, importPath + '.ts');
          if (!existsSync(moduleTsPath)) return match;

          const moduleDir = dirname(moduleTsPath);

          // Find routing module in the same directory
          const routingFile = readdirSync(moduleDir).find(
            f => f.includes('routing') && f.endsWith('.ts') && !f.endsWith('.spec.ts'));
          if (!routingFile) return match;

          const routingContent = readFileSync(join(moduleDir, routingFile), 'utf8');
          const routesBlock = extractBracketBlock(routingContent, 'const routes: Routes =');
          if (!routesBlock) return match;

          // Component imports from routing module (skip router/NgModule imports)
          const compImports = (routingContent.match(/^import\s+.+;$/gm) ?? [])
            .filter(l => !l.includes('@angular/router') && !l.includes('NgModule'));

          const routesFileName = basename(moduleTsPath).replace('.module.ts', '.routes.ts');
          const newRoutesPath = join(moduleDir, routesFileName);
          if (existsSync(newRoutesPath)) return match; // already done

          const exportName = moduleName.replace(/Module$/, 'Routes');
          writeFileSync(newRoutesPath, [
            `import { Routes } from '@angular/router';`,
            ...compImports,
            ``,
            `export const ${exportName}: Routes = ${routesBlock};`,
            ``,
          ].join('\n'));
          console.log(`  ↳ ${routesFileName} criado`);
          // Routing module superseded by the new routes file
          unlinkSync(join(moduleDir, routingFile));
          console.log(`  ↳ ${routingFile} removido`);

          const newImportPath = importPath.replace('.module', '.routes');
          modified = true;
          converted++;
          return `loadChildren: () => import('${newImportPath}').then(m => m.${exportName})`;
        },
      );

      if (modified) writeFileSync(full, src);
    }
  }

  const srcDir = join(destPath, 'src');
  if (existsSync(srcDir)) walk(srcDir);
  if (converted > 0) console.log(`  ↳ ${converted} lazy NgModule(s) → routes file(s)`);
  return converted;
}

// ─── Remove .module.ts não referenciados ─────────────────────────────────────
// Em Angular 21 standalone, NgModules são obsoletos. Após todas as conversões,
// qualquer .module.ts que não for importado por nenhum outro arquivo pode ser removido.

function removeUnusedModules() {
  const srcDir = join(destPath, 'src');
  if (!existsSync(srcDir)) return 0;

  // 1. Coleta todos os .module.ts
  const moduleFiles = [];
  function collect(dir) {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { collect(full); continue; }
      if (entry.endsWith('.module.ts')) moduleFiles.push(full);
    }
  }
  collect(srcDir);

  // 2. Constrói índice com o conteúdo de todos os .ts (exceto os próprios modules)
  const allTsContent = [];
  function indexTs(dir) {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { indexTs(full); continue; }
      if (!entry.endsWith('.ts') || entry.endsWith('.module.ts')) continue;
      allTsContent.push(readFileSync(full, 'utf8'));
    }
  }
  indexTs(srcDir);
  const combined = allTsContent.join('\n');

  // 3. Remove módulos não referenciados
  let removed = 0;
  for (const modulePath of moduleFiles) {
    const base = basename(modulePath, '.ts'); // ex: 'vacancy.module'
    const isReferenced = combined.includes(`/${base}'`) ||
                         combined.includes(`/${base}"`) ||
                         combined.includes(`/${base}\``);
    if (!isReferenced) {
      unlinkSync(modulePath);
      console.log(`  ↳ ${basename(modulePath)} removido`);
      removed++;
    }
  }
  return removed;
}

// ─── Garante standalone: true em @Pipe / @Directive ─────────────────────────
// O schematic de standalone migration às vezes adiciona um pipe/directive ao
// imports[] de um componente sem marcar o próprio decorator como standalone: true,
// causando NG0302. Corrigimos como pós-processamento.

function fixMissingStandalone() {
  let count = 0;
  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!entry.endsWith('.ts')) continue;
      let src = readFileSync(full, 'utf8');
      const hasPipeOrDirective = src.includes('@Pipe(') || src.includes('@Directive(');
      const hasComponent = src.includes('@Component({');
      if (!hasPipeOrDirective && !hasComponent) continue;

      let out = src;

      // @Pipe e @Directive: regex simples (corpos nunca têm chaves aninhadas)
      if (hasPipeOrDirective) {
        out = out.replace(/@(Pipe|Directive)\(\{([^}]*)\}\)/g, (match, dec, body) => {
          if (body.includes('standalone')) return match;
          const trimmed = body.trimEnd();
          const sep = trimmed.endsWith(',') ? '' : ',';
          return `@${dec}({${trimmed}${sep}\n  standalone: true\n})`;
        });
      }

      // @Component: bracket-counting (corpos contêm estruturas aninhadas)
      if (hasComponent) {
        const marker = '@Component({';
        let result = out;
        let offset = 0;
        while (true) {
          const idx = result.indexOf(marker, offset);
          if (idx === -1) break;
          let depth = 0, end = -1;
          for (let i = idx + marker.length - 1; i < result.length; i++) {
            if (result[i] === '{') depth++;
            else if (result[i] === '}') { if (--depth === 0) { end = i; break; } }
          }
          if (end === -1) break;
          if (!result.slice(idx, end + 1).includes('standalone:')) {
            const insertPos = idx + marker.length;
            result = result.slice(0, insertPos) + '\n  standalone: true,' + result.slice(insertPos);
            offset = insertPos + '\n  standalone: true,'.length;
          } else {
            offset = end + 1;
          }
        }
        out = result;
      }

      if (out !== src) { writeFileSync(full, out); count++; }
    }
  }
  const srcDir = join(destPath, 'src');
  if (existsSync(srcDir)) walk(srcDir);
  if (count > 0) console.log(`  ↳ standalone: true adicionado em ${count} arquivo(s)`);
  return count;
}

// ─── SCSS @import → @use ─────────────────────────────────────────────────────

function fixSassImports() {
  let count = 0;
  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!entry.endsWith('.scss')) continue;
      let src = readFileSync(full, 'utf8');
      // @import "~pkg" or @import "path" → @use "path" as *  (strips tilde prefix)
      const out = src.replace(/@import\s+(['"])(~?)([^'"]+)\1\s*;/g,
        (_, q, _tilde, path) => `@use ${q}${path}${q} as *;`);
      if (out !== src) { writeFileSync(full, out); count++; }
    }
  }
  const srcDir = join(destPath, 'src');
  if (existsSync(srcDir)) walk(srcDir);
  if (count > 0) console.log(`  ↳ SCSS @import → @use: ${count} arquivo(s)`);
  return count;
}

// ─── Vite/esbuild builder ────────────────────────────────────────────────────

function migrateToApplicationBuilder() {
  console.log(`\n  🔄 builder  (browser → application/esbuild)...`);
  run('npx ng update @angular/cli --name use-application-builder --force --allow-dirty', { ignoreError: true });
}

// ─── Moderniza tsconfig.json (ES2022 / bundler) ───────────────────────────────

function modernizeTsconfig() {
  const tsconfigPath = join(destPath, 'tsconfig.json');
  if (!existsSync(tsconfigPath)) return false;
  const tsconfig = readJson(tsconfigPath);
  if (!tsconfig.compilerOptions) tsconfig.compilerOptions = {};
  const co = tsconfig.compilerOptions;
  const changes = [];

  const modernTargets = ['ES2022', 'ES2023', 'ES2024', 'ESNext'];
  if (!modernTargets.includes(co.target)) { co.target = 'ES2022'; changes.push('target→ES2022'); }
  if (!modernTargets.includes(co.module)) { co.module = 'ES2022'; changes.push('module→ES2022'); }
  if (co.moduleResolution !== 'bundler') { co.moduleResolution = 'bundler'; changes.push('moduleResolution→bundler'); }
  if (co.useDefineForClassFields !== false) { co.useDefineForClassFields = false; changes.push('useDefineForClassFields→false'); }

  if (changes.length) {
    writeJson(tsconfigPath, tsconfig);
    console.log(`  ↳ tsconfig.json: ${changes.join(', ')}`);
  } else {
    console.log('  ↳ tsconfig.json já está moderno');
  }
  return changes.length > 0;
}

// ─── ESLint via @angular/eslint ───────────────────────────────────────────────

function addEslint() {
  const hasEslint = existsSync(join(destPath, '.eslintrc.json'))
    || existsSync(join(destPath, 'eslint.config.js'))
    || existsSync(join(destPath, 'eslint.config.mjs'));
  if (hasEslint) { console.log('  ↳ ESLint já configurado'); return false; }

  run('npx ng add @angular/eslint --skip-confirmation', { ignoreError: true });

  const added = existsSync(join(destPath, '.eslintrc.json'))
    || existsSync(join(destPath, 'eslint.config.js'))
    || existsSync(join(destPath, 'eslint.config.mjs'));
  if (added) console.log('  ↳ @angular/eslint configurado');
  else console.log('  ↳ ESLint: ng add falhou — adicione manualmente com: ng add @angular/eslint');
  return added;
}

// ─── Path aliases no tsconfig ─────────────────────────────────────────────────

function addTsconfigPathAliases() {
  const tsconfigPath = join(destPath, 'tsconfig.json');
  const tsconfig = readJson(tsconfigPath);
  if (tsconfig.compilerOptions?.paths) { console.log('  ↳ paths já existem no tsconfig.json'); return; }
  if (!tsconfig.compilerOptions) tsconfig.compilerOptions = {};
  tsconfig.compilerOptions.paths = {
    '@app/*':          ['src/app/*'],
    '@core/*':         ['src/app/core/*'],
    '@shared/*':       ['src/app/shared/*'],
    '@features/*':     ['src/app/features/*'],
    '@environments/*': ['src/environments/*'],
  };
  writeJson(tsconfigPath, tsconfig);
  console.log('  ↳ @app, @core, @shared, @features, @environments adicionados');
}

// ─── app.config.ts + app.routes.ts ───────────────────────────────────────────

function extractBracketBlock(content, prefix) {
  const idx = content.indexOf(prefix);
  if (idx === -1) return null;
  let pos = idx + prefix.length;
  while (pos < content.length && content[pos] !== '[') pos++;
  if (pos >= content.length) return null;
  let depth = 0;
  for (let i = pos; i < content.length; i++) {
    if (content[i] === '[') depth++;
    else if (content[i] === ']') { if (--depth === 0) return content.slice(pos, i + 1); }
  }
  return null;
}

function extractImportProvidersFromModules(content) {
  const idx = content.indexOf('importProvidersFrom(');
  if (idx === -1) return [];
  let depth = 0, start = idx + 'importProvidersFrom('.length, end = start;
  for (let i = start; i < content.length; i++) {
    if (content[i] === '(') depth++;
    else if (content[i] === ')') { if (depth === 0) { end = i; break; } depth--; }
  }
  return content.slice(start, end).split(',').map(m => m.trim()).filter(Boolean);
}

function createAppConfigAndRoutes() {
  const appDir   = join(destPath, 'src', 'app');
  const mainPath  = join(destPath, 'src', 'main.ts');
  const routingPath = join(appDir, 'app-routing.module.ts');
  const configPath  = join(appDir, 'app.config.ts');
  const routesPath  = join(appDir, 'app.routes.ts');

  if (existsSync(configPath)) { console.log('  ↳ app.config.ts já existe'); return; }

  const mainContent = existsSync(mainPath) ? readFileSync(mainPath, 'utf8') : '';

  // 1. app.routes.ts — extrai o array de rotas do routing module
  let hasRoutes = existsSync(routesPath);
  if (!hasRoutes && existsSync(routingPath)) {
    const routingContent = readFileSync(routingPath, 'utf8');
    const routesBlock = extractBracketBlock(routingContent, 'const routes: Routes =');
    if (routesBlock) {
      const extraImports = (routingContent.match(/^import\s+.+;$/gm) ?? [])
        .filter(l => !l.includes('@angular/router') && !l.includes('NgModule') && !l.includes('RouterModule'));
      writeFileSync(routesPath, [
        `import { Routes } from '@angular/router';`,
        ...extraImports,
        ``,
        `export const routes: Routes = ${routesBlock};`,
        ``,
      ].join('\n'));
      console.log('  ↳ app.routes.ts criado');
      report.modernize.appRoutes = true;
      report.filesCreated.push('src/app/app.routes.ts');
      hasRoutes = true;
      // Routing module is now superseded by app.routes.ts
      unlinkSync(routingPath);
      console.log('  ↳ app-routing.module.ts removido');
    }
  }

  // 2. app.config.ts — converte importProvidersFrom() para providers funcionais
  const modules = extractImportProvidersFromModules(mainContent);
  const configImports = [`import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';`];
  const providers     = [`provideZoneChangeDetection({ eventCoalescing: true })`];
  const unknownMods   = [];

  if (hasRoutes) {
    providers.push(`provideRouter(routes)`);
    configImports.push(`import { provideRouter } from '@angular/router';`);
    configImports.push(`import { routes } from './app.routes';`);
  }

  for (const mod of modules) {
    if (mod === 'BrowserModule' || mod === 'AppRoutingModule') continue;
    if (mod === 'BrowserAnimationsModule') {
      providers.push(`provideAnimationsAsync()`);
      configImports.push(`import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';`);
    } else if (mod === 'NoopAnimationsModule') {
      providers.push(`provideNoopAnimations()`);
      configImports.push(`import { provideNoopAnimations } from '@angular/platform-browser/animations';`);
    } else if (mod === 'HttpClientModule') {
      providers.push(`provideHttpClient()`);
      configImports.push(`import { provideHttpClient } from '@angular/common/http';`);
    } else {
      unknownMods.push(mod);
    }
  }

  // MatDatepicker requires a DateAdapter provider — detect usage and add it automatically
  if (hasPackage('@angular/material') && (scanForContent('MatDatepicker') || scanForContent('mat-datepicker'))) {
    providers.push(`provideNativeDateAdapter()`);
    configImports.push(`import { provideNativeDateAdapter } from '@angular/material/core';`);
    console.log('  ↳ provideNativeDateAdapter() adicionado (MatDatepicker detectado)');
  }

  if (unknownMods.length > 0) {
    configImports[0] = `import { ApplicationConfig, importProvidersFrom, provideZoneChangeDetection } from '@angular/core';`;
    providers.push(`importProvidersFrom(${unknownMods.join(', ')})`);
    for (const mod of unknownMods) {
      const re = new RegExp(`import\\s*\\{[^}]*\\b${mod}\\b[^}]*\\}\\s*from\\s*['"][^'"]+['"]`);
      const m = mainContent.match(re);
      if (m) {
        // main.ts is at src/, app.config.ts is at src/app/ — adjust relative paths one level up
        const adjusted = m[0].replace(/from\s*'\.\/app\//g, `from './`).replace(/from\s*"\.\/app\//g, `from "./`);
        configImports.push(adjusted + ';');
      }
    }
  }

  writeFileSync(configPath, [
    ...configImports,
    ``,
    `export const appConfig: ApplicationConfig = {`,
    `  providers: [`,
    ...providers.map(p => `    ${p},`),
    `  ],`,
    `};`,
    ``,
  ].join('\n'));
  console.log('  ↳ app.config.ts criado');
  report.modernize.appConfig = true;
  report.filesCreated.push('src/app/app.config.ts');
  if (unknownMods.length > 0) {
    report.notes.push(`Módulos não convertidos automaticamente (mantidos via importProvidersFrom): ${unknownMods.join(', ')}`);
  }

  // 3. main.ts — simplifica para usar appConfig
  writeFileSync(mainPath, [
    `import { bootstrapApplication } from '@angular/platform-browser';`,
    `import { AppComponent } from './app/app.component';`,
    `import { appConfig } from './app/app.config';`,
    ``,
    `bootstrapApplication(AppComponent, appConfig).catch((err) => console.error(err));`,
    ``,
  ].join('\n'));
  console.log('  ↳ main.ts simplificado');
  report.modernize.mainSimplified = true;
}

// ─── throwError() → factory function (RxJS 7) ────────────────────────────────
// RxJS 7 deprecou throwError(value) — exige throwError(() => value).
// Objeto literal precisa de () => ({...}) para não ser interpretado como function body.

function fixThrowError() {
  let count = 0;
  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!entry.endsWith('.ts')) continue;
      let src = readFileSync(full, 'utf8');
      if (!src.includes('throwError(')) continue;

      let out = '';
      let pos = 0;
      let modified = false;
      const marker = 'throwError(';

      while (pos < src.length) {
        const idx = src.indexOf(marker, pos);
        if (idx === -1) { out += src.slice(pos); break; }
        out += src.slice(pos, idx + marker.length);
        const argStart = idx + marker.length;

        // Bracket-counting para encontrar o ) de fechamento do throwError(
        let depth = 1, inStr = false, strChar = '';
        let j = argStart;
        while (j < src.length && depth > 0) {
          const ch = src[j];
          if (inStr) {
            if (ch === '\\') j++; // skip escaped char
            else if (ch === strChar) inStr = false;
          } else {
            if (ch === '"' || ch === "'" || ch === '`') { inStr = true; strChar = ch; }
            else if (ch === '(') depth++;
            else if (ch === ')') { if (--depth === 0) break; }
          }
          j++;
        }

        const arg = src.slice(argStart, j).trim();
        // Já é factory function?
        const isFactory = /^(\(\s*[^)]*\)|\w+)\s*=>/.test(arg) || /^function[\s({]/.test(arg);

        if (isFactory) {
          out += src.slice(argStart, j) + ')';
        } else if (arg.startsWith('{')) {
          out += `() => (${arg}))`;
          modified = true;
        } else {
          out += `() => ${arg})`;
          modified = true;
        }
        pos = j + 1;
      }

      if (modified) { writeFileSync(full, out); count++; }
    }
  }
  const srcDir = join(destPath, 'src');
  if (existsSync(srcDir)) walk(srcDir);
  if (count > 0) console.log(`  ↳ throwError() → factory function (RxJS 7): ${count} arquivo(s)`);
  return count;
}

// ─── styleUrls (array) → styleUrl (singular) ─────────────────────────────────
// Angular 19 introduziu styleUrl (singular). Array com um elemento → string.

function fixStyleUrls() {
  let count = 0;
  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!entry.endsWith('.ts')) continue;
      let src = readFileSync(full, 'utf8');
      if (!src.includes('styleUrls')) continue;
      const out = src.replace(
        /styleUrls\s*:\s*\[\s*(['"][^'"]+['"])\s*\]/g,
        'styleUrl: $1',
      );
      if (out !== src) { writeFileSync(full, out); count++; }
    }
  }
  const srcDir = join(destPath, 'src');
  if (existsSync(srcDir)) walk(srcDir);
  if (count > 0) console.log(`  ↳ styleUrls → styleUrl: ${count} arquivo(s)`);
  return count;
}

// ─── polyfills.ts → zone.js inline em angular.json ───────────────────────────
// Angular 15+ recomenda listar polyfills diretamente no angular.json.
// Se o arquivo só tem `import 'zone.js'` (+ comentários), é seguro inlinear.

function inlinePolyfills() {
  const polyfillsPath = join(destPath, 'src', 'polyfills.ts');
  if (!existsSync(polyfillsPath)) return false;

  const content = readFileSync(polyfillsPath, 'utf8');
  const stripped = content
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .trim();

  if (stripped !== "import 'zone.js';" && stripped !== 'import "zone.js";') return false;

  const ngPath = join(destPath, 'angular.json');
  if (!existsSync(ngPath)) return false;
  let ng;
  try { ng = readJson(ngPath); } catch { return false; }
  let changed = false;

  for (const proj of Object.values(ng.projects ?? {})) {
    for (const target of Object.values(proj.architect ?? {})) {
      const sections = [target.options, ...Object.values(target.configurations ?? {})].filter(Boolean);
      for (const section of sections) {
        if (section.polyfills === 'src/polyfills.ts') {
          section.polyfills = ['zone.js'];
          changed = true;
        } else if (Array.isArray(section.polyfills)) {
          const idx = section.polyfills.indexOf('src/polyfills.ts');
          if (idx !== -1) { section.polyfills[idx] = 'zone.js'; changed = true; }
        }
      }
    }
  }

  if (changed) {
    writeJson(ngPath, ng);
    unlinkSync(polyfillsPath);
    console.log('  ↳ polyfills.ts inlined → angular.json ["zone.js"]');
    return true;
  }
  return false;
}

function runModernizationMigrations() {
  let prevHash = capture('git rev-parse HEAD');

  // Grava o passo atual no git, captura o diff vs passo anterior e atualiza o relatório
  function commitStep(key, label) {
    run('git add -A');
    run(`git commit --allow-empty -m "refactor: ${label ?? key}"`, { ignoreError: true });
    const h = capture('git rev-parse HEAD');
    report.details[key] = captureGitDiff(prevHash, h);
    prevHash = h;
    writeReport(true);
  }

  // 1. inject(): constructor DI → inject()
  console.log(`\n  🔄 inject()  (constructor DI → inject())...`);
  run('npx ng generate @angular/core:inject-migration --defaults', { ignoreError: true });
  report.modernize.inject = true;
  commitStep('inject', 'inject()');

  // 2. signals: @Input/@Output/@ViewChild → signal APIs
  console.log(`\n  🔄 signals  (@Input/@Output/@ViewChild → signal APIs)...`);
  run('npx ng generate @angular/core:signals --defaults --best-effort-mode', { ignoreError: true });
  report.modernize.signals = true;
  commitStep('signals', 'signals');

  // 2b. UntypedForm* → typed forms (ponte de migração v14, obsoleta no v21)
  report.modernize.untypedFormsFixed = fixUntypedForms();
  commitStep('untypedForms', 'untyped forms');

  // 2c. throwError() → factory function (RxJS 7)
  console.log(`\n  🔄 throwError  (RxJS 7 factory function)...`);
  report.modernize.throwErrorFixed = fixThrowError();
  commitStep('throwError', 'throwError factory');

  // 3. standalone migration (3 passos obrigatórios em sequência)
  runUntilStable(
    'npx ng generate @angular/core:standalone-migration --mode convert-to-standalone --defaults',
    'standalone  (convert-to-standalone)',
  );
  console.log(`\n  🔄 standalone  (prune-ng-modules)...`);
  run('npx ng generate @angular/core:standalone-migration --mode prune-ng-modules --defaults', { ignoreError: true });
  console.log(`\n  🔄 standalone  (standalone-bootstrap)...`);
  run('npx ng generate @angular/core:standalone-migration --mode standalone-bootstrap --defaults', { ignoreError: true });
  report.modernize.standalone = true;
  commitStep('standalone', 'standalone migration');

  // 3b. Garante standalone: true em pipes/directives que o schematic ignorou
  console.log(`\n  🔄 standalone  (fix missing standalone: true in pipes/directives)...`);
  report.modernize.standaloneFixed = fixMissingStandalone();
  commitStep('standaloneFixed', 'standalone: true patch');

  // 3c. control-flow: *ngIf/*ngFor/*ngSwitch → @if/@for/@switch
  runUntilStable(
    'npx ng generate @angular/core:control-flow',
    'control-flow  (*ngIf/*ngFor → @if/@for)',
  );
  report.modernize.controlFlow = true;
  commitStep('controlFlow', 'control-flow');

  // 3d. [ngClass] → [class] bindings
  console.log(`\n  🔄 ngClass → class bindings...`);
  run('npx ng generate @angular/core:ngclass-to-class', { ignoreError: true });
  report.modernize.ngClassToClass = true;
  commitStep('ngClassToClass', 'ngClass → class');

  // 3e. [ngStyle] → [style] bindings
  console.log(`\n  🔄 ngStyle → style bindings...`);
  run('npx ng generate @angular/core:ngstyle-to-style --best-effort-mode', { ignoreError: true });
  report.modernize.ngStyleToStyle = true;
  commitStep('ngStyleToStyle', 'ngStyle → style');

  // 4. app.config.ts + app.routes.ts
  console.log(`\n  🔄 app.config.ts + app.routes.ts...`);
  createAppConfigAndRoutes();
  commitStep('appConfig', 'app.config.ts + app.routes.ts');

  // 4b. Lazy NgModule → routes file (resolve NG0200)
  console.log(`\n  🔄 lazy routes  (NgModule → routes file)...`);
  report.modernize.lazyRoutesConverted = convertLazyModulesToRoutes();
  commitStep('lazyRoutes', 'lazy routes');

  // 5. Vite/esbuild builder
  migrateToApplicationBuilder();
  report.modernize.builder = true;
  commitStep('builder', 'application builder');

  // 5b. polyfills.ts → inline zone.js em angular.json
  console.log(`\n  🔄 polyfills  (inline zone.js em angular.json)...`);
  report.modernize.polyfillsInlined = inlinePolyfills();
  commitStep('polyfills', 'polyfills inline');

  // 6. Moderniza tsconfig (ES2022 / bundler / useDefineForClassFields)
  console.log(`\n  🔄 tsconfig  (ES2022, moduleResolution→bundler)...`);
  report.modernize.tsconfigModernized = modernizeTsconfig();
  commitStep('tsconfig', 'tsconfig ES2022/bundler');

  // 6b. Path aliases
  console.log(`\n  🔄 path aliases no tsconfig...`);
  addTsconfigPathAliases();
  report.modernize.pathAliases = true;
  commitStep('pathAliases', 'tsconfig path aliases');

  // 6c. ESLint
  console.log(`\n  🔄 ESLint  (@angular/eslint)...`);
  report.modernize.eslintAdded = addEslint();
  commitStep('eslint', 'ESLint');

  // 7. SCSS @import → @use as *
  console.log(`\n  🔄 SCSS  (@import → @use as *)...`);
  report.modernize.sassImports = fixSassImports();
  commitStep('sass', 'SCSS @use');

  // 8. Remove .module.ts que não são mais referenciados
  console.log(`\n  🔄 módulos  (removendo .module.ts obsoletos)...`);
  report.modernize.modulesRemoved = removeUnusedModules();
  commitStep('modules', 'remove unused modules');

  // 9. styleUrls → styleUrl (Angular 19+)
  console.log(`\n  🔄 styleUrls → styleUrl...`);
  report.modernize.styleUrlFixed = fixStyleUrls();
  commitStep('styleUrl', 'styleUrls → styleUrl');

  // 10. self-closing tags
  console.log(`\n  🔄 self-closing tags...`);
  run('npx ng generate @angular/core:self-closing-tag', { ignoreError: true });
  report.modernize.selfClosingTags = true;
  commitStep('selfClosing', 'self-closing tags');

  // 11. cleanup unused imports (deve rodar por último, após todas as migrações de template)
  console.log(`\n  🔄 cleanup unused imports...`);
  run('npx ng generate @angular/core:cleanup-unused-imports', { ignoreError: true });
  report.modernize.cleanupImports = true;
  commitStep('cleanupImports', 'cleanup unused imports');
}

// ─── Status HTML (auto-refresh a cada 4s) — Angular design ──────────────────

function writeStatusHtml() {
  if (!existsSync(destPath)) return;

  const now = new Date().toLocaleTimeString('pt-BR');
  const totalVersions = opts.to - (report.sourceVersion || 11);
  const doneVersions  = report.ngUpdateSteps.length;
  const pct = totalVersions > 0 ? Math.round((doneVersions / totalVersions) * 100) : 0;
  const m   = report.modernize;

  const fileList = (key) => {
    const files = report.details[key];
    if (!files?.length) return '';
    const items = files.map(({ path, action, lines: ls }) => {
      const badge = action === 'created' ? '<span class="tag new">new</span> '
                  : action === 'deleted' ? '<span class="tag del">del</span> ' : '';
      const lineStr = ls?.length ? ` <span class="ln">:${formatRanges(ls)}</span>` : '';
      return `<li>${badge}<code>${path}</code>${lineStr}</li>`;
    }).join('');
    const n = files.length;
    return `<details><summary>${n} file${n !== 1 ? 's' : ''} ▾</summary><ul>${items}</ul></details>`;
  };

  const row = (label, done, key) => {
    if (done === false) return '';   // skip not-yet-started rows while ng update still runs
    const icon = done === null ? '<span class="spin">◌</span>' : done ? '✓' : '–';
    const cls  = done === null ? 'row-pending' : done ? 'row-done' : 'row-skip';
    const det  = key ? fileList(key) : '';
    return `<tr class="${cls}">
      <td class="ic">${icon}</td>
      <td>${label}</td>
      <td class="det">${det}</td>
    </tr>`;
  };

  const html = `<!DOCTYPE html>
<html lang="pt">
<head>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="4">
  <title>ng-migrator — Migration Status</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    :root{
      --red:#DD0031;--red-dk:#C3002F;
      --bg:#0F0F1A;--surf:#16162A;--surf2:#1E1E35;
      --bdr:#2A2A45;--text:#E8E8F0;--muted:#7070A0;
      --green:#4CAF50;--amber:#FF9800;--blue:#5CB8F5;
    }
    body{font-family:'Roboto',system-ui,sans-serif;background:var(--bg);color:var(--text);min-height:100vh}
    a{color:var(--blue)}

    /* ── Header ── */
    header{
      background:linear-gradient(135deg,var(--red-dk) 0%,var(--red) 60%,#E91E63 100%);
      padding:.9rem 2rem;display:flex;align-items:center;gap:1rem;
      box-shadow:0 2px 12px rgba(0,0,0,.5);
    }
    .logo-shield{width:28px;height:31px;flex-shrink:0}
    .logo-text{font-size:1.15rem;font-weight:700;color:#fff;letter-spacing:-.3px}
    .logo-sub{font-size:.78rem;color:rgba(255,255,255,.65);margin-top:1px}
    .ts{margin-left:auto;font-size:.72rem;color:rgba(255,255,255,.55);white-space:nowrap}

    /* ── Main layout — two-column dashboard ── */
    main{
      max-width:1600px;margin:0 auto;padding:1.5rem 2rem;
      display:grid;
      grid-template-columns:360px 1fr;
      grid-template-rows:auto 1fr;
      gap:1.25rem;
      align-items:start;
    }
    .col-left{grid-column:1;display:flex;flex-direction:column;gap:1.25rem;position:sticky;top:1.5rem;max-height:calc(100vh - 3rem);overflow-y:auto}
    .col-right{grid-column:2}

    /* ── Cards ── */
    .card{background:var(--surf);border:1px solid var(--bdr);border-radius:10px;overflow:hidden}
    .card-head{
      background:var(--surf2);border-bottom:1px solid var(--bdr);
      padding:.55rem 1rem;display:flex;align-items:center;gap:.6rem;
    }
    .card-title{font-size:.72rem;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--muted)}
    .card-badge{
      margin-left:auto;background:rgba(221,0,49,.18);color:var(--red);
      border:1px solid rgba(221,0,49,.3);border-radius:4px;
      font-size:.68rem;font-weight:600;padding:1px 7px;
    }

    /* ── Progress bar ── */
    .prog-wrap{padding:.75rem 1rem;border-bottom:1px solid var(--bdr)}
    .prog-track{background:var(--bdr);border-radius:99px;height:8px;overflow:hidden}
    .prog-fill{background:linear-gradient(90deg,var(--red),#E91E63);height:100%;border-radius:99px;transition:width .5s ease}
    .prog-label{font-size:.72rem;color:var(--muted);margin-top:.4rem}

    /* ── Table ── */
    table{width:100%;border-collapse:collapse}
    tr{border-bottom:1px solid var(--bdr)}
    tr:last-child{border-bottom:none}
    td{padding:.5rem 1rem;font-size:.855rem;vertical-align:middle}
    td.ic{width:2.2rem;text-align:center;font-size:1rem;padding-right:0}
    td.det{color:var(--muted);font-size:.8rem;min-width:160px}

    .row-done td:nth-child(2){color:var(--green)}
    .row-done .ic{color:var(--green)}
    .row-pending td:nth-child(2){color:var(--amber)}
    .row-pending .ic{color:var(--amber)}
    .row-skip td{opacity:.38}

    @keyframes pulse{0%,100%{opacity:.3}50%{opacity:.8}}
    .spin{animation:pulse 1.4s ease-in-out infinite;display:inline-block}

    /* ── File details ── */
    details{display:inline-block}
    details summary{cursor:pointer;color:var(--blue);font-size:.78rem;list-style:none;user-select:none}
    details summary::-webkit-details-marker{display:none}
    details[open] summary{margin-bottom:.3rem}
    details ul{list-style:none;margin-left:.2rem;padding:0}
    details li{font-size:.73rem;color:var(--muted);padding:.15rem 0;font-family:'Roboto Mono',monospace;display:flex;align-items:baseline;gap:.3rem}
    details code{color:#B0B0D0;background:#0A0A18;padding:1px 5px;border-radius:3px;font-size:.72rem;font-family:inherit}
    .ln{color:#4A4A70;font-size:.68rem}
    .tag{font-size:.65rem;font-weight:700;padding:0 4px;border-radius:3px;line-height:1.5}
    .tag.new{background:rgba(76,175,80,.15);color:var(--green);border:1px solid rgba(76,175,80,.3)}
    .tag.del{background:rgba(239,83,80,.15);color:#EF5350;border:1px solid rgba(239,83,80,.3)}
  </style>
</head>
<body>

<header>
  <svg class="logo-shield" viewBox="0 0 250 300" fill="none" xmlns="http://www.w3.org/2000/svg">
    <polygon points="125,5 245,50 224,238 125,295 26,238 5,50"
      fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.6)" stroke-width="10"/>
    <path d="M125 52 L182 200 H163 L150 163 H100 L87 200 H68 Z M125 88 L145 150 H105 Z"
      fill="white"/>
  </svg>
  <div>
    <div class="logo-text">ng-migrator</div>
    <div class="logo-sub">Angular ${report.sourceVersion ?? '?'} → ${report.targetVersion}</div>
  </div>
  <div class="ts">⟳ ${now}</div>
</header>

<main>

  <div class="col-left">
    <!-- ng update card -->
    <div class="card">
      <div class="card-head">
        <span class="card-title">ng update</span>
        <span class="card-badge">${doneVersions} / ${totalVersions} versions</span>
      </div>
      <div class="prog-wrap">
        <div class="prog-track"><div class="prog-fill" style="width:${pct}%"></div></div>
        <div class="prog-label">${pct}% complete</div>
      </div>
      <table>
        ${report.ngUpdateSteps.map(s => `
        <tr class="${s.ok ? 'row-done' : 'row-pending'}">
          <td class="ic">${s.ok ? '✓' : '⚠'}</td>
          <td>Angular ${s.version}</td>
          <td class="det">${fileList(`ngUpdate_${s.version}`) || (s.ok ? '' : '<span style="color:var(--amber)">warnings</span>')}</td>
        </tr>`).join('')}
        ${Array.from({ length: Math.max(0, totalVersions - doneVersions) }, (_, i) => {
          const v = (report.sourceVersion ?? 11) + doneVersions + i + 1;
          return `<tr class="row-skip"><td class="ic">·</td><td>Angular ${v}</td><td class="det"></td></tr>`;
        }).join('')}
      </table>
    </div>

    <!-- Source info card -->
    <div class="card">
      <div class="card-head"><span class="card-title">Project</span></div>
      <div style="padding:.65rem 1rem;font-size:.78rem;color:var(--muted);line-height:1.7;word-break:break-all">
        <div><span style="color:var(--text)">Source</span> &nbsp;Angular ${report.sourceVersion ?? '?'}</div>
        <div><span style="color:var(--text)">Target</span> &nbsp;Angular ${report.targetVersion}</div>
        <div style="margin-top:.4rem;font-size:.71rem">${report.destPath}</div>
      </div>
    </div>
  </div>

  <div class="col-right">
    ${opts.modernize ? `
    <!-- Modernization card -->
    <div class="card">
      <div class="card-head">
        <span class="card-title">Modernization</span>
        <span style="margin-left:auto;font-size:.72rem;color:var(--muted)">${
          Object.keys(report.details).filter(k => !k.startsWith('ngUpdate_')).length
        } steps completed</span>
      </div>
      <table>
        ${row('inject() — constructor DI → inject()',             m.inject          ? true : (doneVersions >= totalVersions ? null : false), 'inject')}
        ${row('Signals — @Input / @Output / @ViewChild → signal APIs', m.signals   ? true : (m.inject ? null : false),                       'signals')}
        ${row('UntypedForm* → typed forms',                        m.untypedFormsFixed > 0 ? true : (m.signals ? null : false),              'untypedForms')}
        ${row('throwError() → factory function (RxJS 7)',          m.throwErrorFixed > 0 ? true : (m.signals ? null : false),                'throwError')}
        ${row('Standalone — convert → prune → bootstrap',          m.standalone      ? true : (m.signals ? null : false),                    'standalone')}
        ${row('standalone: true patches in pipes / directives',    m.standaloneFixed > 0 ? true : (m.standalone ? null : false),            'standaloneFixed')}
        ${row('Control flow — @if / @for / @switch',               m.controlFlow     ? true : (m.standalone ? null : false),                 'controlFlow')}
        ${row('[ngClass] → [class]',                               m.ngClassToClass  ? true : (m.controlFlow ? null : false),                'ngClassToClass')}
        ${row('[ngStyle] → [style]',                               m.ngStyleToStyle  ? true : (m.ngClassToClass ? null : false),             'ngStyleToStyle')}
        ${row('app.config.ts + app.routes.ts',                     m.appConfig       ? true : (m.ngStyleToStyle ? null : false),             'appConfig')}
        ${row('Lazy NgModules → routes files',                     m.lazyRoutesConverted > 0 ? true : (m.appConfig !== undefined ? null : false), 'lazyRoutes')}
        ${row('Builder → esbuild / Vite',                          m.builder         ? true : (m.appConfig !== undefined ? null : false),    'builder')}
        ${row('polyfills.ts → zone.js inline in angular.json',     m.polyfillsInlined ? true : (m.builder ? null : false),                  'polyfills')}
        ${row('tsconfig — ES2022 / moduleResolution: bundler',     m.tsconfigModernized ? true : (m.builder ? null : false),                'tsconfig')}
        ${row('Path aliases — @app / @core / @shared / @features', m.pathAliases     ? true : (m.tsconfigModernized !== undefined ? null : false), 'pathAliases')}
        ${row('ESLint via @angular/eslint',                        m.eslintAdded     ? true : (m.pathAliases ? null : false),                'eslint')}
        ${row('SCSS @import → @use as *',                         m.sassImports > 0 ? true : (m.eslintAdded !== undefined ? null : false),  'sass')}
        ${row('Unused .module.ts files removed',                  m.modulesRemoved > 0 ? true : (m.sassImports !== undefined ? null : false), 'modules')}
        ${row('styleUrls: [] → styleUrl (Angular 19)',            m.styleUrlFixed > 0 ? true : (m.modulesRemoved !== undefined ? null : false), 'styleUrl')}
        ${row('Self-closing tags',                                m.selfClosingTags ? true : (m.styleUrlFixed !== undefined ? null : false), 'selfClosing')}
        ${row('Cleanup unused component imports',                 m.cleanupImports  ? true : (m.selfClosingTags ? null : false),             'cleanupImports')}
      </table>
    </div>` : ''}
  </div>

</main>
</body>
</html>`;

  writeFileSync(join(destPath, 'MIGRATION-STATUS.html'), html);
}

// ─── Relatório de migração ────────────────────────────────────────────────────

function writeReport(skipDiff = false) {
  if (skipDiff) writeStatusHtml();   // atualiza o HTML em tempo real
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
  if (!skipDiff && report.initialCommit) {
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
      const patchPath = join(destPath, 'MIGRATION.patch');
      writeFileSync(patchPath, fullDiff);
      lines.push(`> Full before/after diff saved to \`MIGRATION.patch\``);
      lines.push(``);
      console.log(`  📄 Diff completo salvo em: ${patchPath}`);
    }
  }

  const reportPath = join(destPath, 'MIGRATION-REPORT.md');
  writeFileSync(reportPath, lines.join('\n'));
  if (!skipDiff) {
    writeStatusHtml();
    console.log(`\n  📄 Relatório final gravado em: ${reportPath}`);
    console.log(`  🌐 Status HTML: ${join(destPath, 'MIGRATION-STATUS.html')}`);
  }
}

// ─── Pacotes extras por versão ───────────────────────────────────────────────

function extraPackages(v) {
  const extra = [];
  if (hasPackage('@angular/material')) extra.push(`@angular/material@${v}`);
  else if (hasPackage('@angular/cdk')) extra.push(`@angular/cdk@${v}`);
  if (v < 17 && hasPackage('@nguniversal/express-engine'))
    extra.push(`@nguniversal/express-engine@${v}`);
  return extra;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PIPELINE PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(' ng-migrator  •  Angular gradual migration');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(` Origem:  ${sourcePath}`);
console.log(` Destino: ${destPath}`);
console.log(` Alvo:    Angular ${opts.to}`);
if (opts.dryRun) console.log(' Modo:    DRY RUN');
if (!opts.modernize) console.log(' Modernize: desativado (--no-modernize)');
console.log('');

if (opts.dryRun) {
  console.log('(dry-run: nenhuma operação executada)');
  process.exit(0);
}

// 1. Copia o projeto
console.log('📁 Copiando projeto...');
copyDir(sourcePath, destPath);

// Remove lockfiles antigos
for (const f of ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml']) {
  const p = join(destPath, f);
  if (existsSync(p)) { unlinkSync(p); console.log(`  ↳ ${f} removido`); }
}

// 2. Pré-voo: limpa package.json e remove arquivos legados
console.log('\n🧹 Limpeza inicial...');
preflight();
cleanupLegacyFiles();

// Se o projeto já tem imports legacy (source >= v15), migra agora
if ((opts.from ?? getInstalledMajor('@angular/core')) >= 15) {
  console.log('\n🔄 Migrando Material legacy → MDC (projeto fonte já em v15+)...');
  fixLegacyMaterial();
}

// 3. Git init — ng update exige repositório git
console.log('\n🔧 Inicializando repositório git...');
run('git init');
run('git add -A');
run('git commit -m "chore: snapshot antes da migração"');
report.initialCommit = capture('git rev-parse HEAD');

// 4. Instala dependências da versão atual
const detectedVersion = opts.from ?? getInstalledMajor('@angular/core');
report.sourceVersion = detectedVersion || null;
writeReport(true);  // primeiro snapshot — abre o arquivo no destino
console.log(`\n📦 Versão detectada: Angular ${detectedVersion || '?'}`);
console.log('📦 Instalando dependências...');
if (npmInstall().status !== 0) {
  console.error('\n❌ npm install falhou. Verifique o package.json e tente novamente.');
  process.exit(1);
}

// 5. ng update incremental
const startVersion = (detectedVersion || 11) + 1;
const steps = [];
let ngUpdatePrevHash = capture('git rev-parse HEAD');

for (let v = startVersion; v <= opts.to; v++) {
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(` Angular ${v - 1} → ${v}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  const packages = [`@angular/core@${v}`, `@angular/cli@${v}`, ...extraPackages(v)].join(' ');

  // Before v17: Angular Material drops legacy-* — migrate them first
  if (v === 17) {
    console.log(`\n  🔄 Migrando Material legacy → MDC...`);
    fixLegacyMaterial();
  }

  const result = run(`npx ng update ${packages} --allow-dirty --force`, { ignoreError: true });
  const ok = result.status === 0;

  if (!ok) console.warn(`\n  ⚠ ng update v${v} reportou erros — sincronizando versões manualmente.`);

  // Garante que nenhum pacote ficou para trás (ng update pode falhar silenciosamente)
  console.log(`\n  🔄 Sincronizando versões para v${v}...`);
  syncVersions(v);

  npmInstall();

  run('git add -A');
  run(`git commit -m "chore: Angular ${v}" --allow-empty`);

  const h = capture('git rev-parse HEAD');
  report.details[`ngUpdate_${v}`] = captureGitDiff(ngUpdatePrevHash, h);
  ngUpdatePrevHash = h;

  steps.push({ version: v, ok });
  report.ngUpdateSteps.push({ version: v, ok });
  writeReport(true);
}

// 6. Modernização: inject() + signals + output()
if (opts.modernize) {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' Modernização (inject / signals / output)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  runModernizationMigrations(); // cada step já grava commit individualmente
}

// ─── Relatório final ─────────────────────────────────────────────────────────

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(' Resultado');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
for (const { version, ok } of steps) {
  console.log(`  ${ok ? '✅' : '⚠ '} Angular ${version}`);
}

const warnings = steps.filter(s => !s.ok);
if (warnings.length) {
  console.log(`\n  ⚠ ${warnings.length} passo(s) com aviso (schematics podem não ter rodado completamente).`);
  console.log('    Verifique o output acima e o histórico git para detalhes.');
}

console.log(`\n  Projeto migrado: ${destPath}`);

writeReport();

console.log('\n Próximos passos:');
console.log(` 1. cd ${destPath}`);
console.log(' 2. ng build      → verifica erros de compilação');
console.log(' 3. ng serve      → testa a aplicação');
console.log('');

// Abre o projeto no VS Code se disponível
const codeCheck = spawnSync('code --version', { shell: true, stdio: 'ignore' });
if (codeCheck.status === 0) {
  console.log('🖥  Abrindo projeto no VS Code...');
  spawnSync(`code "${destPath}"`, { shell: true, stdio: 'ignore' });
}
