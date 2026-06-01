import {
  readFileSync, writeFileSync, existsSync, readdirSync, statSync, unlinkSync,
} from 'fs';
import { join, dirname, relative } from 'path';
import { destPath, SKIP_DIRS, report } from './context.mjs';
import { readJson, writeJson, run, capture, walkFiles } from './utils.mjs';

// ─── UntypedForm* → typed forms ──────────────────────────────────────────────

export function fixUntypedForms() {
  const REPLACEMENTS = [
    ['UntypedFormBuilder', 'FormBuilder'],
    ['UntypedFormGroup',   'FormGroup'],
    ['UntypedFormControl', 'FormControl'],
    ['UntypedFormArray',   'FormArray'],
  ];

  let count = 0;
  walkFiles(join(destPath, 'src'), e => e.endsWith('.ts'), (full) => {
    let src = readFileSync(full, 'utf8');
    if (!REPLACEMENTS.some(([from]) => src.includes(from))) return;

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
  });
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

  walkFiles(srcDir, e => e.endsWith('.ts') && !e.endsWith('.spec.ts'), (full, entry) => {
    const src = readFileSync(full, 'utf8');
    declRe.lastIndex = 0;
    if (!declRe.test(src)) { declRe.lastIndex = 0; return; }
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
  });
  if (count > 0) console.log(`  ↳ ${count} variável(eis) com nome reservado renomeada(s)`);
  return count;
}

// ─── Fix TypeScript/RxJS compatibility issues ────────────────────────────────

export function fixTsCompat() {
  let count = 0;
  const srcDir = join(destPath, 'src');
  if (!existsSync(srcDir)) return 0;

  walkFiles(srcDir, e => e.endsWith('.ts') && !e.endsWith('.spec.ts'), (full) => {
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
      // Material v15+: _control.ngControl return type widened to NgControl | AbstractControlDirective
      // Cast is safe — in MatFormFieldControl context ngControl is always NgControl when not null.
      // Must wrap in parens when followed by property access to avoid broken `x as T.prop` syntax.
      out = out.replace(/(\._control\.ngControl)(?!\s+as\s+NgControl)(\.[A-Za-z_$])/g, '($1 as NgControl)$2');
      // Fallback for standalone occurrences (not followed by property access)
      out = out.replace(/(\._control\.ngControl)(?!\s+as\s+NgControl)(?!\s*\.\w)/g, '$1 as NgControl');

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
  });
  if (count > 0) console.log(`  ↳ ts-compat fixes: ${count} arquivo(s)`);
  return count;
}

// ─── throwError() → factory function (RxJS 7) ────────────────────────────────

export function fixThrowError() {
  let count = 0;
  const srcDir = join(destPath, 'src');
  if (!existsSync(srcDir)) return 0;
  walkFiles(srcDir, e => e.endsWith('.ts'), (full) => {
    let src = readFileSync(full, 'utf8');
    if (!src.includes('throwError(')) return;

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
  });
  if (count > 0) console.log(`  ↳ throwError() → factory function (RxJS 7): ${count} arquivo(s)`);
  return count;
}

// ─── Fix: import * as moment → default import ─────────────────────────────────

export function fixMomentImport() {
  let count = 0;
  const srcDir = join(destPath, 'src');
  if (existsSync(srcDir)) walkFiles(srcDir, e => e.endsWith('.ts'), (full) => {
    let src = readFileSync(full, 'utf8');
    // Cobre: from 'moment', from "moment", from 'moment/moment', from "moment/moment"
    const out = src.replace(/import\s+\*\s+as\s+moment\s+from\s+(['"])moment(?:\/[^'"]+)?\1/g, `import moment from 'moment'`);
    if (out !== src) { writeFileSync(full, out); count++; }
  });
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
  const srcDir = join(destPath, 'src');
  if (existsSync(srcDir)) walkFiles(srcDir, e => e.endsWith('.ts'), (full) => {
    let src = readFileSync(full, 'utf8');
    if (!src.includes('new Subject()') && !src.includes('new Subject<unknown>()')) return;
    let out = src
      .replace(/new\s+Subject\s*<unknown>\s*\(\)/g, 'new Subject<void>()')
      .replace(
        /((?:private|protected|public|readonly)\s+)?(\w+)(\$?)\s*(?:=\s*)new\s+Subject\s*\(\)/g,
        (match, _mod, name, dollar) => {
          // Converte para Subject<void> se: nome típico de destroy/unsubscribe, OU se há
          // chamada `.next()` SEM argumento (RxJS 7+: Subject<unknown>.next() exige 1 arg → TS2554).
          const nextNoArg = new RegExp(`\\b${name}\\${dollar || ''}\\s*\\.next\\(\\s*\\)`).test(src);
          return /(?:unsubscribe|destroy|teardown|stop|complete|close)/i.test(name) || nextNoArg
            ? match.replace('new Subject()', 'new Subject<void>()') : match;
        },
      );
    if (out !== src) { writeFileSync(full, out); count++; }
  });
  if (count > 0) console.log(`  ↳ Subject<void>: ${count} arquivo(s)`);
  return count;
}

// ─── output() sem tipo → remove arg de emit() (void emitter) ─────────────────

export function fixVoidOutputEmit() {
  let count = 0;
  const srcDir = join(destPath, 'src');
  if (!existsSync(srcDir)) return 0;

  walkFiles(srcDir, e => e.endsWith('.ts') && !e.endsWith('.spec.ts'), (full) => {
    const src = readFileSync(full, 'utf8');
    if (!src.includes('= output()')) return;

    // Collect names of void outputs: `readonly xxx = output()` (no type param → void)
    const voidOutputRe = /\breadonly\s+(\w+)\s*=\s*output\s*\(\s*\)/g;
    const voidOutputs = [];
    let m;
    while ((m = voidOutputRe.exec(src)) !== null) voidOutputs.push(m[1]);
    if (!voidOutputs.length) return;

    let out = src;
    for (const name of voidOutputs) {
      // Remove argument from .emit(arg) calls on this void emitter
      // Pattern handles one level of nested parens (e.g. emit(func())) correctly
      out = out.replace(
        new RegExp(`((?:this\\.)?${name}\\.emit)\\((?:[^()]|\\([^)]*\\))+\\)`, 'g'),
        '$1()',
      );
      // Fix subscribe callbacks that only forwarded the event: (e => ..emit()) → (() => ..emit())
      out = out.replace(
        new RegExp(
          `(\\.subscribe\\s*\\()\\s*(\\w+)\\s*=>\\s*((?:[^;{}]*\\.)?${name}\\.emit\\(\\))\\s*(\\))`,
          'g',
        ),
        '$1() => $3$4',
      );
    }

    if (out !== src) { writeFileSync(full, out); count++; }
  });
  if (count > 0) console.log(`  ↳ output() void emit args removed: ${count} arquivo(s)`);
  return count;
}

// ─── Revert signal inputs assigned to (TS2540) → @Input() ───────────────────
// The signals schematic with --best-effort-mode sometimes converts @Input()
// properties that are directly assigned (this.prop = value), which produces
// TS2540 (read-only). We detect and revert those back to @Input().
export function fixReadonlySignalInputAssignments() {
  let count = 0;
  const srcDir = join(destPath, 'src');
  if (!existsSync(srcDir)) return 0;

  walkFiles(srcDir, e => e.endsWith('.ts') && !e.endsWith('.spec.ts'), (full) => {
    const src = readFileSync(full, 'utf8');
    if (!src.includes('= input(') && !src.includes('= input<')) return;

    // Find all signal inputs: readonly xxx = input<Type>(default?)
    const signalRe = /readonly\s+(\w+)\s*=\s*input(?:<[^>]*>)?\([^)]*\)/g;
    const signalNames = [];
    let m;
    while ((m = signalRe.exec(src)) !== null) signalNames.push(m[1]);
    if (!signalNames.length) return;

    // Keep only those that are assigned to in code: this.xxx =
    const assigned = signalNames.filter(n => new RegExp(`this\\.${n}\\s*=(?!=)`).test(src));
    if (!assigned.length) return;

    let out = src;
    const htmlPath = full.replace(/\.ts$/, '.html');
    let htmlSrc = existsSync(htmlPath) ? readFileSync(htmlPath, 'utf8') : null;
    let htmlOut = htmlSrc;

    for (const name of assigned) {
      // Capture full signal declaration to extract type and default
      const declRe = new RegExp(
        `(readonly\\s+${name}\\s*=\\s*input)(?:<([^>]*)>)?\\(([^)]*)\\)`,
      );
      out = out.replace(declRe, (_, _prefix, type, defaultVal) => {
        const t = (type || '').trim() || 'any';
        const d = (defaultVal || '').trim();
        return d
          ? `@Input() ${name}: ${t} = ${d}`
          : `@Input() ${name}!: ${t}`;
      });

      // Revert zero-arg signal calls in TS: this.xxx() → this.xxx
      out = out.replace(new RegExp(`this\\.${name}\\(\\)`, 'g'), `this.${name}`);

      // Revert zero-arg signal calls in HTML template: xxx() → xxx
      if (htmlOut) {
        htmlOut = htmlOut.replace(new RegExp(`\\b${name}\\(\\)`, 'g'), name);
      }
    }

    if (htmlOut && htmlOut !== htmlSrc) writeFileSync(htmlPath, htmlOut);

    if (out === src) return;

    // Fix @angular/core imports: add Input, remove input if unused
    out = out.replace(
      /import\s*\{([^}]+)\}\s*from\s*['"]@angular\/core['"]/,
      (match, body) => {
        const items = body.split(',').map(s => s.trim()).filter(Boolean);
        if (!items.includes('Input')) items.push('Input');
        // Remove 'input' only if no remaining usages
        const afterMatch = out.slice(out.indexOf(match) + match.length);
        const beforeMatch = out.slice(0, out.indexOf(match));
        const stillUsed = /\binput\s*[<(]/.test(beforeMatch + afterMatch);
        if (!stillUsed) {
          const idx = items.indexOf('input');
          if (idx !== -1) items.splice(idx, 1);
        }
        return `import { ${items.join(', ')} } from '@angular/core'`;
      },
    );

    writeFileSync(full, out);
    count++;
  });
  if (count > 0) console.log(`  ↳ signal input → @Input() revert (TS2540): ${count} arquivo(s)`);
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
  let keptMixinFiles = 0; // .scss mantidos em @import por usarem mixins de theming
  const srcDir = join(destPath, 'src');

  if (existsSync(srcDir)) walkFiles(srcDir, e => e.endsWith('.scss'), (full) => {
    let src = readFileSync(full, 'utf8');
    let out = src;

      // @angular/material/theming was merged into @angular/material in v15
      out = out.replace(/@angular\/material\/theming/g, '@angular/material');

      // @use NÃO repassa membros transitivos como o @import fazia. Se o arquivo chama um
      // mixin "bare" (@include nome(...) sem namespace), ele provavelmente vem de um @import
      // (theming tipo Nebular: nb-install-component) — converter pra @use o quebraria
      // ("Undefined mixin"). Conservador: mantém @import nesses arquivos (dart-sass ainda
      // aceita @import, só com deprecation warning até Sass 3.0), removendo apenas o ~ (não
      // suportado pelo esbuild builder). Material é tratado à parte adiante, com namespace.
      // Sinais de que o arquivo depende de membros do @import (mixins OU funções de theming):
      //   - mixin bare:  @include nb-install-component(...)
      //   - função bare de lib em atribuição: $nb-themes: nb-register-theme(...) / mat.define-...
      // O @use não repassa esses membros transitivamente como o @import → "Undefined mixin/function".
      const usesBareMixin =
        /@include\s+[\w-]+\s*[(;]/.test(out) ||
        /\$[\w-]+\s*:\s*[a-z][\w-]*-[\w-]+\s*\(/.test(out); // $var: hyphen-fn( … )
      let keptHere = false;
      out = out.replace(/@import\s+(['"])(~?)([^'"]+)\1\s*;/g, (full, q, _tilde, path) => {
        const isMaterial = /@angular\/material/.test(path);
        if (!isMaterial && usesBareMixin) {
          keptHere = true;
          return `@import ${q}${path}${q};`; // mantém @import, remove só o ~
        }
        return `@use ${q}${path}${q} as *;`;
      });
      if (keptHere) keptMixinFiles++;

      // url("~pkg/...") → url("pkg/...") — webpack ~ prefix not supported by esbuild
      out = out.replace(/url\(\s*(['"]?)~([^'")\s]+)\1\s*\)/g,
        (_, q, path) => `url(${q}${path}${q})`);

      // Material v1 SCSS API → v15/v17+ API
      const hasMat1Api = out.includes('mat-typography-config(') || out.includes('mat-typography-level(') ||
          out.includes('mat-palette(') || out.includes('mat-light-theme(') ||
          out.includes('mat-dark-theme(') || out.includes('mat-core()') ||
          out.includes('mat-base-typography(') || /@include\s+mat-/.test(out);
      if (hasMat1Api) {
        out = out.replace(/@use\s+(['"])@angular\/material\1\s+as\s+\*/g,
          `@use '@angular/material' as mat`);

        {
          // For all target versions: convert M2 typography to the appropriate modern API.
          // Do NOT remove the variable — removing leaves orphaned $var references in mixin calls.
          const typographyRenames = report.targetVersion >= 17
            ? [
                // v17+: use legacy-compat function so existing M2 themes keep working
                [/\bmat-typography-config\s*\(/g, 'mat.define-legacy-typography-config('],
                [/\bmat-typography-level\s*\(/g,  'mat.define-typography-level('],
              ]
            : [
                [/\bmat-typography-config\s*\(/g, 'mat.define-typography-config('],
                [/\bmat-typography-level\s*\(/g,  'mat.define-typography-level('],
                [/\bmat-base-typography\s*\(/g,   'mat.typography-hierarchy('],
              ];
          out = out.split('\n').map(line => {
            if (/^\s*@(function|mixin)\s/.test(line)) return line;
            for (const [from, to] of typographyRenames) line = line.replace(from, to);
            return line;
          }).join('\n');
          // mat-base-typography is removed in v17+ (no direct replacement)
          if (report.targetVersion >= 17) {
            out = out.replace(/[ \t]*@include\s+mat-base-typography\s*\([^)]*\)\s*;\n?/g, '');
          }
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
  });
  if (count > 0) console.log(`  ↳ SCSS @import → @use + tilde fix: ${count} arquivo(s)`);
  if (keptMixinFiles > 0) {
    console.log(`  ↳ ${keptMixinFiles} .scss mantido(s) em @import (usam mixins de theming sem namespace)`);
    report.notes.push(
      `[ATENÇÃO] ${keptMixinFiles} arquivo(s) .scss foram mantidos em @import porque usam mixins de theming sem namespace (ex: @include nb-install-component). Converter para @use quebraria esses mixins ("Undefined mixin"). O dart-sass aceita @import (com deprecation warning até o Sass 3.0). Para migrar para @use, adicione @forward na cadeia de temas da biblioteca.`,
    );
  }
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
  if (hasEslint) {
    console.log('  ↳ ESLint já configurado');
    fixEslintConfig();
    return false;
  }

  run('npx ng add @angular/eslint --skip-confirmation', { ignoreError: true });

  const added = existsSync(join(destPath, '.eslintrc.json'))
    || existsSync(join(destPath, 'eslint.config.js'))
    || existsSync(join(destPath, 'eslint.config.mjs'));
  if (added) { console.log('  ↳ @angular/eslint configurado'); fixEslintConfig(); }
  else console.log('  ↳ ESLint: ng add falhou — adicione manualmente com: ng add @angular/eslint');
  return added;
}

// Remove presets depreciados do ng-cli-compat (removidos no @angular-eslint v17+)
// e limpa parserOptions legadas para evitar erros de carregamento de config.
function fixEslintConfig() {
  const eslintPath = join(destPath, '.eslintrc.json');
  if (!existsSync(eslintPath)) return;

  const config = readJson(eslintPath);
  let changed = false;

  for (const override of config.overrides ?? []) {
    // Replace ng-cli-compat presets with current equivalents
    if (Array.isArray(override.extends)) {
      const before = JSON.stringify(override.extends);
      override.extends = override.extends
        .filter(e => e !== 'plugin:@angular-eslint/ng-cli-compat--formatting-add-on')
        .map(e => e === 'plugin:@angular-eslint/ng-cli-compat'
          ? 'plugin:@angular-eslint/recommended'
          : e);
      if (JSON.stringify(override.extends) !== before) changed = true;
    }

    // Remove deprecated parserOptions
    if (override.parserOptions) {
      if (override.parserOptions.createDefaultProgram !== undefined) {
        delete override.parserOptions.createDefaultProgram;
        changed = true;
      }
      // Remove non-existent tsconfig paths (e.g. e2e/ removed during migration)
      if (Array.isArray(override.parserOptions.project)) {
        const filtered = override.parserOptions.project.filter(p => {
          const abs = join(destPath, p);
          return existsSync(abs);
        });
        if (filtered.length !== override.parserOptions.project.length) {
          override.parserOptions.project = filtered;
          changed = true;
        }
      }
    }
  }

  if (changed) {
    writeJson(eslintPath, config);
    console.log('  ↳ .eslintrc.json: ng-cli-compat → @angular-eslint/recommended');
  }
}

// ─── Path aliases no tsconfig ─────────────────────────────────────────────────

export function addTsconfigPathAliases() {
  const tsconfigPath = join(destPath, 'tsconfig.json');
  const tsconfig = readJson(tsconfigPath);
  if (tsconfig.compilerOptions?.paths) { console.log('  ↳ paths já existem no tsconfig.json'); return; }
  if (!tsconfig.compilerOptions) tsconfig.compilerOptions = {};

  // @app/* sempre existe (src/app é obrigatório em qualquer projeto Angular)
  const paths = { '@app/*': ['src/app/*'] };

  // Demais aliases: só adiciona se o diretório realmente existir no projeto
  const candidates = [
    ['@core/*',         'src/app/core'],
    ['@shared/*',       'src/app/shared'],
    ['@features/*',     'src/app/features'],
    ['@pages/*',        'src/app/pages'],
    ['@environments/*', 'src/environments'],
  ];
  for (const [alias, dir] of candidates) {
    if (existsSync(join(destPath, dir))) {
      paths[alias] = [`${dir}/*`];
    }
  }

  // paths com alvos não-relativos ("src/app/*") exigem baseUrl — senão o TS 5.x +
  // moduleResolution:bundler avisa "Non-relative path ... is not allowed when baseUrl is not set".
  if (!tsconfig.compilerOptions.baseUrl) tsconfig.compilerOptions.baseUrl = '.';
  tsconfig.compilerOptions.paths = paths;
  writeJson(tsconfigPath, tsconfig);
  console.log(`  ↳ path aliases (baseUrl: "."): ${Object.keys(paths).join(', ')}`);
}

// ─── styleUrls (array) → styleUrl (singular) ─────────────────────────────────

export function fixStyleUrls() {
  let count = 0;
  const srcDir = join(destPath, 'src');
  if (existsSync(srcDir)) walkFiles(srcDir, e => e.endsWith('.ts'), (full) => {
    let src = readFileSync(full, 'utf8');
    if (!src.includes('styleUrls')) return;
    const out = src.replace(
      /styleUrls\s*:\s*\[\s*(['"][^'"]+['"])\s*\]/g,
      'styleUrl: $1',
    );
    if (out !== src) { writeFileSync(full, out); count++; }
  });
  if (count > 0) console.log(`  ↳ styleUrls → styleUrl: ${count} arquivo(s)`);
  return count;
}

// ─── Fix signal property access: this.signalProp.method → this.signalProp().method ──────
// After the signals schematic converts @Input()/@ViewChild() to signal equivalents,
// some call sites still access the signal object directly (this.prop.x) instead of
// calling the signal first (this.prop().x). This produces TS2339 errors.
export function fixSignalPropertyAccess() {
  let count = 0;
  const srcDir = join(destPath, 'src');
  if (!existsSync(srcDir)) return 0;

  const SIGNAL_FACTORIES = ['input', 'viewChild', 'viewChildren', 'contentChild', 'contentChildren', 'model', 'computed', 'signal'];
  const sigDeclRe = new RegExp(
    `\\breadonly\\s+(\\w+)\\s*=\\s*(?:${SIGNAL_FACTORIES.join('|')})\\s*(?:<[^>]*>)?\\s*\\(`,
    'g',
  );

  // Pass 1: build global index of ALL signal property names across all files
  const globalSignalNames = new Set();
  walkFiles(srcDir, e => e.endsWith('.ts') && !e.endsWith('.spec.ts'), (full) => {
    const src = readFileSync(full, 'utf8');
    if (!SIGNAL_FACTORIES.some(f => src.includes(`= ${f}(`))) return;
    sigDeclRe.lastIndex = 0;
    let m;
    while ((m = sigDeclRe.exec(src)) !== null) globalSignalNames.add(m[1]);
  });
  if (!globalSignalNames.size) return 0;

  // Pass 2: fix accesses in all files
  walkFiles(srcDir, e => e.endsWith('.ts') && !e.endsWith('.spec.ts'), (full) => {
    const src = readFileSync(full, 'utf8');

    // Collect signal names declared in THIS file (for this.X.y fixes)
    sigDeclRe.lastIndex = 0;
    const localSignalNames = [];
    let m;
    while ((m = sigDeclRe.exec(src)) !== null) localSignalNames.push(m[1]);

    let out = src;

    // Fix this.X.y → this.X().y for locally-declared signals
    for (const name of localSignalNames) {
      const re = new RegExp(`(this\\.${name})\\.([A-Za-z_$])`, 'g');
      out = out.replace(re, `$1().$2`);
    }

    // Fix cross-class access: obj().signalProp.x → obj().signalProp().x
    // Match: word char or ) followed by .signalName.identifier (not already called)
    for (const name of globalSignalNames) {
      if (localSignalNames.includes(name)) continue; // already handled above
      const re = new RegExp(`(\\))\\.${name}\\.([A-Za-z_$])`, 'g');
      out = out.replace(re, `$1.${name}().$2`);
    }

    if (out !== src) { writeFileSync(full, out); count++; }
  });
  if (count > 0) console.log(`  ↳ signal property access fixed (this.prop.x → this.prop().x): ${count} arquivo(s)`);
  return count;
}

// ─── Fix @Output() Subject → EventEmitter ──────────────────────────────────────
// Angular @Output() should use EventEmitter, not plain Subject. Subject has no
// .emit() method. Convert `@Output() x = new Subject<T>()` → `new EventEmitter<T>()`.
// This also fixes downstream `.emit()` calls that fail when target is Subject.
export function fixSubjectEmit() {
  let count = 0;
  const srcDir = join(destPath, 'src');
  if (!existsSync(srcDir)) return 0;

  walkFiles(srcDir, e => e.endsWith('.ts') && !e.endsWith('.spec.ts'), (full) => {
    const src = readFileSync(full, 'utf8');
    if (!src.includes('@Output()') || !src.includes('new Subject')) return;

    // Convert @Output() x = new Subject<T>() → new EventEmitter<T>()
    const outputSubjectRe = /(@Output\(\)[^=\n]*=\s*)new\s+Subject\s*(<[^>]*>)?\s*\(\)/g;
    let out = src.replace(outputSubjectRe, (_, prefix, typeParam) => {
      const tp = typeParam ?? '';
      return `${prefix}new EventEmitter${tp}()`;
    });

    if (out === src) return;

    // Fix Angular core imports: add EventEmitter, remove Subject if unused
    out = out.replace(
      /import\s*\{([^}]+)\}\s*from\s*['"]@angular\/core['"]/,
      (match, body) => {
        const items = body.split(',').map(s => s.trim()).filter(Boolean);
        if (!items.includes('EventEmitter')) items.push('EventEmitter');
        return `import { ${items.join(', ')} } from '@angular/core'`;
      },
    );
    // Remove Subject from rxjs import if no longer used
    out = out.replace(
      /import\s*\{([^}]+)\}\s*from\s*['"]rxjs['"]/,
      (match, body) => {
        const items = body.split(',').map(s => s.trim()).filter(Boolean);
        const subjectUsed = /\bSubject\b/.test(out.replace(match, ''));
        if (!subjectUsed) {
          const idx = items.indexOf('Subject');
          if (idx !== -1) items.splice(idx, 1);
        }
        if (!items.length) return '';
        return `import { ${items.join(', ')} } from 'rxjs'`;
      },
    );

    writeFileSync(full, out);
    count++;
  });
  if (count > 0) console.log(`  ↳ @Output() Subject → EventEmitter: ${count} arquivo(s)`);
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

  // Remove imports de polyfills legados: core-js/es6/* e core-js/es7/* (paths removidos no
  // core-js 3 → "Could not resolve"), classlist.js, web-animations-js, intl — desnecessários
  // em navegadores evergreen / Angular moderno. Sem isso o polyfills.ts quebra o build esbuild.
  const legacyPolyfillRe = /^[ \t]*import\s+['"](?:core-js\/(?:es[67]|modules\/es[67])|classlist\.js|web-animations-js|intl(?:\/.*)?)['"];?[ \t]*\r?\n?/gm;
  if (legacyPolyfillRe.test(content)) {
    content = content.replace(legacyPolyfillRe, '');
    writeFileSync(polyfillsPath, content);
    console.log('  ↳ polyfills legados removidos (core-js es6/es7, classlist, intl…)');
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

    // Remove polyfills.ts from all tsconfig*.json files arrays
    const tsconfigFiles = readdirSync(destPath)
      .filter(f => f.startsWith('tsconfig') && f.endsWith('.json'));
    for (const fname of tsconfigFiles) {
      const tsconfigPath = join(destPath, fname);
      try {
        const tscfg = readJson(tsconfigPath);
        if (Array.isArray(tscfg.files)) {
          const before = tscfg.files.length;
          tscfg.files = tscfg.files.filter(f =>
            !String(f).includes('polyfills.ts') && !String(f).includes('polyfills.ngtypecheck.ts')
          );
          if (tscfg.files.length !== before) {
            writeJson(tsconfigPath, tscfg);
            console.log(`  ↳ polyfills.ts removido do ${fname}`);
          }
        }
      } catch { /* ignore malformed tsconfig */ }
    }
    return true;
  }
  return false;
}

// ─── Fix double commas (,, → ,) introduced by standalone migration schematic ─
// The Angular standalone-migration schematic sometimes produces trailing double
// commas (e.g. MatGridListModule,,) in NgModule import/export arrays. These are
// syntax artifacts that can mask other compile errors downstream.
export function fixDoubleCommas() {
  let count = 0;
  walkFiles(join(destPath, 'src'), e => e.endsWith('.ts') || e.endsWith('.html'), (full) => {
    const src = readFileSync(full, 'utf8');
    if (!src.includes(',,')) return;
    const out = src.replace(/,(\s*,)+/g, ',');
    if (out !== src) { writeFileSync(full, out); count++; }
  });
  if (count > 0) console.log(`  ↳ double commas (,,) fixed: ${count} arquivo(s)`);
  return count;
}

// ─── Fix TS2663: bare signal property access without 'this.' ─────────────────
// The signals schematic sometimes converts `this.prop.x` → `prop.x` (drops
// `this.` entirely) instead of the correct `this.prop().x`. TypeScript reports
// TS2663: "Cannot find name 'prop'. Did you mean the instance member 'this.prop'?"
// We run a build to get precise file:line locations, then fix surgically.
export function fixTs2663SignalAccess() {
  const raw = capture('npx ng build --no-progress 2>&1; true');
  let count = 0;
  const lines = raw.split('\n');
  const ts2663Lines = lines.filter(l => l.replace(/\x1b\[[0-9;]*m/g, '').includes('TS2663')).length;
  if (ts2663Lines > 0 || lines.length > 5) {
    console.log(`  ↳ TS2663 scan: ${lines.length} linhas capturadas, ${ts2663Lines} ocorrência(s)`);
  }

  const errors = [];
  for (let i = 0; i < lines.length; i++) {
    const clean = lines[i].replace(/\x1b\[[0-9;]*m/g, '');
    if (!clean.includes('TS2663')) continue;
    const nameMatch = clean.match(/Cannot find name [''](\w+)['']/);
    if (!nameMatch) continue;
    const propName = nameMatch[1];

    // File:line reference is in surrounding context (esbuild multi-line format)
    for (let j = Math.max(0, i - 3); j <= Math.min(lines.length - 1, i + 6); j++) {
      const ref = lines[j].replace(/\x1b\[[0-9;]*m/g, '');
      const m = ref.match(/([^\s:]+\.ts):(\d+):(\d+)/);
      if (m) {
        errors.push({ propName, file: m[1], line: parseInt(m[2]) - 1 });
        break;
      }
    }
  }

  if (!errors.length) return 0;

  // Group by file to batch writes
  const byFile = new Map();
  for (const e of errors) {
    const fullPath = join(destPath, e.file);
    if (!byFile.has(fullPath)) byFile.set(fullPath, []);
    byFile.get(fullPath).push(e);
  }

  for (const [fullPath, errs] of byFile) {
    if (!existsSync(fullPath)) continue;
    const fileLines = readFileSync(fullPath, 'utf8').split('\n');
    let changed = false;
    for (const { propName, line } of errs) {
      if (line >= fileLines.length) continue;
      const original = fileLines[line];
      // Replace propName.x → this.propName().x (not preceded by . or word chars)
      const fixed = original.replace(
        new RegExp(`(?<![.\\w$])(${propName})\\.([A-Za-z_$])`, 'g'),
        `this.${propName}().$2`,
      );
      if (fixed !== original) { fileLines[line] = fixed; changed = true; count++; }
    }
    if (changed) writeFileSync(fullPath, fileLines.join('\n'));
  }

  if (count > 0) console.log(`  ↳ TS2663 bare signal access (prop.x → this.prop().x): ${count} location(s)`);
  return count;
}
