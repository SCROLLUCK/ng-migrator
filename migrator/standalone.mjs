import { parseTemplate } from '@angular/compiler';
import { Project, SyntaxKind } from 'ts-morph';
import {
  readFileSync, writeFileSync, existsSync, readdirSync, statSync,
} from 'fs';
import { join, dirname, basename, relative, resolve } from 'path';
import { destPath, SKIP_DIRS } from './context.mjs';

// ─── Shared helpers: template import detection (NgModule + standalone) ──────────

export const TMPL_ELEM = {
  'mat-autocomplete':        { sym: 'MatAutocompleteModule',      pkg: '@angular/material/autocomplete' },
  'mat-option':              { sym: 'MatOptionModule',            pkg: '@angular/material/core' },
  'mat-optgroup':            { sym: 'MatOptionModule',            pkg: '@angular/material/core' },
  'mat-button-toggle':       { sym: 'MatButtonToggleModule',      pkg: '@angular/material/button-toggle' },
  'mat-button-toggle-group': { sym: 'MatButtonToggleModule',      pkg: '@angular/material/button-toggle' },
  'mat-card':                { sym: 'MatCardModule',              pkg: '@angular/material/card' },
  'mat-card-header':         { sym: 'MatCardModule',              pkg: '@angular/material/card' },
  'mat-card-content':        { sym: 'MatCardModule',              pkg: '@angular/material/card' },
  'mat-card-actions':        { sym: 'MatCardModule',              pkg: '@angular/material/card' },
  'mat-card-footer':         { sym: 'MatCardModule',              pkg: '@angular/material/card' },
  'mat-card-title':          { sym: 'MatCardModule',              pkg: '@angular/material/card' },
  'mat-card-subtitle':       { sym: 'MatCardModule',              pkg: '@angular/material/card' },
  'mat-checkbox':            { sym: 'MatCheckboxModule',          pkg: '@angular/material/checkbox' },
  'mat-chip':                { sym: 'MatChipsModule',             pkg: '@angular/material/chips' },
  'mat-chip-list':           { sym: 'MatChipsModule',             pkg: '@angular/material/chips' },
  'mat-chip-listbox':        { sym: 'MatChipsModule',             pkg: '@angular/material/chips' },
  'mat-chip-grid':           { sym: 'MatChipsModule',             pkg: '@angular/material/chips' },
  'mat-datepicker':          { sym: 'MatDatepickerModule',        pkg: '@angular/material/datepicker' },
  'mat-datepicker-toggle':   { sym: 'MatDatepickerModule',        pkg: '@angular/material/datepicker' },
  'mat-calendar':            { sym: 'MatDatepickerModule',        pkg: '@angular/material/datepicker' },
  'mat-dialog-content':      { sym: 'MatDialogModule',            pkg: '@angular/material/dialog' },
  'mat-dialog-actions':      { sym: 'MatDialogModule',            pkg: '@angular/material/dialog' },
  'mat-dialog-title':        { sym: 'MatDialogModule',            pkg: '@angular/material/dialog' },
  'mat-divider':             { sym: 'MatDividerModule',           pkg: '@angular/material/divider' },
  'mat-expansion-panel':     { sym: 'MatExpansionModule',         pkg: '@angular/material/expansion' },
  'mat-accordion':           { sym: 'MatExpansionModule',         pkg: '@angular/material/expansion' },
  'mat-expansion-panel-header': { sym: 'MatExpansionModule',      pkg: '@angular/material/expansion' },
  'mat-panel-title':         { sym: 'MatExpansionModule',         pkg: '@angular/material/expansion' },
  'mat-panel-description':   { sym: 'MatExpansionModule',         pkg: '@angular/material/expansion' },
  'mat-form-field':          { sym: 'MatFormFieldModule',         pkg: '@angular/material/form-field' },
  'mat-label':               { sym: 'MatFormFieldModule',         pkg: '@angular/material/form-field' },
  'mat-error':               { sym: 'MatFormFieldModule',         pkg: '@angular/material/form-field' },
  'mat-hint':                { sym: 'MatFormFieldModule',         pkg: '@angular/material/form-field' },
  'mat-grid-list':           { sym: 'MatGridListModule',          pkg: '@angular/material/grid-list' },
  'mat-grid-tile':           { sym: 'MatGridListModule',          pkg: '@angular/material/grid-list' },
  'mat-icon':                { sym: 'MatIconModule',              pkg: '@angular/material/icon' },
  'mat-list':                { sym: 'MatListModule',              pkg: '@angular/material/list' },
  'mat-nav-list':            { sym: 'MatListModule',              pkg: '@angular/material/list' },
  'mat-action-list':         { sym: 'MatListModule',              pkg: '@angular/material/list' },
  'mat-list-item':           { sym: 'MatListModule',              pkg: '@angular/material/list' },
  'mat-selection-list':      { sym: 'MatListModule',              pkg: '@angular/material/list' },
  'mat-list-option':         { sym: 'MatListModule',              pkg: '@angular/material/list' },
  'mat-menu':                { sym: 'MatMenuModule',              pkg: '@angular/material/menu' },
  'mat-paginator':           { sym: 'MatPaginatorModule',         pkg: '@angular/material/paginator' },
  'mat-progress-bar':        { sym: 'MatProgressBarModule',       pkg: '@angular/material/progress-bar' },
  'mat-progress-spinner':    { sym: 'MatProgressSpinnerModule',   pkg: '@angular/material/progress-spinner' },
  'mat-spinner':             { sym: 'MatProgressSpinnerModule',   pkg: '@angular/material/progress-spinner' },
  'mat-radio-button':        { sym: 'MatRadioModule',             pkg: '@angular/material/radio' },
  'mat-radio-group':         { sym: 'MatRadioModule',             pkg: '@angular/material/radio' },
  'mat-select':              { sym: 'MatSelectModule',            pkg: '@angular/material/select' },
  'mat-sidenav':             { sym: 'MatSidenavModule',           pkg: '@angular/material/sidenav' },
  'mat-sidenav-container':   { sym: 'MatSidenavModule',           pkg: '@angular/material/sidenav' },
  'mat-sidenav-content':     { sym: 'MatSidenavModule',           pkg: '@angular/material/sidenav' },
  'mat-drawer':              { sym: 'MatSidenavModule',           pkg: '@angular/material/sidenav' },
  'mat-slide-toggle':        { sym: 'MatSlideToggleModule',       pkg: '@angular/material/slide-toggle' },
  'mat-slider':              { sym: 'MatSliderModule',            pkg: '@angular/material/slider' },
  'mat-sort-header':         { sym: 'MatSortModule',              pkg: '@angular/material/sort' },
  'mat-step':                { sym: 'MatStepperModule',           pkg: '@angular/material/stepper' },
  'mat-stepper':             { sym: 'MatStepperModule',           pkg: '@angular/material/stepper' },
  'mat-horizontal-stepper':  { sym: 'MatStepperModule',           pkg: '@angular/material/stepper' },
  'mat-vertical-stepper':    { sym: 'MatStepperModule',           pkg: '@angular/material/stepper' },
  'mat-table':               { sym: 'MatTableModule',             pkg: '@angular/material/table' },
  'mat-header-cell':         { sym: 'MatTableModule',             pkg: '@angular/material/table' },
  'mat-cell':                { sym: 'MatTableModule',             pkg: '@angular/material/table' },
  'mat-footer-cell':         { sym: 'MatTableModule',             pkg: '@angular/material/table' },
  'mat-header-row':          { sym: 'MatTableModule',             pkg: '@angular/material/table' },
  'mat-row':                 { sym: 'MatTableModule',             pkg: '@angular/material/table' },
  'mat-footer-row':          { sym: 'MatTableModule',             pkg: '@angular/material/table' },
  'mat-tab':                 { sym: 'MatTabsModule',              pkg: '@angular/material/tabs' },
  'mat-tab-group':           { sym: 'MatTabsModule',              pkg: '@angular/material/tabs' },
  'mat-tab-nav-bar':         { sym: 'MatTabsModule',              pkg: '@angular/material/tabs' },
  'mat-toolbar':             { sym: 'MatToolbarModule',           pkg: '@angular/material/toolbar' },
  'mat-toolbar-row':         { sym: 'MatToolbarModule',           pkg: '@angular/material/toolbar' },
  'mat-tooltip':             { sym: 'MatTooltipModule',           pkg: '@angular/material/tooltip' },
  'mat-tree':                { sym: 'MatTreeModule',              pkg: '@angular/material/tree' },
  'mat-tree-node':           { sym: 'MatTreeModule',              pkg: '@angular/material/tree' },
  'mat-nested-tree-node':    { sym: 'MatTreeModule',              pkg: '@angular/material/tree' },
  'router-outlet':           { sym: 'RouterOutlet',               pkg: '@angular/router' },
  'cdk-virtual-scroll-viewport': { sym: 'ScrollingModule',        pkg: '@angular/cdk/scrolling' },
  // Third-party
  'ng-progress':             { sym: 'NgProgressModule',           pkg: '@ngx-progressbar/core' },
  'ngx-ui-loader':           { sym: 'NgxUiLoaderModule',          pkg: 'ngx-ui-loader' },
  'ngx-spinner':             { sym: 'NgxSpinnerModule',           pkg: 'ngx-spinner' },
  'webcam':                  { sym: 'WebcamModule',               pkg: 'ngx-webcam' },
};

export const TMPL_ATTR = {
  'matTooltip':              { sym: 'MatTooltipModule',           pkg: '@angular/material/tooltip' },
  'matMenuTriggerFor':       { sym: 'MatMenuModule',              pkg: '@angular/material/menu' },
  'matSort':                 { sym: 'MatSortModule',              pkg: '@angular/material/sort' },
  'matSortHeader':           { sym: 'MatSortModule',              pkg: '@angular/material/sort' },
  'matColumnDef':            { sym: 'MatTableModule',             pkg: '@angular/material/table' },
  'matHeaderCellDef':        { sym: 'MatTableModule',             pkg: '@angular/material/table' },
  'matCellDef':              { sym: 'MatTableModule',             pkg: '@angular/material/table' },
  'matFooterCellDef':        { sym: 'MatTableModule',             pkg: '@angular/material/table' },
  'matHeaderRowDef':         { sym: 'MatTableModule',             pkg: '@angular/material/table' },
  'matRowDef':               { sym: 'MatTableModule',             pkg: '@angular/material/table' },
  'matFooterRowDef':         { sym: 'MatTableModule',             pkg: '@angular/material/table' },
  'matInput':                { sym: 'MatInputModule',             pkg: '@angular/material/input' },
  'matNativeControl':        { sym: 'MatInputModule',             pkg: '@angular/material/input' },
  'mat-button':              { sym: 'MatButtonModule',            pkg: '@angular/material/button' },
  'mat-raised-button':       { sym: 'MatButtonModule',            pkg: '@angular/material/button' },
  'mat-flat-button':         { sym: 'MatButtonModule',            pkg: '@angular/material/button' },
  'mat-stroked-button':      { sym: 'MatButtonModule',            pkg: '@angular/material/button' },
  'mat-icon-button':         { sym: 'MatButtonModule',            pkg: '@angular/material/button' },
  'mat-fab':                 { sym: 'MatButtonModule',            pkg: '@angular/material/button' },
  'mat-mini-fab':            { sym: 'MatButtonModule',            pkg: '@angular/material/button' },
  'mat-dialog-close':        { sym: 'MatDialogModule',            pkg: '@angular/material/dialog' },
  'matDialogClose':          { sym: 'MatDialogModule',            pkg: '@angular/material/dialog' },
  'ngClass':                 { sym: 'NgClass',                    pkg: '@angular/common' },
  'ngStyle':                 { sym: 'NgStyle',                    pkg: '@angular/common' },
  'matLine':                 { sym: 'MatListModule',              pkg: '@angular/material/list' },
  'matListIcon':             { sym: 'MatListModule',              pkg: '@angular/material/list' },
  'routerLink':              { sym: 'RouterLink',                 pkg: '@angular/router' },
  'routerLinkActive':        { sym: 'RouterLinkActive',           pkg: '@angular/router' },
  'cdkScrollable':           { sym: 'ScrollingModule',            pkg: '@angular/cdk/scrolling' },
};

export const TMPL_PIPE = {
  'translate':    { sym: 'TranslateModule',   pkg: '@ngx-translate/core' },
  'async':        { sym: 'AsyncPipe',        pkg: '@angular/common' },
  'date':         { sym: 'DatePipe',         pkg: '@angular/common' },
  'currency':     { sym: 'CurrencyPipe',     pkg: '@angular/common' },
  'decimal':      { sym: 'DecimalPipe',      pkg: '@angular/common' },
  'percent':      { sym: 'PercentPipe',      pkg: '@angular/common' },
  'uppercase':    { sym: 'UpperCasePipe',    pkg: '@angular/common' },
  'lowercase':    { sym: 'LowerCasePipe',    pkg: '@angular/common' },
  'titlecase':    { sym: 'TitleCasePipe',    pkg: '@angular/common' },
  'slice':        { sym: 'SlicePipe',        pkg: '@angular/common' },
  'json':         { sym: 'JsonPipe',         pkg: '@angular/common' },
  'keyvalue':     { sym: 'KeyValuePipe',     pkg: '@angular/common' },
  'number':       { sym: 'DecimalPipe',      pkg: '@angular/common' },
  'i18nPlural':   { sym: 'I18nPluralPipe',   pkg: '@angular/common' },
  'i18nSelect':   { sym: 'I18nSelectPipe',   pkg: '@angular/common' },
};

export function tmplPkgInstalled(pkg) {
  const nmDir = join(destPath, 'node_modules');
  const parts = pkg.split('/');
  const p = pkg.startsWith('@') ? join(nmDir, parts[0], parts[1]) : join(nmDir, parts[0]);
  return existsSync(p);
}

export function tmplGetTemplate(tsFile, src) {
  const inlineM = src.match(/template\s*:\s*(`(?:[^`\\]|\\.|\n)*?`|'(?:[^'\\]|\\.)*?'|"(?:[^"\\]|\\.)*?")/s);
  if (inlineM) return inlineM[1].slice(1, -1);
  const urlM = src.match(/templateUrl\s*:\s*['"]([^'"]+)['"]/);
  if (urlM) {
    const p = join(dirname(tsFile), urlM[1]);
    if (existsSync(p)) return readFileSync(p, 'utf8');
  }
  return null;
}

export function tmplDetectNeeded(tpl, tsFilePath = 'template.html') {
  const needed = new Map();

  // ── AST-based detection (elements + attribute bindings) ────────────────────
  try {
    const ast = parseTemplate(tpl, tsFilePath, { preserveWhitespaces: false });
    function visitNode(node) {
      if (!node) return;
      // Element names: <mat-card>, <router-outlet>, etc.
      if (node.name) {
        const e = TMPL_ELEM[node.name];
        if (e && tmplPkgInstalled(e.pkg)) needed.set(e.sym, e.pkg);
      }
      // Attribute / input / output names: matInput, routerLink, matTooltip, etc.
      const tokens = [
        ...(node.attributes ?? []),
        ...(node.inputs ?? []),
        ...(node.outputs ?? []),
        ...(node.references ?? []),
      ];
      for (const t of tokens) {
        const a = TMPL_ATTR[t.name];
        if (a && tmplPkgInstalled(a.pkg)) needed.set(a.sym, a.pkg);
      }
      if (node.children) for (const c of node.children) visitNode(c);
    }
    for (const node of ast.nodes) visitNode(node);
  } catch {
    // Fallback: regex scan (handles malformed / partial templates)
    const elemKeys = Object.keys(TMPL_ELEM).map(k => k.replace(/[-[\]]/g, '\\$&')).join('|');
    const elemRe = new RegExp(`<(${elemKeys})[\\s\\/>]`, 'g');
    let m;
    while ((m = elemRe.exec(tpl)) !== null) {
      const e = TMPL_ELEM[m[1]];
      if (e && tmplPkgInstalled(e.pkg)) needed.set(e.sym, e.pkg);
    }
    for (const [attr, { sym, pkg }] of Object.entries(TMPL_ATTR)) {
      if (!tmplPkgInstalled(pkg)) continue;
      const esc = attr.replace(/[-[\]]/g, '\\$&');
      if (new RegExp(`(?:[\\s\\["])${esc}(?:[\\s=\\]">/])`).test(tpl)) needed.set(sym, pkg);
    }
  }

  // ── Pipe detection (regex — pipe expressions live inside {{ }} / ternaries) ─
  const pipeRe = /\|\s*([\w]+)/g;
  let pm;
  while ((pm = pipeRe.exec(tpl)) !== null) {
    const p = TMPL_PIPE[pm[1]];
    if (p && tmplPkgInstalled(p.pkg)) needed.set(p.sym, p.pkg);
  }

  // ── Form directives (regex — attributes on any element, including dynamic) ──
  if (/\(\s*ngModel\s*\)|\bngModel\b/.test(tpl)) needed.set('FormsModule', '@angular/forms');
  if (/\[formControl\]|\bformControlName\b|\[formGroup\]|\bformGroupName\b|\bformArrayName\b/.test(tpl)) {
    needed.set('ReactiveFormsModule', '@angular/forms');
  }

  return needed;
}

// ─── Índice de componentes/directives standalone do próprio projeto ────────────
let _internalProjectIndex = null;

export function invalidateProjectIndex() {
  _internalProjectIndex = null;
}

export function buildInternalProjectIndex() {
  if (_internalProjectIndex) return _internalProjectIndex;
  const tsconfigPath = join(destPath, 'tsconfig.json');
  if (!existsSync(tsconfigPath)) { _internalProjectIndex = new Map(); return _internalProjectIndex; }
  try {
    const project = new Project({ tsConfigFilePath: tsconfigPath, skipAddingFilesFromTsConfig: false });
    const index = new Map();
    for (const sf of project.getSourceFiles()) {
      const filePath = sf.getFilePath();
      if (!filePath.includes('/src/')) continue;
      for (const cls of sf.getClasses()) {
        const dec = cls.getDecorator('Component') ?? cls.getDecorator('Directive') ?? cls.getDecorator('Pipe');
        if (!dec) continue;
        const args = dec.getArguments();
        if (!args.length || !args[0].isKind(SyntaxKind.ObjectLiteralExpression)) continue;
        const objLit = args[0];
        // Only index standalone declarations
        const standaloneProp = objLit.getProperty('standalone');
        if (!standaloneProp || !/\btrue\b/.test(standaloneProp.getText())) continue;
        const className = cls.getName();
        if (!className) continue;
        // Get selector (Component/Directive) or name (Pipe)
        const selectorProp = objLit.getProperty('selector') ?? objLit.getProperty('name');
        if (!selectorProp || !selectorProp.isKind(SyntaxKind.PropertyAssignment)) continue;
        const raw = selectorProp.getInitializer()?.getText().replace(/['"`]/g, '').trim() ?? '';
        for (const sel of raw.split(',').map(s => s.trim()).filter(Boolean)) {
          index.set(sel, { symbol: className, filePath });
        }
      }
    }
    _internalProjectIndex = index;
    console.log(`  ↳ índice interno: ${index.size} selector(es) standalone mapeado(s)`);
  } catch (e) {
    console.log(`  ↳ índice interno: falha ao carregar AST (${e.message?.slice(0, 60)}), pulando`);
    _internalProjectIndex = new Map();
  }
  return _internalProjectIndex;
}

export function tmplGetDecoratorImportsArray(src, decoratorRe) {
  const compIdx = src.search(decoratorRe);
  if (compIdx === -1) return null;
  let depth = 0, compEnd = -1;
  for (let i = src.indexOf('(', compIdx); i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') { if (--depth === 0) { compEnd = i; break; } }
  }
  if (compEnd === -1) return null;
  const decBody = src.slice(compIdx, compEnd + 1);
  const imM = decBody.match(/\bimports\s*:\s*\[/);
  if (!imM) return null;
  const arrStart = compIdx + imM.index + imM[0].length - 1;
  let bdepth = 0, arrEnd = -1;
  for (let i = arrStart; i < src.length; i++) {
    if (src[i] === '[') bdepth++;
    else if (src[i] === ']') { if (--bdepth === 0) { arrEnd = i; break; } }
  }
  if (arrEnd === -1) return null;
  const existing = new Set(src.slice(arrStart + 1, arrEnd).match(/\b[A-Z][A-Za-z0-9_]*\b/g) ?? []);
  return { start: arrStart, end: arrEnd, existing };
}

export function tmplHasEsImport(src, sym) {
  const atIdx = src.search(/@(?:Component|Directive|Pipe|Injectable|NgModule)\s*[({]/);
  const section = atIdx > 0 ? src.slice(0, atIdx) : src;
  return new RegExp(`\\b${sym}\\b`).test(section);
}

export function tmplInjectImports(src, toAdd, decoratorRe) {
  let modified = src;
  for (const { sym, pkg } of toAdd) {
    if (!tmplHasEsImport(modified, sym)) {
      const lastIm = [...modified.matchAll(/^import\s+.+;?[ \t]*$/gm)].pop();
      const pos = lastIm ? lastIm.index + lastIm[0].length : 0;
      modified = modified.slice(0, pos) + `\nimport { ${sym} } from '${pkg}';` + modified.slice(pos);
    }
  }
  let arr2 = tmplGetDecoratorImportsArray(modified, decoratorRe);
  if (!arr2) {
    // No imports: [] in the decorator — inject one before the closing brace
    const decIdx = modified.search(decoratorRe);
    if (decIdx === -1) return modified;
    let depth = 0, decEnd = -1;
    for (let i = modified.indexOf('(', decIdx); i < modified.length; i++) {
      if (modified[i] === '(') depth++;
      else if (modified[i] === ')') { if (--depth === 0) { decEnd = i; break; } }
    }
    if (decEnd === -1) return modified;
    // Find the closing } of the decorator's object literal
    let bdepth = 0, objEnd = -1;
    for (let i = modified.indexOf('{', decIdx); i < decEnd; i++) {
      if (modified[i] === '{') bdepth++;
      else if (modified[i] === '}') { if (--bdepth === 0) { objEnd = i; break; } }
    }
    if (objEnd === -1) return modified;
    modified = modified.slice(0, objEnd) + '\n  imports: [],\n' + modified.slice(objEnd);
    arr2 = tmplGetDecoratorImportsArray(modified, decoratorRe);
    if (!arr2) return modified;
  }
  const insertStr = toAdd.map(x => x.sym).join(',\n    ');
  const before = modified.slice(0, arr2.end);
  const sep = before.trimEnd().endsWith('[') ? '\n    ' : ',\n    ';
  return before.trimEnd() + sep + insertStr + '\n  ' + modified.slice(arr2.end);
}

// ─── Fix NgModule imports BEFORE standalone migration ────────────────────────

export function fixNgModuleImports() {
  const srcDir = join(destPath, 'src');
  if (!existsSync(srcDir)) return 0;

  // Map exported class name → file path
  const classMap = new Map();
  function buildClassMap(dir) {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { buildClassMap(full); continue; }
      if (!entry.endsWith('.ts') || entry.endsWith('.spec.ts')) continue;
      const src = readFileSync(full, 'utf8');
      const re = /export\s+(?:abstract\s+)?class\s+([A-Z][A-Za-z0-9_]*)/g;
      let m;
      while ((m = re.exec(src)) !== null) classMap.set(m[1], full);
    }
  }
  buildClassMap(srcDir);

  const MODULE_RE = /@NgModule\s*\(/;
  let total = 0;

  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!entry.endsWith('.module.ts')) continue;

      let src = readFileSync(full, 'utf8');
      const modIdx = src.search(MODULE_RE);
      if (modIdx === -1) continue;

      // Find @NgModule decorator bounds
      let depth = 0, modEnd = -1;
      for (let i = src.indexOf('(', modIdx); i < src.length; i++) {
        if (src[i] === '(') depth++;
        else if (src[i] === ')') { if (--depth === 0) { modEnd = i; break; } }
      }
      if (modEnd === -1) continue;
      const decBody = src.slice(modIdx, modEnd + 1);

      // Collect declared class names
      const declM = decBody.match(/\bdeclarations\s*:\s*\[/);
      if (!declM) continue;
      const declStart = modIdx + declM.index + declM[0].length - 1;
      let bdepth = 0, declEnd = -1;
      for (let i = declStart; i < src.length; i++) {
        if (src[i] === '[') bdepth++;
        else if (src[i] === ']') { if (--bdepth === 0) { declEnd = i; break; } }
      }
      if (declEnd === -1) continue;
      const declared = src.slice(declStart + 1, declEnd).match(/\b[A-Z][A-Za-z0-9_]*\b/g) ?? [];

      // Detect imports needed by all declared components' templates
      const needed = new Map();
      for (const cls of declared) {
        const compFile = classMap.get(cls);
        if (!compFile) continue;
        const compSrc = readFileSync(compFile, 'utf8');
        const tpl = tmplGetTemplate(compFile, compSrc);
        if (!tpl) continue;
        for (const [sym, pkg] of tmplDetectNeeded(tpl)) needed.set(sym, pkg);
      }
      if (!needed.size) continue;

      // Find existing imports: [] in module
      const importsInfo = tmplGetDecoratorImportsArray(src, MODULE_RE);
      const existing = importsInfo?.existing ?? new Set();
      const toAdd = [...needed].filter(([sym]) => !existing.has(sym)).map(([sym, pkg]) => ({ sym, pkg }));
      if (!toAdd.length) continue;

      const modified = tmplInjectImports(src, toAdd, MODULE_RE);
      if (modified !== src) {
        writeFileSync(full, modified);
        total++;
        console.log(`  ↳ ${basename(full)}: +${toAdd.map(x => x.sym).join(', ')}`);
      }
    }
  }
  walk(srcDir);
  if (total > 0) console.log(`  ↳ NgModule imports: ${total} module(s) corrigido(s)`);
  return total;
}

// ─── Copia TODOS os imports do NgModule para cada componente standalone ──────

export function copyModuleImportsToComponents() {
  const srcDir = join(destPath, 'src');
  if (!existsSync(srcDir)) return 0;

  // Build class name → file path map
  const classMap = new Map();
  function buildClassMap(dir) {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { buildClassMap(full); continue; }
      if (!entry.endsWith('.ts') || entry.endsWith('.spec.ts')) continue;
      const src = readFileSync(full, 'utf8');
      const re = /export\s+(?:abstract\s+)?class\s+([A-Z][A-Za-z0-9_]*)/g;
      let m;
      while ((m = re.exec(src)) !== null) classMap.set(m[1], full);
    }
  }
  buildClassMap(srcDir);

  const COMPONENT_RE = /@Component\s*\(/;
  const MODULE_RE = /@NgModule\s*\(/;
  let total = 0;

  function extractDecoratorArray(src, decoratorRe, key) {
    const idx = src.search(decoratorRe);
    if (idx === -1) return [];
    let depth = 0, end = -1;
    for (let i = src.indexOf('(', idx); i < src.length; i++) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')') { if (--depth === 0) { end = i; break; } }
    }
    if (end === -1) return [];
    const body = src.slice(idx, end + 1);
    const km = body.match(new RegExp(`\\b${key}\\s*:\\s*\\[`));
    if (!km) return [];
    const arrStart = idx + km.index + km[0].length - 1;
    let bd = 0, arrEnd = -1;
    for (let i = arrStart; i < src.length; i++) {
      if (src[i] === '[') bd++;
      else if (src[i] === ']') { if (--bd === 0) { arrEnd = i; break; } }
    }
    if (arrEnd === -1) return [];
    return src.slice(arrStart + 1, arrEnd).match(/\b[A-Z][A-Za-z0-9_]*\b/g) ?? [];
  }

  // Build sym → pkg map from ES imports in any source string
  function buildEsImportMap(src) {
    const map = new Map();
    for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g)) {
      for (const sym of m[1].split(',').map(s => s.replace(/\s+as\s+\w+/, '').trim())) {
        if (sym) map.set(sym, m[2]);
      }
    }
    return map;
  }

  // Collect all external-package symbols exported (directly or transitively) by a local module class.
  function collectModuleExports(className, depth, result, visited = new Set()) {
    if (depth > 8 || visited.has(className)) return;
    visited.add(className);
    const file = classMap.get(className);
    if (!file || !existsSync(file)) return;
    const src = readFileSync(file, 'utf8');
    if (!src.includes('@NgModule')) return;
    const es = buildEsImportMap(src);
    for (const exported of extractDecoratorArray(src, MODULE_RE, 'exports')) {
      const pkg = es.get(exported);
      if (!pkg) continue;
      if (!pkg.startsWith('.')) {
        result.set(exported, pkg); // external symbol re-exported — add it
      } else {
        collectModuleExports(exported, depth + 1, result, visited); // recurse into local re-export
      }
    }
  }

  // Resolve all external symbols a component declared in modSrc can access.
  function resolveTransitiveExternals(modSrc) {
    const result = new Map();
    const esImports = buildEsImportMap(modSrc);
    for (const sym of extractDecoratorArray(modSrc, MODULE_RE, 'imports')) {
      const pkg = esImports.get(sym);
      if (!pkg) continue;
      if (!pkg.startsWith('.')) {
        result.set(sym, pkg); // external symbol — include directly
      } else {
        collectModuleExports(sym, 0, result); // local module — follow exports
      }
    }
    return result;
  }

  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!entry.endsWith('.module.ts')) continue;

      const modSrc = readFileSync(full, 'utf8');
      if (!modSrc.includes('@NgModule')) continue;

      const declared = extractDecoratorArray(modSrc, MODULE_RE, 'declarations');
      if (!declared.length) continue;

      // Resolve all externally-importable symbols reachable from this module
      const allExternals = resolveTransitiveExternals(modSrc);
      if (!allExternals.size) continue;

      for (const cls of declared) {
        const compFile = classMap.get(cls);
        if (!compFile) continue;
        let compSrc = readFileSync(compFile, 'utf8');
        if (!compSrc.includes('@Component(')) continue;
        // Process ALL declared components — including those not yet standalone.
        // Components converted later (convertOrphanedNonStandalone) would otherwise
        // miss their module's imports since the module is already pruned by then.

        const arrInfo = tmplGetDecoratorImportsArray(compSrc, COMPONENT_RE);
        const existing = arrInfo?.existing ?? new Set();

        const toAdd = [...allExternals]
          .filter(([sym]) => !existing.has(sym))
          .map(([sym, pkg]) => ({ sym, pkg }));
        if (!toAdd.length) continue;

        const modified = tmplInjectImports(compSrc, toAdd, COMPONENT_RE);
        if (modified !== compSrc) {
          writeFileSync(compFile, modified);
          total++;
          console.log(`  ↳ ${basename(compFile)}: +${toAdd.map(x => x.sym).join(', ')}`);
        }
      }
    }
  }
  walk(srcDir);
  if (total > 0) console.log(`  ↳ module imports copied to ${total} component(s)`);
  return total;
}

// ─── Adiciona imports faltantes em componentes standalone ────────────────────

export function fixStandaloneImports() {
  const COMPONENT_RE = /@Component\s*\(/;
  let total = 0;

  // Build the internal project index once (lazy) for detecting project-internal components
  const internalIndex = buildInternalProjectIndex();

  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!entry.endsWith('.ts') || entry.endsWith('.spec.ts')) continue;
      let src = readFileSync(full, 'utf8');
      if (!src.includes('@Component(') || !src.includes('standalone: true')) continue;
      const tpl = tmplGetTemplate(full, src);
      if (!tpl) continue;

      const needed = tmplDetectNeeded(tpl, full);

      // Detect project-internal standalone components referenced in the template
      for (const [selector, { symbol, filePath: depFile }] of internalIndex) {
        if (depFile === full) continue;
        const escaped = selector.replace(/[-[\].*+?^${}()|\\]/g, '\\$&');
        if (!new RegExp(`<${escaped}[\\s\\/>]`).test(tpl)) continue;
        // Compute the relative import path (without .ts extension)
        const rel = relative(dirname(full), depFile).replace(/\.ts$/, '');
        const importPath = rel.startsWith('.') ? rel : `./${rel}`;
        needed.set(symbol, importPath);
      }

      if (!needed.size) continue;
      const arrInfo = tmplGetDecoratorImportsArray(src, COMPONENT_RE);
      const existing = arrInfo?.existing ?? new Set();
      const toAdd = [...needed].filter(([sym]) => !existing.has(sym)).map(([sym, pkg]) => ({ sym, pkg }));
      if (!toAdd.length) continue;
      const modified = tmplInjectImports(src, toAdd, COMPONENT_RE);
      if (modified !== src) {
        writeFileSync(full, modified);
        total++;
        console.log(`  ↳ ${basename(full)}: +${toAdd.map(x => x.sym).join(', ')}`);
      }
    }
  }
  const srcDir = join(destPath, 'src');
  if (existsSync(srcDir)) walk(srcDir);
  if (total > 0) console.log(`  ↳ standalone imports: ${total} componente(s) corrigido(s)`);
  return total;
}

// ─── Garante standalone: true em @Pipe / @Directive ─────────────────────────

export function fixMissingStandalone() {
  let count = 0;
  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!entry.endsWith('.ts')) continue;
      let src = readFileSync(full, 'utf8');
      const hasPipeOrDirective = src.includes('@Pipe(') || src.includes('@Directive(');
      const hasComponent = src.includes('@Component({');
      if (!hasPipeOrDirective && !hasComponent) continue;

      let out = src;

      // @Pipe e @Directive: regex simples (corpos nunca têm chaves aninhadas)
      if (hasPipeOrDirective) {
        out = out.replace(/@(Pipe|Directive)\(\{([^}]*)\}\)/g, (match, dec, body) => {
          if (body.includes('standalone')) return match;
          const trimmed = body.trimEnd();
          const sep = trimmed.endsWith(',') ? '' : ',';
          return `@${dec}({${trimmed}${sep}\n  standalone: true\n})`;
        });
      }

      // @Component: use export-class boundaries
      if (hasComponent) {
        const classBoundaryRe = /^export\s+(?:abstract\s+)?class\s+/gm;
        const boundaries = [];
        let bm;
        while ((bm = classBoundaryRe.exec(out)) !== null) boundaries.push(bm.index);
        boundaries.push(out.length);

        let result = out;
        let shift = 0;
        for (let bi = 0; bi < boundaries.length - 1; bi++) {
          const classStart = boundaries[bi] + shift;
          const before = result.slice(0, classStart);
          const compIdx = before.lastIndexOf('@Component(');
          if (compIdx === -1) continue;

          const decRegion = result.slice(compIdx, classStart);
          const openBrace = decRegion.indexOf('{');
          if (openBrace === -1) continue;

          if (decRegion.includes('standalone:')) {
            const isExplicitlyFalse = /standalone\s*:\s*false/.test(decRegion);
            if (isExplicitlyFalse) {
              // Always convert false → true; add imports: [] if not present
              // (Angular 19 ng update adds standalone: false to ALL components — this handles them)
              let fixedRegion = decRegion.replace(/standalone\s*:\s*false/, 'standalone: true');
              if (!decRegion.includes('imports:')) {
                fixedRegion = fixedRegion.slice(0, openBrace + 1) + '\n  imports: [],' + fixedRegion.slice(openBrace + 1);
              }
              const regionStart = compIdx;
              const regionEnd = compIdx + decRegion.length;
              result = result.slice(0, regionStart) + fixedRegion + result.slice(regionEnd);
              shift += fixedRegion.length - decRegion.length;
            } else if (!decRegion.includes('imports:')) {
              const insertAt = compIdx + openBrace + 1;
              const extra = '\n  imports: [],';
              result = result.slice(0, insertAt) + extra + result.slice(insertAt);
              shift += extra.length;
            }
          } else {
            const insertAt = compIdx + openBrace + 1;
            const extra = '\n  standalone: true,' + (decRegion.includes('imports:') ? '' : '\n  imports: [],');
            result = result.slice(0, insertAt) + extra + result.slice(insertAt);
            shift += extra.length;
          }
        }
        out = result;
      }

      if (out !== src) { writeFileSync(full, out); count++; }
    }
  }
  const srcDir = join(destPath, 'src');
  if (existsSync(srcDir)) walk(srcDir);
  if (count > 0) console.log(`  ↳ standalone: true adicionado em ${count} arquivo(s)`);
  return count;
}

export function removeImportsFromNonStandalone() {
  let count = 0;
  const srcDir = join(destPath, 'src');
  if (!existsSync(srcDir)) return;
  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!entry.endsWith('.ts') || entry.endsWith('.spec.ts')) continue;
      const src = readFileSync(full, 'utf8');
      if (!src.includes('standalone: false') && !src.includes('standalone:false')) continue;
      if (!src.includes('@Component(')) continue;

      const classBoundaryRe = /^export\s+(?:abstract\s+)?class\s+/gm;
      const boundaries = [];
      let bm;
      while ((bm = classBoundaryRe.exec(src)) !== null) boundaries.push(bm.index);
      boundaries.push(src.length);

      let result = src;
      let shift = 0;
      for (let bi = 0; bi < boundaries.length - 1; bi++) {
        const classStart = boundaries[bi] + shift;
        const before = result.slice(0, classStart);
        const compIdx = before.lastIndexOf('@Component(');
        if (compIdx === -1) continue;
        const decRegion = result.slice(compIdx, classStart);
        if (!/standalone\s*:\s*false/.test(decRegion)) continue;
        if (!decRegion.includes('imports:')) continue;

        const cleaned = decRegion.replace(/\n[ \t]*imports\s*:\s*\[[^\]]*\]\s*,?/g, '');
        if (cleaned === decRegion) continue;
        result = result.slice(0, compIdx) + cleaned + result.slice(classStart);
        shift += cleaned.length - decRegion.length;
      }

      if (result !== src) {
        writeFileSync(full, result);
        count++;
      }
    }
  }
  walk(srcDir);
  if (count > 0) console.log(`  ↳ imports: [] removido de ${count} componente(s) standalone: false`);
}

export function collectStandaloneFalseCount() {
  const srcDir = join(destPath, 'src');
  if (!existsSync(srcDir)) return 0;
  let count = 0;
  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!entry.endsWith('.ts') || entry.endsWith('.spec.ts')) continue;
      const src = readFileSync(full, 'utf8');
      if ((src.includes('standalone: false') || src.includes('standalone:false')) &&
          (src.includes('@Component(') || src.includes('@Pipe(') || src.includes('@Directive('))) {
        count++;
      }
    }
  }
  walk(srcDir);
  return count;
}

export function convertOrphanedNonStandalone() {
  const srcDir = join(destPath, 'src');
  if (!existsSync(srcDir)) return 0;

  // Coleta todos os nomes de classe presentes em declarations: [] de NgModules ainda existentes
  const declaredInModule = new Set();
  function indexModules(dir) {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { indexModules(full); continue; }
      if (!entry.endsWith('.module.ts')) continue;
      const src = readFileSync(full, 'utf8');
      if (!src.includes('@NgModule')) continue;
      const declIdx = src.search(/\bdeclarations\s*:/);
      if (declIdx === -1) continue;
      const arrOpen = src.indexOf('[', declIdx);
      if (arrOpen === -1) continue;
      let depth = 0, arrEnd = -1;
      for (let i = arrOpen; i < src.length; i++) {
        if (src[i] === '[') depth++;
        else if (src[i] === ']') { if (--depth === 0) { arrEnd = i; break; } }
      }
      if (arrEnd === -1) continue;
      for (const m of src.slice(arrOpen + 1, arrEnd).matchAll(/\b[A-Z][A-Za-z0-9_]*\b/g)) {
        declaredInModule.add(m[0]);
      }
    }
  }
  indexModules(srcDir);

  let count = 0;
  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!entry.endsWith('.ts') || entry.endsWith('.spec.ts')) continue;
      const src = readFileSync(full, 'utf8');
      if (!src.includes('@Component(')) continue;
      if (!src.includes('standalone: false') && !src.includes('standalone:false')) continue;

      const classNames = [...src.matchAll(/export\s+(?:abstract\s+)?class\s+([A-Z][A-Za-z0-9_]*)/g)].map(m => m[1]);
      if (classNames.some(cls => declaredInModule.has(cls))) continue;

      let updated = src.replace(/\bstandalone\s*:\s*false/g, 'standalone: true');
      if (updated === src) continue;
      // Ensure each @Component that became standalone: true also has imports: []
      const COMP_RE2 = /@Component\s*\(/g;
      let m2; let r2 = updated; let sh2 = 0;
      while ((m2 = COMP_RE2.exec(updated)) !== null) {
        const ds = m2.index + sh2;
        let depth2 = 0, de = -1;
        for (let i = r2.indexOf('(', ds); i < r2.length; i++) {
          if (r2[i] === '(') depth2++; else if (r2[i] === ')') { if (--depth2 === 0) { de = i; break; } }
        }
        if (de === -1) continue;
        const db = r2.slice(ds, de + 1);
        if (!db.includes('standalone: true') || db.includes('imports:')) continue;
        const ob = r2.indexOf('{', ds);
        if (ob === -1 || ob > de) continue;
        const ins = '\n  imports: [],';
        r2 = r2.slice(0, ob + 1) + ins + r2.slice(ob + 1);
        sh2 += ins.length;
      }
      updated = r2;
      writeFileSync(full, updated);
      count++;
      console.log(`  ↳ ${basename(full)}: standalone: false → true (órfão)`);
    }
  }
  walk(srcDir);
  if (count > 0) console.log(`  ↳ ${count} componente(s) órfão(s) convertidos para standalone: true`);
  return count;
}

export function cleanupStandaloneTodos() {
  const srcDir = join(destPath, 'src');
  if (!existsSync(srcDir)) return 0;
  let count = 0;
  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!entry.endsWith('.ts') && !entry.endsWith('.html')) continue;
      const src = readFileSync(full, 'utf8');
      if (!src.includes('TODO(standalone-migration)')) continue;
      const updated = src.split('\n')
        .filter(line => !/^\s*\/\/\s*TODO\(standalone-migration\)/.test(line))
        .join('\n')
        .replace(/\s*\/\*\s*TODO\(standalone-migration\)[^*]*\*\//g, '');
      if (updated !== src) { writeFileSync(full, updated); count++; }
    }
  }
  walk(srcDir);
  if (count > 0) console.log(`  ↳ TODO(standalone-migration): removido de ${count} arquivo(s)`);
  return count;
}

export function fixCircularStandaloneImports() {
  const srcDir = join(destPath, 'src');
  if (!existsSync(srcDir)) return 0;

  const fileInfo = new Map();

  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!entry.endsWith('.ts') || entry.endsWith('.spec.ts')) continue;
      const src = readFileSync(full, 'utf8');
      if (!src.includes('standalone: true')) continue;
      if (!/@(?:Component|Directive|Pipe)\s*\(/.test(src)) continue;

      const classes = new Set(
        [...src.matchAll(/export\s+(?:abstract\s+)?class\s+([A-Z]\w*)/g)].map(m => m[1]),
      );

      const decM = src.match(/@(?:Component|Directive|Pipe)\s*\(\s*\{[\s\S]*?\bimports\s*:\s*\[([\s\S]*?)\]/);
      const decoratorImportClasses = decM
        ? [...decM[1].matchAll(/\b([A-Z]\w*)\b/g)].map(m => m[1])
        : [];

      const esImportMap = new Map();
      for (const m of src.matchAll(/^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/gm)) {
        const importPath = m[2];
        if (!importPath.startsWith('.')) continue;
        let resolved = resolve(dirname(full), importPath);
        if (!resolved.endsWith('.ts')) resolved += '.ts';
        for (const rawCls of m[1].split(',')) {
          const cls = rawCls.replace(/\s+as\s+\S+/, '').trim();
          if (cls) esImportMap.set(cls, resolved);
        }
      }

      if (classes.size > 0 && decoratorImportClasses.length > 0) {
        fileInfo.set(full, { classes, decoratorImportClasses, esImportMap });
      }
    }
  }
  walk(srcDir);

  let fixed = 0;
  const handled = new Set();

  for (const [fileA, infoA] of fileInfo) {
    for (const cls of infoA.decoratorImportClasses) {
      const fileB = infoA.esImportMap.get(cls);
      if (!fileB || !fileInfo.has(fileB)) continue;
      const infoB = fileInfo.get(fileB);

      const classesFromAInB = infoB.decoratorImportClasses.filter(
        c => infoA.classes.has(c) && infoB.esImportMap.get(c) === fileA,
      );
      if (classesFromAInB.length === 0) continue;

      const cycleKey = [fileA, fileB].sort().join('|');
      if (handled.has(cycleKey)) continue;
      handled.add(cycleKey);

      const [, fixFile] = [fileA, fileB].sort();
      const classesToWrap = fixFile === fileA ? classesFromAInB : [cls];

      let src = readFileSync(fixFile, 'utf8');
      let changed = false;

      for (const c of classesToWrap) {
        if (src.includes(`forwardRef(() => ${c})`)) continue;
        src = src.replace(
          new RegExp(`(\\bimports\\s*:\\s*\\[[^\\]]*?)\\b${c}\\b`, 's'),
          (_, prefix) => `${prefix}forwardRef(() => ${c})`,
        );
        changed = true;
        console.log(`  ↳ ${basename(fixFile)}: forwardRef(() => ${c}) — dependência circular`);
      }

      if (!changed) continue;

      if (!src.includes('forwardRef')) {
        src = src.replace(
          /^(import\s+\{)([^}]+)(\}\s+from\s+['"]@angular\/core['"])/m,
          (_, open, names, close) => `${open}${names.trimEnd()}, forwardRef${close}`,
        );
      }

      writeFileSync(fixFile, src);
      fixed++;
    }
  }

  if (fixed > 0) console.log(`  ↳ ${fixed} dependência(s) circular(es) corrigida(s) com forwardRef`);
  return fixed;
}
