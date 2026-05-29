import {
  readFileSync, writeFileSync, existsSync, readdirSync, statSync,
} from 'fs';
import { join } from 'path';
import { destPath, SKIP_DIRS, report } from './context.mjs';
import { readJson, writeJson } from './utils.mjs';
import { getMajor, hasPackage } from './packages.mjs';
import { fixTsconfigLocations } from './preflight.mjs';

// @angular-devkit/architect e build-optimizer usam 0.NNxx.y (ex: v12 = 0.1200.7), não ^12.0.0.
export function getEffectiveMajor(versionStr) {
  const legacy = String(versionStr).match(/^[~^]?0\.(1[0-9]{3})\./);
  if (legacy) return Math.floor(parseInt(legacy[1]) / 100);
  return getMajor(versionStr);
}

export function syncVersions(targetVersion) {
  const pkgPath = join(destPath, 'package.json');
  const pkg = readJson(pkgPath);
  let changed = false;

  // Estes pacotes usam esquema 0.NNxx.y no npm, não ^N.0.0
  const DEVKIT_ZERO_VERSIONED = new Set([
    '@angular-devkit/architect', '@angular-devkit/build-optimizer',
  ]);

  const ANGULAR_PKGS = [
    '@angular/animations', '@angular/build', '@angular/cdk', '@angular/cli',
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
  const TS_FLOOR  = { 12:'4.2',13:'4.4',14:'4.6',15:'4.8',16:'4.9',17:'5.2',18:'5.3',19:'5.5',20:'5.5',21:'5.8' };
  const TS_TARGET = { 12:'~4.3.5',13:'~4.6.0',14:'~4.7.0',15:'~4.9.0',16:'~5.0.0',17:'~5.2.0',18:'~5.4.0',19:'~5.6.0',20:'~5.7.0',21:'~5.8.0' };
  // For Angular v22+, fall back to the v21 floor/target until the maps are updated
  const tsFloor  = TS_FLOOR[targetVersion]  ?? (targetVersion > 21 ? TS_FLOOR[21]  : null);
  const tsTgt    = TS_TARGET[targetVersion] ?? (targetVersion > 21 ? TS_TARGET[21] : null);
  if (tsFloor && pkg.devDependencies?.typescript) {
    const curTs = pkg.devDependencies.typescript.replace(/[^0-9.]/g, '');
    const [curMaj, curMin] = curTs.split('.').map(Number);
    const [floorMaj, floorMin] = tsFloor.split('.').map(Number);
    const tooOld = curMaj < floorMaj || (curMaj === floorMaj && curMin < floorMin);
    if (tooOld) {
      pkg.devDependencies.typescript = tsTgt;
      console.log(`  ↳ typescript: ${curTs} → ${tsTgt} (forçado)`);
      changed = true;
    }
  }

  // @types/node: versão compatível com o TypeScript de cada passo da migração.
  // @types/node@18.7+ usa `export type { type X }` (requer TS 4.5+).
  // @types/node@20.4+ usa Symbol.dispose/asyncDispose (requer TS 5.2+).
  // Upgrades progressivos via overrides conforme o TS evolui a cada ng update.
  const nodeTypesTarget =
    targetVersion <= 12 ? '^14.18.0'   // TS 4.1-4.3: pré-4.5 syntax
    : targetVersion <= 16 ? '^16.18.0' // TS 4.4-4.9: seguro, sem Disposable
    : null;                             // Angular 17+: remover override (TS 5.2+ suporta 20+)

  if (nodeTypesTarget !== null) {
    if (!pkg.overrides) pkg.overrides = {};
    if (pkg.overrides['@types/node'] !== nodeTypesTarget) {
      pkg.overrides['@types/node'] = nodeTypesTarget;
      console.log(`  ↳ overrides["@types/node"] = ${nodeTypesTarget} (TS-compat para Angular ${targetVersion})`);
      changed = true;
    }
    // Também fix direto em dependencies/devDependencies se presente em versão incompatível
    for (const section of ['dependencies', 'devDependencies']) {
      const cur = pkg[section]?.['@types/node'];
      if (cur && getMajor(cur) > getMajor(nodeTypesTarget)) {
        pkg[section]['@types/node'] = nodeTypesTarget;
        console.log(`  ↳ @types/node: ${cur} → ${nodeTypesTarget} (TS-compat)`);
        changed = true;
      }
    }
  } else {
    // Angular 17+: TS 5.2+ suporta @types/node@20+, remover qualquer override de @types/node
    if (pkg.overrides?.['@types/node']) {
      delete pkg.overrides['@types/node'];
      if (Object.keys(pkg.overrides).length === 0) delete pkg.overrides;
      console.log('  ↳ overrides["@types/node"] removido (TS 5.2+ disponível)');
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

  // rxjs: garante ~7.8.0 a partir do Angular 14+
  // rxjs@7.4 não tem exports.types correto — moduleResolution:bundler requer 7.5+
  if (targetVersion >= 14 && pkg.dependencies?.rxjs) {
    const currentRxjs = pkg.dependencies.rxjs;
    const major = getMajor(currentRxjs);
    const minorMatch = currentRxjs.match(/\b7\.(\d+)/);
    const minor = minorMatch ? parseInt(minorMatch[1]) : 0;
    if (major < 7 || (major === 7 && minor < 5)) {
      pkg.dependencies.rxjs = '~7.8.0';
      console.log(`  ↳ rxjs: ${currentRxjs} → ~7.8.0 (forçado)`);
      changed = true;
    }
  }

  // zone.js: v0.14+ para Angular 17+, v0.16+ para Angular 21+
  if (pkg.dependencies?.['zone.js']) {
    const target = targetVersion >= 21 ? '~0.16.0' : targetVersion >= 17 ? '~0.14.0' : null;
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
export function verifyTsconfigPaths() {
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

export function fixLegacyMaterial() {
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
  return count;
}

// Resolve o conflito EOVERRIDE de @types/node antes de rodar ng update.
// npm 9+ (Node 18+) rejeita overrides cujo range é incompatível com o dep direto.
// Deve ser chamado imediatamente antes de cada `ng update`, sem alterar pacotes Angular.
export function resolveNodeTypesOverride(targetVersion) {
  const pkgPath = join(destPath, 'package.json');
  const pkg = readJson(pkgPath);
  let changed = false;

  const nodeTypesTarget =
    targetVersion <= 12 ? '^14.18.0'
    : targetVersion <= 16 ? '^16.18.0'
    : null;

  if (nodeTypesTarget !== null) {
    // Alinha override com dep direto para evitar EOVERRIDE
    if (!pkg.overrides) pkg.overrides = {};
    if (pkg.overrides['@types/node'] !== nodeTypesTarget) {
      pkg.overrides['@types/node'] = nodeTypesTarget;
      changed = true;
    }
    for (const section of ['dependencies', 'devDependencies']) {
      const cur = pkg[section]?.['@types/node'];
      if (cur && getMajor(cur) !== getMajor(nodeTypesTarget)) {
        pkg[section]['@types/node'] = nodeTypesTarget;
        changed = true;
      }
    }
  } else {
    // v17+: remove qualquer override de @types/node para prevenir EOVERRIDE
    if (pkg.overrides?.['@types/node']) {
      delete pkg.overrides['@types/node'];
      if (Object.keys(pkg.overrides).length === 0) delete pkg.overrides;
      changed = true;
    }
  }

  if (changed) writeJson(pkgPath, pkg);
}

// Pacotes do ecossistema Angular que seguem o mesmo versionamento major.
const ANGULAR_ECOSYSTEM = [
  '@angular/material',
  '@angular/cdk',
  '@angular/pwa',
  '@angular/service-worker',
];

export function extraPackages(v) {
  const extra = [];
  for (const pkg of ANGULAR_ECOSYSTEM) {
    if (hasPackage(pkg)) extra.push(`${pkg}@${v}`);
  }
  if (v < 17 && hasPackage('@nguniversal/express-engine'))
    extra.push(`@nguniversal/express-engine@${v}`);
  return extra;
}

// ─── Detecção genérica de incompatibilidades de peer dependency ───────────────
// Varre os pacotes instalados em node_modules e verifica se seus peerDependencies
// de @angular/core são satisfeitos pela versão Angular alvo.
// Sem listas hardcoded: funciona para qualquer projeto.

function angularVersionInRange(angularMajor, peerRange) {
  // Divide por || para ranges union: "^13.0.0 || ^14.0.0"
  for (const segment of peerRange.split('||').map(s => s.trim())) {
    const tokens = [...segment.matchAll(/([><=^~]*)(\d+)\.\d+/g)];
    for (const t of tokens) {
      const op = t[1].trim();
      const major = parseInt(t[2]);
      if (op === '^' || op === '~' || op === '' || op === '=') {
        if (major === angularMajor) return true;
      } else if (op === '>=' || op === '>') {
        const threshold = op === '>' ? major + 1 : major;
        if (angularMajor >= threshold) {
          // Verifica se existe upper bound explícito menor que a versão alvo
          const upper = segment.match(/<\s*(\d+)\.\d+/);
          if (!upper || angularMajor < parseInt(upper[1])) return true;
        }
      }
    }
  }
  return false;
}

export function patchThirdPartyVersions(angularMajor) {
  const nmDir = join(destPath, 'node_modules');
  const pkgJsonPath = join(destPath, 'package.json');
  if (!existsSync(pkgJsonPath) || !existsSync(nmDir)) return;

  const pkg = readJson(pkgJsonPath);
  const allDeps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };

  const incompatible = [];

  for (const pkgName of Object.keys(allDeps)) {
    // Pula pacotes gerenciados pelo pipeline (Angular, devkit, eslint)
    if (pkgName.startsWith('@angular/') ||
        pkgName.startsWith('@angular-devkit/') ||
        pkgName.startsWith('@angular-eslint/') ||
        pkgName.startsWith('@typescript-eslint/') ||
        pkgName.startsWith('@types/')) continue;

    const pkgParts = pkgName.startsWith('@') ? pkgName.split('/').slice(0, 2) : [pkgName];
    const pkgDir = join(nmDir, ...pkgParts);
    const metaPath = join(pkgDir, 'package.json');
    if (!existsSync(metaPath)) continue;

    try {
      const meta = readJson(metaPath);
      const angularPeer = meta.peerDependencies?.['@angular/core'];
      if (!angularPeer) continue;
      if (!angularVersionInRange(angularMajor, angularPeer)) {
        incompatible.push({
          name: pkgName,
          installedVersion: meta.version,
          peerRequires: angularPeer,
        });
      }
    } catch { /* ignore */ }
  }

  if (!incompatible.length) return;

  console.log(`\n  ⚠️  Pacotes incompatíveis com Angular ${angularMajor} (peer dependency):`);
  for (const { name, installedVersion, peerRequires } of incompatible) {
    console.log(`  ↳ ${name}@${installedVersion}: requer @angular/core "${peerRequires}"`);
    report.notes.push(
      `[ATENÇÃO] ${name}@${installedVersion} requer @angular/core "${peerRequires}" — incompatível com Angular ${angularMajor}. Atualize este pacote manualmente.`,
    );
  }
}

// Extrai todos os pacotes que causaram peer dependency conflict no output do ng update
// e tenta incluí-los no próximo run com a versão alvo.
// Packages whose versions are managed by syncVersions or by dedicated modernization steps.
const SYNC_MANAGED_PREFIXES = ['@angular-eslint/', '@typescript-eslint/'];

export function extractConflictPackages(output, v, alreadyIncluded) {
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
