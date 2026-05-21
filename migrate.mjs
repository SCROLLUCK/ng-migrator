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
import Database from 'better-sqlite3';

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

// Steps to skip (passed via env var from ng-migrator-ui or --skip-steps CLI)
const skipSteps = new Set((process.env.NG_MIGRATOR_SKIP_STEPS ?? '').split(',').filter(Boolean));

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

// SQLite DB for diff storage; opened after migratorDir is created
let diffDb = null;

function captureGitDiff(h0, h1) {
  if (!h0 || !h1 || h0 === h1) return [];
  const raw = capture(`git diff ${h0} ${h1} --name-status -- ':!package-lock.json'`);
  if (!raw) return [];
  const result = [];
  for (const line of raw.split('\n').filter(Boolean)) {
    const parts = line.split('\t');
    const status = parts[0][0];          // A/M/D/R
    const path = parts[parts.length - 1];
    if (status === 'D') { result.push({ path, action: 'deleted', lines: [], h0, h1 }); continue; }
    const diff = capture(`git diff ${h0} ${h1} -- "${path}"`);
    diffDb?.prepare('INSERT OR REPLACE INTO diffs (path, h0, h1, diff) VALUES (?, ?, ?, ?)').run(path, h0, h1, diff || '');
    result.push({ path, action: status === 'A' ? 'created' : 'modified', lines: parseAddedLines(diff), h0, h1 });
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

// Like run(), but also captures combined stdout+stderr for post-processing.
function runCapture(cmd, { cwd = destPath } = {}) {
  console.log(`  $ ${cmd}`);
  const result = spawnSync(cmd, {
    shell: true, cwd,
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '1', CI: '1' },
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  result.output = (result.stdout || '') + (result.stderr || '');
  return result;
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
    '@angular/flex-layout',            // descontinuado pelo Google, sem versão Angular 16+
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

  // engines.node: projetos antigos fixam em ^14.x ou ^12.x; Angular 21 requer Node 18+
  if (pkg.engines?.node) {
    const nodeReq = pkg.engines.node;
    // Only update if the requirement doesn't already allow Node 18+
    const allowsNode18 = nodeReq.includes('>=18') || nodeReq.includes('>=20') || nodeReq.includes('>=22');
    if (!allowsNode18) {
      pkg.engines.node = '>=18';
      console.log(`  ↳ engines.node: "${nodeReq}" → ">=18" (Angular 21 requer Node 18+)`);
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
    if (!e2eBuilder.includes('protractor')) continue;

    const otherTargets = Object.keys(proj.architect ?? {}).filter(t => t !== 'e2e');
    if (otherTargets.length === 0 || name.endsWith('-e2e')) {
      // Projeto exclusivamente e2e — remove o projeto inteiro
      delete ng.projects[name];
      console.log(`  ↳ angular.json: projeto "${name}" removido (Protractor obsoleto)`);
    } else {
      // Projeto principal com target e2e embutido — remove só o target
      delete proj.architect.e2e;
      console.log(`  ↳ angular.json: target "e2e" removido do projeto "${name}" (Protractor obsoleto)`);
    }
    changed = true;
  }

  if (changed) writeJson(ngPath, ng);

  fixTsconfigLocations(ng);
  fixKarmaConf();
}

// Garante que os tsConfig referenciados no angular.json realmente existem no disco.
// Estratégia: não move nem renomeia — cria uma cópia onde o angular.json espera,
// procurando o arquivo na raiz ou em src/ como fallback.
function fixTsconfigLocations(ngJson) {
  if (!ngJson) return;

  // Coleta todos os caminhos de tsConfig referenciados no angular.json
  const refs = new Set();
  function collectRefs(obj) {
    if (!obj || typeof obj !== 'object') return;
    if (typeof obj.tsConfig === 'string') refs.add(obj.tsConfig);
    for (const v of Object.values(obj)) if (typeof v === 'object') collectRefs(v);
  }
  collectRefs(ngJson);

  for (const ref of refs) {
    const expectedPath = join(destPath, ref);
    if (existsSync(expectedPath)) continue;   // já existe onde angular.json espera

    // Tenta encontrar o arquivo no local alternativo (raiz ↔ src/)
    const basename = ref.split('/').pop();
    const candidates = [
      join(destPath, basename),
      join(destPath, 'src', basename),
    ].filter(p => p !== expectedPath);

    for (const src of candidates) {
      if (!existsSync(src)) continue;
      // Copia para onde angular.json espera (mantém o original intacto)
      let content = readFileSync(src, 'utf8');
      // Corrige extends relativo se necessário
      const rel = ref.startsWith('src/') ? '../tsconfig.json' : './tsconfig.json';
      try {
        const obj = JSON.parse(content);
        const bad = ref.startsWith('src/') ? './tsconfig.json' : '../tsconfig.json';
        if (obj.extends === bad) { obj.extends = rel; content = JSON.stringify(obj, null, 2); }
      } catch { }
      mkdirSync(join(destPath, ref.split('/').slice(0, -1).join('/') || '.'), { recursive: true });
      writeFileSync(expectedPath, content);
      console.log(`  ↳ ${ref} criado a partir de ${relative(destPath, src)}`);
      break;
    }
  }
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

// @angular-devkit/architect e build-optimizer usam 0.NNxx.y (ex: v12 = 0.1200.7), não ^12.0.0.
function getEffectiveMajor(versionStr) {
  const legacy = String(versionStr).match(/^[~^]?0\.(1[0-9]{3})\./);
  if (legacy) return Math.floor(parseInt(legacy[1]) / 100);
  return getMajor(versionStr);
}

function syncVersions(targetVersion) {
  const pkgPath = join(destPath, 'package.json');
  const pkg = readJson(pkgPath);
  let changed = false;

  // Estes pacotes usam esquema 0.NNxx.y no npm, não ^N.0.0
  const DEVKIT_ZERO_VERSIONED = new Set([
    '@angular-devkit/architect', '@angular-devkit/build-optimizer',
  ]);

  const ANGULAR_PKGS = [
    '@angular/animations', '@angular/cdk', '@angular/cli',
    '@angular/common', '@angular/compiler', '@angular/compiler-cli',
    '@angular/core', '@angular/forms', '@angular/language-service',
    '@angular/material', '@angular/material-moment-adapter',
    '@angular/platform-browser', '@angular/platform-browser-dynamic',
    '@angular/router',
    '@angular-devkit/build-angular', '@angular-devkit/architect',
    '@angular-devkit/core', '@angular-devkit/build-optimizer',
    // angular-eslint acompanha a versão do Angular (versionamento major normal)
    '@angular-eslint/builder', '@angular-eslint/eslint-plugin',
    '@angular-eslint/eslint-plugin-template', '@angular-eslint/schematics',
    '@angular-eslint/template-parser', '@angular-eslint/utils',
  ];

  for (const section of ['dependencies', 'devDependencies']) {
    if (!pkg[section]) continue;
    for (const name of ANGULAR_PKGS) {
      if (!pkg[section][name]) continue;
      const current = getEffectiveMajor(pkg[section][name]);
      if (current > 0 && current < targetVersion) {
        // Pacotes com esquema 0.NNxx.y precisam de formato especial
        const targetStr = DEVKIT_ZERO_VERSIONED.has(name)
          ? `~0.${targetVersion}00.0`
          : `^${targetVersion}.0.0`;
        pkg[section][name] = targetStr;
        console.log(`  ↳ ${name}: ${current} → ${targetVersion} (forçado)`);
        changed = true;
      }
    }
  }

  // TypeScript: ng update às vezes falha antes de atualizar o TS (ex: v12 com npm >6).
  // Garante versão mínima compatível para evitar conflito de peer deps no npm install.
  const TS_FLOOR = { 12:'4.2',13:'4.4',14:'4.6',15:'4.8',16:'4.9',17:'5.2',18:'5.3',19:'5.5',20:'5.5',21:'5.8' };
  const tsFloor = TS_FLOOR[targetVersion];
  if (tsFloor && pkg.devDependencies?.typescript) {
    const curTs = pkg.devDependencies.typescript.replace(/[^0-9.]/g, '');
    const [curMaj, curMin] = curTs.split('.').map(Number);
    const [floorMaj, floorMin] = tsFloor.split('.').map(Number);
    const tooOld = curMaj < floorMaj || (curMaj === floorMaj && curMin < floorMin);
    if (tooOld) {
      const TS_TARGET = { 12:'~4.3.5',13:'~4.6.0',14:'~4.7.0',15:'~4.9.0',16:'~5.0.0',17:'~5.2.0',18:'~5.4.0',19:'~5.6.0',20:'~5.7.0',21:'~5.8.0' };
      pkg.devDependencies.typescript = TS_TARGET[targetVersion];
      console.log(`  ↳ typescript: ${curTs} → ${TS_TARGET[targetVersion]} (forçado)`);
      changed = true;
    }
  }

  // eslint: @angular-eslint@18+ exige eslint@8+. Remove duplicata em dependencies se houver.
  const eslintDep = pkg.dependencies?.eslint;
  const eslintDev = pkg.devDependencies?.eslint;
  if (eslintDep && eslintDev) {
    // eslint nunca deve estar em dependencies — é ferramenta de dev
    delete pkg.dependencies.eslint;
    console.log('  ↳ eslint removido de dependencies (duplicata — mantido em devDependencies)');
    changed = true;
  }
  if (targetVersion >= 18) {
    const eslintTarget = pkg.devDependencies?.eslint ?? pkg.dependencies?.eslint;
    if (eslintTarget && getMajor(eslintTarget) < 9) {
      if (!pkg.devDependencies) pkg.devDependencies = {};
      pkg.devDependencies.eslint = '^9.0.0';
      if (pkg.dependencies?.eslint) delete pkg.dependencies.eslint;
      console.log(`  ↳ eslint: ${getMajor(eslintTarget)} → 9 (@angular-eslint@18+ exige ^8.57+)`);
      changed = true;
    }
    // @typescript-eslint/* v4/v5/v6/v7 only supports eslint@^5-7; v8.x supports eslint@9
    for (const tsEslintPkg of ['@typescript-eslint/eslint-plugin', '@typescript-eslint/parser', '@typescript-eslint/utils']) {
      for (const section of ['dependencies', 'devDependencies']) {
        const ver = pkg[section]?.[tsEslintPkg];
        if (ver && getMajor(ver) < 8) {
          pkg[section][tsEslintPkg] = '^8.0.0';
          console.log(`  ↳ ${tsEslintPkg}: ${getMajor(ver)} → 8 (compatível com eslint@9)`);
          changed = true;
        }
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

  if (changed) writeJson(pkgPath, pkg);
  // Não chama npmInstall() aqui — o loop principal faz isso após syncVersions()
}

// Antes de cada ng update: garante que tsconfig.json existe na raiz e que
// todos os caminhos tsConfig do angular.json apontam para arquivos reais.
function verifyTsconfigPaths() {
  // Garante tsconfig.json na raiz (algumas migrações o procuram diretamente lá)
  const rootTs = join(destPath, 'tsconfig.json');
  if (!existsSync(rootTs)) {
    writeJson(rootTs, {
      compileOnSave: false,
      compilerOptions: {
        outDir: './dist/out-tsc', strict: true, sourceMap: true,
        experimentalDecorators: true, moduleResolution: 'node',
        importHelpers: true, target: 'ES2022', module: 'ES2022',
        useDefineForClassFields: false, lib: ['ES2022', 'dom'],
      },
      angularCompilerOptions: {
        enableI18nLegacyMessageIdFormat: false,
        strictInjectionParameters: true, strictInputAccessModifiers: true, strictTemplates: true,
      },
    });
    console.log('  ↳ tsconfig.json criado na raiz (estava ausente)');
  }

  // Cria arquivos onde o angular.json espera encontrá-los (sem alterar o angular.json)
  const ngPath = join(destPath, 'angular.json');
  if (!existsSync(ngPath)) return;
  let ng; try { ng = readJson(ngPath); } catch { return; }
  fixTsconfigLocations(ng);
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
        /loadChildren\s*:\s*\(\s*\)\s*=>\s*import\(\s*['"]([^'"]+\.module)['"]\s*\)\s*\.then\s*\(\s*\(?\s*(\w+)\s*\)?\s*=>\s*\2\.(\w+Module)\s*\)/g,
        (match, importPath, _varName, moduleName) => {
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

// ─── Converte .routing.module.ts restantes → .routes.ts ──────────────────────
// Após convertLazyModulesToRoutes() (lazy) e prune-ng-modules, podem restar
// routing modules com RouterModule.forChild() referenciados por componentes
// standalone. Extrai o array de rotas, cria o .routes.ts e remove referências.
function convertRemainingRoutingModules() {
  const srcDir = join(destPath, 'src');
  if (!existsSync(srcDir)) return 0;
  let converted = 0;

  const routingFiles = [];
  function collect(dir) {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { collect(full); continue; }
      if (/\.routing\.module\.ts$/.test(entry) ||
          (/routing/i.test(entry) && entry.endsWith('.module.ts'))) {
        routingFiles.push(full);
      }
    }
  }
  collect(srcDir);

  for (const routingPath of routingFiles) {
    const src = readFileSync(routingPath, 'utf8');
    if (!src.includes('RouterModule.forChild') && !src.includes('RouterModule.forRoot')) continue;

    const routesBlock = extractBracketBlock(src, 'const routes: Routes =') ||
                        extractBracketBlock(src, 'const routes =');
    if (!routesBlock) continue;

    // Component/service imports only (skip Angular infra)
    const compImports = (src.match(/^import\s+.+;$/gm) ?? []).filter(l =>
      !l.includes('@angular/router') && !l.includes('@angular/core') &&
      !l.includes('NgModule'),
    );

    // Derive a camelCase export name: FeatRoutingModule → featRoutes
    const moduleClassM = src.match(/export\s+class\s+(\w+)/);
    const moduleClass = moduleClassM?.[1] ?? '';
    const exportName = moduleClass
      ? moduleClass.replace(/RoutingModule$/, 'Routes').replace(/Module$/, 'Routes')
          .replace(/^(.)/, c => c.toLowerCase())
      : 'featureRoutes';

    const routesFileName = basename(routingPath)
      .replace(/\.routing\.module\.ts$/, '.routes.ts')
      .replace(/\.module\.ts$/, '.routes.ts');
    const routesPath = join(dirname(routingPath), routesFileName);
    if (existsSync(routesPath)) continue;

    writeFileSync(routesPath, [
      `import { Routes } from '@angular/router';`,
      ...compImports,
      ``,
      `export const ${exportName}: Routes = ${routesBlock};`,
      ``,
    ].join('\n'));

    // Remove references to the old routing module class from other files
    if (moduleClass) {
      function fixRefs(dir) {
        for (const entry of readdirSync(dir)) {
          if (SKIP_DIRS.has(entry)) continue;
          const full = join(dir, entry);
          if (statSync(full).isDirectory()) { fixRefs(full); continue; }
          if (!entry.endsWith('.ts') || full === routingPath) continue;
          let s = readFileSync(full, 'utf8');
          if (!s.includes(moduleClass)) continue;
          // Remove ES import line
          s = s.replace(
            new RegExp(`^import\\s+\\{[^}]*\\b${moduleClass}\\b[^}]*\\}\\s+from\\s+['"][^'"]+['"];?\\s*\\n?`, 'gm'),
            '',
          );
          // Remove class name from imports: [] (trailing comma variants)
          s = s.replace(new RegExp(`\\b${moduleClass}\\b,?\\s*`, 'g'), '');
          const orig = readFileSync(full, 'utf8');
          if (s !== orig) writeFileSync(full, s);
        }
      }
      fixRefs(srcDir);
    }

    unlinkSync(routingPath);
    console.log(`  ↳ ${basename(routingPath)} → ${routesFileName}  (export: ${exportName})`);
    converted++;
  }

  if (converted > 0) console.log(`  ↳ ${converted} routing module(s) → routes`);
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

  // 2. Constrói índice com o conteúdo de TODOS os .ts (incluindo outros modules)
  //    para detectar referências cruzadas entre módulos (ex: main.module.ts → translate.module)
  const allTsFiles = [];
  function indexTs(dir) {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { indexTs(full); continue; }
      if (!entry.endsWith('.ts')) continue;
      allTsFiles.push({ path: full, content: readFileSync(full, 'utf8') });
    }
  }
  indexTs(srcDir);

  // 3. Remove módulos não referenciados por nenhum outro arquivo .ts
  let removed = 0;
  for (const modulePath of moduleFiles) {
    const base = basename(modulePath, '.ts'); // ex: 'vacancy.module'
    const isReferenced = allTsFiles.some(({ path, content }) =>
      path !== modulePath && (
        content.includes(`/${base}'`) ||
        content.includes(`/${base}"`) ||
        content.includes(`/${base}\``)
      )
    );
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

      // @Component: use export-class boundaries (avoids bracket-counting failures
      // with inline templates that contain { } in expressions or template literals)
      if (hasComponent) {
        // Find all 'export ... class' positions as decorator-end boundaries
        const classBoundaryRe = /^export\s+(?:abstract\s+)?class\s+/gm;
        const boundaries = [];
        let bm;
        while ((bm = classBoundaryRe.exec(out)) !== null) boundaries.push(bm.index);
        boundaries.push(out.length);

        let result = out;
        let shift = 0;
        for (let bi = 0; bi < boundaries.length - 1; bi++) {
          const classStart = boundaries[bi] + shift;
          const before = result.slice(0, classStart);
          const compIdx = before.lastIndexOf('@Component(');
          if (compIdx === -1) continue;

          // Decorator region: from @Component( to just before export class
          const decRegion = result.slice(compIdx, classStart);
          const openBrace = decRegion.indexOf('{');
          if (openBrace === -1) continue;

          if (decRegion.includes('standalone:')) {
            const isExplicitlyFalse = /standalone\s*:\s*false/.test(decRegion);
            if (isExplicitlyFalse) {
              // standalone: false + imports: [] is an inconsistent state (migration added imports
              // but didn't flip the flag). Promote to standalone: true.
              if (decRegion.includes('imports:')) {
                const fixedRegion = decRegion.replace(/standalone\s*:\s*false/, 'standalone: true');
                const regionStart = compIdx;
                const regionEnd = compIdx + decRegion.length;
                result = result.slice(0, regionStart) + fixedRegion + result.slice(regionEnd);
                shift += fixedRegion.length - decRegion.length;
              }
              // else: standalone: false without imports: [] — leave it (it's an NgModule component)
            } else if (!decRegion.includes('imports:')) {
              // standalone: true but missing imports: [] — add it
              const insertAt = compIdx + openBrace + 1;
              const extra = '\n  imports: [],';
              result = result.slice(0, insertAt) + extra + result.slice(insertAt);
              shift += extra.length;
            }
          } else {
            // No standalone: — add standalone: true (and imports: [] if missing)
            const insertAt = compIdx + openBrace + 1;
            const extra = '\n  standalone: true,' + (decRegion.includes('imports:') ? '' : '\n  imports: [],');
            result = result.slice(0, insertAt) + extra + result.slice(insertAt);
            shift += extra.length;
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

// Remove imports: [...] from @Component decorators that have standalone: false.
// imports: is only valid on standalone components; leaving it causes NG2010.
function removeImportsFromNonStandalone() {
  let count = 0;
  const srcDir = join(destPath, 'src');
  if (!existsSync(srcDir)) return;
  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!entry.endsWith('.ts') || entry.endsWith('.spec.ts')) continue;
      const src = readFileSync(full, 'utf8');
      if (!src.includes('standalone: false') && !src.includes('standalone:false')) continue;
      if (!src.includes('@Component(')) continue;

      // Use export-class boundaries to isolate each decorator
      const classBoundaryRe = /^export\s+(?:abstract\s+)?class\s+/gm;
      const boundaries = [];
      let bm;
      while ((bm = classBoundaryRe.exec(src)) !== null) boundaries.push(bm.index);
      boundaries.push(src.length);

      let result = src;
      let shift = 0;
      for (let bi = 0; bi < boundaries.length - 1; bi++) {
        const classStart = boundaries[bi] + shift;
        const before = result.slice(0, classStart);
        const compIdx = before.lastIndexOf('@Component(');
        if (compIdx === -1) continue;
        const decRegion = result.slice(compIdx, classStart);
        if (!/standalone\s*:\s*false/.test(decRegion)) continue;
        if (!decRegion.includes('imports:')) continue;

        // Strip imports: [...] (single or multi-line) from this decorator region
        const cleaned = decRegion.replace(/\n[ \t]*imports\s*:\s*\[[^\]]*\]\s*,?/g, '');
        if (cleaned === decRegion) continue;
        result = result.slice(0, compIdx) + cleaned + result.slice(classStart);
        shift += cleaned.length - decRegion.length;
      }

      if (result !== src) {
        writeFileSync(full, result);
        count++;
      }
    }
  }
  walk(srcDir);
  if (count > 0) console.log(`  ↳ imports: [] removido de ${count} componente(s) standalone: false`);
}

// Returns the number of @Component/@Pipe/@Directive files that still have standalone: false.
function collectStandaloneFalseCount() {
  const srcDir = join(destPath, 'src');
  if (!existsSync(srcDir)) return 0;
  let count = 0;
  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!entry.endsWith('.ts') || entry.endsWith('.spec.ts')) continue;
      const src = readFileSync(full, 'utf8');
      if ((src.includes('standalone: false') || src.includes('standalone:false')) &&
          (src.includes('@Component(') || src.includes('@Pipe(') || src.includes('@Directive('))) {
        count++;
      }
    }
  }
  walk(srcDir);
  return count;
}

// Converte componentes standalone: false que não aparecem em nenhum declarations[]
// de NgModule sobrevivente. Após prune-ng-modules, esses componentes estão órfãos
// (nenhum módulo os declara) e devem ser standalone: true.
function convertOrphanedNonStandalone() {
  const srcDir = join(destPath, 'src');
  if (!existsSync(srcDir)) return 0;

  // Coleta todos os nomes de classe presentes em declarations: [] de NgModules ainda existentes
  const declaredInModule = new Set();
  function indexModules(dir) {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { indexModules(full); continue; }
      if (!entry.endsWith('.module.ts')) continue;
      const src = readFileSync(full, 'utf8');
      if (!src.includes('@NgModule')) continue;
      // Extrai declarations: [...] com bracket counter
      const declIdx = src.search(/\bdeclarations\s*:/);
      if (declIdx === -1) continue;
      const arrOpen = src.indexOf('[', declIdx);
      if (arrOpen === -1) continue;
      let depth = 0, arrEnd = -1;
      for (let i = arrOpen; i < src.length; i++) {
        if (src[i] === '[') depth++;
        else if (src[i] === ']') { if (--depth === 0) { arrEnd = i; break; } }
      }
      if (arrEnd === -1) continue;
      for (const m of src.slice(arrOpen + 1, arrEnd).matchAll(/\b[A-Z][A-Za-z0-9_]*\b/g)) {
        declaredInModule.add(m[0]);
      }
    }
  }
  indexModules(srcDir);

  let count = 0;
  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!entry.endsWith('.ts') || entry.endsWith('.spec.ts')) continue;
      const src = readFileSync(full, 'utf8');
      if (!src.includes('@Component(')) continue;
      if (!src.includes('standalone: false') && !src.includes('standalone:false')) continue;

      // Verifica se alguma classe deste arquivo ainda está declarada em módulo sobrevivente
      const classNames = [...src.matchAll(/export\s+(?:abstract\s+)?class\s+([A-Z][A-Za-z0-9_]*)/g)].map(m => m[1]);
      if (classNames.some(cls => declaredInModule.has(cls))) continue;

      // Nenhum módulo restante declara este componente — converter para standalone: true
      const updated = src.replace(/\bstandalone\s*:\s*false/g, 'standalone: true');
      if (updated !== src) {
        writeFileSync(full, updated);
        count++;
        console.log(`  ↳ ${basename(full)}: standalone: false → true (órfão)`);
      }
    }
  }
  walk(srcDir);
  if (count > 0) console.log(`  ↳ ${count} componente(s) órfão(s) convertidos para standalone: true`);
  return count;
}

// ─── Limpa TODO(standalone-migration): comments ───────────────────────────────
// O schematic prune-ng-modules insere esses comentários quando não consegue
// remover uma referência automaticamente. Após as nossas correções eles são lixo.
function cleanupStandaloneTodos() {
  const srcDir = join(destPath, 'src');
  if (!existsSync(srcDir)) return 0;
  let count = 0;
  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!entry.endsWith('.ts') && !entry.endsWith('.html')) continue;
      const src = readFileSync(full, 'utf8');
      if (!src.includes('TODO(standalone-migration)')) continue;
      const updated = src.split('\n')
        .filter(line => !/^\s*\/\/\s*TODO\(standalone-migration\)/.test(line))
        .join('\n')
        .replace(/\s*\/\*\s*TODO\(standalone-migration\)[^*]*\*\//g, '');
      if (updated !== src) { writeFileSync(full, updated); count++; }
    }
  }
  walk(srcDir);
  if (count > 0) console.log(`  ↳ TODO(standalone-migration): removido de ${count} arquivo(s)`);
  return count;
}

// ─── Detecta e corrige dependências circulares em imports standalone ──────────
// A → imports [B], B → imports [A] causa ReferenceError em runtime.
// Fix: no arquivo "B" (lexicograficamente maior), envolve a classe de A com forwardRef.
function fixCircularStandaloneImports() {
  const srcDir = join(destPath, 'src');
  if (!existsSync(srcDir)) return 0;

  // file → { classes: Set<string>, decoratorImportClasses: string[], esImportMap: Map<class, file> }
  const fileInfo = new Map();

  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!entry.endsWith('.ts') || entry.endsWith('.spec.ts')) continue;
      const src = readFileSync(full, 'utf8');
      if (!src.includes('standalone: true')) continue;
      if (!/@(?:Component|Directive|Pipe)\s*\(/.test(src)) continue;

      // Classes exported from this file
      const classes = new Set(
        [...src.matchAll(/export\s+(?:abstract\s+)?class\s+([A-Z]\w*)/g)].map(m => m[1]),
      );

      // imports: [...] inside the decorator
      const decM = src.match(/@(?:Component|Directive|Pipe)\s*\(\s*\{[\s\S]*?\bimports\s*:\s*\[([\s\S]*?)\]/);
      const decoratorImportClasses = decM
        ? [...decM[1].matchAll(/\b([A-Z]\w*)\b/g)].map(m => m[1])
        : [];

      // TypeScript import statements → class → resolved file path
      const esImportMap = new Map();
      for (const m of src.matchAll(/^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/gm)) {
        const importPath = m[2];
        if (!importPath.startsWith('.')) continue;
        let resolved = resolve(dirname(full), importPath);
        if (!resolved.endsWith('.ts')) resolved += '.ts';
        for (const rawCls of m[1].split(',')) {
          const cls = rawCls.replace(/\s+as\s+\S+/, '').trim();
          if (cls) esImportMap.set(cls, resolved);
        }
      }

      if (classes.size > 0 && decoratorImportClasses.length > 0) {
        fileInfo.set(full, { classes, decoratorImportClasses, esImportMap });
      }
    }
  }
  walk(srcDir);

  let fixed = 0;
  const handled = new Set();

  for (const [fileA, infoA] of fileInfo) {
    for (const cls of infoA.decoratorImportClasses) {
      const fileB = infoA.esImportMap.get(cls);
      if (!fileB || !fileInfo.has(fileB)) continue;
      const infoB = fileInfo.get(fileB);

      // Check if B also imports a class from A
      const classesFromAInB = infoB.decoratorImportClasses.filter(
        c => infoA.classes.has(c) && infoB.esImportMap.get(c) === fileA,
      );
      if (classesFromAInB.length === 0) continue;

      const cycleKey = [fileA, fileB].sort().join('|');
      if (handled.has(cycleKey)) continue;
      handled.add(cycleKey);

      // Break cycle in the lexicographically larger file (deterministic choice)
      const [, fixFile] = [fileA, fileB].sort();
      const fixInfo = fixFile === fileA ? infoA : infoB;
      const classesToWrap = fixFile === fileA ? classesFromAInB : [cls];

      let src = readFileSync(fixFile, 'utf8');
      let changed = false;

      for (const c of classesToWrap) {
        // Only wrap if not already wrapped
        if (src.includes(`forwardRef(() => ${c})`)) continue;
        src = src.replace(
          new RegExp(`(\\bimports\\s*:\\s*\\[[^\\]]*?)\\b${c}\\b`, 's'),
          (_, prefix) => `${prefix}forwardRef(() => ${c})`,
        );
        changed = true;
        console.log(`  ↳ ${basename(fixFile)}: forwardRef(() => ${c}) — dependência circular`);
      }

      if (!changed) continue;

      // Ensure forwardRef is imported from @angular/core
      if (!src.includes('forwardRef')) {
        src = src.replace(
          /^(import\s+\{)([^}]+)(\}\s+from\s+['"]@angular\/core['"])/m,
          (_, open, names, close) => `${open}${names.trimEnd()}, forwardRef${close}`,
        );
      }

      writeFileSync(fixFile, src);
      fixed++;
    }
  }

  if (fixed > 0) console.log(`  ↳ ${fixed} dependência(s) circular(es) corrigida(s) com forwardRef`);
  return fixed;
}

// ─── Shared helpers: template import detection (NgModule + standalone) ──────────

const TMPL_ELEM = {
  'mat-autocomplete':        { sym: 'MatAutocompleteModule',      pkg: '@angular/material/autocomplete' },
  'mat-option':              { sym: 'MatOptionModule',            pkg: '@angular/material/core' },
  'mat-optgroup':            { sym: 'MatOptionModule',            pkg: '@angular/material/core' },
  'mat-button-toggle':       { sym: 'MatButtonToggleModule',      pkg: '@angular/material/button-toggle' },
  'mat-button-toggle-group': { sym: 'MatButtonToggleModule',      pkg: '@angular/material/button-toggle' },
  'mat-card':                { sym: 'MatCardModule',              pkg: '@angular/material/card' },
  'mat-card-header':         { sym: 'MatCardModule',              pkg: '@angular/material/card' },
  'mat-card-content':        { sym: 'MatCardModule',              pkg: '@angular/material/card' },
  'mat-card-actions':        { sym: 'MatCardModule',              pkg: '@angular/material/card' },
  'mat-card-footer':         { sym: 'MatCardModule',              pkg: '@angular/material/card' },
  'mat-card-title':          { sym: 'MatCardModule',              pkg: '@angular/material/card' },
  'mat-card-subtitle':       { sym: 'MatCardModule',              pkg: '@angular/material/card' },
  'mat-checkbox':            { sym: 'MatCheckboxModule',          pkg: '@angular/material/checkbox' },
  'mat-chip':                { sym: 'MatChipsModule',             pkg: '@angular/material/chips' },
  'mat-chip-list':           { sym: 'MatChipsModule',             pkg: '@angular/material/chips' },
  'mat-chip-listbox':        { sym: 'MatChipsModule',             pkg: '@angular/material/chips' },
  'mat-chip-grid':           { sym: 'MatChipsModule',             pkg: '@angular/material/chips' },
  'mat-datepicker':          { sym: 'MatDatepickerModule',        pkg: '@angular/material/datepicker' },
  'mat-datepicker-toggle':   { sym: 'MatDatepickerModule',        pkg: '@angular/material/datepicker' },
  'mat-calendar':            { sym: 'MatDatepickerModule',        pkg: '@angular/material/datepicker' },
  'mat-dialog-content':      { sym: 'MatDialogModule',            pkg: '@angular/material/dialog' },
  'mat-dialog-actions':      { sym: 'MatDialogModule',            pkg: '@angular/material/dialog' },
  'mat-dialog-title':        { sym: 'MatDialogModule',            pkg: '@angular/material/dialog' },
  'mat-divider':             { sym: 'MatDividerModule',           pkg: '@angular/material/divider' },
  'mat-expansion-panel':     { sym: 'MatExpansionModule',         pkg: '@angular/material/expansion' },
  'mat-accordion':           { sym: 'MatExpansionModule',         pkg: '@angular/material/expansion' },
  'mat-expansion-panel-header': { sym: 'MatExpansionModule',      pkg: '@angular/material/expansion' },
  'mat-panel-title':         { sym: 'MatExpansionModule',         pkg: '@angular/material/expansion' },
  'mat-panel-description':   { sym: 'MatExpansionModule',         pkg: '@angular/material/expansion' },
  'mat-form-field':          { sym: 'MatFormFieldModule',         pkg: '@angular/material/form-field' },
  'mat-label':               { sym: 'MatFormFieldModule',         pkg: '@angular/material/form-field' },
  'mat-error':               { sym: 'MatFormFieldModule',         pkg: '@angular/material/form-field' },
  'mat-hint':                { sym: 'MatFormFieldModule',         pkg: '@angular/material/form-field' },
  'mat-grid-list':           { sym: 'MatGridListModule',          pkg: '@angular/material/grid-list' },
  'mat-grid-tile':           { sym: 'MatGridListModule',          pkg: '@angular/material/grid-list' },
  'mat-icon':                { sym: 'MatIconModule',              pkg: '@angular/material/icon' },
  'mat-list':                { sym: 'MatListModule',              pkg: '@angular/material/list' },
  'mat-nav-list':            { sym: 'MatListModule',              pkg: '@angular/material/list' },
  'mat-action-list':         { sym: 'MatListModule',              pkg: '@angular/material/list' },
  'mat-list-item':           { sym: 'MatListModule',              pkg: '@angular/material/list' },
  'mat-selection-list':      { sym: 'MatListModule',              pkg: '@angular/material/list' },
  'mat-list-option':         { sym: 'MatListModule',              pkg: '@angular/material/list' },
  'mat-menu':                { sym: 'MatMenuModule',              pkg: '@angular/material/menu' },
  'mat-paginator':           { sym: 'MatPaginatorModule',         pkg: '@angular/material/paginator' },
  'mat-progress-bar':        { sym: 'MatProgressBarModule',       pkg: '@angular/material/progress-bar' },
  'mat-progress-spinner':    { sym: 'MatProgressSpinnerModule',   pkg: '@angular/material/progress-spinner' },
  'mat-spinner':             { sym: 'MatProgressSpinnerModule',   pkg: '@angular/material/progress-spinner' },
  'mat-radio-button':        { sym: 'MatRadioModule',             pkg: '@angular/material/radio' },
  'mat-radio-group':         { sym: 'MatRadioModule',             pkg: '@angular/material/radio' },
  'mat-select':              { sym: 'MatSelectModule',            pkg: '@angular/material/select' },
  'mat-sidenav':             { sym: 'MatSidenavModule',           pkg: '@angular/material/sidenav' },
  'mat-sidenav-container':   { sym: 'MatSidenavModule',           pkg: '@angular/material/sidenav' },
  'mat-sidenav-content':     { sym: 'MatSidenavModule',           pkg: '@angular/material/sidenav' },
  'mat-drawer':              { sym: 'MatSidenavModule',           pkg: '@angular/material/sidenav' },
  'mat-slide-toggle':        { sym: 'MatSlideToggleModule',       pkg: '@angular/material/slide-toggle' },
  'mat-slider':              { sym: 'MatSliderModule',            pkg: '@angular/material/slider' },
  'mat-sort-header':         { sym: 'MatSortModule',              pkg: '@angular/material/sort' },
  'mat-step':                { sym: 'MatStepperModule',           pkg: '@angular/material/stepper' },
  'mat-stepper':             { sym: 'MatStepperModule',           pkg: '@angular/material/stepper' },
  'mat-horizontal-stepper':  { sym: 'MatStepperModule',           pkg: '@angular/material/stepper' },
  'mat-vertical-stepper':    { sym: 'MatStepperModule',           pkg: '@angular/material/stepper' },
  'mat-table':               { sym: 'MatTableModule',             pkg: '@angular/material/table' },
  'mat-header-cell':         { sym: 'MatTableModule',             pkg: '@angular/material/table' },
  'mat-cell':                { sym: 'MatTableModule',             pkg: '@angular/material/table' },
  'mat-footer-cell':         { sym: 'MatTableModule',             pkg: '@angular/material/table' },
  'mat-header-row':          { sym: 'MatTableModule',             pkg: '@angular/material/table' },
  'mat-row':                 { sym: 'MatTableModule',             pkg: '@angular/material/table' },
  'mat-footer-row':          { sym: 'MatTableModule',             pkg: '@angular/material/table' },
  'mat-tab':                 { sym: 'MatTabsModule',              pkg: '@angular/material/tabs' },
  'mat-tab-group':           { sym: 'MatTabsModule',              pkg: '@angular/material/tabs' },
  'mat-tab-nav-bar':         { sym: 'MatTabsModule',              pkg: '@angular/material/tabs' },
  'mat-toolbar':             { sym: 'MatToolbarModule',           pkg: '@angular/material/toolbar' },
  'mat-toolbar-row':         { sym: 'MatToolbarModule',           pkg: '@angular/material/toolbar' },
  'mat-tooltip':             { sym: 'MatTooltipModule',           pkg: '@angular/material/tooltip' },
  'mat-tree':                { sym: 'MatTreeModule',              pkg: '@angular/material/tree' },
  'mat-tree-node':           { sym: 'MatTreeModule',              pkg: '@angular/material/tree' },
  'mat-nested-tree-node':    { sym: 'MatTreeModule',              pkg: '@angular/material/tree' },
  'router-outlet':           { sym: 'RouterOutlet',               pkg: '@angular/router' },
  'cdk-virtual-scroll-viewport': { sym: 'ScrollingModule',        pkg: '@angular/cdk/scrolling' },
  // Third-party
  'ng-progress':             { sym: 'NgProgressModule',           pkg: '@ngx-progressbar/core' },
  'ngx-ui-loader':           { sym: 'NgxUiLoaderModule',          pkg: 'ngx-ui-loader' },
  'ngx-spinner':             { sym: 'NgxSpinnerModule',           pkg: 'ngx-spinner' },
};

const TMPL_ATTR = {
  'matTooltip':              { sym: 'MatTooltipModule',           pkg: '@angular/material/tooltip' },
  'matMenuTriggerFor':       { sym: 'MatMenuModule',              pkg: '@angular/material/menu' },
  'matSort':                 { sym: 'MatSortModule',              pkg: '@angular/material/sort' },
  'matSortHeader':           { sym: 'MatSortModule',              pkg: '@angular/material/sort' },
  'matColumnDef':            { sym: 'MatTableModule',             pkg: '@angular/material/table' },
  'matHeaderCellDef':        { sym: 'MatTableModule',             pkg: '@angular/material/table' },
  'matCellDef':              { sym: 'MatTableModule',             pkg: '@angular/material/table' },
  'matFooterCellDef':        { sym: 'MatTableModule',             pkg: '@angular/material/table' },
  'matHeaderRowDef':         { sym: 'MatTableModule',             pkg: '@angular/material/table' },
  'matRowDef':               { sym: 'MatTableModule',             pkg: '@angular/material/table' },
  'matFooterRowDef':         { sym: 'MatTableModule',             pkg: '@angular/material/table' },
  'matInput':                { sym: 'MatInputModule',             pkg: '@angular/material/input' },
  'matNativeControl':        { sym: 'MatInputModule',             pkg: '@angular/material/input' },
  'mat-button':              { sym: 'MatButtonModule',            pkg: '@angular/material/button' },
  'mat-raised-button':       { sym: 'MatButtonModule',            pkg: '@angular/material/button' },
  'mat-flat-button':         { sym: 'MatButtonModule',            pkg: '@angular/material/button' },
  'mat-stroked-button':      { sym: 'MatButtonModule',            pkg: '@angular/material/button' },
  'mat-icon-button':         { sym: 'MatButtonModule',            pkg: '@angular/material/button' },
  'mat-fab':                 { sym: 'MatButtonModule',            pkg: '@angular/material/button' },
  'mat-mini-fab':            { sym: 'MatButtonModule',            pkg: '@angular/material/button' },
  'mat-dialog-close':        { sym: 'MatDialogModule',            pkg: '@angular/material/dialog' },
  'matDialogClose':          { sym: 'MatDialogModule',            pkg: '@angular/material/dialog' },
  'ngClass':                 { sym: 'NgClass',                    pkg: '@angular/common' },
  'ngStyle':                 { sym: 'NgStyle',                    pkg: '@angular/common' },
  'matLine':                 { sym: 'MatListModule',              pkg: '@angular/material/list' },
  'matListIcon':             { sym: 'MatListModule',              pkg: '@angular/material/list' },
  'routerLink':              { sym: 'RouterLink',                 pkg: '@angular/router' },
  'routerLinkActive':        { sym: 'RouterLinkActive',           pkg: '@angular/router' },
  'cdkScrollable':           { sym: 'ScrollingModule',            pkg: '@angular/cdk/scrolling' },
};

const TMPL_PIPE = {
  'translate':    { sym: 'TranslatePipe',    pkg: '@ngx-translate/core' },
  'async':        { sym: 'AsyncPipe',        pkg: '@angular/common' },
  'date':         { sym: 'DatePipe',         pkg: '@angular/common' },
  'currency':     { sym: 'CurrencyPipe',     pkg: '@angular/common' },
  'decimal':      { sym: 'DecimalPipe',      pkg: '@angular/common' },
  'percent':      { sym: 'PercentPipe',      pkg: '@angular/common' },
  'uppercase':    { sym: 'UpperCasePipe',    pkg: '@angular/common' },
  'lowercase':    { sym: 'LowerCasePipe',    pkg: '@angular/common' },
  'titlecase':    { sym: 'TitleCasePipe',    pkg: '@angular/common' },
  'slice':        { sym: 'SlicePipe',        pkg: '@angular/common' },
  'json':         { sym: 'JsonPipe',         pkg: '@angular/common' },
  'keyvalue':     { sym: 'KeyValuePipe',     pkg: '@angular/common' },
  'number':       { sym: 'DecimalPipe',      pkg: '@angular/common' },
  'i18nPlural':   { sym: 'I18nPluralPipe',   pkg: '@angular/common' },
  'i18nSelect':   { sym: 'I18nSelectPipe',   pkg: '@angular/common' },
};

function tmplPkgInstalled(pkg) {
  const nmDir = join(destPath, 'node_modules');
  const parts = pkg.split('/');
  const p = pkg.startsWith('@') ? join(nmDir, parts[0], parts[1]) : join(nmDir, parts[0]);
  return existsSync(p);
}

function tmplGetTemplate(tsFile, src) {
  const inlineM = src.match(/template\s*:\s*(`(?:[^`\\]|\\.|\n)*?`|'(?:[^'\\]|\\.)*?'|"(?:[^"\\]|\\.)*?")/s);
  if (inlineM) return inlineM[1].slice(1, -1);
  const urlM = src.match(/templateUrl\s*:\s*['"]([^'"]+)['"]/);
  if (urlM) {
    const p = join(dirname(tsFile), urlM[1]);
    if (existsSync(p)) return readFileSync(p, 'utf8');
  }
  return null;
}

function tmplDetectNeeded(tpl) {
  const needed = new Map();
  // Build pattern from all known element keys so third-party elements (ng-progress, etc.) are also detected
  const elemKeys = Object.keys(TMPL_ELEM).map(k => k.replace(/[-[\]]/g, '\\$&')).join('|');
  const elemRe = new RegExp(`<(${elemKeys})[\\s\\/>]`, 'g');
  let m;
  while ((m = elemRe.exec(tpl)) !== null) {
    const e = TMPL_ELEM[m[1]];
    if (e && tmplPkgInstalled(e.pkg)) needed.set(e.sym, e.pkg);
  }
  for (const [attr, { sym, pkg }] of Object.entries(TMPL_ATTR)) {
    if (!tmplPkgInstalled(pkg)) continue;
    const esc = attr.replace(/[-[\]]/g, '\\$&');
    if (new RegExp(`(?:[\\s\\["])${esc}(?:[\\s=\\]">/])`).test(tpl)) needed.set(sym, pkg);
  }
  if (/\bmat-(?:button|raised-button|flat-button|stroked-button|icon-button|fab|mini-fab)\b/.test(tpl)) {
    if (tmplPkgInstalled('@angular/material/button')) needed.set('MatButtonModule', '@angular/material/button');
  }
  const pipeRe = /\|\s*([\w]+)/g;
  while ((m = pipeRe.exec(tpl)) !== null) {
    const p = TMPL_PIPE[m[1]];
    if (p && tmplPkgInstalled(p.pkg)) needed.set(p.sym, p.pkg);
  }
  if (/\(\s*ngModel\s*\)|\bngModel\b/.test(tpl)) needed.set('FormsModule', '@angular/forms');
  if (/\[formControl\]|\bformControlName\b|\[formGroup\]|\bformGroupName\b|\bformArrayName\b/.test(tpl)) {
    needed.set('ReactiveFormsModule', '@angular/forms');
  }
  return needed;
}

function tmplGetDecoratorImportsArray(src, decoratorRe) {
  const compIdx = src.search(decoratorRe);
  if (compIdx === -1) return null;
  let depth = 0, compEnd = -1;
  for (let i = src.indexOf('(', compIdx); i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') { if (--depth === 0) { compEnd = i; break; } }
  }
  if (compEnd === -1) return null;
  const decBody = src.slice(compIdx, compEnd + 1);
  const imM = decBody.match(/\bimports\s*:\s*\[/);
  if (!imM) return null;
  const arrStart = compIdx + imM.index + imM[0].length - 1;
  let bdepth = 0, arrEnd = -1;
  for (let i = arrStart; i < src.length; i++) {
    if (src[i] === '[') bdepth++;
    else if (src[i] === ']') { if (--bdepth === 0) { arrEnd = i; break; } }
  }
  if (arrEnd === -1) return null;
  const existing = new Set(src.slice(arrStart + 1, arrEnd).match(/\b[A-Z][A-Za-z0-9_]*\b/g) ?? []);
  return { start: arrStart, end: arrEnd, existing };
}

function tmplHasEsImport(src, sym) {
  const atIdx = src.search(/@(?:Component|Directive|Pipe|Injectable|NgModule)\s*[({]/);
  const section = atIdx > 0 ? src.slice(0, atIdx) : src;
  return new RegExp(`\\b${sym}\\b`).test(section);
}

function tmplInjectImports(src, toAdd, decoratorRe) {
  let modified = src;
  for (const { sym, pkg } of toAdd) {
    if (!tmplHasEsImport(modified, sym)) {
      const lastIm = [...modified.matchAll(/^import\s+.+;?[ \t]*$/gm)].pop();
      const pos = lastIm ? lastIm.index + lastIm[0].length : 0;
      modified = modified.slice(0, pos) + `\nimport { ${sym} } from '${pkg}';` + modified.slice(pos);
    }
  }
  let arr2 = tmplGetDecoratorImportsArray(modified, decoratorRe);
  if (!arr2) {
    // No imports: [] in the decorator — inject one before the closing brace
    const decIdx = modified.search(decoratorRe);
    if (decIdx === -1) return modified;
    let depth = 0, decEnd = -1;
    for (let i = modified.indexOf('(', decIdx); i < modified.length; i++) {
      if (modified[i] === '(') depth++;
      else if (modified[i] === ')') { if (--depth === 0) { decEnd = i; break; } }
    }
    if (decEnd === -1) return modified;
    // Find the closing } of the decorator's object literal
    let bdepth = 0, objEnd = -1;
    for (let i = modified.indexOf('{', decIdx); i < decEnd; i++) {
      if (modified[i] === '{') bdepth++;
      else if (modified[i] === '}') { if (--bdepth === 0) { objEnd = i; break; } }
    }
    if (objEnd === -1) return modified;
    modified = modified.slice(0, objEnd) + '\n  imports: [],\n' + modified.slice(objEnd);
    arr2 = tmplGetDecoratorImportsArray(modified, decoratorRe);
    if (!arr2) return modified;
  }
  const insertStr = toAdd.map(x => x.sym).join(',\n    ');
  const before = modified.slice(0, arr2.end);
  const sep = before.trimEnd().endsWith('[') ? '\n    ' : ',\n    ';
  return before.trimEnd() + sep + insertStr + '\n  ' + modified.slice(arr2.end);
}

// ─── Fix NgModule imports BEFORE standalone migration ────────────────────────
// When convert-to-standalone copies a module's imports to each component,
// missing entries in the module cause the component to also miss them.
// This pre-populates NgModule imports from template analysis.

function fixNgModuleImports() {
  const srcDir = join(destPath, 'src');
  if (!existsSync(srcDir)) return 0;

  // Map exported class name → file path
  const classMap = new Map();
  function buildClassMap(dir) {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { buildClassMap(full); continue; }
      if (!entry.endsWith('.ts') || entry.endsWith('.spec.ts')) continue;
      const src = readFileSync(full, 'utf8');
      const re = /export\s+(?:abstract\s+)?class\s+([A-Z][A-Za-z0-9_]*)/g;
      let m;
      while ((m = re.exec(src)) !== null) classMap.set(m[1], full);
    }
  }
  buildClassMap(srcDir);

  const MODULE_RE = /@NgModule\s*\(/;
  let total = 0;

  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!entry.endsWith('.module.ts')) continue;

      let src = readFileSync(full, 'utf8');
      const modIdx = src.search(MODULE_RE);
      if (modIdx === -1) continue;

      // Find @NgModule decorator bounds
      let depth = 0, modEnd = -1;
      for (let i = src.indexOf('(', modIdx); i < src.length; i++) {
        if (src[i] === '(') depth++;
        else if (src[i] === ')') { if (--depth === 0) { modEnd = i; break; } }
      }
      if (modEnd === -1) continue;
      const decBody = src.slice(modIdx, modEnd + 1);

      // Collect declared class names
      const declM = decBody.match(/\bdeclarations\s*:\s*\[/);
      if (!declM) continue;
      const declStart = modIdx + declM.index + declM[0].length - 1;
      let bdepth = 0, declEnd = -1;
      for (let i = declStart; i < src.length; i++) {
        if (src[i] === '[') bdepth++;
        else if (src[i] === ']') { if (--bdepth === 0) { declEnd = i; break; } }
      }
      if (declEnd === -1) continue;
      const declared = src.slice(declStart + 1, declEnd).match(/\b[A-Z][A-Za-z0-9_]*\b/g) ?? [];

      // Detect imports needed by all declared components' templates
      const needed = new Map();
      for (const cls of declared) {
        const compFile = classMap.get(cls);
        if (!compFile) continue;
        const compSrc = readFileSync(compFile, 'utf8');
        const tpl = tmplGetTemplate(compFile, compSrc);
        if (!tpl) continue;
        for (const [sym, pkg] of tmplDetectNeeded(tpl)) needed.set(sym, pkg);
      }
      if (!needed.size) continue;

      // Find existing imports: [] in module
      const importsInfo = tmplGetDecoratorImportsArray(src, MODULE_RE);
      const existing = importsInfo?.existing ?? new Set();
      const toAdd = [...needed].filter(([sym]) => !existing.has(sym)).map(([sym, pkg]) => ({ sym, pkg }));
      if (!toAdd.length) continue;

      const modified = tmplInjectImports(src, toAdd, MODULE_RE);
      if (modified !== src) {
        writeFileSync(full, modified);
        total++;
        console.log(`  ↳ ${basename(full)}: +${toAdd.map(x => x.sym).join(', ')}`);
      }
    }
  }
  walk(srcDir);
  if (total > 0) console.log(`  ↳ NgModule imports: ${total} module(s) corrigido(s)`);
  return total;
}

// ─── Copia TODOS os imports do NgModule para cada componente standalone ──────
// Roda APÓS convert-to-standalone (enquanto .module.ts ainda existe).
// A estratégia: copiar tudo → cleanup-unused-imports remove o que não usa.
// Isso é mais seguro que template-scan porque pega providers, CDK, pipes, etc.

function copyModuleImportsToComponents() {
  const srcDir = join(destPath, 'src');
  if (!existsSync(srcDir)) return 0;

  // Build class name → file path map
  const classMap = new Map();
  function buildClassMap(dir) {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { buildClassMap(full); continue; }
      if (!entry.endsWith('.ts') || entry.endsWith('.spec.ts')) continue;
      const src = readFileSync(full, 'utf8');
      const re = /export\s+(?:abstract\s+)?class\s+([A-Z][A-Za-z0-9_]*)/g;
      let m;
      while ((m = re.exec(src)) !== null) classMap.set(m[1], full);
    }
  }
  buildClassMap(srcDir);

  const COMPONENT_RE = /@Component\s*\(/;
  const MODULE_RE = /@NgModule\s*\(/;
  let total = 0;

  function extractDecoratorArray(src, decoratorRe, key) {
    const idx = src.search(decoratorRe);
    if (idx === -1) return [];
    let depth = 0, end = -1;
    for (let i = src.indexOf('(', idx); i < src.length; i++) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')') { if (--depth === 0) { end = i; break; } }
    }
    if (end === -1) return [];
    const body = src.slice(idx, end + 1);
    const km = body.match(new RegExp(`\\b${key}\\s*:\\s*\\[`));
    if (!km) return [];
    const arrStart = idx + km.index + km[0].length - 1;
    let bd = 0, arrEnd = -1;
    for (let i = arrStart; i < src.length; i++) {
      if (src[i] === '[') bd++;
      else if (src[i] === ']') { if (--bd === 0) { arrEnd = i; break; } }
    }
    if (arrEnd === -1) return [];
    return src.slice(arrStart + 1, arrEnd).match(/\b[A-Z][A-Za-z0-9_]*\b/g) ?? [];
  }

  // Build sym → pkg map from ES imports in any source string
  function buildEsImportMap(src) {
    const map = new Map();
    for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g)) {
      for (const sym of m[1].split(',').map(s => s.replace(/\s+as\s+\w+/, '').trim())) {
        if (sym) map.set(sym, m[2]);
      }
    }
    return map;
  }

  // Collect all external-package symbols exported (directly or transitively) by
  // a local module class. Angular's visibility rule: when Module A imports
  // Module B, components in A can use what Module B *exports* — not what B imports.
  // We recurse through exported local modules to collect their external re-exports.
  function collectModuleExports(className, depth, result, visited = new Set()) {
    if (depth > 8 || visited.has(className)) return;
    visited.add(className);
    const file = classMap.get(className);
    if (!file || !existsSync(file)) return;
    const src = readFileSync(file, 'utf8');
    if (!src.includes('@NgModule')) return;
    const es = buildEsImportMap(src);
    for (const exported of extractDecoratorArray(src, MODULE_RE, 'exports')) {
      const pkg = es.get(exported);
      if (!pkg) continue;
      if (!pkg.startsWith('.')) {
        result.set(exported, pkg); // external symbol re-exported — add it
      } else {
        collectModuleExports(exported, depth + 1, result, visited); // recurse into local re-export
      }
    }
  }

  // Resolve all external symbols a component declared in modSrc can access.
  // Direct external imports are added as-is; local module imports are replaced
  // by whatever those modules transitively export.
  function resolveTransitiveExternals(modSrc) {
    const result = new Map();
    const esImports = buildEsImportMap(modSrc);
    for (const sym of extractDecoratorArray(modSrc, MODULE_RE, 'imports')) {
      const pkg = esImports.get(sym);
      if (!pkg) continue;
      if (!pkg.startsWith('.')) {
        result.set(sym, pkg); // external symbol — include directly
      } else {
        collectModuleExports(sym, 0, result); // local module — follow exports
      }
    }
    return result;
  }

  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!entry.endsWith('.module.ts')) continue;

      const modSrc = readFileSync(full, 'utf8');
      if (!modSrc.includes('@NgModule')) continue;

      const declared = extractDecoratorArray(modSrc, MODULE_RE, 'declarations');
      if (!declared.length) continue;

      // Resolve all externally-importable symbols reachable from this module
      // (direct + transitive sub-module exports)
      const allExternals = resolveTransitiveExternals(modSrc);
      if (!allExternals.size) continue;

      for (const cls of declared) {
        const compFile = classMap.get(cls);
        if (!compFile) continue;
        let compSrc = readFileSync(compFile, 'utf8');
        if (!compSrc.includes('@Component(')) continue;
        // Process both confirmed standalone components and those that will become
        // standalone via fixMissingStandalone() which runs right after
        if (!compSrc.includes('standalone: true') && !compSrc.includes('standalone:true')) continue;

        const arrInfo = tmplGetDecoratorImportsArray(compSrc, COMPONENT_RE);
        if (!arrInfo) continue;
        const existing = arrInfo.existing;

        const toAdd = [...allExternals]
          .filter(([sym]) => !existing.has(sym))
          .map(([sym, pkg]) => ({ sym, pkg }));
        if (!toAdd.length) continue;

        const modified = tmplInjectImports(compSrc, toAdd, COMPONENT_RE);
        if (modified !== compSrc) {
          writeFileSync(compFile, modified);
          total++;
          console.log(`  ↳ ${basename(compFile)}: +${toAdd.map(x => x.sym).join(', ')}`);
        }
      }
    }
  }
  walk(srcDir);
  if (total > 0) console.log(`  ↳ module imports copied to ${total} component(s)`);
  return total;
}

// ─── Adiciona imports faltantes em componentes standalone ────────────────────
// Após standalone-migration, componentes podem referenciar mat-* sem ter os
// módulos no imports:[]. Detecta via template scan e adiciona automaticamente.

function fixStandaloneImports() {
  const COMPONENT_RE = /@Component\s*\(/;
  let total = 0;
  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!entry.endsWith('.ts') || entry.endsWith('.spec.ts')) continue;
      let src = readFileSync(full, 'utf8');
      if (!src.includes('@Component(') || !src.includes('standalone: true')) continue;
      const tpl = tmplGetTemplate(full, src);
      if (!tpl) continue;
      const needed = tmplDetectNeeded(tpl);
      if (!needed.size) continue;
      // arrInfo may be null (no imports: [] yet) — tmplInjectImports will create it
      const arrInfo = tmplGetDecoratorImportsArray(src, COMPONENT_RE);
      const existing = arrInfo?.existing ?? new Set();
      const toAdd = [...needed].filter(([sym]) => !existing.has(sym)).map(([sym, pkg]) => ({ sym, pkg }));
      if (!toAdd.length) continue;
      const modified = tmplInjectImports(src, toAdd, COMPONENT_RE);
      if (modified !== src) {
        writeFileSync(full, modified);
        total++;
        console.log(`  ↳ ${basename(full)}: +${toAdd.map(x => x.sym).join(', ')}`);
      }
    }
  }
  const srcDir = join(destPath, 'src');
  if (existsSync(srcDir)) walk(srcDir);
  if (total > 0) console.log(`  ↳ standalone imports: ${total} componente(s) corrigido(s)`);
  return total;
}

// ─── Fix: import * as moment → default import ─────────────────────────────────
// moduleResolution:bundler + moduleDetection:force quebra namespace imports de CJS

function fixMomentImport() {
  let count = 0;
  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!entry.endsWith('.ts')) continue;
      let src = readFileSync(full, 'utf8');
      const out = src.replace(/import\s+\*\s+as\s+moment\s+from\s+(['"])moment\1/g, `import moment from 'moment'`);
      if (out !== src) { writeFileSync(full, out); count++; }
    }
  }
  const srcDir = join(destPath, 'src');
  if (existsSync(srcDir)) walk(srcDir);
  if (count > 0) {
    const tsconfigPath = join(destPath, 'tsconfig.json');
    if (existsSync(tsconfigPath)) {
      const tc = readJson(tsconfigPath);
      if (!tc.compilerOptions) tc.compilerOptions = {};
      if (!tc.compilerOptions.esModuleInterop) {
        tc.compilerOptions.esModuleInterop = true;
        writeJson(tsconfigPath, tc);
      }
    }
    console.log(`  ↳ moment: import * as → default import (${count} arquivo(s))`);
  }
  return count;
}

// ─── Fix: new Subject() → new Subject<void>() em destroy signals ──────────────
// RxJS 7 + TS strict: Subject<unknown>.next() exige argumento. Subject<void> não.

function fixSubjectVoid() {
  let count = 0;
  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!entry.endsWith('.ts')) continue;
      let src = readFileSync(full, 'utf8');
      if (!src.includes('new Subject()') && !src.includes('new Subject<unknown>()')) continue;
      let out = src
        .replace(/new\s+Subject\s*<unknown>\s*\(\)/g, 'new Subject<void>()')
        .replace(
          /((?:private|protected|public|readonly)\s+)?(\w+)\$?\s*(?:=\s*)new\s+Subject\s*\(\)/g,
          (match, _mod, name) =>
            /(?:unsubscribe|destroy|teardown|stop|complete|close)/i.test(name)
              ? match.replace('new Subject()', 'new Subject<void>()') : match,
        );
      if (out !== src) { writeFileSync(full, out); count++; }
    }
  }
  const srcDir = join(destPath, 'src');
  if (existsSync(srcDir)) walk(srcDir);
  if (count > 0) console.log(`  ↳ Subject<void>: ${count} arquivo(s)`);
  return count;
}

// ─── SCSS @import → @use ─────────────────────────────────────────────────────

// Remove M2 typography variable blocks (mat.define-typography-config / mat-typography-config)
// that are invalid in Material 17+ (M3). Strips the full multi-line variable assignment and
// cleans up @include usages that referenced the removed variable.
function removeM2TypographyBlocks(src) {
  // Match: $varName: mat-typography-config(... or mat.define-typography-config(... (multi-line, nested parens)
  const varNames = new Set();
  let out = src.replace(
    /(\$[\w-]+)\s*:\s*(?:mat-typography-config|mat\.define-typography-config)\s*\(/g,
    (match, varName) => { varNames.add(varName); return match; },
  );

  // For each found var, remove the full assignment block (handles nested parens)
  for (const varName of varNames) {
    const escapedVar = varName.replace('$', '\\$');
    // Find the start of the assignment: $varName: mat*-typography-config(
    const startRe = new RegExp(
      '\\n?[ \\t]*' + escapedVar +
      '\\s*:\\s*(?:mat-typography-config|mat\\.define-typography-config)\\s*\\(',
    );
    let m = startRe.exec(out);
    if (!m) continue;
    const blockStart = m.index;
    // Walk forward, tracking paren depth to find the closing ');'
    let depth = 0;
    let i = m.index + m[0].length - 1; // position just before '('
    while (i < out.length) {
      if (out[i] === '(') depth++;
      else if (out[i] === ')') { depth--; if (depth === 0) { i++; break; } }
      i++;
    }
    // Consume optional trailing ';' and newline
    while (i < out.length && (out[i] === ';' || out[i] === '\r')) i++;
    if (out[i] === '\n') i++;
    out = out.slice(0, blockStart) + out.slice(i);

    // Remove @include mat.core($varName) → @include mat.core()
    out = out.replace(
      new RegExp('(@include\\s+mat\\.core\\s*\\()\\s*' + escapedVar + '\\s*(\\))', 'g'),
      '$1$2',
    );
    // Remove @include mat.all-component-typographies($varName); lines
    out = out.replace(
      new RegExp(
        '[ \\t]*@include\\s+mat\\.all-component-typographies\\s*\\(\\s*' +
        escapedVar + '\\s*\\)\\s*;[ \\t]*\\n?', 'g',
      ),
      '',
    );
  }

  return out;
}

function fixSassImports() {
  let count = 0;
  const srcDir = join(destPath, 'src');

  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!entry.endsWith('.scss')) continue;
      let src = readFileSync(full, 'utf8');
      let out = src;

      // @angular/material/theming was merged into @angular/material in v15
      out = out.replace(/@angular\/material\/theming/g, '@angular/material');

      // @import "~pkg" / @import "path" → @use "path" as *  (strips tilde prefix)
      out = out.replace(/@import\s+(['"])(~?)([^'"]+)\1\s*;/g,
        (_, q, _tilde, path) => `@use ${q}${path}${q} as *;`);

      // Material v1 SCSS API → v15/v17+ API
      // When old mat-* functions are present, switch @use '@angular/material' as * → as mat
      // and rename functions to their new names.
      if (out.includes('mat-typography-config(') || out.includes('mat-typography-level(') ||
          out.includes('mat-palette(') || out.includes('mat-light-theme(') ||
          out.includes('mat-dark-theme(') || out.includes('mat-core()')) {
        // Use explicit namespace so the new function names resolve correctly
        out = out.replace(/@use\s+(['"])@angular\/material\1\s+as\s+\*/g,
          `@use '@angular/material' as mat`);

        if (report.targetVersion >= 17) {
          // M3 (v17+): mat.define-typography-config() and mat.define-typography-level() were
          // removed entirely. Strip the whole variable block and clean up usages.
          out = removeM2TypographyBlocks(out);
        } else {
          // M2 (v14–v16): rename to the v15 API equivalents
          const matFnRenames = [
            [/\bmat-typography-config\s*\(/g,  'mat.define-typography-config('],
            [/\bmat-typography-level\s*\(/g,   'mat.define-typography-level('],
          ];
          out = out.split('\n').map(line => {
            if (/^\s*@(function|mixin)\s/.test(line)) return line;
            for (const [from, to] of matFnRenames) line = line.replace(from, to);
            return line;
          }).join('\n');
          // $letter-spacing keyword arg not supported in define-typography-level — strip it
          out = out.replace(/,\s*\$letter-spacing\s*:\s*[^,)]+/g, '');
        }

        // Common renames for all versions >= 15
        const matFnRenamesCommon = [
          [/\bmat-palette\s*\(/g,            'mat.define-palette('],
          [/\bmat-light-theme\s*\(/g,        'mat.define-light-theme('],
          [/\bmat-dark-theme\s*\(/g,         'mat.define-dark-theme('],
        ];
        out = out.split('\n').map(line => {
          if (/^\s*@(function|mixin)\s/.test(line)) return line;
          for (const [from, to] of matFnRenamesCommon) line = line.replace(from, to);
          return line;
        }).join('\n');
        out = out.replace(/@include\s+mat-core\s*\(\s*\)/g, '@include mat.core()');
        out = out.replace(/@include\s+angular-material-theme\s*\(/g, '@include mat.all-component-themes(');
        out = out.replace(/@include\s+angular-material-color\s*\(/g, '@include mat.all-component-colors(');
        out = out.replace(/@include\s+angular-material-typography\s*\(/g, '@include mat.all-component-typographies(');
      }

      // Fix url("~src/...") → relative path from this file to src/
      // (tilde+src/ was a webpack alias for Angular's source root)
      if (out.includes('~src/')) {
        const relToSrc = relative(dirname(full), srcDir).replace(/\\/g, '/') || '.';
        out = out.replace(/url\((['"])~src\//g, `url($1${relToSrc}/`);
        out = out.replace(/(['"])~src\//g, `$1${relToSrc}/`);
      }

      // Fix deprecated Sass slash division: $x / $y → math.div($x, $y)
      // Only matches clear SCSS math (both sides are variables or numeric literals, not CSS grid/font shorthands)
      const divRe = /(\$[\w-]+|\d+(?:\.\d+)?)(\s*\/\s*)(\$[\w-]+|\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw)?)/g;
      if (divRe.test(out) && !out.includes("'sass:math'") && !out.includes('"sass:math"')) {
        out = out.replace(divRe, (_, a, __, b) => `math.div(${a}, ${b})`);
        out = `@use 'sass:math' as math;\n${out}`;
      }

      // Fix deprecated darken()/lighten() → color.adjust() — Dart Sass 2.0 removes them
      const hasDarken  = /\bdarken\s*\(/.test(out);
      const hasLighten = /\blighten\s*\(/.test(out);
      if ((hasDarken || hasLighten) && !out.includes("'sass:color'") && !out.includes('"sass:color"')) {
        if (hasDarken)  out = out.replace(/\bdarken\s*\(([^,]+),\s*([^)]+)\)/g,  'color.adjust($1, $lightness: -$2)');
        if (hasLighten) out = out.replace(/\blighten\s*\(([^,]+),\s*([^)]+)\)/g, 'color.adjust($1, $lightness: $2)');
        out = `@use 'sass:color' as color;\n${out}`;
      }

      // Reorder: @use and @forward rules must come before any other CSS rules in SCSS
      if (out.includes('@use ') || out.includes('@forward ')) {
        const lines = out.split('\n');
        const leading = [];
        const useLines = [];
        const rest = [];
        let pastLeading = false;
        for (const line of lines) {
          const t = line.trim();
          if (!pastLeading && (t === '' || t.startsWith('//') || t.startsWith('/*') || t.startsWith('*'))) {
            leading.push(line);
          } else {
            pastLeading = true;
            if (/^\s*@(use|forward)\s/.test(line)) useLines.push(line);
            else rest.push(line);
          }
        }
        if (useLines.length > 0) {
          while (leading.length && leading[leading.length - 1].trim() === '') leading.pop();
          while (rest.length && rest[0].trim() === '') rest.shift();
          out = [
            ...leading,
            ...(leading.length ? [''] : []),
            ...useLines,
            ...(rest.length ? [''] : []),
            ...rest,
          ].join('\n');
        }
      }

      if (out !== src) { writeFileSync(full, out); count++; }
    }
  }

  if (existsSync(srcDir)) walk(srcDir);
  if (count > 0) console.log(`  ↳ SCSS @import → @use + tilde fix: ${count} arquivo(s)`);
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
  // Third-party libraries often lag behind Angular releases and reference removed internal types.
  // skipLibCheck avoids type errors in node_modules that we can't control (e.g. InjectFlags removed in Angular v20).
  if (!co.skipLibCheck) { co.skipLibCheck = true; changes.push('skipLibCheck→true'); }

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

  if (existsSync(configPath)) {
    // Post-process existing app.config.ts (created by standalone-bootstrap schematic):
    // 1. Deduplicate import lines (schematic sometimes generates duplicates)
    // 2. Add missing ES imports for symbols used in importProvidersFrom(...)
    let cfg = readFileSync(configPath, 'utf8');
    const mainContent2 = existsSync(mainPath) ? readFileSync(mainPath, 'utf8') : '';
    let cfgChanged = false;

    // Deduplicate import lines (normalize quotes so single vs double quote differences are caught)
    const cfgLines = cfg.split('\n');
    const seenImports = new Set();
    const deduped = cfgLines.filter(line => {
      if (!/^\s*import\s+/.test(line)) return true;
      const key = line.trim().replace(/"/g, "'"); // normalize to single quotes for comparison
      if (seenImports.has(key)) return false;
      seenImports.add(key);
      return true;
    });
    if (deduped.length !== cfgLines.length) { cfg = deduped.join('\n'); cfgChanged = true; }

    // Find symbols used in importProvidersFrom(...) that have no import statement.
    // Search across multiple candidate files: app.config.ts may be missing imports that were
    // in app.module.ts (third-party modules like NgxMaskModule, ToastrModule, etc. were never
    // in main.ts — they were in the AppModule.imports array).
    const ipfMatch = cfg.match(/importProvidersFrom\s*\(([^)]+)\)/s);
    if (ipfMatch) {
      // Build a corpus of all TS files that might have the original imports
      const candidatePaths = [
        mainPath,
        join(appDir, 'app.module.ts'),
        join(appDir, 'app-routing.module.ts'),
      ];
      // Also include any *.module.ts directly under src/app/
      try {
        for (const f of readdirSync(appDir)) {
          if (f.endsWith('.module.ts')) candidatePaths.push(join(appDir, f));
        }
      } catch { /* ignore */ }
      const candidateContent = candidatePaths
        .filter(p => existsSync(p))
        .map(p => readFileSync(p, 'utf8'))
        .join('\n');

      const ipfBody = ipfMatch[1];
      const usedSyms = [...ipfBody.matchAll(/\b([A-Z][A-Za-z0-9_]*)\b/g)].map(m => m[1]);
      for (const sym of usedSyms) {
        // Use regex instead of includes() so multi-line imports (schematic formatting) are detected
        if (new RegExp(`\\bimport\\s*\\{[^}]*\\b${sym}\\b[^}]*\\}`).test(cfg)) continue;
        // Symbol is not imported — search candidate files for an import containing this symbol
        const re = new RegExp(`import\\s*\\{[^}]*\\b${sym}\\b[^}]*\\}\\s*from\\s*['"][^'"]+['"]`);
        const m2 = candidateContent.match(re);
        if (m2) {
          // Extract only the source module path from the matched import — we add a minimal
          // single-symbol import to avoid pulling in other symbols that are already imported
          // (which would cause TS2300 duplicate identifier errors).
          const fromM = m2[0].match(/from\s*(['"][^'"]+['"])/);
          if (fromM) {
            const src = fromM[1]
              .replace(/^'\.\/app\//, `'./`)
              .replace(/^"\.\/app\//, `"./`);
            const singleImport = `import { ${sym} } from ${src}`;
            const lastImp = cfg.lastIndexOf('\nimport ');
            const ins = lastImp !== -1 ? lastImp + 1 : 0;
            cfg = cfg.slice(0, ins) + singleImport + ';\n' + cfg.slice(ins);
            cfgChanged = true;
          }
        }
      }
    }

    // Final dedup pass (safety net in case newly-added imports duplicated existing ones)
    if (cfgChanged) {
      const lines2 = cfg.split('\n');
      const seen2 = new Set();
      const deduped2 = lines2.filter(line => {
        if (!/^\s*import\s+/.test(line)) return true;
        const key = line.trim();
        if (seen2.has(key)) return false;
        seen2.add(key);
        return true;
      });
      if (deduped2.length !== lines2.length) cfg = deduped2.join('\n');
    }

    if (cfgChanged) { writeFileSync(configPath, cfg); console.log('  ↳ app.config.ts deduplicado/corrigido'); }
    return;
  }

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
  // Detect root component name and import path from the existing main.ts
  // (standalone-bootstrap schematic already set the correct path and name)
  const bootstrapM = mainContent.match(/bootstrapApplication\s*\(\s*([A-Z][A-Za-z0-9]*)/);
  const compName = bootstrapM?.[1] ?? 'AppComponent';
  const compImportM = mainContent.match(
    new RegExp(`import\\s*\\{[^}]*\\b${compName}\\b[^}]*\\}\\s*from\\s*['"]([^'"]+)['"]`),
  );
  const compPath = compImportM?.[1] ?? './app/app.component';

  writeFileSync(mainPath, [
    `import { bootstrapApplication } from '@angular/platform-browser';`,
    `import { ${compName} } from '${compPath}';`,
    `import { appConfig } from './app/app.config';`,
    ``,
    `bootstrapApplication(${compName}, appConfig).catch((err) => console.error(err));`,
    ``,
  ].join('\n'));
  console.log('  ↳ main.ts simplificado');
  report.modernize.mainSimplified = true;
}

// ─── throwError() → factory function (RxJS 7) ────────────────────────────────
// RxJS 7 deprecou throwError(value) — exige throwError(() => value).
// Objeto literal precisa de () => ({...}) para não ser interpretado como function body.

// ─── Renomeia variáveis cujos nomes são palavras reservadas ──────────────────
// O signals schematic pode gerar `const for = this.for()` — inválido em TS.
// Encontra cada declaração `const|let|var <reserved> =` dentro de um bloco,
// e renomeia o identificador para `<keyword>Value` em todo o bloco enclosing.
function fixReservedKeywordVariables() {
  const srcDir = join(destPath, 'src');
  if (!existsSync(srcDir)) return 0;

  // Reserved words that can realistically appear as Angular @Input names
  const KEYWORDS = [
    'for','class','new','in','of','if','else','switch','return','break','continue',
    'delete','typeof','void','instanceof','throw','try','catch','finally','import',
    'export','default','enum','extends','super','function','while','do','static',
    'yield','async','await','abstract','from','as','interface','type','let','var',
  ].join('|');
  const declRe = new RegExp(`\\b(const|let|var)\\s+(${KEYWORDS})\\s*=`, 'g');

  let count = 0;

  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!entry.endsWith('.ts') || entry.endsWith('.spec.ts')) continue;
      const src = readFileSync(full, 'utf8');
      declRe.lastIndex = 0;
      if (!declRe.test(src)) { declRe.lastIndex = 0; continue; }
      declRe.lastIndex = 0;

      let out = src;
      let fileChanged = false;

      // Repeat until no more reserved declarations are found (handles multiple in same file)
      for (let safety = 0; safety < 30; safety++) {
        declRe.lastIndex = 0;
        const m = declRe.exec(out);
        if (!m) break;

        const keyword = m[2];
        const newName = keyword + 'Value';

        // Walk backward from match to find the opening { of the enclosing block
        let depth = 0, blockStart = -1;
        for (let i = m.index - 1; i >= 0; i--) {
          if (out[i] === '}') depth++;
          else if (out[i] === '{') { if (depth === 0) { blockStart = i + 1; break; } depth--; }
        }
        const start = blockStart === -1 ? 0 : blockStart;

        // Find the matching closing }
        let end = out.length;
        if (blockStart !== -1) {
          depth = 1;
          for (let i = blockStart; i < out.length && depth > 0; i++) {
            if (out[i] === '{') depth++;
            else if (out[i] === '}') { if (--depth === 0) { end = i + 1; break; } }
          }
        }

        const block = out.slice(start, end);

        // Replace \bkeyword\b within the block:
        // - NOT preceded by '.' — preserves this.keyword / obj.keyword
        // - NOT followed by \s*( — preserves for(...) / for...of / for...in loops
        const newBlock = block.replace(
          new RegExp('(?<!\\.)\\b' + keyword + '\\b(?!\\s*\\()', 'g'),
          newName,
        );

        if (newBlock !== block) {
          out = out.slice(0, start) + newBlock + out.slice(end);
          fileChanged = true;
          count++;
          console.log(`  ↳ ${basename(full)}: '${keyword}' → '${newName}' (palavra reservada)`);
        } else {
          break;
        }
      }

      if (fileChanged) writeFileSync(full, out);
    }
  }

  walk(srcDir);
  if (count > 0) console.log(`  ↳ ${count} variável(eis) com nome reservado renomeada(s)`);
  return count;
}

// ─── Fix TypeScript/RxJS compatibility issues ────────────────────────────────
function fixTsCompat() {
  let count = 0;
  const srcDir = join(destPath, 'src');
  if (!existsSync(srcDir)) return 0;

  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!entry.endsWith('.ts') || entry.endsWith('.spec.ts')) continue;
      let src = readFileSync(full, 'utf8');
      let out = src;

      // rxjs/internal-compatibility was removed in RxJS 7
      // isObject(x) → (x !== null && typeof x === 'object')
      if (out.includes('rxjs/internal-compatibility')) {
        out = out.replace(
          /import\s*\{[^}]*\bisObject\b[^}]*\}\s*from\s*['"]rxjs\/internal-compatibility['"]\s*;?\n?/g, '');
        out = out.replace(/\bisObject\s*\(([^)]+)\)/g, '($1 !== null && typeof $1 === \'object\')');
        out = out.replace(
          /import\s*\{[^}]*\}\s*from\s*['"]rxjs\/internal-compatibility['"]\s*;?\n?/g, '');
      }

      // _countGroupLabelsBeforeLegacyOption → _countGroupLabelsBeforeOption (Material v15)
      out = out.replace(/_countGroupLabelsBeforeLegacyOption/g, '_countGroupLabelsBeforeOption');
      // _getLegacyOptionScrollPosition → _getOptionScrollPosition (Material v15)
      out = out.replace(/_getLegacyOptionScrollPosition/g, '_getOptionScrollPosition');

      // Double commas in TypeScript arrays/imports (from schematic add/remove operations)
      out = out.replace(/,(\s*,)+/g, ',');

      // ModuleWithProviders without generic type arg (required since Angular 10+)
      // static forRoot(): ModuleWithProviders → static forRoot(): ModuleWithProviders<ClassName>
      // Try to infer the class name from the enclosing class declaration
      if (out.includes('ModuleWithProviders') && !out.match(/ModuleWithProviders\s*<[^>]+>/)) {
        const classNameM = out.match(/export\s+(?:abstract\s+)?class\s+([A-Z][A-Za-z0-9_]*)/);
        const className = classNameM?.[1];
        if (className) {
          out = out.replace(/\bModuleWithProviders\b(?!\s*<)/g, `ModuleWithProviders<${className}>`);
        }
      }

      if (out !== src) { writeFileSync(full, out); count++; }
    }
  }
  walk(srcDir);
  if (count > 0) console.log(`  ↳ ts-compat fixes: ${count} arquivo(s)`);
  return count;
}

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

  let content = readFileSync(polyfillsPath, 'utf8');

  // Normalize legacy zone.js path: 'zone.js/dist/zone' → 'zone.js'
  if (content.includes('zone.js/dist/zone')) {
    content = content.replace(/zone\.js\/dist\/zone/g, 'zone.js');
    writeFileSync(polyfillsPath, content);
  }

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

    // Remove polyfills.ts (and its ngtypecheck counterpart) from tsconfig.app.json files array
    const tsconfigAppPath = join(destPath, 'tsconfig.app.json');
    if (existsSync(tsconfigAppPath)) {
      try {
        const tsapp = readJson(tsconfigAppPath);
        if (Array.isArray(tsapp.files)) {
          const before = tsapp.files.length;
          tsapp.files = tsapp.files.filter(f =>
            !String(f).includes('polyfills.ts') && !String(f).includes('polyfills.ngtypecheck.ts')
          );
          if (tsapp.files.length !== before) {
            writeJson(tsconfigAppPath, tsapp);
            console.log('  ↳ polyfills.ts removido do tsconfig.app.json');
          }
        }
      } catch { /* ignore malformed tsconfig */ }
    }
    return true;
  }
  return false;
}

function migrateFlexLayoutToTailwind() {
  const srcDir = join(destPath, 'src');

  // ── fxLayout → Tailwind ──────────────────────────────────────────────────

  function fxLayoutToTw(val) {
    const parts = val.trim().split(/\s+/);
    const MAP = { row:'flex', column:'flex flex-col', 'row-reverse':'flex flex-row-reverse', 'column-reverse':'flex flex-col-reverse' };
    const classes = [MAP[parts[0]] ?? 'flex'];
    if (parts.includes('wrap')) classes.push('flex-wrap');
    return classes.join(' ');
  }

  function fxLayoutAlignToTw(val) {
    const [main = '', cross = ''] = val.trim().split(/\s+/);
    const J = { start:'justify-start','flex-start':'justify-start',end:'justify-end','flex-end':'justify-end',center:'justify-center','space-around':'justify-around','space-between':'justify-between','space-evenly':'justify-evenly' };
    const A = { start:'items-start','flex-start':'items-start',end:'items-end','flex-end':'items-end',center:'items-center',stretch:'items-stretch',baseline:'items-baseline' };
    return [J[main], A[cross]].filter(Boolean).join(' ');
  }

  function fxLayoutGapToTw(val) {
    const v = val.trim();
    const px = v.endsWith('px') ? parseFloat(v) : v.endsWith('rem') ? parseFloat(v) * 16 : null;
    if (px !== null) {
      const s = px / 4;
      const VALID = new Set([0,.5,1,1.5,2,2.5,3,3.5,4,5,6,7,8,9,10,11,12,14,16,20,24,28,32,36,40,44,48,52,56,60,64,72,80,96]);
      if (VALID.has(s)) return `gap-${s}`;
    }
    return `gap-[${v}]`;
  }

  function fxFlexToTw(val) {
    const v = (val ?? '').trim();
    if (!v) return 'flex-1';
    const NAMED = { auto:'flex-auto', grow:'flex-grow', nogrow:'grow-0', noshrink:'shrink-0', none:'flex-none', fill:'flex-1 w-full h-full', initial:'flex-initial' };
    if (NAMED[v]) return NAMED[v];
    const n = parseFloat(v.replace('%', ''));
    if (!isNaN(n)) {
      const PCT = { 0:'w-0', 20:'w-1/5', 25:'w-1/4', 33:'w-1/3', 40:'w-2/5', 50:'w-1/2', 60:'w-3/5', 66:'w-2/3', 67:'w-2/3', 75:'w-3/4', 80:'w-4/5', 100:'w-full' };
      return PCT[Math.round(n)] ?? `w-[${Math.round(n)}%]`;
    }
    if (/\s/.test(v)) return `flex-[${v.replace(/\s+/g, '_')}]`;
    return `flex-[${v}]`;
  }

  const BP = { xs:'', sm:'sm:', md:'md:', lg:'lg:', xl:'xl:', '2xl':'2xl:', 'lt-sm':'max-sm:', 'lt-md':'max-md:', 'lt-lg':'max-lg:', 'lt-xl':'max-xl:', 'gt-xs':'sm:', 'gt-sm':'md:', 'gt-md':'lg:', 'gt-lg':'xl:' };

  function withPrefix(classes, bp) {
    const prefix = bp ? (BP[bp] ?? `${bp}:`) : '';
    return prefix ? classes.split(' ').map(c => `${prefix}${c}`).join(' ') : classes;
  }

  // Processa uma tag HTML individual (string), converte fx* → class=""
  function processTag(tag) {
    const classes = [];
    const cleaned = tag.replace(
      /[ \t]+\[?(fx(?:Layout(?:Align|Gap)?|Flex(?:Fill)?|Hide|Show|Fill))(?:\.([a-z0-9-]+))?\]?(?:="([^"]*)")?(?=[\s\/>])/g,
      (_m, name, bp, val) => {
        val = val ?? '';
        let tw = '';
        if      (name === 'fxLayout')                    tw = fxLayoutToTw(val);
        else if (name === 'fxLayoutAlign')               tw = fxLayoutAlignToTw(val);
        else if (name === 'fxLayoutGap')                 tw = fxLayoutGapToTw(val);
        else if (name === 'fxFlex')                      tw = fxFlexToTw(val);
        else if (name === 'fxFlexFill' || name === 'fxFill') tw = 'flex-1 w-full h-full min-h-0 min-w-0';
        else if (name === 'fxHide')                      tw = 'hidden';
        else if (name === 'fxShow')                      tw = 'block';
        if (tw) classes.push(withPrefix(tw, bp));
        return '';
      },
    );
    if (!classes.length) return tag;
    const newCls = classes.join(' ').replace(/\s+/g, ' ').trim();
    // Merge com class existente ou cria novo atributo
    if (/\bclass="/.test(cleaned))
      return cleaned.replace(/class="([^"]*)"/, (_, ex) => `class="${[ex.trim(), newCls].filter(Boolean).join(' ')}"`);
    return cleaned.replace(/^(<[a-zA-Z][a-zA-Z0-9-]*)/, `$1 class="${newCls}"`);
  }

  // Processa o conteúdo de um arquivo HTML convertendo todas as tags com fx*
  function processHtml(content) {
    let out = '';
    let i = 0;
    while (i < content.length) {
      if (content[i] === '<' && /[a-zA-Z]/.test(content[i + 1] ?? '')) {
        let j = i + 1;
        let inStr = false, sc = '';
        while (j < content.length) {
          const c = content[j];
          if (inStr) { if (c === sc) inStr = false; }
          else if (c === '"' || c === "'") { inStr = true; sc = c; }
          else if (c === '>') { j++; break; }
          j++;
        }
        const tag = content.slice(i, j);
        out += /\bfx[A-Z]/.test(tag) ? processTag(tag) : tag;
        i = j;
      } else {
        out += content[i++];
      }
    }
    return out;
  }

  // ── Execução ─────────────────────────────────────────────────────────────

  let htmlCount = 0, tsCount = 0;

  function walkHtml(dir) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { if (!SKIP_DIRS.has(entry)) walkHtml(full); continue; }
      if (!entry.endsWith('.html')) continue;
      const src = readFileSync(full, 'utf8');
      if (!/\bfx[A-Z]/.test(src)) continue;
      const out = processHtml(src);
      if (out !== src) { writeFileSync(full, out); htmlCount++; }
    }
  }

  function walkTs(dir) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { if (!SKIP_DIRS.has(entry)) walkTs(full); continue; }
      if (!entry.endsWith('.ts')) continue;
      let src = readFileSync(full, 'utf8');
      if (!/FlexLayout/.test(src)) continue;
      const before = src;
      src = src.replace(/^import\s*\{[^}]*FlexLayoutModule[^}]*\}\s*from\s*['"]@angular\/flex-layout['"]\s*;?\r?\n?/gm, '');
      src = src.replace(/,?\s*\bFlexLayoutModule\b/g, '');
      src = src.replace(/\bFlexLayoutModule\b\s*,?\s*/g, '');
      if (src !== before) { writeFileSync(full, src); tsCount++; }
    }
  }

  console.log('  ↳ Convertendo atributos fxLayout/fxFlex → classes Tailwind...');
  walkHtml(srcDir);
  walkTs(srcDir);

  // Instala Tailwind CSS v3 (pinned: v4 uses a different config format incompatible with this setup)
  console.log('  ↳ Instalando Tailwind CSS v3...');
  run('npm install -D "tailwindcss@^3" postcss autoprefixer', { ignoreError: true });

  // Detect if project uses ESM ("type": "module" in package.json)
  let projectIsEsm = false;
  try {
    const pkgJson = JSON.parse(readFileSync(join(destPath, 'package.json'), 'utf8'));
    projectIsEsm = pkgJson.type === 'module';
  } catch { /* ignore */ }

  const twConfigName = projectIsEsm ? 'tailwind.config.mjs' : 'tailwind.config.js';
  const configPath = join(destPath, twConfigName);
  if (!existsSync(configPath)) {
    const twContent = projectIsEsm
      ? `/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{html,ts}'],
  theme: { extend: {} },
  plugins: [],
};\n`
      : `/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,ts}'],
  theme: { extend: {} },
  plugins: [],
};\n`;
    writeFileSync(configPath, twContent);
    console.log(`  ↳ ${twConfigName} criado`);
  }

  // Adiciona @tailwind directives no styles global
  for (const name of ['styles.scss', 'styles.css']) {
    const p = join(destPath, 'src', name);
    if (!existsSync(p)) continue;
    const content = readFileSync(p, 'utf8');
    if (!content.includes('@tailwind')) {
      writeFileSync(p, `@tailwind base;\n@tailwind components;\n@tailwind utilities;\n\n${content}`);
      console.log(`  ↳ @tailwind directives adicionadas em src/${name}`);
    }
    break;
  }

  console.log(`  ↳ flex-layout → Tailwind: ${htmlCount} template(s), ${tsCount} TypeScript(s)`);
  return { htmlCount, tsCount };
}

function runModernizationMigrations() {
  let prevHash = capture('git rev-parse HEAD');

  // Grava o passo atual no git, captura o diff vs passo anterior e atualiza o relatório
  // Returns true if ESLint is already configured in the project
  function hasEslintConfig() {
    return existsSync(join(destPath, 'eslint.config.js'))
      || existsSync(join(destPath, '.eslintrc.json'))
      || existsSync(join(destPath, '.eslintrc.js'))
      || existsSync(join(destPath, '.eslintrc.cjs'));
  }

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
    // Pre-populate NgModule imports from template analysis so the schematic
    // correctly copies them to each standalone component's imports: []
    console.log(`\n  🔄 standalone  (pre-fix NgModule imports)...`);
    fixNgModuleImports();

    runUntilStable(
      'npx ng generate @angular/core:standalone-migration --mode convert-to-standalone --defaults',
      'standalone  (convert-to-standalone)',
    );
    // Copy ALL NgModule imports to each converted component while .module.ts files still exist.
    // cleanup-unused-imports (last step) will prune what's not actually used.
    console.log(`\n  🔄 standalone  (copy all module imports to components)...`);
    copyModuleImportsToComponents();

    console.log(`\n  🔄 standalone  (prune-ng-modules)...`);
    run('npx ng generate @angular/core:standalone-migration --mode prune-ng-modules --defaults', { ignoreError: true });
    // Remove TODO(standalone-migration): comments left by the schematic
    cleanupStandaloneTodos();
    // Componentes que ficaram com standalone: false mas não pertencem a nenhum
    // NgModule sobrevivente são órfãos — convertê-los para standalone: true.
    convertOrphanedNonStandalone();
    console.log(`\n  🔄 standalone  (standalone-bootstrap)...`);
    run('npx ng generate @angular/core:standalone-migration --mode standalone-bootstrap --defaults', { ignoreError: true });
    report.modernize.standalone = true;
    commitStep('standalone', 'standalone migration');
  }

  // 3b. Garante standalone: true em pipes/directives que o schematic ignorou
  //     e adiciona imports faltantes de Material/Angular em componentes standalone
  if (!skipSteps.has('standaloneFixed')) {
    console.log(`\n  🔄 standalone  (fix missing standalone: true in pipes/directives)...`);
    report.modernize.standaloneFixed = fixMissingStandalone();
    removeImportsFromNonStandalone();
    console.log(`\n  🔄 standalone  (add missing Material/Angular imports)...`);
    report.modernize.standaloneFixed += fixStandaloneImports();
    // Re-run NgModule import fix for components that remain standalone: false after migration.
    // Their NgModules need the Material/CDK/pipe modules that templates reference.
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
    // Only relevant when standalone migration ran: some components had standalone: false but
    // belonged to modules removed only in this step. Promote orphans and add missing imports.
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
        if (secondPassConverted > 0) fixStandaloneImports();
        fixMissingStandalone();
        removeImportsFromNonStandalone();
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
    // Re-apply standalone fixes after cleanup: schematic may remove standalone: true from
    // components still referenced in surviving NgModules, leaving imports: [] without standalone.
    fixMissingStandalone();
    removeImportsFromNonStandalone();
    // Fix double commas left by schematics (prune-ng-modules, cleanup-unused-imports)
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

function writeReport() {
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

// ─── Grava dados de migração como JSON (lido pelo servidor UI) ───────────────

function writeMigrationData() {
  if (!existsSync(destPath)) return;
  try {
    const dataPath = join(migratorDir, 'MIGRATION-DATA.json');
    writeFileSync(dataPath, JSON.stringify(report, null, 2) + '\n');
  } catch {
    // non-fatal — UI polling will just show stale data
  }
}

// ─── Pacotes extras por versão ───────────────────────────────────────────────

// Pacotes do ecossistema Angular que seguem o mesmo versionamento major.
const ANGULAR_ECOSYSTEM = [
  '@angular/material',
  '@angular/cdk',
  '@angular/pwa',
  '@angular/service-worker',
];

function extraPackages(v) {
  const extra = [];
  for (const pkg of ANGULAR_ECOSYSTEM) {
    if (hasPackage(pkg)) extra.push(`${pkg}@${v}`);
  }
  if (v < 17 && hasPackage('@nguniversal/express-engine'))
    extra.push(`@nguniversal/express-engine@${v}`);
  return extra;
}

// Extrai todos os pacotes que causaram peer dependency conflict no output do ng update
// e tenta incluí-los no próximo run com a versão alvo.
// Não filtramos por namespace — pacotes de terceiros (@angular-builders/jest, etc.)
// também podem ser resolvidos assim. Se a versão @v não existir no npm, o ng update
// falha de qualquer jeito e caímos no --force. Sem risco extra.
// Packages whose versions are managed by syncVersions or by dedicated modernization steps.
// Including them in ng update would trigger their migration schematics (e.g. ng lint --fix
// from @angular-eslint/schematics), polluting the ng update commit with unrelated changes.
const SYNC_MANAGED_PREFIXES = ['@angular-eslint/', '@typescript-eslint/'];

function extractConflictPackages(output, v, alreadyIncluded) {
  const re = /Package "(@[\w/-]+)" has an incompatible peer dependency/g;
  const extra = [];
  let m;
  while ((m = re.exec(output)) !== null) {
    const pkg = m[1];
    if (SYNC_MANAGED_PREFIXES.some(p => pkg.startsWith(p))) continue;
    const versioned = `${pkg}@${v}`;
    if (!alreadyIncluded.includes(versioned)) extra.push(versioned);
  }
  return [...new Set(extra)];
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

// Pasta para arquivos gerados pelo migrador (relatórios, dados, patch)
const migratorDir = join(destPath, '.ng-migrator');
mkdirSync(migratorDir, { recursive: true });
diffDb = new Database(join(migratorDir, 'diffs.db'));
diffDb.exec('CREATE TABLE IF NOT EXISTS diffs (path TEXT, h0 TEXT, h1 TEXT, diff TEXT, PRIMARY KEY (path, h0, h1))');

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
writeMigrationData();  // primeiro snapshot
writeMigrationData();
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

  verifyTsconfigPaths();
  // 1ª tentativa: sem --force
  let packageList = packages.split(' ');
  let result = runCapture(`npx ng update ${packages} --allow-dirty`);

  // 2ª tentativa: detectar pacotes conflitantes do output e incluí-los no comando
  if (result.status !== 0) {
    const conflictPkgs = extractConflictPackages(result.output, v, packageList);
    if (conflictPkgs.length > 0) {
      const allPkgs = [...packageList, ...conflictPkgs].join(' ');
      console.warn(`\n  ⚠ ng update v${v} peer conflict — retentando com: ${conflictPkgs.join(' ')}`);
      packageList = allPkgs.split(' ');
      result = runCapture(`npx ng update ${allPkgs} --allow-dirty`);
    }
  }

  // 3ª tentativa: fallback com --force
  if (result.status !== 0) {
    console.warn(`\n  ⚠ ng update v${v} ainda falhou — tentando com --force...`);
    result = run(`npx ng update ${packageList.join(' ')} --allow-dirty --force`, { ignoreError: true });
  }
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
  writeMigrationData();
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
writeMigrationData();

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
