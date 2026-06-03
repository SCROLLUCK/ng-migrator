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

import { renameIdentifiers } from './_lib.mjs';

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
      let out = renameIdentifiers(content, {
        _countGroupLabelsBeforeLegacyOption: '_countGroupLabelsBeforeOption',
        _getLegacyOptionScrollPosition: '_getOptionScrollPosition',
      });
      // Cast `… as NgControl`. Quando há acesso a propriedade depois (`.name`), precisa envolver a
      // expressão receptora INTEIRA em parênteses — `(this.formField._control.ngControl as NgControl).name`
      // — senão o `(` cairia no meio da cadeia. Por isso capturamos o receiver todo, não só `._control…`.
      const RECV = '(?:this|[A-Za-z_$][\\w$]*)(?:\\.[A-Za-z_$][\\w$]*)*\\._control\\.ngControl';
      out = out.replace(new RegExp(`(${RECV})(?!\\s+as\\s+NgControl)(?=\\s*\\.[A-Za-z_$])`, 'g'), '($1 as NgControl)');
      // Sem acesso logo após: cast sufixo simples.
      out = out.replace(new RegExp(`(${RECV})(?!\\s+as\\s+NgControl)(?!\\s*\\.\\w)`, 'g'), '$1 as NgControl');
      return out;
    });
    return { files, summary: `Material API renames + ngControl cast em ${files.length} arquivo(s)` };
  },
};
