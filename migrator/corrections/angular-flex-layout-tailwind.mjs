// Correção PROATIVA (gatilho `gate`) — específica de `@angular/flex-layout`.
//
// Por que proativa e não error-driven: `@angular/flex-layout` foi descontinuado e NUNCA teve versão
// v16+. Subir o projeto para o Angular 16 com ele ainda no `package.json` faz o `npm install` do
// `ng update` falhar (sem candidato) ANTES de qualquer build — não há erro de compilação para um
// `detect` casar. Por isso roda no `gate(v) === 16`, antes do update: converte os templates
// (`fxLayout`/`fxFlex`/… → utilitários Tailwind), remove `FlexLayoutModule` dos módulos e tira o
// pacote do `package.json`. No-op se o projeto não usa flex-layout.
//
// É uma correção BUILT-IN/complexa: ao contrário das correções simples error-driven (que usam só o
// ApplyContext), esta importa um internal do migrador (`migrateFlexLayoutToTailwind`), porque a
// conversão envolve templates + módulos + package.json + Tailwind — além do `transformTs`. Built-in
// corrections podem usar internals; correções enviadas pela UI devem ficar no ctx.

import { migrateFlexLayoutToTailwind } from '../flex-layout.mjs';
import { report } from '../context.mjs';

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
   * Delega à conversão self-contida; o runner cuida do commit e do diff. Seta
   * `report.modernize.flexLayoutMigrated` para back-compat do dashboard e para a rede de segurança
   * de modernização (`flexLayout`) pular quando já feito aqui.
   */
  apply: () => {
    const fl = migrateFlexLayoutToTailwind();
    if (!fl.htmlCount && !fl.tsCount) return { files: [], summary: '' };
    report.modernize.flexLayoutMigrated = fl;
    return { files: [], summary: `flex-layout → Tailwind (${fl.htmlCount} template(s), ${fl.tsCount} módulo(s))` };
  },
};
