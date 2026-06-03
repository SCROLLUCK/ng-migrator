// ─── Correção: moment (namespace import → default import) ─────────────────────
//
// `moment` é um módulo CommonJS callable (`export = moment`). Com `esModuleInterop` LIGADO (o
// migrador liga no modernizeTsconfig), `import * as moment from 'moment'` vira um namespace NÃO
// chamável → `moment(...)` dá `TS2349 "This expression is not callable"`. O fix é usar default
// import (`import moment from 'moment'`), que exige `esModuleInterop` — então também o garantimos.
// Específico do moment → correção (não modernização).

/** @type {import('./index.mjs').Correction} */
export default {
  name: 'moment-default-import',
  description: 'moment: import * as moment → import moment (default, esModuleInterop)',

  /** @param {import('./index.mjs').DetectContext} ctx */
  detect({ raw, codes, hasPackage }) {
    return hasPackage('moment')
      && /moment/.test(raw)
      && (codes.has('TS2349') || codes.has('TS1192') || codes.has('TS2497'));
  },

  /** @param {import('./index.mjs').ApplyContext} ctx */
  apply({ transformTs, setCompilerOption }) {
    const files = transformTs((content) => {
      if (!/import\s+\*\s+as\s+moment\b/.test(content)) return content;
      // Cobre: from 'moment', "moment", 'moment/moment', etc.
      return content.replace(
        /import\s+\*\s+as\s+moment\s+from\s+(['"])moment(?:\/[^'"]+)?\1/g,
        "import moment from 'moment'",
      );
    });
    if (files.length) setCompilerOption('esModuleInterop', true);
    return { files, summary: `import * as moment → default import em ${files.length} arquivo(s)` };
  },
};
