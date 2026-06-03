// ─── Steps de CORREÇÃO (≠ modernização) ──────────────────────────────────────
//
// Diferente das modernizações (genéricas, regra inviolável), as CORREÇÕES são CIRÚRGICAS e PODEM
// ser específicas de uma lib. Elas consertam erros conhecidos (ex: `NgxMaskModule` removido no
// ngx-mask v15+) — disparadas pelo build-check (e futuramente runtime-check) que detectou o erro.
//
// EXTENSÍVEL: cada correção é um arquivo `.mjs` auto-contido nesta pasta, auto-descoberto. Adicionar
// uma correção = soltar um arquivo aqui (no futuro, via upload na UI). Formato de cada arquivo:
//
//   export default {
//     name: 'ngx-mask-standalone',
//     description: 'texto p/ o report',
//     detect(ctx) { return boolean },          // ctx: { raw, codes:Set, angularMajor, hasPackage, getInstalledMajor }
//     apply(ctx) { return { files:[...], summary } }, // ctx: { destPath, srcDir, transformTs(fn) }
//   }
//
// `apply` usa SÓ o ctx (não importa internals do migrador) — assim uma correção enviada pela UI é
// segura e portátil.

import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { capture } from '../utils.mjs';
import { destPath, report, SKIP_DIRS } from '../context.mjs';
import { hasPackage, getInstalledMajor } from '../packages.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Auto-descobre e carrega todas as correções desta pasta.
export async function loadCorrections() {
  let files = [];
  try { files = readdirSync(__dirname).filter(f => f.endsWith('.mjs') && f !== 'index.mjs'); } catch { return []; }
  const out = [];
  for (const f of files) {
    try {
      const mod = await import(pathToFileURL(join(__dirname, f)).href);
      const c = mod.default;
      if (c?.name && typeof c.detect === 'function' && typeof c.apply === 'function') out.push(c);
      else console.log(`  ⚠ correção '${f}' ignorada (formato inválido)`);
    } catch (e) { console.log(`  ⚠ correção '${f}' falhou ao carregar: ${e.message}`); }
  }
  return out;
}

// Helper passado às correções: transforma cada .ts de src/ e devolve os arquivos alterados.
function makeApplyCtx() {
  const srcDir = join(destPath, 'src');
  const transformTs = (fn) => {
    const changed = [];
    const walk = (dir) => {
      let entries;
      try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const full = join(dir, e.name);
        if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(full); continue; }
        if (!e.name.endsWith('.ts') || e.name.endsWith('.spec.ts')) continue;
        const src = readFileSync(full, 'utf8');
        const out = fn(src, full);
        if (typeof out === 'string' && out !== src) { writeFileSync(full, out); changed.push(relative(destPath, full).replace(/\\/g, '/')); }
      }
    };
    walk(srcDir);
    return changed;
  };
  return { destPath, srcDir, transformTs };
}

// Builda, extrai os códigos de erro, e roda as correções cujo `detect` casa. Registra em
// report.corrections (separado de "neutralizado"). `runtimeRaw` (opcional) permite disparar por
// erro de RUNTIME no futuro (ex: saída de `ng serve`/smoke test), além do build.
export async function runCorrections(angularMajor, runtimeRaw = '') {
  const corrections = await loadCorrections();
  if (!corrections.length) return [];
  const buildRaw = capture('npx ng build --configuration development 2>&1; true').replace(/\x1b\[[0-9;]*m/g, '');
  const raw = buildRaw + '\n' + runtimeRaw;
  const codes = new Set([...raw.matchAll(/\b((?:TS|NG)\d{4,5})\b/g)].map(m => m[1]));
  if (!codes.size) return []; // sem erro → nada a corrigir
  const detectCtx = { raw, codes, angularMajor, hasPackage, getInstalledMajor };
  const applyCtx = makeApplyCtx();
  const applied = [];
  for (const c of corrections) {
    try {
      if (!c.detect(detectCtx)) continue;
      const result = c.apply(applyCtx) || {};
      const fileList = result.files || [];
      if (fileList.length) {
        console.log(`  🩹 correção '${c.name}': ${result.summary || fileList.length + ' arquivo(s)'}`);
        applied.push({ name: c.name, description: c.description || '', summary: result.summary || '', files: fileList, angularMajor });
      }
    } catch (e) { console.log(`  ⚠ correção '${c.name}' falhou: ${e.message}`); }
  }
  if (applied.length) {
    (report.corrections ??= []).push(...applied);
    report.notes.push(`[ng${angularMajor}] Correções específicas aplicadas (runtime-safe): ${applied.map(a => a.name).join(', ')}`);
  }
  return applied;
}
