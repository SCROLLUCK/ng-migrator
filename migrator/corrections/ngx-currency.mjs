// ─── Correção: ngx-currency (NgModule → standalone) ──────────────────────────
//
// ngx-currency v3+ (e o 19.x usado em projetos Angular recentes) REMOVEU o `NgxCurrencyModule`.
// A máscara virou a diretiva standalone `NgxCurrencyDirective` e a config global virou o provider
// `provideEnvironmentNgxCurrency()`. Apps NgModule que faziam `imports: [NgxCurrencyModule]` quebram
// com TS2305 ('NgxCurrencyModule' has no exported member) e a cascata de template a jusante.

import { rewriteNamedImport, addProviderToNgModule } from './_lib.mjs';

/** @type {import('./index.mjs').Correction} */
export default {
  name: 'ngx-currency-standalone',
  description: 'ngx-currency v3+: NgxCurrencyModule → NgxCurrencyDirective (standalone) + provideEnvironmentNgxCurrency()',

  /** @param {import('./index.mjs').DetectContext} ctx */
  detect({ raw, codes, hasPackage }) {
    return hasPackage('ngx-currency')
      && /NgxCurrencyModule/.test(raw)
      && (codes.has('TS2305') || codes.has('TS2724') || codes.has('NG6002') || codes.has('NG1010') || codes.has('NG2010'));
  },

  /** @param {import('./index.mjs').ApplyContext} ctx */
  apply({ transformTs }) {
    const files = transformTs((content) => {
      if (!content.includes('NgxCurrencyModule')) return content;
      // Import: remove NgxCurrencyModule, adiciona a diretiva + o provider.
      let out = rewriteNamedImport(content, 'ngx-currency', { add: ['NgxCurrencyDirective', 'provideEnvironmentNgxCurrency'], remove: ['NgxCurrencyModule'] });
      // `imports: [ ... NgxCurrencyModule.forRoot(...) / NgxCurrencyModule ... ]` → diretiva.
      out = out.replace(/NgxCurrencyModule\s*\.\s*for(?:Root|Child)\s*\([^)]*\)/g, 'NgxCurrencyDirective');
      out = out.replace(/\bNgxCurrencyModule\b/g, 'NgxCurrencyDirective');
      // A config global virou provider → garante provideEnvironmentNgxCurrency() nos providers do @NgModule.
      out = addProviderToNgModule(out, 'provideEnvironmentNgxCurrency()');
      return out;
    });
    return { files, summary: `NgxCurrencyModule → NgxCurrencyDirective + provideEnvironmentNgxCurrency() em ${files.length} arquivo(s)` };
  },
};
