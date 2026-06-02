import {
  readFileSync, writeFileSync, existsSync, readdirSync, statSync,
} from 'fs';
import { join } from 'path';
import semver from 'semver';
import { destPath, SKIP_DIRS, report } from './context.mjs';
import { readJson, writeJson, capture } from './utils.mjs';
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

  // Pacotes framework/devkit fixos + ecossistema detectado em runtime (material, cdk,
  // google-maps…) — para que nenhum @angular/* oficial fique pra trás no package.json.
  const frameworkSet = new Set(ANGULAR_PKGS);
  const syncTargets = [...new Set([...ANGULAR_PKGS, ...getAngularEcosystem()])];
  for (const section of ['dependencies', 'devDependencies']) {
    if (!pkg[section]) continue;
    for (const name of syncTargets) {
      if (!pkg[section][name]) continue;
      const current = getEffectiveMajor(pkg[section][name]);
      if (current > 0 && current < targetVersion) {
        let targetStr;
        if (frameworkSet.has(name)) {
          // Framework/devkit: sempre estável. Devkit usa esquema 0.NNxx.y.
          targetStr = DEVKIT_ZERO_VERSIONED.has(name) ? `~0.${targetVersion}00.0` : `^${targetVersion}.0.0`;
        } else {
          // Ecossistema runtime: pode ser beta-only (flex-layout) → resolve o spec real no registry.
          targetStr = resolveEcosystemSpec(name, targetVersion);
          if (!targetStr) {
            console.log(`  ↳ ${name}: sem versão publicada para o major ${targetVersion} — mantido (tratado à parte)`);
            continue;
          }
        }
        pkg[section][name] = targetStr;
        console.log(`  ↳ ${name}: ${current} → ${targetStr} (forçado)`);
        changed = true;
      }
    }
  }

  // TypeScript: ng update às vezes falha antes de atualizar o TS (ex: v12 com npm >6).
  // Garante versão mínima compatível para evitar conflito de peer deps no npm install.
  // Angular N exige uma faixa específica de TS; o compiler aborta se estiver abaixo.
  // ng20 → TS >=5.8; ng21 → TS >=5.9 (e <6.1). Manter alinhado a cada release.
  const TS_FLOOR  = { 12:'4.2',13:'4.4',14:'4.6',15:'4.8',16:'4.9',17:'5.2',18:'5.3',19:'5.5',20:'5.8',21:'5.9' };
  const TS_TARGET = { 12:'~4.3.5',13:'~4.6.0',14:'~4.7.0',15:'~4.9.0',16:'~5.0.0',17:'~5.2.0',18:'~5.4.0',19:'~5.6.0',20:'~5.8.0',21:'~5.9.0' };
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
    // Dep direto DEVE bater EXATAMENTE com o override (mesma string), senão npm 9+ dá EOVERRIDE
    // ("Override for @types/node@X conflicts with direct dependency"). Alinha sempre que diferir —
    // não só quando o major difere (cobre dep `16.18.0` exato vs override `^16.18.0`).
    for (const section of ['dependencies', 'devDependencies']) {
      const cur = pkg[section]?.['@types/node'];
      if (cur && cur !== nodeTypesTarget) {
        pkg[section]['@types/node'] = nodeTypesTarget;
        console.log(`  ↳ @types/node: ${cur} → ${nodeTypesTarget} (TS-compat, alinhado ao override)`);
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

  // Mantém `^` (caret): o npm 9+ exige que o valor do override BATA com o spec do dep direto, senão
  // EOVERRIDE. O `^16.18.0` casa com o dep direto (alinhado abaixo); o problema de `.d.ts` do último
  // patch (16.18.x novo demais p/ o TS do step) é coberto pelo skipLibCheck (ligado cedo), não por
  // pinar exato aqui (que quebraria o match override↔dep). Pin exato só p/ libs normais (applyPin).
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
      if (cur && cur !== nodeTypesTarget) {  // string idêntica ao override → evita EOVERRIDE
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

// ─── Ecossistema Angular detectado em runtime (sem lista hardcoded) ───────────
// Pacotes do escopo @angular/* que versionam em lockstep com o @angular/core (mesmo
// time: material, cdk, google-maps, youtube-player, localize, elements, service-worker…).
// Sinal genérico: estão instalados no MESMO major que o core. Pacotes de terceiros que
// apenas usam o escopo @angular/ (ex: @angular/fire) ficam num major diferente → fora.
//
// O conjunto é CONGELADO no início (captureAngularEcosystem), quando tudo está em
// lockstep. Detectar a cada step seria errado: um pacote que ficasse pra trás deixaria
// de casar o major e seria excluído — exatamente o bug "Updating multiple major versions
// at once is not supported" que isto previne (foi o que segurou @angular/google-maps em v11).
let _frozenEcosystem = null;

export function captureAngularEcosystem() {
  const scopeDir = join(destPath, 'node_modules', '@angular');
  const corePath = join(scopeDir, 'core', 'package.json');
  const found = [];
  if (existsSync(corePath) && existsSync(scopeDir)) {
    const coreMajor = getMajor(readJson(corePath).version);
    for (const name of readdirSync(scopeDir)) {
      if (name === 'core' || name === 'cli') continue; // já no comando base (core@v cli@v)
      const metaPath = join(scopeDir, name, 'package.json');
      if (!existsSync(metaPath)) continue;
      try {
        if (getMajor(readJson(metaPath).version) === coreMajor) found.push(`@angular/${name}`);
      } catch { /* package.json ilegível — ignora */ }
    }
  }
  _frozenEcosystem = found.sort();
  console.log(`  ↳ ecossistema Angular (lockstep) detectado: ${found.join(', ') || '(nenhum)'}`);
  return _frozenEcosystem;
}

export function getAngularEcosystem() {
  return _frozenEcosystem ?? [];
}

// Há alguma versão publicada de `pkgName` no major alvo? Evita incluir `@pkg@v`
// inexistente (ex: pacote deprecado que parou de publicar) — ele sai do conjunto sozinho.
function publishesMajor(pkgName, major) {
  const p = fetchPackument(pkgName);
  if (!p?.versions) return true; // registry indisponível → não bloqueia (ng update tenta)
  return Object.keys(p.versions).some(ver => getMajor(ver) === major);
}

// Resolve o spec de versão correto para um pacote do ecossistema no major alvo. A maioria publica
// estável → `^v.0.0`. Mas alguns só publicam PRÉ-RELEASES (ex: @angular/flex-layout, que nunca teve
// um `12.0.0` estável, só `12.0.0-beta.35`) — aí `^12.0.0` dá ETARGET no npm install. Nesses casos
// fixa a MAIOR versão exata daquele major. Retorna null se não há versão para o major (ex: flex-
// layout no v16 — tratado à parte pela conversão para Tailwind no gate v16).
function resolveEcosystemSpec(name, major) {
  const p = fetchPackument(name);
  if (!p?.versions) return `^${major}.0.0`;                 // registry indisponível → tenta o padrão
  const matching = Object.keys(p.versions).filter(v => getMajor(v) === major);
  if (!matching.length) return null;
  if (matching.some(v => !semver.prerelease(v))) return `^${major}.0.0`; // existe estável
  return matching.sort(semver.compare).pop();               // só pré-releases → fixa a maior exata
}

export function extraPackages(v) {
  const extra = [];
  for (const pkg of getAngularEcosystem()) {
    if (!hasPackage(pkg) || !publishesMajor(pkg, v)) continue;
    // Beta-only (flex-layout) precisa da versão EXATA no `ng update pkg@<ver>` — `@v` não resolve.
    const spec = resolveEcosystemSpec(pkg, v);
    extra.push(!spec || spec.startsWith('^') ? `${pkg}@${v}` : `${pkg}@${spec}`);
  }
  if (v < 17 && hasPackage('@nguniversal/express-engine'))
    extra.push(`@nguniversal/express-engine@${v}`);
  return extra;
}

// ─── Detecção genérica de incompatibilidades de peer dependency ───────────────
// Varre os pacotes instalados em node_modules e verifica se seus peerDependencies
// de @angular/core são satisfeitos pela versão Angular alvo.
// Sem listas hardcoded: funciona para qualquer projeto.

// O peer range é compatível com o major Angular alvo se o range INTERSECTA a faixa
// inteira daquele major (>=M.0.0 <M+1.0.0). Usar semver evita os bugs do parsing por
// regex: espaço após operador ("&gt;= 6.0.0"), versão sem minor ("&gt;=5"), ranges
// compostos ("&gt;=14 &lt;16") e unions ("^13 || ^14").
function angularVersionInRange(angularMajor, peerRange) {
  if (!peerRange) return false;
  const band = `>=${angularMajor}.0.0 <${angularMajor + 1}.0.0`;
  try {
    // includePrerelease SÓ quando o peer tem um tag de pré-release REAL. Com versões PARCIAIS
    // (`>=14`, `14 - 15`), `includePrerelease: true` faz o semver casar a band adjacente por engano
    // (`intersects(">=14", ">=13.0.0 <14.0.0", {includePrerelease:true})` → `true`, BUG). A detecção
    // tem que ser `/\d-[0-9A-Za-z]/` (dígito-hífen-alfanum, ex: `1.0.0-rc`/`12.0.0-beta`) — NÃO
    // `.includes('-')`, que casa também o RANGE com hífen `14 - 15` (peer real do ngx-pipes@3.2.0,
    // que NÃO inclui o 13) e reintroduzia o bug.
    const hasPrerelease = /\d-[0-9A-Za-z]/.test(peerRange);
    return semver.intersects(peerRange, band, hasPrerelease ? { includePrerelease: true } : undefined);
  } catch {
    return false; // range não-semver (ex: tag git, "*" tratado abaixo)
  }
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

// ─── Resolução de versão compatível via npm registry ─────────────────────────
// Em vez de chutar `pkg@<angularMajor>` (o major do Angular raramente coincide com
// o major da lib de terceiros) e cair em --force, consulta o packument no registry
// e escolhe a MAIOR versão publicada cujo peerDependencies['@angular/core'] inclui
// o major Angular alvo. Genérico, sem listas hardcoded.

const NPM_REGISTRY = (process.env.NPM_CONFIG_REGISTRY || 'https://registry.npmjs.org/')
  .replace(/\/?$/, '/');

// Pacotes do ecossistema cujas versões já são geridas por syncVersions/extraPackages.
const THIRD_PARTY_SKIP_PREFIXES = [
  '@angular/', '@angular-devkit/', '@angular-eslint/',
  '@typescript-eslint/', '@types/',
];

const _packumentCache = new Map();

function fetchPackument(pkgName) {
  if (_packumentCache.has(pkgName)) return _packumentCache.get(pkgName);
  let packument = null;
  try {
    // Scoped packages: a barra precisa ser encodada (@nebular%2Ftheme).
    const url = NPM_REGISTRY + pkgName.replace('/', '%2F');
    const raw = capture(`curl -sfL "${url}"`);
    if (raw) packument = JSON.parse(raw);
  } catch { /* registry indisponível / pacote privado — degrada para null */ }
  _packumentCache.set(pkgName, packument);
  return packument;
}

// Maior versão de `pkgName` cujo peer @angular/core inclui `angularMajor`. Retorna a string de
// versão (ex: "20.1.0") ou null se nenhuma servir / sem rede. Preferimos ESTÁVEL (não pegar um
// beta aleatório de terceiros); só caímos para PRÉ-RELEASE se nenhuma estável casar — cobre libs
// beta/rc-only (mesmo problema do @angular/flex-layout, mas no caminho de terceiros). Usa
// semver.rcompare (ordena pré-releases corretamente; o compare manual quebrava em `-beta`).
const _resolveCache = new Map();
export function resolveCompatibleVersion(pkgName, angularMajor) {
  const key = `${pkgName}@ng${angularMajor}`;
  if (_resolveCache.has(key)) return _resolveCache.get(key);

  const packument = fetchPackument(pkgName);
  let best = null;
  if (packument?.versions) {
    const matches = (v) => {
      const peer = packument.versions[v].peerDependencies?.['@angular/core'];
      return peer && angularVersionInRange(angularMajor, peer);
    };
    const valid = Object.keys(packument.versions).filter(v => semver.valid(v));
    const stable = valid.filter(v => !semver.prerelease(v)).sort(semver.rcompare);
    for (const v of stable) { if (matches(v)) { best = v; break; } }
    if (!best) {
      const pre = valid.filter(v => semver.prerelease(v)).sort(semver.rcompare);
      for (const v of pre) { if (matches(v)) { best = v; break; } }
    }
  }
  _resolveCache.set(key, best);
  return best;
}

// Antes de cada ng update: para cada lib de terceiros cujo peer @angular/core NÃO
// cobre o major alvo, fixa no package.json a maior versão compatível encontrada no
// registry. Elimina o conflito de peer dependency na origem — sem --force.
// Retorna `[{ name, from, to }]` com as libs que foram fixadas (para rastreio na UI).
// Resolução transitiva: pacotes companheiros (ex: @nebular/eva-icons) NÃO têm peer
// @angular/core — eles peer-dependem de OUTRO pacote que estamos fixando (ex: @nebular/theme).
// Retorna a maior versão de `pkgName` cujos peers para os pacotes-âncora casam o major fixado.
// `anchorMajors`: { '@nebular/theme': 17, ... }.
function resolveCompanionVersion(pkgName, anchorMajors) {
  const packument = fetchPackument(pkgName);
  if (!packument?.versions) return null;
  // Estável primeiro (desc), depois pré-releases (desc) — cobre companheiros beta-only.
  const valid = Object.keys(packument.versions).filter(v => semver.valid(v));
  const order = [
    ...valid.filter(v => !semver.prerelease(v)).sort(semver.rcompare),
    ...valid.filter(v => semver.prerelease(v)).sort(semver.rcompare),
  ];
  for (const v of order) {
    const peers = packument.versions[v].peerDependencies || {};
    let matched = false, conflict = false;
    for (const [peerName, peerRange] of Object.entries(peers)) {
      if (anchorMajors[peerName] == null) continue;
      if (angularVersionInRange(anchorMajors[peerName], peerRange)) matched = true;
      else conflict = true;
    }
    if (matched && !conflict) return v;
  }
  return null;
}

export function pinCompatibleThirdParty(angularMajor) {
  const nmDir = join(destPath, 'node_modules');
  const pkgJsonPath = join(destPath, 'package.json');
  if (!existsSync(pkgJsonPath)) return [];

  const pkg = readJson(pkgJsonPath);
  const pinned = [];
  const anchorMajors = {}; // pacote-âncora → major que terá após este step (p/ companheiros)

  // Lista de [section, name] de todas as libs de terceiros do package.json.
  const thirdParty = [];
  for (const section of ['dependencies', 'devDependencies']) {
    if (!pkg[section]) continue;
    for (const name of Object.keys(pkg[section])) {
      if (!THIRD_PARTY_SKIP_PREFIXES.some(p => name.startsWith(p))) thirdParty.push([section, name]);
    }
  }

  const installedMeta = (name) => {
    const parts = name.startsWith('@') ? name.split('/').slice(0, 2) : [name];
    const metaPath = join(nmDir, ...parts, 'package.json');
    if (!existsSync(metaPath)) return null;
    try { const m = readJson(metaPath); return { version: m.version, peers: m.peerDependencies || {} }; }
    catch { return null; }
  };

  const applyPin = (section, name, target, reason) => {
    // EXATO, sem `^`: a versão resolvida é a MAIOR compatível com ESTE major. Com `^${target}` o
    // npm pode subir para um minor mais novo INCOMPATÍVEL — ex: `^3.0.0` deixa instalar ngx-pipes
    // 3.2.0 (peer `14 - 15`), reintroduzindo o erro. Pinar exato trava na versão compatível.
    const newRange = target;
    if (pkg[section][name] === newRange) return;
    console.log(`  ↳ ${name}: ${pkg[section][name]} → ${newRange} (${reason})`);
    pinned.push({ name, from: pkg[section][name], to: newRange });
    pkg[section][name] = newRange;
  };

  // PASSO 1 — âncoras: libs que peer-dependem de @angular/core.
  for (const [section, name] of thirdParty) {
    const meta = installedMeta(name);
    if (!meta) continue;
    const corePeer = meta.peers['@angular/core'];
    if (!corePeer) continue; // sem peer angular → é tratado no passo 2 (companheiro)
    if (angularVersionInRange(angularMajor, corePeer)) {
      anchorMajors[name] = getMajor(meta.version); // já compatível; registra major p/ companheiros
      continue;
    }
    const target = resolveCompatibleVersion(name, angularMajor);
    if (!target) {
      report.notes.push(
        `[ATENÇÃO] ${name} requer @angular/core "${corePeer}" — incompatível com Angular ${angularMajor} e nenhuma versão compatível foi encontrada no registry. Atualize manualmente.`,
      );
      continue;
    }
    applyPin(section, name, target, `compatível com Angular ${angularMajor}, via registry`);
    anchorMajors[name] = getMajor(target);
  }

  // PASSO 2 — companheiros: libs sem peer @angular/core, mas que peer-dependem de uma âncora.
  for (const [section, name] of thirdParty) {
    const meta = installedMeta(name);
    if (!meta || meta.peers['@angular/core']) continue; // já tratado no passo 1

    // Quais peers apontam para âncoras que fixamos? Já está compatível?
    const relevant = {};
    let needsBump = false;
    for (const [peerName, peerRange] of Object.entries(meta.peers)) {
      if (anchorMajors[peerName] == null) continue;
      relevant[peerName] = anchorMajors[peerName];
      if (!angularVersionInRange(anchorMajors[peerName], peerRange)) needsBump = true;
    }
    if (Object.keys(relevant).length === 0 || !needsBump) continue;

    const target = resolveCompanionVersion(name, relevant);
    if (!target) {
      const anchors = Object.keys(relevant).join(', ');
      report.notes.push(
        `[ATENÇÃO] ${name} acompanha ${anchors} mas nenhuma versão compatível foi encontrada no registry. Atualize manualmente.`,
      );
      continue;
    }
    applyPin(section, name, target, `acompanha ${Object.keys(relevant).join(', ')}, via registry`);
  }

  if (pinned.length) writeJson(pkgJsonPath, pkg);
  return pinned;
}

// Nomes (sem versão) dos pacotes que ainda têm conflito de peer dependency no output —
// usado para mostrar na UI o que sobrou irresolvível antes de um --force.
export function listConflictPackageNames(output) {
  const re = /Package "(@?[\w/-]+)" has an incompatible peer dependency/g;
  const names = new Set();
  let m;
  while ((m = re.exec(output)) !== null) names.add(m[1]);
  return [...names];
}

// Extrai todos os pacotes que causaram peer dependency conflict no output do ng update
// e tenta incluí-los no próximo run com a versão compatível resolvida via registry.
// Packages whose versions are managed by syncVersions or by dedicated modernization steps.
const SYNC_MANAGED_PREFIXES = ['@angular-eslint/', '@typescript-eslint/'];

export function extractConflictPackages(output, v, alreadyIncluded) {
  const re = /Package "(@[\w/-]+)" has an incompatible peer dependency/g;
  const extra = [];
  let m;
  while ((m = re.exec(output)) !== null) {
    const pkg = m[1];
    if (SYNC_MANAGED_PREFIXES.some(p => pkg.startsWith(p))) continue;
    // Pacotes @angular/* oficiais existem em @v. Para libs de terceiros, o major raramente
    // bate com o do Angular — resolve a versão compatível no registry.
    let targetVer;
    if (pkg.startsWith('@angular/') || pkg.startsWith('@angular-devkit/')) {
      targetVer = String(v);
    } else {
      targetVer = resolveCompatibleVersion(pkg, v);
      // Sem versão compatível (ex: @nebular/eva-icons, que peer-depende de @nebular/theme e
      // não de @angular/core): NÃO injeta um @<major> inventado — isso faz o ng update abortar
      // com "Package does not exist". Deixa o conflito genuíno cair no --force.
      if (!targetVer) continue;
    }
    const versioned = `${pkg}@${targetVer}`;
    if (!alreadyIncluded.includes(versioned)) extra.push(versioned);
  }
  return [...new Set(extra)];
}
