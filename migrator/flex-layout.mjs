import {
  readFileSync, writeFileSync, existsSync, readdirSync, statSync,
} from 'fs';
import { join } from 'path';
import { destPath, SKIP_DIRS } from './context.mjs';
import { run } from './utils.mjs';

export function migrateFlexLayoutToTailwind() {
  const srcDir = join(destPath, 'src');

  // ── fxLayout → Tailwind ──────────────────────────────────────────────────

  function fxLayoutToTw(val) {
    const parts = val.trim().split(/\s+/);
    const MAP = { row:'flex', column:'flex flex-col', 'row-reverse':'flex flex-row-reverse', 'column-reverse':'flex flex-col-reverse' };
    const classes = [MAP[parts[0]] ?? 'flex'];
    if (parts.includes('wrap')) classes.push('flex-wrap');
    return classes.join(' ');
  }

  function fxLayoutAlignToTw(val) {
    const [main = '', cross = ''] = val.trim().split(/\s+/);
    const J = { start:'justify-start','flex-start':'justify-start',end:'justify-end','flex-end':'justify-end',center:'justify-center','space-around':'justify-around','space-between':'justify-between','space-evenly':'justify-evenly' };
    const A = { start:'items-start','flex-start':'items-start',end:'items-end','flex-end':'items-end',center:'items-center',stretch:'items-stretch',baseline:'items-baseline' };
    return [J[main], A[cross]].filter(Boolean).join(' ');
  }

  function fxLayoutGapToTw(val) {
    const v = val.trim();
    const px = v.endsWith('px') ? parseFloat(v) : v.endsWith('rem') ? parseFloat(v) * 16 : null;
    if (px !== null) {
      const s = px / 4;
      const VALID = new Set([0,.5,1,1.5,2,2.5,3,3.5,4,5,6,7,8,9,10,11,12,14,16,20,24,28,32,36,40,44,48,52,56,60,64,72,80,96]);
      if (VALID.has(s)) return `gap-${s}`;
    }
    return `gap-[${v}]`;
  }

  function fxFlexToTw(val) {
    const v = (val ?? '').trim();
    if (!v) return 'flex-1';
    const NAMED = { auto:'flex-auto', grow:'flex-grow', nogrow:'grow-0', noshrink:'shrink-0', none:'flex-none', fill:'flex-1 w-full h-full', initial:'flex-initial' };
    if (NAMED[v]) return NAMED[v];
    const n = parseFloat(v.replace('%', ''));
    if (!isNaN(n)) {
      const PCT = { 0:'w-0', 20:'w-1/5', 25:'w-1/4', 33:'w-1/3', 40:'w-2/5', 50:'w-1/2', 60:'w-3/5', 66:'w-2/3', 67:'w-2/3', 75:'w-3/4', 80:'w-4/5', 100:'w-full' };
      return PCT[Math.round(n)] ?? `w-[${Math.round(n)}%]`;
    }
    if (/\s/.test(v)) return `flex-[${v.replace(/\s+/g, '_')}]`;
    return `flex-[${v}]`;
  }

  const BP = { xs:'', sm:'sm:', md:'md:', lg:'lg:', xl:'xl:', '2xl':'2xl:', 'lt-sm':'max-sm:', 'lt-md':'max-md:', 'lt-lg':'max-lg:', 'lt-xl':'max-xl:', 'gt-xs':'sm:', 'gt-sm':'md:', 'gt-md':'lg:', 'gt-lg':'xl:' };

  function withPrefix(classes, bp) {
    const prefix = bp ? (BP[bp] ?? `${bp}:`) : '';
    return prefix ? classes.split(' ').map(c => `${prefix}${c}`).join(' ') : classes;
  }

  // Processa uma tag HTML individual (string), converte fx* → class=""
  function processTag(tag) {
    const classes = [];
    const cleaned = tag.replace(
      /[ \t]+\[?(fx(?:Layout(?:Align|Gap)?|Flex(?:Fill)?|Hide|Show|Fill))(?:\.([a-z0-9-]+))?\]?(?:="([^"]*)")?(?=[\s\/>])/g,
      (_m, name, bp, val) => {
        val = val ?? '';
        let tw = '';
        if      (name === 'fxLayout')                    tw = fxLayoutToTw(val);
        else if (name === 'fxLayoutAlign')               tw = fxLayoutAlignToTw(val);
        else if (name === 'fxLayoutGap')                 tw = fxLayoutGapToTw(val);
        else if (name === 'fxFlex')                      tw = fxFlexToTw(val);
        else if (name === 'fxFlexFill' || name === 'fxFill') tw = 'flex-1 w-full h-full min-h-0 min-w-0';
        else if (name === 'fxHide')                      tw = 'hidden';
        else if (name === 'fxShow')                      tw = 'block';
        if (tw) classes.push(withPrefix(tw, bp));
        return '';
      },
    );
    if (!classes.length) return tag;
    const newCls = classes.join(' ').replace(/\s+/g, ' ').trim();
    // Merge com class existente ou cria novo atributo
    if (/\bclass="/.test(cleaned))
      return cleaned.replace(/class="([^"]*)"/, (_, ex) => `class="${[ex.trim(), newCls].filter(Boolean).join(' ')}"`);
    return cleaned.replace(/^(<[a-zA-Z][a-zA-Z0-9-]*)/, `$1 class="${newCls}"`);
  }

  // Processa o conteúdo de um arquivo HTML convertendo todas as tags com fx*
  function processHtml(content) {
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
  }

  // ── Execução ─────────────────────────────────────────────────────────────

  let htmlCount = 0, tsCount = 0;

  function walkHtml(dir) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { if (!SKIP_DIRS.has(entry)) walkHtml(full); continue; }
      if (!entry.endsWith('.html')) continue;
      const src = readFileSync(full, 'utf8');
      if (!/\bfx[A-Z]/.test(src)) continue;
      const out = processHtml(src);
      if (out !== src) { writeFileSync(full, out); htmlCount++; }
    }
  }

  function walkTs(dir) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { if (!SKIP_DIRS.has(entry)) walkTs(full); continue; }
      if (!entry.endsWith('.ts')) continue;
      let src = readFileSync(full, 'utf8');
      if (!/FlexLayout/.test(src)) continue;
      const before = src;
      src = src.replace(/^import\s*\{[^}]*FlexLayoutModule[^}]*\}\s*from\s*['"]@angular\/flex-layout['"]\s*;?\r?\n?/gm, '');
      src = src.replace(/,?\s*\bFlexLayoutModule\b/g, '');
      src = src.replace(/\bFlexLayoutModule\b\s*,?\s*/g, '');
      if (src !== before) { writeFileSync(full, src); tsCount++; }
    }
  }

  console.log('  ↳ Convertendo atributos fxLayout/fxFlex → classes Tailwind...');
  walkHtml(srcDir);
  walkTs(srcDir);

  // Instala Tailwind CSS v3 (pinned: v4 uses a different config format incompatible with this setup)
  console.log('  ↳ Instalando Tailwind CSS v3...');
  run('npm install -D "tailwindcss@^3" postcss autoprefixer', { ignoreError: true });

  // Detect if project uses ESM ("type": "module" in package.json)
  let projectIsEsm = false;
  try {
    const pkgJson = JSON.parse(readFileSync(join(destPath, 'package.json'), 'utf8'));
    projectIsEsm = pkgJson.type === 'module';
  } catch { /* ignore */ }

  const twConfigName = projectIsEsm ? 'tailwind.config.mjs' : 'tailwind.config.js';
  const configPath = join(destPath, twConfigName);
  if (!existsSync(configPath)) {
    const twContent = projectIsEsm
      ? `/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{html,ts}'],
  theme: { extend: {} },
  plugins: [],
};\n`
      : `/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,ts}'],
  theme: { extend: {} },
  plugins: [],
};\n`;
    writeFileSync(configPath, twContent);
    console.log(`  ↳ ${twConfigName} criado`);
  }

  // Adiciona @tailwind directives no styles global
  for (const name of ['styles.scss', 'styles.css']) {
    const p = join(destPath, 'src', name);
    if (!existsSync(p)) continue;
    const content = readFileSync(p, 'utf8');
    if (!content.includes('@tailwind')) {
      writeFileSync(p, `@tailwind base;\n@tailwind components;\n@tailwind utilities;\n\n${content}`);
      console.log(`  ↳ @tailwind directives adicionadas em src/${name}`);
    }
    break;
  }

  console.log(`  ↳ flex-layout → Tailwind: ${htmlCount} template(s), ${tsCount} TypeScript(s)`);
  return { htmlCount, tsCount };
}
