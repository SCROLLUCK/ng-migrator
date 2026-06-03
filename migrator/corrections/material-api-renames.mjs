// ─── Correção: @angular/material v15 (renames de API + ngControl widening) ────
//
// No Angular Material v15 (MDC), APIs internas foram renomeadas e o tipo de `_control.ngControl`
// foi alargado para `NgControl | AbstractControlDirective` — quebrando código que sobrescreve
// internals do Material:
//   - `_countGroupLabelsBeforeLegacyOption` → `_countGroupLabelsBeforeOption`
//   - `_getLegacyOptionScrollPosition`      → `_getOptionScrollPosition`
//   - `x._control.ngControl` (agora união)  → `(x._control.ngControl as NgControl)`  (TS2322)
// Específico do @angular/material → correção (não modernização). O cast é seguro: em
// MatFormFieldControl, `ngControl`, quando não-nulo, é sempre `NgControl`.

/** @type {import('./index.mjs').Correction} */
export default {
  name: 'material-api-renames',
  description: '@angular/material v15: renames de API privada + ngControl as NgControl',

  /** @param {import('./index.mjs').DetectContext} ctx */
  detect({ raw, hasPackage }) {
    return hasPackage('@angular/material')
      && /(AbstractControlDirective|_countGroupLabelsBeforeLegacyOption|_getLegacyOptionScrollPosition)/.test(raw);
  },

  /** @param {import('./index.mjs').ApplyContext} ctx */
  apply({ transformTs }) {
    const files = transformTs((content) => {
      let out = content;
      out = out.replace(/_countGroupLabelsBeforeLegacyOption/g, '_countGroupLabelsBeforeOption');
      out = out.replace(/_getLegacyOptionScrollPosition/g, '_getOptionScrollPosition');
      // Cast quando seguido por acesso a propriedade (envolve em parênteses p/ não quebrar `x as T.p`).
      out = out.replace(/(\._control\.ngControl)(?!\s+as\s+NgControl)(\.[A-Za-z_$])/g, '($1 as NgControl)$2');
      // Fallback p/ ocorrências sem acesso a propriedade logo após.
      out = out.replace(/(\._control\.ngControl)(?!\s+as\s+NgControl)(?!\s*\.\w)/g, '$1 as NgControl');
      return out;
    });
    return { files, summary: `Material API renames + ngControl cast em ${files.length} arquivo(s)` };
  },
};
