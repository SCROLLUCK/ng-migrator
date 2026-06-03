// Correção PROATIVA (gatilho `gate`) — específica de `@angular/flex-layout`.
//
// Por que proativa e não error-driven: `@angular/flex-layout` foi descontinuado e NUNCA teve versão
// v16+. Subir o projeto para o Angular 16 com ele ainda no `package.json` faz o `npm install` do
// `ng update` falhar (sem candidato) ANTES de qualquer build — não há erro de compilação para um
// `detect` casar. Por isso roda no `gate(v) === 16`, antes do update.
//
// AUTOCONTIDA: toda a lógica de conversão (fxLayout/fxFlex/… → utilitários Tailwind, remoção do
// `FlexLayoutModule`, scaffolding do Tailwind) vive AQUI. A correção não importa nada do migrador —
// só `fs`/`path` (builtins do Node) e os mecanismos GENÉRICOS do ctx (`transformHtml`, `transformTs`,
// `installDevDeps`). Assim a correção é portátil e o conhecimento do bug fica isolado neste arquivo.

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { removeImport, removeSymbolFromArrays, hasDependency, removeDependencies, readPackageJson } from './_lib.mjs';

// ─── fxLayout/fxFlex → classes Tailwind ──────────────────────────────────────

const fxLayoutToTw = (val) => {
  const parts = val.trim().split(/\s+/);
  const MAP = { row: 'flex', column: 'flex flex-col', 'row-reverse': 'flex flex-row-reverse', 'column-reverse': 'flex flex-col-reverse' };
  const classes = [MAP[parts[0]] ?? 'flex'];
  if (parts.includes('wrap')) classes.push('flex-wrap');
  return classes.join(' ');
};

const fxLayoutAlignToTw = (val) => {
  const [main = '', cross = ''] = val.trim().split(/\s+/);
  const J = { start: 'justify-start', 'flex-start': 'justify-start', end: 'justify-end', 'flex-end': 'justify-end', center: 'justify-center', 'space-around': 'justify-around', 'space-between': 'justify-between', 'space-evenly': 'justify-evenly' };
  const A = { start: 'items-start', 'flex-start': 'items-start', end: 'items-end', 'flex-end': 'items-end', center: 'items-center', stretch: 'items-stretch', baseline: 'items-baseline' };
  return [J[main], A[cross]].filter(Boolean).join(' ');
};

const fxLayoutGapToTw = (val) => {
  const v = val.trim();
  const px = v.endsWith('px') ? parseFloat(v) : v.endsWith('rem') ? parseFloat(v) * 16 : null;
  if (px !== null) {
    const s = px / 4;
    const VALID = new Set([0, .5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64, 72, 80, 96]);
    if (VALID.has(s)) return `gap-${s}`;
  }
  return `gap-[${v}]`;
};

const fxFlexToTw = (val) => {
  const v = (val ?? '').trim();
  if (!v) return 'flex-1';
  const NAMED = { auto: 'flex-auto', grow: 'flex-grow', nogrow: 'grow-0', noshrink: 'shrink-0', none: 'flex-none', fill: 'flex-1 w-full h-full', initial: 'flex-initial' };
  if (NAMED[v]) return NAMED[v];
  const n = parseFloat(v.replace('%', ''));
  if (!isNaN(n)) {
    const PCT = { 0: 'w-0', 20: 'w-1/5', 25: 'w-1/4', 33: 'w-1/3', 40: 'w-2/5', 50: 'w-1/2', 60: 'w-3/5', 66: 'w-2/3', 67: 'w-2/3', 75: 'w-3/4', 80: 'w-4/5', 100: 'w-full' };
    return PCT[Math.round(n)] ?? `w-[${Math.round(n)}%]`;
  }
  if (/\s/.test(v)) return `flex-[${v.replace(/\s+/g, '_')}]`;
  return `flex-[${v}]`;
};

const BP = { xs: '', sm: 'sm:', md: 'md:', lg: 'lg:', xl: 'xl:', '2xl': '2xl:', 'lt-sm': 'max-sm:', 'lt-md': 'max-md:', 'lt-lg': 'max-lg:', 'lt-xl': 'max-xl:', 'gt-xs': 'sm:', 'gt-sm': 'md:', 'gt-md': 'lg:', 'gt-lg': 'xl:' };

const withPrefix = (classes, bp) => {
  const prefix = bp ? (BP[bp] ?? `${bp}:`) : '';
  return prefix ? classes.split(' ').map(c => `${prefix}${c}`).join(' ') : classes;
};

// Converte uma única tag HTML (string): fx* → class=""
const processTag = (tag) => {
  const classes = [];
  const cleaned = tag.replace(
    /[ \t]+\[?(fx(?:Layout(?:Align|Gap)?|Flex(?:Fill)?|Hide|Show|Fill))(?:\.([a-z0-9-]+))?\]?(?:="([^"]*)")?(?=[\s/>])/g,
    (_m, name, bp, val) => {
      val = val ?? '';
      let tw = '';
      if (name === 'fxLayout') tw = fxLayoutToTw(val);
      else if (name === 'fxLayoutAlign') tw = fxLayoutAlignToTw(val);
      else if (name === 'fxLayoutGap') tw = fxLayoutGapToTw(val);
      else if (name === 'fxFlex') tw = fxFlexToTw(val);
      else if (name === 'fxFlexFill' || name === 'fxFill') tw = 'flex-1 w-full h-full min-h-0 min-w-0';
      else if (name === 'fxHide') tw = 'hidden';
      else if (name === 'fxShow') tw = 'block';
      if (tw) classes.push(withPrefix(tw, bp));
      return '';
    },
  );
  if (!classes.length) return tag;
  const newCls = classes.join(' ').replace(/\s+/g, ' ').trim();
  if (/\bclass="/.test(cleaned))
    return cleaned.replace(/class="([^"]*)"/, (_, ex) => `class="${[ex.trim(), newCls].filter(Boolean).join(' ')}"`);
  return cleaned.replace(/^(<[a-zA-Z][a-zA-Z0-9-]*)/, `$1 class="${newCls}"`);
};

// Converte todas as tags com fx* de um arquivo HTML (parser leve, respeita strings de atributo).
const processHtml = (content) => {
  let out = '';
  let i = 0;
  while (i < content.length) {
    if (content[i] === '<' && /[a-zA-Z]/.test(content[i + 1] ?? '')) {
      let j = i + 1;
      let inStr = false, sc = '';
      while (j < content.length) {
        const c = content[j];
        if (inStr) { if (c === sc) inStr = false; }
        else if (c === '"' || c === "'") { inStr = true; sc = c; }
        else if (c === '>') { j++; break; }
        j++;
      }
      const tag = content.slice(i, j);
      out += /\bfx[A-Z]/.test(tag) ? processTag(tag) : tag;
      i = j;
    } else {
      out += content[i++];
    }
  }
  return out;
};

/** @type {import('./index.mjs').Correction} */
export default {
  name: 'angular-flex-layout-tailwind',
  description: '@angular/flex-layout (sem versão v16+) → utilitários Tailwind: converte templates, remove FlexLayoutModule e o pacote',

  /**
   * Proativa: roda ao subir para o v16 (último major antes de o pacote ficar sem candidato).
   * @param {number} angularMajor
   */
  gate: (angularMajor) => angularMajor === 16,

  /**
   * @param {import('./index.mjs').ApplyContext} ctx
   */
  apply: ({ destPath, transformHtml, transformTs, installDevDeps }) => {
    // Guard: só age se o projeto realmente depende de @angular/flex-layout. Sem isso, instalaríamos
    // Tailwind e criaríamos tailwind.config em QUALQUER projeto migrado.
    if (!hasDependency(destPath, '@angular/flex-layout')) return { files: [], summary: '' };

    // 1) templates: fxLayout/fxFlex/… → classes Tailwind
    const htmlFiles = transformHtml((src) => (/\bfx[A-Z]/.test(src) ? processHtml(src) : src));

    // 2) módulos .ts: remove o import e as referências a FlexLayoutModule
    const tsFiles = transformTs((src) => {
      if (!/FlexLayout/.test(src)) return src;
      return removeSymbolFromArrays(removeImport(src, '@angular/flex-layout'), 'FlexLayoutModule');
    });

    // 3) Tailwind v3 (v4 usa um formato de config incompatível com este setup)
    installDevDeps(['tailwindcss@^3', 'postcss', 'autoprefixer']);

    // 4) tailwind.config (respeita ESM se o package.json tem "type": "module")
    let projectIsEsm = false;
    try { projectIsEsm = readPackageJson(destPath).type === 'module'; } catch { /* ignore */ }
    const twConfigName = projectIsEsm ? 'tailwind.config.mjs' : 'tailwind.config.js';
    const configPath = join(destPath, twConfigName);
    if (!existsSync(configPath)) {
      const body = `{\n  content: ['./src/**/*.{html,ts}'],\n  theme: { extend: {} },\n  plugins: [],\n}`;
      writeFileSync(configPath, `/** @type {import('tailwindcss').Config} */\n${projectIsEsm ? 'export default ' + body : 'module.exports = ' + body};\n`);
    }

    // 5) diretivas @tailwind no styles global
    for (const name of ['styles.scss', 'styles.css']) {
      const p = join(destPath, 'src', name);
      if (!existsSync(p)) continue;
      const content = readFileSync(p, 'utf8');
      if (!content.includes('@tailwind'))
        writeFileSync(p, `@tailwind base;\n@tailwind components;\n@tailwind utilities;\n\n${content}`);
      break;
    }

    // 6) remove @angular/flex-layout do package.json (lê fresco — o install do Tailwind o reescreveu)
    removeDependencies(destPath, ['@angular/flex-layout']);

    const files = [...htmlFiles, ...tsFiles];
    return { files, summary: `flex-layout → Tailwind (${htmlFiles.length} template(s), ${tsFiles.length} módulo(s))` };
  },
};
