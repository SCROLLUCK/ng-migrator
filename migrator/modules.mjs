import {
  readFileSync, writeFileSync, existsSync, readdirSync, statSync, unlinkSync,
} from 'fs';
import { join, dirname, basename } from 'path';
import { destPath, SKIP_DIRS } from './context.mjs';
import { extractBracketBlock } from './utils.mjs';

export function convertLazyModulesToRoutes() {
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

      // Normalizes any known .then() pattern to the canonical `m => m.SomeModule` form
      // before the main replacement below runs.
      // Pattern 1: .then(({ SomeModule }) => SomeModule)  — destructuring
      src = src.replace(
        /loadChildren\s*:\s*\(\s*\)\s*=>\s*import\(\s*(['"])([^'"]+\.module)\1\s*\)\s*\.then\s*\(\s*\(\s*\{\s*(\w+Module)\s*\}\s*\)\s*=>\s*\3\s*\)/g,
        (_, q, importPath, moduleName) =>
          `loadChildren: () => import(${q}${importPath}${q}).then(m => m.${moduleName})`,
      );
      // Pattern 2: .then(function(m) { return m.SomeModule; })  — function keyword
      src = src.replace(
        /loadChildren\s*:\s*\(\s*\)\s*=>\s*import\(\s*(['"])([^'"]+\.module)\1\s*\)\s*\.then\s*\(\s*function\s*\(\s*(\w+)\s*\)\s*\{\s*return\s+\3\.(\w+Module)\s*;\s*\}\s*\)/g,
        (_, q, importPath, _v, moduleName) =>
          `loadChildren: () => import(${q}${importPath}${q}).then(m => m.${moduleName})`,
      );

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

export function convertRemainingRoutingModules() {
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

export function removeUnusedModules() {
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

  // 2. Constrói índice com o conteúdo de TODOS os .ts
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
    const modSrc = readFileSync(modulePath, 'utf8');
    // Extrai o nome da classe exportada (ex: VacancyModule) — necessário para detectar
    // referências via barrel import ou path alias que não usam o path do arquivo diretamente
    const classNameMatch = modSrc.match(/export\s+class\s+([A-Z][A-Za-z0-9_]*Module)\b/);
    const className = classNameMatch?.[1];

    const isReferenced = allTsFiles.some(({ path, content }) => {
      if (path === modulePath) return false;
      // Referência por path de arquivo
      if (content.includes(`/${base}'`) || content.includes(`/${base}"`) || content.includes(`/${base}\``)) return true;
      // Referência por nome de classe (cobre barrel imports e path aliases)
      if (className && content.includes(className)) return true;
      return false;
    });
    if (!isReferenced) {
      unlinkSync(modulePath);
      console.log(`  ↳ ${basename(modulePath)} removido`);
      removed++;
    }
  }
  return removed;
}
