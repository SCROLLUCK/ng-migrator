import {
  readFileSync, writeFileSync, existsSync,
  readdirSync, mkdirSync, unlinkSync,
} from 'fs';
import { join, relative } from 'path';
import { destPath, SKIP_DIRS } from './context.mjs';
import { readJson, writeJson, scanForContent } from './utils.mjs';
import { getMajor } from './packages.mjs';

export function preflight() {
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
    'codelyzer', 'protractor',
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

  // Ecossistema TSLint inteiro está morto desde 2019 e exige TypeScript < 3 (peer dep),
  // conflitando em TODO step da migração. Remove qualquer pacote tslint* (tslint,
  // tslint-language-service, tslint-eslint-rules, tslint-config-prettier…). O ESLint
  // entra depois via addEslint(). Genérico: não depende de nomes específicos.
  for (const section of ['dependencies', 'devDependencies']) {
    for (const name of Object.keys(pkg[section] ?? {})) {
      if (name === 'tslint' || name.startsWith('tslint-')) {
        delete pkg[section][name];
        console.log(`  ↳ ${name} removido (TSLint obsoleto)`);
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

  // node-sass é módulo NATIVO (compila via node-gyp, exige Python + toolchain). As imagens
  // Docker node:NN não têm Python → o `npm install` quebra inteiro ("Can't find Python")
  // ao recompilar no boundary de troca de Node, deixando node_modules incompleto. node-sass
  // está deprecado há anos; o substituto é dart-sass (`sass`) — JS puro, sem build nativo,
  // já usado pelo Angular CLI. Troca genérica e recomendada pelo próprio time do Sass.
  for (const section of ['dependencies', 'devDependencies']) {
    if (pkg[section]?.['node-sass']) {
      delete pkg[section]['node-sass'];
      if (!pkg.dependencies?.sass && !pkg.devDependencies?.sass) {
        (pkg.devDependencies ??= {}).sass = '^1.77.0';
      }
      console.log('  ↳ node-sass → sass (dart-sass; remove build nativo node-gyp/Python)');
      changed = true;
    }
  }

  // Script e2e usa Protractor, removido do Angular no v15
  if (pkg.scripts?.e2e) {
    delete pkg.scripts.e2e;
    console.log('  ↳ scripts.e2e removido (Protractor obsoleto)');
    changed = true;
  }

  // @types/node@18.7+ usa sintaxe `export type { type X }` (requer TS 4.5+).
  // Para projetos com TS < 4.5 (Angular 11-12), usar @types/node@^14.18.0.
  // Para TS 4.5-5.1 (Angular 13-16), ^16.18.0 é compatível e não usa Disposable.
  // Angular 17+ (TS 5.2+) pode usar ^20.0.0, mas o override é removido em syncVersions().
  const tsRaw = pkg.devDependencies?.typescript ?? pkg.dependencies?.typescript ?? '';
  const [tsMaj, tsMin] = tsRaw.replace(/[^0-9.]/g, '').split('.').map(Number);
  const safeNodeTypes =
    (tsMaj < 4 || (tsMaj === 4 && (tsMin ?? 0) < 5))  ? '^14.18.0'  // TS < 4.5
    : (tsMaj === 4)                                     ? '^16.18.0'  // TS 4.5-4.9
    :                                                     '^18.19.0'; // TS 5.x+

  // Atualiza devDependencies com versões muito defasadas
  const DEV_BUMPS = {
    '@types/node':    safeNodeTypes, // versão-aware: evita sintaxe TS 4.5+ em projetos antigos
    'ts-node':        '~10.0.0',     // ~7 é de 2018
    '@types/jasmine': '~5.1.0',      // ~3.8 é de 2021; 5.0.0 não existe, atual é 5.1.x
    'jasmine-core':   '~5.1.0',      // ~3.8 é de 2021; atual é 5.x
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

  // @types/node pode vir como dep transitiva em versão muito nova (ex: @types/node@25.x via @angular/cli).
  // Forçar via npm overrides garante a versão correta mesmo quando não está no package.json direto.
  if (!pkg.overrides) pkg.overrides = {};
  if (!pkg.overrides['@types/node']) {
    pkg.overrides['@types/node'] = safeNodeTypes;
    console.log(`  ↳ overrides["@types/node"] = ${safeNodeTypes} (TS-aware: evita breaking types)`);
    changed = true;
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

// Garante que os tsConfig referenciados no angular.json realmente existem no disco.
// Estratégia: não move nem renomeia — cria uma cópia onde o angular.json espera,
// procurando o arquivo na raiz ou em src/ como fallback.
export function fixTsconfigLocations(ngJson) {
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
    const baseName = ref.split('/').pop();
    const candidates = [
      join(destPath, baseName),
      join(destPath, 'src', baseName),
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

export function fixKarmaConf() {
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

export function cleanupLegacyFiles() {
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
