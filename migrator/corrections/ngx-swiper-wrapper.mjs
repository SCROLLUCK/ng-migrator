// Correção: ngx-swiper-wrapper (View Engine, SEM versão Ivy) → swiper-element. gate v16+.
//
// O `ngx-swiper-wrapper` parou no major 10 (View Engine) e NUNCA teve versão Ivy. Com o ngcc
// removido no Angular 16, todo componente que importa o `SwiperModule` vira **NG2012/NG6002**. Na
// prática a migração standalone COPIA o `SwiperModule` pro `imports[]` de quase todo componente
// (re-export do SharedModule) → no orion: 298 NG2012 a partir de UM módulo. A substituição é o
// **swiper-element** (web component oficial): `register()` no main, `<swiper-container>`/
// `<swiper-slide>`, `CUSTOM_ELEMENTS_SCHEMA`, sem NgModule.
//
// PROATIVA (gate v16, como a flex-layout): esperar o erro seria tarde (o npm install do update@16 já
// falharia por não achar candidato Ivy). AUTOCONTIDA: fs/path + ctx + helpers de `_lib.mjs`.
//
// ⚠️ O build fica limpo (remove SwiperModule, converte os elementos, adiciona o schema), MAS a
// CONFIG do carrossel (`[config]`) e a estrutura de slides são RUNTIME — a conversão é best-effort;
// carrosséis complexos (aninhados, ngTemplateOutlet) precisam de validação visual (§2.3).

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { rewriteNamedImport, removeSymbolFromArrays } from './_lib.mjs';

function usesSwiperTemplate(tsContent, tsPath) {
  if (/<swiper\b/.test(tsContent)) return true; // template inline
  try { return /<swiper\b/.test(readFileSync(tsPath.replace(/\.ts$/, '.html'), 'utf8')); } catch { return false; }
}

function addCustomElementsSchema(content) {
  let out = content;
  if (!/\bCUSTOM_ELEMENTS_SCHEMA\b/.test(out)) {
    out = out.replace(/(import\s*\{)([^}]*)(\}\s*from\s*['"]@angular\/core['"])/, (_m, a, n, z) => {
      const set = new Set(n.split(',').map(s => s.trim()).filter(Boolean)); set.add('CUSTOM_ELEMENTS_SCHEMA');
      return `${a} ${[...set].join(', ')} ${z}`;
    });
  }
  if (!/\bschemas\s*:/.test(out)) out = out.replace(/@Component\(\{/, '@Component({\n  schemas: [CUSTOM_ELEMENTS_SCHEMA],');
  return out;
}

export default {
  name: 'ngx-swiper-wrapper-element',
  description: 'ngx-swiper-wrapper (sem Ivy) → swiper-element: remove SwiperModule, <swiper>→<swiper-container>, CUSTOM_ELEMENTS_SCHEMA, register()',
  gate: (angularMajor) => angularMajor >= 16,
  apply(ctx) {
    const pkgPath = join(ctx.destPath, 'package.json');
    if (!existsSync(pkgPath)) return { files: [] };
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    const swSec = pkg.dependencies?.['ngx-swiper-wrapper'] ? 'dependencies'
      : pkg.devDependencies?.['ngx-swiper-wrapper'] ? 'devDependencies' : null;
    if (!swSec) return { files: [], summary: 'ngx-swiper-wrapper não usado' }; // idempotente / no-op

    const changed = [];

    // 1) package.json: remove ngx-swiper-wrapper, sobe swiper p/ ^11 (swiper-element)
    delete pkg[swSec]['ngx-swiper-wrapper'];
    const sSec = pkg.dependencies?.swiper ? 'dependencies' : pkg.devDependencies?.swiper ? 'devDependencies' : 'dependencies';
    (pkg[sSec] ??= {}).swiper = '^11.0.0';
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    changed.push('package.json');

    // 2) main.ts: register() do swiper-element (uma vez)
    const mainPath = join(ctx.srcDir, 'main.ts');
    if (existsSync(mainPath)) {
      let m = readFileSync(mainPath, 'utf8');
      if (!m.includes('swiper/element/bundle')) {
        writeFileSync(mainPath, `import { register as registerSwiperElement } from 'swiper/element/bundle';\nregisterSwiperElement();\n\n${m}`);
        changed.push('src/main.ts');
      }
    }

    // 3) TS: remove SwiperModule (import + imports[]); +CUSTOM_ELEMENTS_SCHEMA onde o template usa <swiper>
    ctx.transformTs((content, path) => {
      const usesTpl = usesSwiperTemplate(content, path);
      if (!content.includes('SwiperModule') && !usesTpl) return content;
      let out = rewriteNamedImport(content, 'ngx-swiper-wrapper', { remove: ['SwiperModule'] });
      out = removeSymbolFromArrays(out, 'SwiperModule');
      if (usesTpl) out = addCustomElementsSchema(out);
      return out;
    }).forEach((f) => changed.push(f));

    // 4) HTML: <swiper>→<swiper-container>, dropa [config] (vai via runtime), slides best-effort
    ctx.transformHtml((content) => {
      if (!/<swiper\b/.test(content)) return content;
      // <swiper>→<swiper-container> + dropa [config] (vai via runtime/ViewChild). Os slides
      // (`<div class="swiper-slide">`) NÃO são convertidos pra `<swiper-slide>` aqui: converter só
      // a tag de abertura por regex deixaria o `</div>` órfão (HTML malformado → erro de build). O
      // div é HTML válido (build limpo); o swiper-element precisa de `<swiper-slide>` p/ renderizar
      // → fica pra validação visual (§2.3).
      return content
        .replace(/<swiper\b/g, '<swiper-container').replace(/<\/swiper>/g, '</swiper-container>')
        .replace(/\s*\[config\]="[^"]*"/g, '');
    }).forEach((f) => changed.push(f));

    return {
      files: [...new Set(changed)],
      summary: `ngx-swiper-wrapper → swiper-element em ${[...new Set(changed)].length} arquivo(s). ⚠ config/slides são RUNTIME — validar visualmente os carrosséis (§2.3).`,
    };
  },
};
