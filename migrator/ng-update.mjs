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
