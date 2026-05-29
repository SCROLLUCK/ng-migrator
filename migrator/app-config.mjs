import {
  readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync, statSync,
} from 'fs';
import { join } from 'path';
import { destPath, report } from './context.mjs';
import { extractBracketBlock, scanForContent } from './utils.mjs';
import { hasPackage } from './packages.mjs';

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
