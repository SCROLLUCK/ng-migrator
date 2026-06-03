// ─── Steps de CORREÇÃO (≠ modernização) ──────────────────────────────────────
//
// Diferente das modernizações (genéricas, regra inviolável), as CORREÇÕES são CIRÚRGICAS e PODEM
// ser específicas de uma lib. Elas consertam erros conhecidos (ex: `NgxMaskModule` removido no
// ngx-mask v15+) — disparadas pelo build-check (e futuramente runtime-check) que detectou o erro.
// Migram a API DE VERDADE (runtime-safe), ao contrário da neutralização (comentar/remover).
//
// EXTENSÍVEL: cada correção é um arquivo `.mjs` auto-contido nesta pasta, auto-descoberto. Adicionar
// uma correção = soltar um arquivo aqui (no futuro, via upload na UI). Veja o template e a doc dos
// campos no README ("Writing a correction") e o exemplo de referência em `ngx-mask.mjs`.
//
// ─── Contrato (formato padrão de toda correção) ──────────────────────────────
//
/**
 * Contexto passado ao `detect()` — somente LEITURA do estado de erro do step atual.
 * @typedef {Object} DetectContext
 * @property {string}  raw              Saída combinada de build (+runtime futuro), sem códigos ANSI.
 * @property {Set<string>} codes        Códigos de erro presentes (ex: `'TS2305'`, `'NG6002'`).
 * @property {number}  angularMajor     Major do Angular deste step (ex: `16`).
 * @property {(name: string) => boolean} hasPackage        O projeto declara este pacote?
 * @property {(name: string) => number}  getInstalledMajor Major instalado de um pacote (0 se ausente).
 */
/**
 * Contexto passado ao `apply()` — helpers de transformação. NÃO importe internals do migrador aqui:
 * use só o ctx (assim uma correção enviada pela UI é portátil e segura).
 * @typedef {Object} ApplyContext
 * @property {string} destPath  Raiz do projeto migrado.
 * @property {string} srcDir    `<destPath>/src`.
 * @property {(fn: (content: string, path: string) => string) => string[]} transformTs
 *   Aplica `fn` a cada `.ts` de `src/` (pula `.spec.ts`). Se `fn` devolver uma string DIFERENTE,
 *   grava o arquivo. Retorna os caminhos (relativos ao projeto) que mudaram.
 * @property {(fn: (content: string, path: string) => string) => string[]} transformHtml
 *   Como `transformTs`, mas para cada `.html` de `src/`. Retorna os caminhos que mudaram.
 * @property {(key: string, value: any) => boolean} setCompilerOption
 *   Garante uma opção em `tsconfig.json` (`compilerOptions[key] = value`). Retorna `true` se mudou.
 * @property {(packages: string[]) => boolean} installDevDeps
 *   Instala devDependencies de forma isolada (Docker, via o mesmo runner do pipeline). Retorna
 *   `true` se rodou. A correção decide O QUE instalar; o ctx cuida de COMO (isolamento).
 */
/**
 * Uma correção. O default export de cada arquivo em `corrections/` deve ter esta forma. Use UM gatilho:
 *  - `detect` (ERROR-DRIVEN): roda quando o erro aparece no build. A maioria. Simples (só ctx) →
 *    portável/UI-uploadable.
 *  - `gate`  (PROATIVO/ceiling): roda numa versão específica ANTES de quebrar (ex: flex-layout no v16,
 *    que não tem versão v16 — esperar o erro = npm install já falhou). Pode ser BUILT-IN/complexa
 *    (importar internals do migrador) — não é uma correção simples de UI.
 * @typedef {Object} Correction
 * @property {string} name         Id único em kebab-case (ex: `'ngx-mask-standalone'`).
 * @property {string} description  Uma linha para o report (o que a correção faz).
 * @property {((ctx: DetectContext) => boolean)} [detect]  ERROR-DRIVEN: ativar para o erro atual?
 * @property {((angularMajor: number) => boolean)} [gate]  PROATIVO: rodar neste major (antes do update)?
 * @property {(ctx: ApplyContext)  => { files: string[], summary: string }} apply  Aplica a correção.
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { capture, run, captureGitDiff, readJson, writeJson } from '../utils.mjs';
import { destPath, report, SKIP_DIRS } from '../context.mjs';
import { hasPackage, getInstalledMajor } from '../packages.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Auto-descobre e carrega todas as correções desta pasta (todo `.mjs` exceto `index.mjs`).
 * Ignora, com aviso, arquivos cujo default export não tem a forma {@link Correction}.
 * @returns {Promise<Correction[]>}
 */
export async function loadCorrections() {
  let files = [];
  try { files = readdirSync(__dirname).filter(f => f.endsWith('.mjs') && f !== 'index.mjs'); } catch { return []; }
  const out = [];
  for (const f of files) {
    try {
      const mod = await import(pathToFileURL(join(__dirname, f)).href);
      const c = mod.default;
      const hasTrigger = typeof c?.detect === 'function' || typeof c?.gate === 'function';
      if (c?.name && hasTrigger && typeof c.apply === 'function') out.push(c);
      else console.log(`  ⚠ correção '${f}' ignorada (formato inválido — precisa de name, apply e detect|gate)`);
    } catch (e) { console.log(`  ⚠ correção '${f}' falhou ao carregar: ${e.message}`); }
  }
  return out;
}

/**
 * Monta o {@link ApplyContext} (o helper `transformTs` + paths) passado a `apply()`.
 * @returns {ApplyContext}
 */
function makeApplyCtx() {
  const srcDir = join(destPath, 'src');
  // Walker genérico: aplica `fn` a cada arquivo de `src/` que casa `match(name)`, grava se mudou.
  const transformFiles = (match, fn) => {
    const changed = [];
    const walk = (dir) => {
      let entries;
      try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const full = join(dir, e.name);
        if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(full); continue; }
        if (!match(e.name)) continue;
        const src = readFileSync(full, 'utf8');
        const out = fn(src, full);
        if (typeof out === 'string' && out !== src) { writeFileSync(full, out); changed.push(relative(destPath, full).replace(/\\/g, '/')); }
      }
    };
    walk(srcDir);
    return changed;
  };
  const transformTs = (fn) => transformFiles((n) => n.endsWith('.ts') && !n.endsWith('.spec.ts'), fn);
  const transformHtml = (fn) => transformFiles((n) => n.endsWith('.html'), fn);
  const installDevDeps = (packages) => {
    if (!packages?.length) return false;
    run(`npm install -D ${packages.map(p => `"${p}"`).join(' ')} --legacy-peer-deps --no-audit --no-fund`, { ignoreError: true });
    return true;
  };
  const setCompilerOption = (key, value) => {
    const tsconfigPath = join(destPath, 'tsconfig.json');
    if (!existsSync(tsconfigPath)) return false;
    try {
      const tc = readJson(tsconfigPath);
      tc.compilerOptions ??= {};
      if (tc.compilerOptions[key] === value) return false;
      tc.compilerOptions[key] = value;
      writeJson(tsconfigPath, tc);
      return true;
    } catch { return false; }
  };
  return { destPath, srcDir, transformTs, transformHtml, setCompilerOption, installDevDeps };
}

/**
 * Builda o projeto, extrai os códigos de erro e roda as correções cujo `detect()` casa. Registra
 * as aplicadas em `report.corrections` (separado de `report.notes`/neutralizado).
 * @param {number} angularMajor  Major do Angular do step atual (entra no {@link DetectContext}).
 * @param {string} [runtimeRaw]  Saída de erro de RUNTIME (ex: `ng serve`/smoke test) — gatilho extra
 *                               além do build, para casos "builda mas crasha". Opcional.
 * @returns {Promise<Array<{ name: string, description: string, summary: string, files: string[], angularMajor: number }>>}
 */
export async function runCorrections(angularMajor, runtimeRaw = '') {
  const corrections = (await loadCorrections()).filter(c => typeof c.detect === 'function');
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

/**
 * Roda as correções PROATIVAS (gatilho `gate`) deste major, ANTES do `ng update`. Diferente do
 * {@link runCorrections} (error-driven, builda e casa por código de erro), estas rodam pela versão
 * — para casos "ceiling" sem versão no major alvo (ex: `@angular/flex-layout`, que não tem v16):
 * esperar o erro seria tarde, o `npm install` do update já teria falhado. Cada correção que mexe
 * na árvore é commitada (`[ng-migrator-step:corrections]`) e seu diff entra em `report.details`.
 * @param {number} angularMajor  Major do Angular que está prestes a subir (entra no `gate`).
 * @returns {Promise<Array<{ name: string, description: string, summary: string, files: string[], angularMajor: number }>>}
 */
export async function runProactiveCorrections(angularMajor) {
  const corrections = (await loadCorrections()).filter(c => typeof c.gate === 'function' && c.gate(angularMajor));
  if (!corrections.length) return [];
  const applyCtx = makeApplyCtx();
  const applied = [];
  for (const c of corrections) {
    try {
      const h0 = capture('git rev-parse HEAD');
      const result = c.apply(applyCtx) || {};
      const dirty = capture('git status --porcelain').trim();
      if (!dirty && !(result.files || []).length) continue; // no-op (ex: projeto não usa a lib)
      run(`git add -A && git commit -m "fix(correção): ${c.name}" -m "[ng-migrator-step:corrections]"`, { ignoreError: true });
      const diff = captureGitDiff(h0, capture('git rev-parse HEAD'));
      report.details[c.name] = diff;
      const files = (result.files || []).length ? result.files : Object.keys(diff);
      console.log(`  🩹 correção proativa '${c.name}': ${result.summary || files.length + ' arquivo(s)'}`);
      applied.push({ name: c.name, description: c.description || '', summary: result.summary || '', files, angularMajor });
    } catch (e) { console.log(`  ⚠ correção '${c.name}' falhou: ${e.message}`); }
  }
  if (applied.length) {
    (report.corrections ??= []).push(...applied);
    report.notes.push(`[ng${angularMajor}] Correções proativas aplicadas: ${applied.map(a => a.name).join(', ')}`);
  }
  return applied;
}
