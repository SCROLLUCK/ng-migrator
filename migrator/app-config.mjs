import {
  readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync, statSync,
} from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import { destPath, report } from './context.mjs';
import { extractBracketBlock, scanForContent } from './utils.mjs';
import { hasPackage } from './packages.mjs';

// Recupera o conteúdo do app.module.ts original (mesmo que o schematic standalone
// já o tenha deletado — via git, já que cada step é commitado).
function readOriginalAppModule(appDir) {
  const p = join(appDir, 'app.module.ts');
  if (existsSync(p)) {
    const c = readFileSync(p, 'utf8');
    if (/providers\s*:/.test(c)) return c;
  }
  try {
    const rel = 'src/app/app.module.ts';
    const delCommit = execSync(`git -C "${destPath}" log --diff-filter=D --format=%H -- ${rel}`, { encoding: 'utf8' })
      .split('\n').filter(Boolean)[0];
    if (delCommit) return execSync(`git -C "${destPath}" show ${delCommit}~1:${rel}`, { encoding: 'utf8' });
  } catch { /* sem git / sem histórico */ }
  return null;
}

// Slice de um bloco balanceado a partir do índice do colchete de abertura.
function sliceBalanced(content, openIdx, open = '[', close = ']') {
  let depth = 0;
  for (let i = openIdx; i < content.length; i++) {
    if (content[i] === open) depth++;
    else if (content[i] === close) { depth--; if (depth === 0) return content.slice(openIdx, i + 1); }
  }
  return null;
}

// Nome do pacote npm de uma linha de import (null se for import relativo/interno).
function packageOfImport(importLine) {
  const m = importLine.match(/from\s*['"]([^'"]+)['"]/);
  if (!m || m[1].startsWith('.')) return null;
  const parts = m[1].split('/');
  return m[1].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

// §5.1 — A migração standalone carrega o `imports` do AppModule (via importProvidersFrom)
// mas DESCARTA o array `providers: []`. Aqui recuperamos esses providers (serviços sem
// providedIn:'root', interceptors HTTP_INTERCEPTORS, value-tokens MAT_*_DEFAULT_OPTIONS,
// adapters, LOCALE_ID, provideHttpClient…) e os transcrevemos para o app.config.ts.
// Pula entradas já presentes e as que referenciam um pacote REMOVIDO (ex: SWIPER_CONFIG
// do ngx-swiper-wrapper, já migrado p/ swiper-element) — regra genérica via hasPackage.
function transcribeAppModuleProviders(cfg, appDir) {
  const mod = readOriginalAppModule(appDir);
  if (!mod) return { cfg, changed: false };

  const provMatch = mod.match(/providers\s*:\s*\[/);
  if (!provMatch) return { cfg, changed: false };
  const provArr = sliceBalanced(mod, mod.indexOf('[', provMatch.index));
  if (!provArr) return { cfg, changed: false };

  const entries = splitTopLevel(provArr.slice(1, -1)).map(s => s.trim()).filter(Boolean);
  const modImports = mod.match(/^import\s+[\s\S]+?;$/gm) || [];

  // Array de providers atual do app.config.ts
  const cfgProvMatch = cfg.match(/providers\s*:\s*\[/);
  if (!cfgProvMatch) return { cfg, changed: false };
  const cfgArr = sliceBalanced(cfg, cfg.indexOf('[', cfgProvMatch.index));
  if (!cfgArr) return { cfg, changed: false };

  const toAdd = [];
  const importsToAdd = [];
  const skipped = [];
  const alreadyImported = (sym) => new RegExp(`\\bimport\\s*(?:type\\s*)?\\{[^}]*\\b${sym}\\b[^}]*\\}`).test(cfg)
    || importsToAdd.some(l => new RegExp(`\\{[^}]*\\b${sym}\\b[^}]*\\}`).test(l));

  for (const entry of entries) {
    // token/identificador da entrada: { provide: X }, provideX(...), ou classe solta
    const token = entry.match(/provide\s*:\s*([A-Za-z_][\w]*)/)?.[1]
      || entry.match(/^([A-Za-z_][\w.]*)\s*\(/)?.[1]
      || entry.match(/^([A-Za-z_][\w]*)$/)?.[1];
    if (token && new RegExp(`\\b${token.replace(/\./g, '\\.')}\\b`).test(cfgArr)) continue; // já presente

    // símbolos PascalCase/UPPER usados na entrada que precisam de import
    const syms = [...new Set([...entry.matchAll(/\b([A-Z][A-Za-z0-9_]*)\b/g)].map(m => m[1]))];
    const needImports = [];
    let obsolete = false;
    for (const s of syms) {
      if (alreadyImported(s)) continue;
      const imp = modImports.find(l => new RegExp(`\\{[^}]*\\b${s}\\b[^}]*\\}`).test(l) || new RegExp(`\\b${s}\\b\\s+from`).test(l));
      if (!imp) continue; // símbolo global/sem import explícito — ignora
      const pkg = packageOfImport(imp);
      if (pkg && !hasPackage(pkg)) { obsolete = true; break; } // pacote removido → entrada obsoleta
      // import só do símbolo s (evita arrastar outros símbolos da mesma linha)
      const from = imp.match(/from\s*(['"][^'"]+['"])/)?.[1];
      if (from) needImports.push(`import { ${s} } from ${from};`);
    }
    if (obsolete) { skipped.push(token || entry.slice(0, 30)); continue; }
    toAdd.push(entry);
    importsToAdd.push(...needImports);
  }

  if (!toAdd.length) return { cfg, changed: false };

  // injeta entradas antes do ] do array de providers
  const newArr = cfgArr.replace(/\]\s*$/, `,\n    ${toAdd.join(',\n    ')},\n  ]`);
  let out = cfg.replace(cfgArr, newArr);
  // injeta imports após o último import
  const block = [...new Set(importsToAdd)].join('\n');
  if (block) {
    const lastImp = out.lastIndexOf('\nimport ');
    const nlAfter = out.indexOf('\n', lastImp + 1);
    out = out.slice(0, nlAfter + 1) + block + '\n' + out.slice(nlAfter + 1);
  }
  console.log(`  ↳ providers do AppModule restaurados: ${toAdd.length}${skipped.length ? ` (pulados obsoletos: ${skipped.join(', ')})` : ''}`);
  report.modernize.appModuleProvidersRestored = toAdd.length;
  return { cfg: out, changed: true };
}

// Garante que os símbolos estejam no import de '@angular/core' (mescla no existente ou cria).
function ensureCoreImports(cfg, syms) {
  const coreImp = cfg.match(/import\s*\{([^}]*)\}\s*from\s*['"]@angular\/core['"]\s*;?/);
  if (coreImp) {
    const have = new Set(coreImp[1].split(',').map(s => s.trim()).filter(Boolean));
    let changed = false;
    for (const s of syms) if (![...have].some(h => h === s || h.endsWith(` ${s}`))) { have.add(s); changed = true; }
    if (!changed) return cfg;
    return cfg.replace(coreImp[0], `import { ${[...have].join(', ')} } from '@angular/core';`);
  }
  return `import { ${syms.join(', ')} } from '@angular/core';\n` + cfg;
}

// §6.4 — A migração standalone DELETA o AppModule, perdendo a lógica do `constructor()`
// (init de bootstrap: idioma default `translate.use()`, registro de ícones `matIconRegistry`,
// `registerLocaleData`, etc.). Recupera esse corpo e re-emite como `provideAppInitializer`
// no app.config.ts, convertendo os campos injetados (`this.x`) em `inject()` locais.
function restoreAppModuleConstructorInit(cfg, appDir) {
  const mod = readOriginalAppModule(appDir);
  if (!mod) return { cfg, changed: false };

  const classMatch = mod.match(/export\s+class\s+AppModule\b[^{]*\{/);
  if (!classMatch) return { cfg, changed: false };
  const classBody = sliceBalanced(mod, mod.indexOf('{', classMatch.index), '{', '}');
  if (!classBody) return { cfg, changed: false };

  const ctorMatch = classBody.match(/constructor\s*\(([^)]*)\)\s*\{/);
  if (!ctorMatch) return { cfg, changed: false };
  const ctorBlock = sliceBalanced(classBody, classBody.indexOf('{', ctorMatch.index), '{', '}');
  if (!ctorBlock) return { cfg, changed: false };
  let body = ctorBlock.slice(1, -1).replace(/^\s*super\([^)]*\);?\s*$/m, '').trim();
  if (!body) return { cfg, changed: false };

  // injeções: campos `name = inject(Type)` na classe + params DI do constructor
  const injects = new Map();
  for (const m of classBody.matchAll(/(?:readonly\s+)?(\w+)\s*=\s*inject\s*(?:<[^>]+>)?\s*\(([\w.]+)\)/g))
    injects.set(m[1], m[2]);
  for (const param of ctorMatch[1].split(',')) {
    const pm = param.match(/(?:private|public|protected|readonly)\s+(\w+)\s*:\s*([\w.]+)/);
    if (pm) injects.set(pm[1], pm[2]);
  }

  // só os injetados realmente usados no corpo (this.name) → vira `const name = inject(Type)`
  const used = [...injects].filter(([name]) => new RegExp(`\\bthis\\.${name}\\b`).test(body));
  for (const [name] of used) body = body.replace(new RegExp(`\\bthis\\.${name}\\b`, 'g'), name);
  // se ainda há `this.` (membro não-injetado), não dá pra mover com segurança → aborta
  if (/\bthis\./.test(body)) return { cfg, changed: false };

  const indent = '      ';
  const lines = [
    ...used.map(([name, type]) => `${indent}const ${name} = inject(${type.split('.')[0]});`),
    ...body.split('\n').map(l => indent + l.trim()).filter(l => l.trim()),
  ];
  const provider = `provideAppInitializer(() => {\n${lines.join('\n')}\n    })`;

  // imports: tipos dos injects + qualquer identificador do corpo que tenha import no AppModule
  const modImports = mod.match(/^import\s+[\s\S]+?;$/gm) || [];
  const neededSyms = new Set(used.map(([, t]) => t.split('.')[0]));
  for (const m of body.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\b/g)) neededSyms.add(m[1]);
  const importsToAdd = [];
  for (const sym of neededSyms) {
    if (new RegExp(`\\bimport\\s*(?:type\\s*)?\\{[^}]*\\b${sym}\\b[^}]*\\}`).test(cfg)) continue;
    if (importsToAdd.some(l => new RegExp(`\\{[^}]*\\b${sym}\\b`).test(l))) continue;
    const imp = modImports.find(l => new RegExp(`\\{[^}]*\\b${sym}\\b[^}]*\\}`).test(l));
    const from = imp?.match(/from\s*(['"][^'"]+['"])/)?.[1];
    if (from) importsToAdd.push(`import { ${sym} } from ${from};`);
  }

  let out = ensureCoreImports(cfg, ['provideAppInitializer', 'inject']);
  const cfgProvMatch = out.match(/providers\s*:\s*\[/);
  if (!cfgProvMatch) return { cfg, changed: false };
  const insertAt = out.indexOf('[', cfgProvMatch.index) + 1;
  out = out.slice(0, insertAt) + `\n    ${provider},` + out.slice(insertAt);

  const block = [...new Set(importsToAdd)].join('\n');
  if (block) {
    const lastImp = out.lastIndexOf('\nimport ');
    const nlAfter = out.indexOf('\n', lastImp + 1);
    out = out.slice(0, nlAfter + 1) + block + '\n' + out.slice(nlAfter + 1);
  }
  console.log('  ↳ init do constructor do AppModule restaurada (provideAppInitializer)');
  report.modernize.appModuleInitRestored = true;
  return { cfg: out, changed: true };
}

export function extractImportProvidersFromModules(content) {
  const idx = content.indexOf('importProvidersFrom(');
  if (idx === -1) return [];
  let depth = 0, start = idx + 'importProvidersFrom('.length, end = start;
  for (let i = start; i < content.length; i++) {
    if (content[i] === '(') depth++;
    else if (content[i] === ')') { if (depth === 0) { end = i; break; } depth--; }
  }
  return splitTopLevel(content.slice(start, end));
}

// Split a comma-separated string respecting nested parentheses/brackets/braces.
function splitTopLevel(str) {
  const parts = [];
  let depth = 0, start = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') depth--;
    else if (c === ',' && depth === 0) {
      const part = str.slice(start, i).trim();
      if (part) parts.push(part);
      start = i + 1;
    }
  }
  const last = str.slice(start).trim();
  if (last) parts.push(last);
  return parts;
}

// Extrai opções de RouterModule.forRoot e converte para with*() features do provideRouter.
// Cobre as opções mais comuns: preloadingStrategy, scrollPositionRestoration, useHash, enableTracing.
function extractRouterWithFeatures(content) {
  // Match RouterModule.forRoot(anything, { ...options... })
  const m = content.match(/RouterModule\.forRoot\s*\([^,)]+,\s*(\{[\s\S]*?\})\s*\)/);
  if (!m) return { features: [], extraImports: [] };

  const opts = m[1];
  const features = [];
  const extraImports = [];
  const routerSymbols = [];

  const preloadM = opts.match(/preloadingStrategy\s*:\s*(\w+)/);
  if (preloadM) {
    features.push(`withPreloading(${preloadM[1]})`);
    routerSymbols.push('withPreloading');
  }

  const scrollM = opts.match(/scrollPositionRestoration\s*:\s*['"](\w+)['"]/);
  if (scrollM) {
    const anchorScrolling = /anchorScrolling\s*:\s*['"]enabled['"]/.test(opts) ? `, anchorScrolling: 'enabled'` : '';
    features.push(`withInMemoryScrolling({ scrollPositionRestoration: '${scrollM[1]}'${anchorScrolling} })`);
    routerSymbols.push('withInMemoryScrolling');
  }

  if (/enableTracing\s*:\s*true/.test(opts)) {
    features.push('withDebugTracing()');
    routerSymbols.push('withDebugTracing');
  }

  if (/useHash\s*:\s*true/.test(opts)) {
    features.push('withHashLocation()');
    routerSymbols.push('withHashLocation');
  }

  return { features, routerSymbols, extraImports };
}

// §5.2 — O standalone-bootstrap às vezes NÃO fia o roteamento no app.config.ts (deixa
// o `ROUTES`/`routes` órfão, sem provideRouter). Sem isso a app não navega e TODOS os
// módulos lazy (loadChildren) ficam tree-shaken, escondendo seus erros do `ng build`.
function findRoutesExport(appDir) {
  const candidates = [
    ['app.routes.ts', /export\s+const\s+(routes|ROUTES)\b/],
    ['app.routing.ts', /export\s+const\s+(ROUTES|routes)\b/],
    ['app-routing.module.ts', /export\s+const\s+(ROUTES|routes)\b/],
  ];
  for (const [file, re] of candidates) {
    const p = join(appDir, file);
    if (existsSync(p)) {
      const m = readFileSync(p, 'utf8').match(re);
      if (m) return { sym: m[1], importPath: './' + file.replace(/\.ts$/, ''), filePath: p };
    }
  }
  return null;
}

function ensureProvideRouter(cfg, appDir) {
  if (/\bprovideRouter\s*\(/.test(cfg)) return { cfg, changed: false };
  const routes = findRoutesExport(appDir);
  if (!routes) return { cfg, changed: false };

  // features do RouterModule.forRoot (no AppModule original, ou no próprio arquivo de rotas)
  let feat = { features: [], routerSymbols: [] };
  const mod = readOriginalAppModule(appDir);
  if (mod) feat = extractRouterWithFeatures(mod);
  if (!feat.features.length) feat = extractRouterWithFeatures(readFileSync(routes.filePath, 'utf8'));

  const call = `provideRouter(${routes.sym}${feat.features.length ? ', ' + feat.features.join(', ') : ''})`;
  const m = cfg.match(/providers\s*:\s*\[/);
  if (!m) return { cfg, changed: false };
  const insertAt = cfg.indexOf('[', m.index) + 1;
  let out = cfg.slice(0, insertAt) + `\n    ${call},` + cfg.slice(insertAt);

  const routerSyms = [...new Set(['provideRouter', ...(feat.routerSymbols || [])])];
  const imps = [];
  if (!new RegExp(`\\bimport\\s*\\{[^}]*\\bprovideRouter\\b`).test(cfg))
    imps.push(`import { ${routerSyms.join(', ')} } from '@angular/router';`);
  if (!new RegExp(`\\bimport\\s*\\{[^}]*\\b${routes.sym}\\b`).test(cfg))
    imps.push(`import { ${routes.sym} } from '${routes.importPath}';`);
  if (imps.length) {
    const lastImp = out.lastIndexOf('\nimport ');
    const nlAfter = out.indexOf('\n', lastImp + 1);
    out = out.slice(0, nlAfter + 1) + imps.join('\n') + '\n' + out.slice(nlAfter + 1);
  }
  console.log(`  ↳ provideRouter(${routes.sym}) fiado no app.config${feat.features.length ? ` [${feat.features.join(', ')}]` : ''}`);
  report.modernize.provideRouterWired = true;
  return { cfg: out, changed: true };
}

// Removes bootstrap-level modules from root app.component.ts imports array.
// These modules are provided by bootstrapApplication / app.config.ts and must NOT
// be in a standalone component's imports (causes double-init of animation system etc.)
function fixRootComponentBootstrapImports(appDir) {
  const BOOTSTRAP_MODS = new Set([
    'BrowserModule', 'BrowserAnimationsModule', 'NoopAnimationsModule',
    'HttpClientModule', 'HttpClientJsonpModule',
  ]);
  const compPath = join(appDir, 'app.component.ts');
  if (!existsSync(compPath)) return;
  let src = readFileSync(compPath, 'utf8');
  if (!src.includes('standalone: true')) return;

  // Find the imports: [...] array in @Component
  const compIdx = src.indexOf('@Component(');
  if (compIdx === -1) return;
  let depth = 0, compEnd = -1;
  for (let i = src.indexOf('(', compIdx); i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') { if (--depth === 0) { compEnd = i; break; } }
  }
  if (compEnd === -1) return;
  const body = src.slice(compIdx, compEnd + 1);
  const impM = body.match(/\bimports\s*:\s*\[/);
  if (!impM) return;
  const arrBase = compIdx + impM.index + impM[0].length - 1;
  let bd = 0, arrEnd = -1;
  for (let i = arrBase; i < src.length; i++) {
    if (src[i] === '[') bd++;
    else if (src[i] === ']') { if (--bd === 0) { arrEnd = i; break; } }
  }
  if (arrEnd === -1) return;
  const arrContent = src.slice(arrBase + 1, arrEnd);
  const filtered = arrContent.split(',').map(s => s.trim()).filter(s => s && !BOOTSTRAP_MODS.has(s));
  if (filtered.length === arrContent.split(',').map(s => s.trim()).filter(Boolean).length) return;

  const removed = arrContent.split(',').map(s => s.trim()).filter(s => s && BOOTSTRAP_MODS.has(s));
  const newArr = filtered.length ? `\n    ${filtered.join(',\n    ')}\n` : '';
  src = src.slice(0, arrBase + 1) + newArr + src.slice(arrEnd);

  // Remove orphaned ES import statements
  for (const sym of removed) {
    const re = new RegExp(`\\nimport\\s*\\{[^}]*\\b${sym}\\b[^}]*\\}\\s*from\\s*['"][^'"]+['"];`);
    const before = src;
    src = src.replace(re, '');
    if (src === before) {
      // Multi-symbol import — just remove this symbol from the braces
      src = src.replace(new RegExp(`\\b${sym}\\b\\s*,?\\s*`), '').replace(/,\s*\}/g, ' }').replace(/\{\s*,\s*/g, '{ ');
    }
  }

  writeFileSync(compPath, src);
  console.log(`  ↳ app.component.ts: removidos ${removed.join(', ')} (bootstrap-level)`);
}

export function createAppConfigAndRoutes() {
  const appDir    = join(destPath, 'src', 'app');
  const mainPath  = join(destPath, 'src', 'main.ts');
  const routingPath = join(appDir, 'app-routing.module.ts');
  const configPath  = join(appDir, 'app.config.ts');
  const routesPath  = join(appDir, 'app.routes.ts');

  if (existsSync(configPath)) {
    // Post-process existing app.config.ts (created by standalone-bootstrap schematic):
    let cfg = readFileSync(configPath, 'utf8');
    let cfgChanged = false;

    // Deduplicate import lines
    const cfgLines = cfg.split('\n');
    const seenImports = new Set();
    const deduped = cfgLines.filter(line => {
      if (!/^\s*import\s+/.test(line)) return true;
      const key = line.trim().replace(/"/g, "'");
      if (seenImports.has(key)) return false;
      seenImports.add(key);
      return true;
    });
    if (deduped.length !== cfgLines.length) { cfg = deduped.join('\n'); cfgChanged = true; }

    // Strip bootstrap-only modules and standalone directives from importProvidersFrom().
    // - BrowserModule: always provided by bootstrapApplication
    // - BrowserAnimationsModule / NoopAnimationsModule: replaced by provideAnimations*
    // - Standalone directives (RouterOutlet, RouterLink, etc.): invalid inside importProvidersFrom
    {
      const STANDALONE_DIRECTIVES = new Set([
        'RouterOutlet', 'RouterLink', 'RouterLinkActive', 'RouterLinkWithHref',
        'NgIf', 'NgFor', 'NgSwitch', 'NgSwitchCase', 'NgSwitchDefault',
        'NgClass', 'NgStyle', 'NgTemplateOutlet', 'NgComponentOutlet',
      ]);
      const ALWAYS_REMOVE = new Set(['BrowserModule']);
      const ipfAllMatch = cfg.match(/importProvidersFrom\s*\(([^)]*(?:\([^)]*\)[^)]*)*)\)/s);
      if (ipfAllMatch) {
        const hasAnimationsProvider = /provideAnimations(?:Async)?\s*\(/.test(cfg);
        const syms = splitTopLevel(ipfAllMatch[1]);
        // Extract just the leading identifier of each arg (e.g. "NgxMaskModule" from "NgxMaskModule.forRoot(...)")
        const filtered = syms.filter(s => {
          const id = s.match(/^([A-Z][A-Za-z0-9_]*)/)?.[1];
          if (!id) return true;
          if (ALWAYS_REMOVE.has(id)) return false;
          if (STANDALONE_DIRECTIVES.has(id)) return false;
          if (hasAnimationsProvider && (id === 'BrowserAnimationsModule' || id === 'NoopAnimationsModule')) return false;
          return true;
        });
        if (filtered.length !== syms.length) {
          const removed = syms.filter(s => !filtered.includes(s)).map(s => s.match(/^([A-Z][A-Za-z0-9_]*)/)?.[1] ?? s);
          if (filtered.length === 0) {
            cfg = cfg.replace(/,?\s*importProvidersFrom\s*\([^)]*(?:\([^)]*\)[^)]*)*\)/s, '');
            if (!cfg.includes('importProvidersFrom(')) {
              cfg = cfg.replace(/,\s*importProvidersFrom\b/, '').replace(/\bimportProvidersFrom,\s*/, '');
            }
          } else {
            cfg = cfg.replace(ipfAllMatch[0], `importProvidersFrom(${filtered.join(', ')})`);
          }
          // NOTE: do NOT remove the ES import lines — they may import other used symbols.
          // Unused imports are just warnings, not errors.
          cfgChanged = true;
          console.log(`  ↳ importProvidersFrom: removidos ${removed.join(', ')}`);
        }
      }
    }

    // Find symbols used in importProvidersFrom(...) that have no import statement.
    const ipfMatch = cfg.match(/importProvidersFrom\s*\(([^)]*(?:\([^)]*\)[^)]*)*)\)/s);
    if (ipfMatch) {
      // Scan entire src/ tree for import statements (app.module.ts may have been deleted by the time we run)
      const srcRoot = join(destPath, 'src');
      const candidatePaths = [mainPath];
      function scanCandidates(dir) {
        try {
          for (const f of readdirSync(dir)) {
            const full = join(dir, f);
            if (statSync(full).isDirectory()) { scanCandidates(full); continue; }
            if (f.endsWith('.module.ts') || f.endsWith('.constant.ts') || f.endsWith('.constants.ts')) candidatePaths.push(full);
          }
        } catch { /* ignore */ }
      }
      scanCandidates(srcRoot);
      const candidateContent = candidatePaths
        .filter(p => existsSync(p))
        .map(p => readFileSync(p, 'utf8'))
        .join('\n');

      const ipfBody = ipfMatch[1];
      const usedSyms = [...ipfBody.matchAll(/\b([A-Z][A-Za-z0-9_]*)\b/g)].map(m => m[1]);
      for (const sym of usedSyms) {
        if (new RegExp(`\\bimport\\s*\\{[^}]*\\b${sym}\\b[^}]*\\}`).test(cfg)) continue;
        const re = new RegExp(`import\\s*\\{[^}]*\\b${sym}\\b[^}]*\\}\\s*from\\s*['"][^'"]+['"]`);
        const m2 = candidateContent.match(re);
        if (m2) {
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

    // §5.2 — garante provideRouter(ROUTES) fiado (senão lazy modules ficam tree-shaken)
    {
      const res = ensureProvideRouter(cfg, appDir);
      if (res.changed) { cfg = res.cfg; cfgChanged = true; }
    }

    // §5.1 — restaura o providers:[] do AppModule que o standalone-bootstrap descartou
    {
      const res = transcribeAppModuleProviders(cfg, appDir);
      if (res.changed) { cfg = res.cfg; cfgChanged = true; }
    }

    // §6.4 — restaura a init do constructor do AppModule (idioma/ícones) como provideAppInitializer
    {
      const res = restoreAppModuleConstructorInit(cfg, appDir);
      if (res.changed) { cfg = res.cfg; cfgChanged = true; }
    }

    // Final dedup pass (safety net)
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
    fixRootComponentBootstrapImports(appDir);
    return;
  }

  const mainContent = existsSync(mainPath) ? readFileSync(mainPath, 'utf8') : '';

  // 1. app.routes.ts — extrai o array de rotas do routing module.
  // Captura as opções de RouterModule.forRoot ANTES de deletar o arquivo.
  let hasRoutes = existsSync(routesPath);
  let routerWithFeatures = { features: [], routerSymbols: [], extraImports: [] };

  if (!hasRoutes && existsSync(routingPath)) {
    const routingContent = readFileSync(routingPath, 'utf8');
    // Extrai with*() features das opções do forRoot antes de apagar o arquivo
    routerWithFeatures = extractRouterWithFeatures(routingContent);
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
      unlinkSync(routingPath);
      console.log('  ↳ app-routing.module.ts removido');
    }
  } else if (existsSync(routingPath)) {
    // Routing module existe mas app.routes.ts já foi criado — ainda extrai opções
    routerWithFeatures = extractRouterWithFeatures(readFileSync(routingPath, 'utf8'));
  }

  // Se não achou opções no routing module, tenta no app.module.ts
  if (!routerWithFeatures.features.length) {
    const appModulePath = join(appDir, 'app.module.ts');
    if (existsSync(appModulePath)) {
      routerWithFeatures = extractRouterWithFeatures(readFileSync(appModulePath, 'utf8'));
    }
  }

  // 2. app.config.ts — converte importProvidersFrom() para providers funcionais
  const modules = extractImportProvidersFromModules(mainContent);
  const configImports = [`import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';`];
  const providers     = [`provideZoneChangeDetection({ eventCoalescing: true })`];
  const unknownMods   = [];

  if (hasRoutes) {
    const routerSymbols = ['provideRouter', ...(routerWithFeatures.routerSymbols ?? [])];
    configImports.push(`import { ${routerSymbols.join(', ')} } from '@angular/router';`);
    configImports.push(`import { routes } from './app.routes';`);
    const withArgs = routerWithFeatures.features.length
      ? `routes,\n    ${routerWithFeatures.features.join(',\n    ')}`
      : 'routes';
    providers.push(`provideRouter(${withArgs})`);
    if (routerWithFeatures.features.length) {
      console.log(`  ↳ provideRouter: ${routerWithFeatures.features.map(f => f.replace(/\(.*$/, '()')).join(', ')}`);
    }
  }

  // Detecta se o projeto usa HTTP_INTERCEPTORS (DI-based interceptors)
  const hasHttpInterceptors = scanForContent('HTTP_INTERCEPTORS', ['.ts']);

  for (const mod of modules) {
    if (mod === 'BrowserModule' || mod === 'AppRoutingModule') continue;
    if (mod === 'BrowserAnimationsModule') {
      // provideAnimations() (síncrono) é a conversão segura de BrowserAnimationsModule.
      // provideAnimationsAsync() muda o comportamento — animações carregadas lazy podem
      // não estar prontas quando o app component renderiza pela primeira vez.
      providers.push(`provideAnimations()`);
      configImports.push(`import { provideAnimations } from '@angular/platform-browser/animations';`);
    } else if (mod === 'NoopAnimationsModule') {
      providers.push(`provideNoopAnimations()`);
      configImports.push(`import { provideNoopAnimations } from '@angular/platform-browser/animations';`);
    } else if (mod === 'HttpClientModule') {
      // withInterceptorsFromDi() preserva interceptors class-based registrados via HTTP_INTERCEPTORS.
      // Sem isso, qualquer interceptor de autenticação/logging para de funcionar silenciosamente.
      if (hasHttpInterceptors) {
        providers.push(`provideHttpClient(withInterceptorsFromDi())`);
        configImports.push(`import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';`);
        console.log('  ↳ provideHttpClient(withInterceptorsFromDi()) — HTTP_INTERCEPTORS detectado');
      } else {
        providers.push(`provideHttpClient()`);
        configImports.push(`import { provideHttpClient } from '@angular/common/http';`);
      }
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
    // Strip standalone directives before writing
    const STANDALONE_STRIP = new Set([
      'RouterOutlet', 'RouterLink', 'RouterLinkActive', 'RouterLinkWithHref',
      'NgIf', 'NgFor', 'NgSwitch', 'NgSwitchCase', 'NgSwitchDefault', 'NgClass', 'NgStyle',
      'NgTemplateOutlet', 'NgComponentOutlet', 'BrowserModule', 'BrowserAnimationsModule',
      'NoopAnimationsModule',
    ]);
    const filteredMods = unknownMods.filter(m => {
      const id = m.match(/^([A-Z][A-Za-z0-9_]*)/)?.[1];
      return id && !STANDALONE_STRIP.has(id);
    });
    providers.push(`importProvidersFrom(${filteredMods.join(', ')})`);

    // Collect all uppercase identifiers used across the entire importProvidersFrom content
    const ipfContent = filteredMods.join(', ');
    const allSyms = new Set([...ipfContent.matchAll(/\b([A-Z][A-Za-z0-9_]*)\b/g)].map(m => m[1]));
    const addedImports = new Set();
    function addImportForSym(sym) {
      if (addedImports.has(sym)) return;
      if (configImports.some(l => new RegExp(`\\b${sym}\\b`).test(l))) return;
      const re = new RegExp(`import\\s*\\{[^}]*\\b${sym}\\b[^}]*\\}\\s*from\\s*['"][^'"]+['"]`);
      const m = mainContent.match(re);
      if (m) {
        const adjusted = m[0]
          .replace(/from\s*'\.\/app\//g, `from './`)
          .replace(/from\s*"\.\/app\//g, `from "./`);
        const key = adjusted.match(/from\s*['"][^'"]+['"]/)?.[0] + adjusted.match(/\{[^}]+\}/)?.[0];
        if (key && !addedImports.has(key)) {
          configImports.push(adjusted + ';');
          addedImports.add(key);
          // Also mark all symbols in this import as handled
          for (const s of (adjusted.match(/\{([^}]+)\}/)?.[1] ?? '').split(',').map(x => x.trim())) {
            if (s) addedImports.add(s);
          }
        }
      }
    }
    for (const sym of allSyms) addImportForSym(sym);
  }

  // Deduplicate configImports (same symbol may be added multiple times)
  const seenImpKeys = new Set();
  const dedupedImports = configImports.filter(line => {
    if (!/^\s*import\s+/.test(line)) return true;
    const key = line.trim().replace(/"/g, "'");
    if (seenImpKeys.has(key)) return false;
    seenImpKeys.add(key);
    return true;
  });

  writeFileSync(configPath, [
    ...dedupedImports,
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
  fixRootComponentBootstrapImports(appDir);
}
