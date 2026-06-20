// ─── Correção: ngx-ui-loader (path /public-api removido) ─────────────────────
//
// Versões antigas do ngx-ui-loader expunham um entry-point profundo `ngx-ui-loader/public-api`.
// Versões recentes (v19) NÃO publicam mais esse caminho — só o entry principal `ngx-ui-loader` —
// então `import { ... } from 'ngx-ui-loader/public-api'` quebra com TS2307 (Cannot find module).
// Os SÍMBOLOS continuam existindo (NgxUiLoaderModule/Service/Config…) no entry principal: a correção
// só reescreve o caminho do módulo, sem mexer nos bindings importados.

/** @type {import('./index.mjs').Correction} */
export default {
  name: 'ngx-ui-loader-path',
  description: "ngx-ui-loader: import de 'ngx-ui-loader/public-api' → 'ngx-ui-loader' (entry-point removido)",

  /** @param {import('./index.mjs').DetectContext} ctx */
  detect({ raw, codes, hasPackage }) {
    return hasPackage('ngx-ui-loader')
      && /ngx-ui-loader\/public-api/.test(raw)
      && codes.has('TS2307');
  },

  /** @param {import('./index.mjs').ApplyContext} ctx */
  apply({ transformTs }) {
    const files = transformTs((content) => {
      if (!content.includes('ngx-ui-loader/public-api')) return content;
      return content.replace(/(['"])ngx-ui-loader\/public-api\1/g, '$1ngx-ui-loader$1');
    });
    return { files, summary: `ngx-ui-loader/public-api → ngx-ui-loader em ${files.length} arquivo(s)` };
  },
};
