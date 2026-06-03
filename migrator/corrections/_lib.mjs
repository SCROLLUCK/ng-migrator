// ─── _lib.mjs — helpers COMPARTILHADOS das correções ─────────────────────────
//
// Para as correções não reinventarem a roda. São utilitários GENÉRICOS e agnósticos ao bug
// (manipular um import, mexer num array de decorator, renomear identificador, editar package.json) —
// NÃO contêm lógica específica de nenhuma lib. Diferente de importar internals do migrador: este
// arquivo faz parte do próprio subsistema de corrections e é autocontido (só `fs`/`path`), então
// continua portátil (uma correção enviada pela UI importaria `./_lib.mjs`, que viaja junto).
//
// Convenção: arquivos com prefixo `_` nesta pasta NÃO são correções (o auto-discovery os ignora).

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ─── Transforms de string TypeScript (recebem e devolvem o conteúdo) ──────────

/**
 * Reescreve um import nomeado de `moduleName`: adiciona e/ou remove símbolos. Se sobrar zero
 * símbolo, remove o import inteiro. No-op se o módulo não é importado por nome. Só age em imports
 * já existentes (não cria um novo — use só quando o módulo já é importado).
 * @param {string} content
 * @param {string} moduleName       Ex: `'ngx-mask'`.
 * @param {{ add?: string[], remove?: string[] }} [opts]
 * @returns {string}
 * @example rewriteNamedImport(src, 'ngx-mask', { add: ['NgxMaskDirective','provideNgxMask'], remove: ['NgxMaskModule'] })
 */
export function rewriteNamedImport(content, moduleName, { add = [], remove = [] } = {}) {
  const re = new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*(['"])${escapeRegExp(moduleName)}\\2\\s*;?`, 'g');
  return content.replace(re, (_full, names, quote) => {
    const symbols = new Set(names.split(',').map(s => s.trim()).filter(Boolean).filter(s => !remove.includes(s)));
    for (const a of add) symbols.add(a);
    if (symbols.size === 0) return '';
    return `import { ${[...symbols].join(', ')} } from ${quote}${moduleName}${quote};`;
  });
}

/**
 * Remove QUALQUER `import … from '<moduleName>'` (default / nomeado / namespace), incluindo a quebra
 * de linha. Use quando o módulo deixou de existir (ex: `@angular/flex-layout`).
 * @param {string} content
 * @param {string} moduleName
 * @returns {string}
 */
export function removeImport(content, moduleName) {
  const re = new RegExp(`^[ \\t]*import\\s+(?:[\\w$]+\\s*,?\\s*)?(?:\\*\\s+as\\s+[\\w$]+|\\{[^}]*\\})?\\s*from\\s*['"]${escapeRegExp(moduleName)}['"]\\s*;?[ \\t]*\\r?\\n?`, 'gm');
  return content.replace(re, '');
}

/**
 * Renomeia identificadores por palavra inteira (`\b`), aplicando cada par `from → to` do mapa.
 * @param {string} content
 * @param {Record<string,string>} map  Ex: `{ _getLegacyOptionScrollPosition: '_getOptionScrollPosition' }`.
 * @returns {string}
 */
export function renameIdentifiers(content, map) {
  let out = content;
  for (const [from, to] of Object.entries(map)) out = out.replace(new RegExp(`\\b${escapeRegExp(from)}\\b`, 'g'), to);
  return out;
}

/**
 * Remove todas as referências NUAS a `symbol` de arrays (limpando vírgulas adjacentes), ex: tirar
 * `FlexLayoutModule` de `imports: [A, FlexLayoutModule, B]`. NÃO mexe no import (use `removeImport`).
 * @param {string} content
 * @param {string} symbol
 * @returns {string}
 */
export function removeSymbolFromArrays(content, symbol) {
  const s = escapeRegExp(symbol);
  let out = content;
  out = out.replace(new RegExp(`\\s*,\\s*\\b${s}\\b`, 'g'), '');  // `, symbol` (vírgula antes)
  out = out.replace(new RegExp(`\\b${s}\\b\\s*,\\s*`, 'g'), '');  // `symbol, ` (vírgula depois)
  out = out.replace(new RegExp(`\\b${s}\\b`, 'g'), '');           // sobra isolada
  // Limpa artefatos de vírgula que possam restar (`[, x]`, `x ,]`, `,,`).
  out = out.replace(/\[\s*,/g, '[').replace(/,\s*\]/g, ']').replace(/,\s*,/g, ',');
  return out;
}

/**
 * Garante uma expressão de provider no array `providers` do `@NgModule` (prepend); cria o array se
 * não existir. No-op se o arquivo não tem `@NgModule` ou se o provider (pela função) já está lá.
 * @param {string} content
 * @param {string} providerExpr  Ex: `'provideNgxMask()'`.
 * @returns {string}
 */
export function addProviderToNgModule(content, providerExpr) {
  if (!/@NgModule\s*\(/.test(content)) return content;
  const fnName = providerExpr.match(/^[A-Za-z_$][\w$]*/)?.[0];
  if (fnName && new RegExp(`${escapeRegExp(fnName)}\\s*\\(`).test(content)) return content; // já presente
  return /providers\s*:\s*\[/.test(content)
    ? content.replace(/providers\s*:\s*\[/, `providers: [${providerExpr}, `)
    : content.replace(/@NgModule\s*\(\s*\{/, full => `${full}\n  providers: [${providerExpr}],`);
}

// ─── package.json ─────────────────────────────────────────────────────────────

/** Lê o `package.json` do projeto migrado. Lança se ausente/inválido. @param {string} destPath */
export function readPackageJson(destPath) {
  return JSON.parse(readFileSync(join(destPath, 'package.json'), 'utf8'));
}

/** Grava o `package.json` (2 espaços + newline final). @param {string} destPath @param {object} pkg */
export function writePackageJson(destPath, pkg) {
  writeFileSync(join(destPath, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
}

/** O projeto declara `name` em deps OU devDeps? @param {string} destPath @param {string} name @returns {boolean} */
export function hasDependency(destPath, name) {
  try { const p = readPackageJson(destPath); return !!(p.dependencies?.[name] || p.devDependencies?.[name]); }
  catch { return false; }
}

/**
 * Remove cada nome de `dependencies`/`devDependencies` e regrava. Lê fresco (caso um install recente
 * tenha reescrito o arquivo). @param {string} destPath @param {string[]} names @returns {string[]} removidos
 */
export function removeDependencies(destPath, names) {
  let pkg;
  try { pkg = readPackageJson(destPath); } catch { return []; }
  const removed = [];
  for (const name of names)
    for (const sec of ['dependencies', 'devDependencies'])
      if (pkg[sec]?.[name]) { delete pkg[sec][name]; removed.push(name); }
  if (removed.length) writePackageJson(destPath, pkg);
  return removed;
}
