// ─── Correção ÚNICA do @angular/material: legacy → MDC (v15) … NG8023 (v19) ──────────
//
// O `ng update @angular/material` migra a API básica, mas NÃO cobre: tema/CSS CUSTOM do app,
// vários defaults do MDC, templates (chip/slider), o cast de `ngControl`, nem o crash de timing do
// `_control`. Resultado: build/runtime podem ficar limpos mas a app fica VISUALMENTE quebrada e com
// quebras pontuais — ver MIGRATOR-IMPROVEMENTS.md §1bis/§6.
//
// As quebras do Material acontecem em majors DIFERENTES (api-renames v15, Sass/CSS/templates v15-17,
// NG8023 v19). Uma correção tem UM gatilho, então usamos **`gate: v => v >= 15`** (dispara no topo de
// CADA iteração do loop a partir do v15) + um **apply CIENTE DA VERSÃO** (`ctx.angularMajor`) que
// aplica cada transform só onde é válido/necessário. Tudo é IDEMPOTENTE (re-rodar não duplica). É
// PROATIVA (não dá pra ser error-driven: o estrago é majoritariamente visual, sem código TS/NG → o
// detect nem dispararia). AUTOCONTIDA: só fs/path + o ctx + os helpers de `_lib.mjs`.

import { renameIdentifiers } from './_lib.mjs';

// ═══ helpers Sass ════════════════════════════════════════════════════════════════
function sliceBalanced(content, openIdx, open = '(', close = ')') {
  let depth = 0;
  for (let i = openIdx; i < content.length; i++) {
    if (content[i] === open) depth++;
    else if (content[i] === close) { depth--; if (depth === 0) return content.slice(openIdx, i + 1); }
  }
  return null;
}
function mapValue(mapInner, key) {
  const m = mapInner.match(new RegExp(`(^|,)\\s*${key}\\s*:\\s*([^,]+?)\\s*(,|$)`, 's'));
  return m ? m[2].trim() : null;
}

// ─── #1 theme-map FLAT (M2 antigo) → estrutura aninhada do MDC (§6.5) — v17 ───────────
// Apps com tema custom têm uma @function própria que monta o theme-map À MÃO no formato FLAT
// (`@return (primary:$p, accent:$a, warn:$w, foreground:…)`). O `mat.all-component-themes` do MDC
// exige a chave `color` aninhada — sem ela NENHUM componente recebe cor. Reescreve p/ gerar via
// `mat.m2-define-{light,dark}-theme((color/typography/density))` + `map-merge` das chaves flat extras.
function fixThemeMapFunctions(scss, typography) {
  let out = scss, searchFrom = 0;
  while (true) {
    const retIdx = out.indexOf('@return', searchFrom);
    if (retIdx === -1) break;
    const parenIdx = out.indexOf('(', retIdx);
    if (parenIdx === -1) break;
    if (out.slice(retIdx + 7, parenIdx).trim() !== '') { searchFrom = retIdx + 7; continue; }
    const block = sliceBalanced(out, parenIdx);
    if (!block) { searchFrom = parenIdx + 1; continue; }
    const inner = block.slice(1, -1);
    const isFlatTheme = /\bprimary\s*:/.test(inner) && /\baccent\s*:/.test(inner)
      && /\b(is-dark|foreground|background)\s*:/.test(inner) && !/\bcolor\s*:/.test(inner);
    if (!isFlatTheme) { searchFrom = parenIdx + block.length; continue; }
    const primary = mapValue(inner, 'primary') ?? '$primary';
    const accent = mapValue(inner, 'accent') ?? '$accent';
    const warn = mapValue(inner, 'warn') ?? accent;
    const themeFn = /\bis-dark\s*:\s*true\b/.test(inner) ? 'mat.m2-define-dark-theme' : 'mat.m2-define-light-theme';
    const replacement = `map-merge(\n        ${themeFn}((\n            color: ( primary: ${primary}, accent: ${accent}, warn: ${warn} ),\n            typography: ${typography},\n            density: 0,\n        )),\n        (${inner})\n    )`;
    out = out.slice(0, parenIdx) + replacement + out.slice(parenIdx + block.length);
    searchFrom = parenIdx + replacement.length;
  }
  return out;
}

// ─── #2 typography legada → M2 (§6.7), preservando os TAMANHOS do app — v17 ───────────
const LEGACY_TYPO_LEVELS = {
  'display-4': 'headline-1', 'display-3': 'headline-2', 'display-2': 'headline-3', 'display-1': 'headline-4',
  headline: 'headline-5', title: 'headline-6', 'subheading-2': 'subtitle-1', 'subheading-1': 'subtitle-2',
  'body-2': 'body-1', 'body-1': 'body-2', caption: 'caption', button: 'button',
};
function translateLegacyTypographyCall(scss) {
  let out = scss;
  const re = /mat\.(?:m2-)?define-legacy-typography-config\s*\(/g;
  let m;
  while ((m = re.exec(out)) !== null) {
    const openIdx = out.indexOf('(', m.index);
    const block = sliceBalanced(out, openIdx);
    if (!block) continue;
    let inner = block.slice(1, -1);
    inner = inner.replace(/\$input\s*:\s*mat\.(?:m2-)?define-typography-level\([^)]*\)\s*,?/g, '');
    // SINGLE-PASS (alternação longest-first): evita cascata (`headline`→`headline-5` pegaria o
    // `headline-1` recém-criado de `display-4`).
    const levelRe = new RegExp(`\\$(${Object.keys(LEGACY_TYPO_LEVELS).sort((a, b) => b.length - a.length).join('|')})\\b`, 'g');
    inner = inner.replace(levelRe, (_x, lvl) => `$${LEGACY_TYPO_LEVELS[lvl]}`);
    const replacement = `mat.m2-define-typography-config(${inner})`;
    out = out.slice(0, m.index) + replacement + out.slice(openIdx + block.length);
    re.lastIndex = m.index + replacement.length;
  }
  return out;
}
function findTypographyVar(scss) {
  const m = scss.match(/\$([\w-]+)\s*:\s*mat\.(?:m2-)?define-(?:legacy-)?typography-config\s*\(/);
  return m ? `$${m[1]}` : null;
}

// ─── #3 renames de classe CSS legada → MDC (§6.1) — v15 ──────────────────────────────
const MDC_RENAMED = [
  'card', 'card-content', 'card-title', 'card-subtitle', 'card-header', 'card-footer', 'card-image',
  'card-actions', 'card-avatar', 'card-title-group', 'card-sm-image', 'card-md-image', 'card-lg-image', 'card-xl-image',
  'form-field', 'form-field-infix', 'form-field-flex', 'form-field-prefix', 'form-field-icon-prefix',
  'form-field-hint-wrapper', 'form-field-hint-spacer', 'form-field-subscript-wrapper', 'form-field-error',
  'table', 'header-cell', 'cell', 'header-row', 'row', 'footer-row', 'footer-cell', 'no-data-row',
  'chip', 'chip-remove', 'chip-trailing-icon', 'chip-avatar',
  'tab-group', 'tab-header', 'tab-body', 'tab-body-wrapper', 'tab-header-pagination', 'tab-list', 'tab-labels', 'tab-body-content',
  'menu-item', 'menu-content', 'menu-panel', 'menu-submenu-icon',
  'dialog-content', 'dialog-container', 'dialog-actions', 'dialog-title',
  'list-item', 'nav-list', 'action-list', 'list-item-content', 'list-text', 'subheader',
  'button', 'raised-button', 'flat-button', 'stroked-button', 'icon-button', 'fab', 'mini-fab', 'unelevated-button', 'outlined-button',
  'select', 'select-trigger', 'select-value', 'select-value-text', 'select-arrow', 'select-panel', 'select-placeholder', 'select-min-line',
  'checkbox', 'radio', 'radio-button', 'slide-toggle', 'paginator', 'paginator-container', 'paginator-range-label',
  'option', 'optgroup', 'autocomplete-panel', 'tooltip', 'progress-bar', 'progress-spinner', 'snack-bar',
];
const MDC_STRUCTURAL = new Set([
  'form-field-wrapper', 'form-field-underline', 'form-field-suffix', 'form-field-ripple',
  'form-field-appearance-outline', 'form-field-appearance-legacy', 'form-field-appearance-standard', 'form-field-appearance-fill',
  'button-focus-overlay', 'button-wrapper', 'button-toggle-focus-overlay',
  'chip-list', 'chip-list-wrapper', 'chip-input',
  'tab-label', 'tab-label-active', 'tab-label-content', 'tab-link', 'tab-nav-bar',
]);
const MDC_SPECIAL = { error: 'form-field-error', hint: 'form-field-hint' };
function renameLegacyCssClasses(scss, structuralFound) {
  let out = scss;
  for (const cls of MDC_RENAMED) out = out.replace(new RegExp(`\\.mat-${cls}(?![\\w-])`, 'g'), `.mat-mdc-${cls}`);
  for (const [legacy, mdc] of Object.entries(MDC_SPECIAL)) out = out.replace(new RegExp(`\\.mat-${legacy}(?![\\w-])`, 'g'), `.mat-mdc-${mdc}`);
  for (const cls of MDC_STRUCTURAL) if (new RegExp(`\\.mat-${cls}(?![\\w-])`).test(out)) structuralFound.add(cls);
  return out;
}

// ─── #4 mixins Sass legados → MDC (rede de segurança) — v15 ───────────────────────────
function renameLegacySassApi(scss) {
  let out = scss;
  out = out.replace(/mat\.legacy-core\(/g, 'mat.core(');
  out = out.replace(/mat\.all-legacy-component-themes\(/g, 'mat.all-component-themes(');
  out = out.replace(/mat\.legacy-([a-z-]+)-theme\(/g, 'mat.$1-theme(');
  out = out.replace(/^([ \t]*)@include\s+mat\.(all-legacy-component-typographies|legacy-typography-hierarchy|legacy-[a-z-]+-typography)\b[^;]*;/gm,
    '$1// [ng-migrator] removido no Material v17 (sem equivalente): $&');
  return out;
}

// ─── #5 defaults de comportamento do MDC → look compacto do legacy (§6.7) — v17 ───────
function defaultsBlock(ns) {
  return `

// [ng-migrator] Material MDC — restaura defaults compactos do legacy (MIGRATOR-IMPROVEMENTS §6.7).
// Rodam no FIM do tema (depois de all-component-themes) p/ a density não ser sobrescrita.
@include ${ns}.form-field-density(-2);
// O button-toggle do MDC mostra um ✓ no selecionado (feature NOVA); o legacy não tinha.
.mat-button-toggle-checkbox-wrapper { display: none !important; }
// O MDC reserva ~22px de subscript p/ hint/erro; o legacy não reservava quando válido.
.mat-mdc-form-field-subscript-wrapper { min-height: 0; }
`;
}

// ═══ helpers TS/HTML ═════════════════════════════════════════════════════════════
// ─── #6 renames de API privada + cast de ngControl (§1bis) — v15 ──────────────────────
function fixMaterialApiTs(content) {
  let out = renameIdentifiers(content, {
    _countGroupLabelsBeforeLegacyOption: '_countGroupLabelsBeforeOption',
    _getLegacyOptionScrollPosition: '_getOptionScrollPosition',
  });
  // crash de timing (§5.4): `_control` pode estar undefined no ngOnInit de directives no MDC.
  out = out.replace(/\._control\.ngControl\b/g, '._control?.ngControl');
  // cast `… as NgControl` (ngControl virou união no v15). Captura o RECEIVER inteiro p/ os parênteses
  // não caírem no meio da cadeia. `?.` já pode ter sido inserido acima.
  const RECV = '(?:this|[A-Za-z_$][\\w$]*)(?:\\.[A-Za-z_$][\\w$]*)*\\._control\\??\\.ngControl';
  out = out.replace(new RegExp(`(${RECV})(?!\\s+as\\s+NgControl)(?=\\s*\\.[A-Za-z_$])`, 'g'), '($1 as NgControl)');
  out = out.replace(new RegExp(`(${RECV})(?!\\s+as\\s+NgControl)(?!\\s*\\.\\w)`, 'g'), '$1 as NgControl');
  // garante o import de NgControl se o cast foi inserido (gap conhecido — gerava TS2304)
  if (/\bas NgControl\b/.test(out) && !/\bimport\s*\{[^}]*\bNgControl\b[^}]*\}\s*from\s*['"]@angular\/forms['"]/.test(out)) {
    const formsImp = out.match(/import\s*\{([^}]*)\}\s*from\s*['"]@angular\/forms['"]\s*;?/);
    if (formsImp) out = out.replace(formsImp[0], `import { ${[...new Set(formsImp[1].split(',').map(s => s.trim()).filter(Boolean)).add('NgControl')].join(', ')} } from '@angular/forms';`);
    else { const lastImp = out.lastIndexOf('\nimport '); const nl = out.indexOf('\n', lastImp + 1); out = out.slice(0, nl + 1) + `import { NgControl } from '@angular/forms';\n` + out.slice(nl + 1); }
  }
  return out;
}

// ─── #7 botão com 2+ diretivas de estilo → NG8023 "Multiple components match" — v19 ───
// Mantém a mais específica (icon-button > fab > mini-fab > stroked/raised/flat > button), remove
// as outras. Render igual (a mais específica já vencia), mas vira erro no v19.
const BUTTON_DIRS = ['mat-icon-button', 'mat-mini-fab', 'mat-fab', 'mat-stroked-button', 'mat-flat-button', 'mat-raised-button', 'mat-button'];
function fixButtonMultipleDirectives(html) {
  return html.replace(/<(button|a)\b[^>]*>/g, (tag) => {
    const present = BUTTON_DIRS.filter(d => new RegExp(`(?<![\\w-])${d}(?![\\w-])`).test(tag));
    if (present.length < 2) return tag;
    let out = tag;
    for (const d of present.slice(1)) out = out.replace(new RegExp(`\\s+${d}(?![\\w-])`, 'g'), '');
    return out;
  });
}

// ─── #8 chip-list → chip-grid/chip-set (v17) ─────────────────────────────────────────
// Heurística por arquivo: se há `matChipInputFor` (entrada de chips), o chip-list vira `chip-grid`
// e os `mat-chip` viram `mat-chip-row`; senão (display) vira `chip-set`. Remove `[selectable]`/
// `[removable]` (não existem mais). Best-effort — casos complexos viram nota.
function fixChipList(html) {
  if (!/<mat-chip-list\b/.test(html)) return html;
  const isGrid = /matChipInputFor/.test(html);
  let out = html;
  if (isGrid) {
    out = out.replace(/<mat-chip-list\b/g, '<mat-chip-grid').replace(/<\/mat-chip-list>/g, '</mat-chip-grid>');
    // `(?![-\w])`: `<mat-chip` puro (NÃO `<mat-chip-grid`/`<mat-chip-row`/…) → `<mat-chip-row`.
    out = out.replace(/<mat-chip(?![-\w])/g, '<mat-chip-row').replace(/<\/mat-chip>/g, '</mat-chip-row>');
  } else {
    out = out.replace(/<mat-chip-list\b/g, '<mat-chip-set').replace(/<\/mat-chip-list>/g, '</mat-chip-set>');
  }
  out = out.replace(/\s+\[?(selectable|removable)\]?(?:="[^"]*")?(?=[\s/>])/g, '');
  return out;
}

// ─── #9 slider v17 (self-contained → <mat-slider><input matSliderThumb>) ──────────────
// `<mat-slider [value] [(ngModel)] thumbLabel [min] [max] [step]>` → `<mat-slider discrete [min]
// [max] [step]><input matSliderThumb [value] [(ngModel)]></mat-slider>`. value/ngModel/formControl
// movem p/ o input; thumbLabel→discrete; min/max/step ficam; tickInterval/invert/vertical caem.
// Best-effort (regex sobre a tag de abertura self-closing ou com fechamento simples).
function fixSlider(html) {
  if (!/<mat-slider\b/.test(html)) return html;
  // IDEMPOTÊNCIA: a correção `material` roda a CADA major (gate v>=15 → 15..22). Sem o lookahead
  // `(?!\s*<input\s+matSliderThumb)`, um slider JÁ convertido (`<mat-slider …><input matSliderThumb…>`)
  // re-casa a tag de abertura (o `</mat-slider>` é opcional) e PREPENDE outro `<input matSliderThumb>
  // </mat-slider>` a cada iteração → no orion, 5-6 inputs duplicados num slider. O lookahead pula
  // sliders cujo conteúdo já é o `<input matSliderThumb>` (marca inequívoca de conversão feita).
  return html.replace(/<mat-slider\b([^>]*?)(\/?)>(?!\s*<input\s+matSliderThumb)(?:\s*<\/mat-slider>)?/g, (whole, attrs, selfClose) => {
    const grab = (name) => { const m = attrs.match(new RegExp(`\\s+(\\[?(?:\\(?${name}\\)?)\\]?(?:="[^"]*")?)`)); return m ? m[1] : ''; };
    const thumbAttrs = ['value', 'ngModel', 'formControl', 'formControlName', 'aria-label', 'aria-labelledby']
      .map(grab).filter(Boolean).join(' ');
    let sliderAttrs = attrs
      .replace(/\s+\[?(?:\(?(?:value|ngModel|formControl|formControlName)\)?)\]?(?:="[^"]*")?/g, '')
      .replace(/\s+\[?(tickInterval|invert|vertical)\]?(?:="[^"]*")?/g, '')
      .replace(/\s+\[?thumbLabel\]?(?:="[^"]*")?/g, ' discrete');
    sliderAttrs = sliderAttrs.replace(/\s+/g, ' ').trim();
    return `<mat-slider ${sliderAttrs}><input matSliderThumb ${thumbAttrs.trim()}></mat-slider>`;
  });
}

export default {
  name: 'material',
  description: '@angular/material legacy→MDC (única): API/ngControl (v15), CSS/Sass/templates (v15), theme-map/typography/defaults (v17), NG8023 botão (v19)',
  gate: (angularMajor) => angularMajor >= 15,
  apply(ctx) {
    const v = ctx.angularMajor || 0;
    const done = [];
    const structuralFound = new Set();

    // ── TS: api-renames + ngControl + _control timing (v15+) ──
    const tsFiles = ctx.transformTs((c) => fixMaterialApiTs(c));
    if (tsFiles.length) done.push(`API/ngControl/_control TS em ${tsFiles.length} arquivo(s)`);

    // ── HTML: chip/slider (v15+) e NG8023 botão (v19+) ──
    const htmlFiles = ctx.transformHtml((c) => {
      let out = fixChipList(c);
      out = fixSlider(out);
      if (v >= 19) out = fixButtonMultipleDirectives(out);
      return out;
    });
    if (htmlFiles.length) done.push(`templates (chip/slider${v >= 19 ? '/NG8023' : ''}) em ${htmlFiles.length} arquivo(s)`);

    // ── Sass/CSS: classes+mixins (v15+); theme-map+typography+defaults (v17+) ──
    let typographyVar = null;
    if (v >= 17) ctx.transformStyles((c) => { if (!typographyVar) typographyVar = findTypographyVar(c); return c; });
    const typography = typographyVar || 'mat.m2-define-typography-config()';
    let themeMapFixed = 0, defaultsApplied = 0;
    const styleFiles = ctx.transformStyles((content) => {
      if (!/@use\s+['"]@angular\/material['"]|\.mat-|mat\.(legacy-|all-component-themes|all-legacy|define-legacy)/.test(content)) return content;
      let out = content;
      if (v >= 17) {
        out = translateLegacyTypographyCall(out);
        const afterTheme = fixThemeMapFunctions(out, typography);
        if (afterTheme !== out) themeMapFixed++;
        out = afterTheme;
      }
      out = renameLegacySassApi(out);
      out = renameLegacyCssClasses(out, structuralFound);
      if (v >= 17) {
        const coreMatch = out.match(/@include\s+(\w+)\.core\s*\(/);
        if (coreMatch && !out.includes('[ng-migrator] Material MDC — restaura defaults')) { out += defaultsBlock(coreMatch[1]); defaultsApplied++; }
      }
      return out;
    });
    if (styleFiles.length) {
      const bits = [`CSS/Sass em ${styleFiles.length} arquivo(s)`];
      if (themeMapFixed) bits.push(`theme-map FLAT→MDC${typographyVar ? ` (typography ${typographyVar})` : ''}`);
      if (defaultsApplied) bits.push('defaults compactos');
      done.push(bits.join(', '));
    }
    if (structuralFound.size) done.push(`⚠ classes estruturais sem mapa 1:1 (revisar manual): ${[...structuralFound].sort().join(', ')}`);

    const files = [...new Set([...tsFiles, ...htmlFiles, ...styleFiles])];
    return { files, summary: done.length ? `[ng${v}] ${done.join('; ')}` : 'nenhuma mudança' };
  },
};
