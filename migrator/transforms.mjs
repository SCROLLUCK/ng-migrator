import {
  readFileSync, writeFileSync, existsSync, readdirSync, statSync, unlinkSync,
} from 'fs';
import { join, dirname, relative } from 'path';
import { destPath, SKIP_DIRS, report } from './context.mjs';
import { readJson, writeJson, run } from './utils.mjs';

// ─── UntypedForm* → typed forms ──────────────────────────────────────────────

export function fixUntypedForms() {
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

// ─── Renomeia variáveis cujos nomes são palavras reservadas ──────────────────

export function fixReservedKeywordVariables() {
  const srcDir = join(destPath, 'src');
  if (!existsSync(srcDir)) return 0;

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

        const newBlock = block.replace(
          new RegExp('(?<!\\.)\\b' + keyword + '\\b(?!\\s*\\()', 'g'),
          newName,
        );

        if (newBlock !== block) {
          out = out.slice(0, start) + newBlock + out.slice(end);
          fileChanged = true;
          count++;
          console.log(`  ↳ ${entry}: '${keyword}' → '${newName}' (palavra reservada)`);
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

export function fixTsCompat() {
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

// ─── throwError() → factory function (RxJS 7) ────────────────────────────────

export function fixThrowError() {
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

        let depth = 1, inStr = false, strChar = '';
        let j = argStart;
        while (j < src.length && depth > 0) {
          const ch = src[j];
          if (inStr) {
            if (ch === '\\') j++;
            else if (ch === strChar) inStr = false;
          } else {
            if (ch === '"' || ch === "'" || ch === '`') { inStr = true; strChar = ch; }
            else if (ch === '(') depth++;
            else if (ch === ')') { if (--depth === 0) break; }
          }
          j++;
        }

        const arg = src.slice(argStart, j).trim();
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

// ─── Fix: import * as moment → default import ─────────────────────────────────

export function fixMomentImport() {
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

export function fixSubjectVoid() {
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
function removeM2TypographyBlocks(src) {
  const varNames = new Set();
  let out = src.replace(
    /(\$[\w-]+)\s*:\s*(?:mat-typography-config|mat\.define-typography-config)\s*\(/g,
    (match, varName) => { varNames.add(varName); return match; },
  );

  for (const varName of varNames) {
    const escapedVar = varName.replace('$', '\\$');
    const startRe = new RegExp(
      '\\n?[ \\t]*' + escapedVar +
      '\\s*:\\s*(?:mat-typography-config|mat\\.define-typography-config)\\s*\\(',
    );
    let m = startRe.exec(out);
    if (!m) continue;
    const blockStart = m.index;
    let depth = 0;
    let i = m.index + m[0].length - 1;
    while (i < out.length) {
      if (out[i] === '(') depth++;
      else if (out[i] === ')') { depth--; if (depth === 0) { i++; break; } }
      i++;
    }
    while (i < out.length && (out[i] === ';' || out[i] === '\r')) i++;
    if (out[i] === '\n') i++;
    out = out.slice(0, blockStart) + out.slice(i);

    out = out.replace(
      new RegExp('(@include\\s+mat\\.core\\s*\\()\\s*' + escapedVar + '\\s*(\\))', 'g'),
      '$1$2',
    );
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

export function fixSassImports() {
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
      const hasMat1Api = out.includes('mat-typography-config(') || out.includes('mat-typography-level(') ||
          out.includes('mat-palette(') || out.includes('mat-light-theme(') ||
          out.includes('mat-dark-theme(') || out.includes('mat-core()') ||
          out.includes('mat-base-typography(') || /@include\s+mat-/.test(out);
      if (hasMat1Api) {
        out = out.replace(/@use\s+(['"])@angular\/material\1\s+as\s+\*/g,
          `@use '@angular/material' as mat`);

        if (report.targetVersion >= 17) {
          out = removeM2TypographyBlocks(out);
          // mat-base-typography is M2-only: remove the call entirely for v17+
          out = out.replace(/[ \t]*@include\s+mat-base-typography\s*\([^)]*\)\s*;\n?/g, '');
        } else {
          const matFnRenames = [
            [/\bmat-typography-config\s*\(/g,  'mat.define-typography-config('],
            [/\bmat-typography-level\s*\(/g,   'mat.define-typography-level('],
            [/\bmat-base-typography\s*\(/g,    'mat.typography-hierarchy('],
          ];
          out = out.split('\n').map(line => {
            if (/^\s*@(function|mixin)\s/.test(line)) return line;
            for (const [from, to] of matFnRenames) line = line.replace(from, to);
            return line;
          }).join('\n');
          out = out.replace(/,\s*\$letter-spacing\s*:\s*[^,)]+/g, '');
        }

        const matFnRenamesCommon = [
          [/\bmat-palette\s*\(/g,                  'mat.define-palette('],
          [/\bmat-light-theme\s*\(/g,              'mat.define-light-theme('],
          [/\bmat-dark-theme\s*\(/g,               'mat.define-dark-theme('],
          [/\bmat-color\s*\(/g,                    'mat.get-color-from-palette('],
          [/\bmat-contrast\s*\(/g,                 'mat.get-contrast-color-from-palette('],
          [/\bmat-get-color-config\s*\(/g,         'mat.get-color-config('],
          [/\bmat-get-typography-config\s*\(/g,    'mat.get-typography-config('],
          [/\bmat-font-size\s*\(/g,                'mat.font-size('],
          [/\bmat-font-family\s*\(/g,              'mat.font-family('],
          [/\bmat-font-weight\s*\(/g,              'mat.font-weight('],
          [/\bmat-line-height\s*\(/g,              'mat.line-height('],
          [/\bmat-letter-spacing\s*\(/g,           'mat.letter-spacing('],
        ];
        out = out.split('\n').map(line => {
          if (/^\s*@(function|mixin)\s/.test(line)) return line;
          for (const [from, to] of matFnRenamesCommon) line = line.replace(from, to);
          return line;
        }).join('\n');
        // mat-core() / mat-core($arg) → mat.core()  (arg was typography config, now deprecated)
        out = out.replace(/@include\s+mat-core\s*\([^)]*\)/g, '@include mat.core()');
        // mat.core($arg) with leftover arg → remove the arg too
        out = out.replace(/@include\s+mat\.core\s*\(\s*\$[\w-]+\s*\)/g, '@include mat.core()');
        out = out.replace(/@include\s+angular-material-theme\s*\(/g, '@include mat.all-component-themes(');
        out = out.replace(/@include\s+angular-material-color\s*\(/g, '@include mat.all-component-colors(');
        out = out.replace(/@include\s+angular-material-typography\s*\(/g, '@include mat.all-component-typographies(');
        // Component-specific typography mixins: mat-{comp}-typography → mat.{comp}-typography
        out = out.replace(/@include\s+mat-([a-z][a-z-]*)-typography\s*\(/g, '@include mat.$1-typography(');

        // $mat-{color} palette variable renames → mat.$color-palette
        // (safety net — ng update @material@15 schematic handles standard files)
        const MAT_PALETTES = [
          'red','pink','purple','deep-purple','indigo','blue','light-blue','cyan','teal',
          'green','light-green','lime','yellow','amber','orange','deep-orange','brown',
          'grey','gray','blue-grey','blue-gray',
        ];
        for (const c of MAT_PALETTES) {
          out = out.replace(new RegExp(`\\$mat-${c}\\b`, 'g'), `mat.$${c}-palette`);
        }
      }

      // Fix url("~src/...") → relative path from this file to src/
      if (out.includes('~src/')) {
        const relToSrc = relative(dirname(full), srcDir).replace(/\\/g, '/') || '.';
        out = out.replace(/url\((['"])~src\//g, `url($1${relToSrc}/`);
        out = out.replace(/(['"])~src\//g, `$1${relToSrc}/`);
      }

      // Fix deprecated Sass slash division: $x / $y → math.div($x, $y)
      // Skip CSS color alpha syntax like rgb(0 0 0 / .05) — both sides are unitless numbers
      const divRe = /(\$[\w-]+|\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|s|ms)?)(\s*\/\s*)(\$[\w-]+|\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|s|ms)?)/g;
      if (divRe.test(out) && !out.includes("'sass:math'") && !out.includes('"sass:math"')) {
        let didReplace = false;
        out = out.replace(divRe, (match, a, op, b) => {
          const isSassVar = a.startsWith('$') || b.startsWith('$');
          const hasUnit = /[a-z%]$/i.test(a) || /[a-z%]$/i.test(b);
          if (!isSassVar && !hasUnit) return match; // CSS color alpha (e.g. rgb(0 0 0 / .05))
          didReplace = true;
          return `math.div(${a}, ${b})`;
        });
        if (didReplace) out = `@use 'sass:math' as math;\n${out}`;
      }

      // Fix deprecated Sass color functions → color.* (Dart Sass 2.0)
      {
        const hasDarken       = /\bdarken\s*\(/.test(out);
        const hasLighten      = /\blighten\s*\(/.test(out);
        const hasAdjustHue    = /\badjust-hue\s*\(/.test(out);
        const hasSaturate     = /\bsaturate\s*\(/.test(out);
        const hasDesaturate   = /\bdesaturate\s*\(/.test(out);
        const hasOpacify      = /\b(?:opacify|fade-in)\s*\(/.test(out);
        const hasTransparent  = /\b(?:transparentize|fade-out)\s*\(/.test(out);
        const hasMix          = /\bmix\s*\(/.test(out);
        const needsColorNs    = hasDarken || hasLighten || hasAdjustHue || hasSaturate ||
                                hasDesaturate || hasOpacify || hasTransparent || hasMix;
        if (needsColorNs && !out.includes("'sass:color'") && !out.includes('"sass:color"')) {
          if (hasDarken)     out = out.replace(/\bdarken\s*\(([^,]+),\s*([^)]+)\)/g,       'color.adjust($1, $lightness: -$2)');
          if (hasLighten)    out = out.replace(/\blighten\s*\(([^,]+),\s*([^)]+)\)/g,      'color.adjust($1, $lightness: $2)');
          if (hasAdjustHue)  out = out.replace(/\badjust-hue\s*\(([^,]+),\s*([^)]+)\)/g,  'color.adjust($1, $hue: $2)');
          // saturate()/desaturate() only when called as Sass fn (2 args), not CSS filter (1 arg)
          if (hasSaturate)   out = out.replace(/\bsaturate\s*\(([^,]+),\s*([^)]+)\)/g,    'color.adjust($1, $saturation: $2)');
          if (hasDesaturate) out = out.replace(/\bdesaturate\s*\(([^,]+),\s*([^)]+)\)/g,  'color.adjust($1, $saturation: -$2)');
          if (hasOpacify)    out = out.replace(/\b(?:opacify|fade-in)\s*\(([^,]+),\s*([^)]+)\)/g,       'color.adjust($1, $alpha: $2)');
          if (hasTransparent) out = out.replace(/\b(?:transparentize|fade-out)\s*\(([^,]+),\s*([^)]+)\)/g, 'color.adjust($1, $alpha: -$2)');
          if (hasMix)        out = out.replace(/\bmix\s*\(/g, 'color.mix(');
          out = `@use 'sass:color' as color;\n${out}`;
        }
      }

      // Deduplicate @use rules with the same path (duplicate @import → duplicate @use = error)
      if (out.includes('@use ')) {
        const seenPaths = new Set();
        out = out.split('\n').filter(line => {
          const m = line.match(/^\s*@use\s+(['"])([^'"]+)\1/);
          if (!m) return true;
          if (seenPaths.has(m[2])) return false;
          seenPaths.add(m[2]);
          return true;
        }).join('\n');
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

export function migrateToApplicationBuilder() {
  console.log(`\n  🔄 builder  (browser → application/esbuild)...`);
  run('npx ng update @angular/cli --name use-application-builder --force --allow-dirty', { ignoreError: true });
}

// ─── Moderniza tsconfig.json (ES2022 / bundler) ───────────────────────────────

export function modernizeTsconfig() {
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

export function addEslint() {
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

export function addTsconfigPathAliases() {
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

// ─── styleUrls (array) → styleUrl (singular) ─────────────────────────────────

export function fixStyleUrls() {
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

export function inlinePolyfills() {
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
