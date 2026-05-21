import {
  readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync,
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
  return content.slice(start, end).split(',').map(m => m.trim()).filter(Boolean);
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

    // Find symbols used in importProvidersFrom(...) that have no import statement.
    const ipfMatch = cfg.match(/importProvidersFrom\s*\(([^)]+)\)/s);
    if (ipfMatch) {
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
