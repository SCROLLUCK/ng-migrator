// ─── Correção: ngx-color-picker (NgModule → standalone) ──────────────────────
//
// ngx-color-picker v16+ REMOVEU o `ColorPickerModule`. O color picker virou standalone: a diretiva
// `ColorPickerDirective` (atributo `[colorPicker]`) + `ColorPickerComponent`. Apps que faziam
// `imports: [ColorPickerModule]` quebram com TS2305 ('ColorPickerModule' has no exported member).
// Não há provider de config global — basta importar a diretiva (e o componente, se usado no template).

import { rewriteNamedImport } from './_lib.mjs';

/** @type {import('./index.mjs').Correction} */
export default {
  name: 'ngx-color-picker-standalone',
  description: 'ngx-color-picker v16+: ColorPickerModule → ColorPickerDirective (standalone)',

  /** @param {import('./index.mjs').DetectContext} ctx */
  detect({ raw, codes, hasPackage }) {
    return hasPackage('ngx-color-picker')
      && /ColorPickerModule/.test(raw)
      && (codes.has('TS2305') || codes.has('TS2724') || codes.has('NG6002') || codes.has('NG1010') || codes.has('NG2010'));
  },

  /** @param {import('./index.mjs').ApplyContext} ctx */
  apply({ transformTs }) {
    const files = transformTs((content) => {
      if (!content.includes('ColorPickerModule')) return content;
      let out = rewriteNamedImport(content, 'ngx-color-picker', { add: ['ColorPickerDirective'], remove: ['ColorPickerModule'] });
      out = out.replace(/ColorPickerModule\s*\.\s*for(?:Root|Child)\s*\([^)]*\)/g, 'ColorPickerDirective');
      out = out.replace(/\bColorPickerModule\b/g, 'ColorPickerDirective');
      return out;
    });
    return { files, summary: `ColorPickerModule → ColorPickerDirective em ${files.length} arquivo(s)` };
  },
};
