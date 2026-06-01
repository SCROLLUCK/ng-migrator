import { parseTemplate } from '@angular/compiler';
import { Project, SyntaxKind } from 'ts-morph';
import {
  readFileSync, writeFileSync, existsSync, readdirSync, statSync,
} from 'fs';
import { join, dirname, basename, relative, resolve } from 'path';
import { destPath, SKIP_DIRS } from './context.mjs';
import { capture, walkFiles } from './utils.mjs';

// ─── Module-level shared helpers ─────────────────────────────────────────────

// Builds a Map<className, absoluteFilePath> for all exported classes under dir.
function buildClassMapInDir(dir) {
  const map = new Map();
  walkFiles(dir, e => e.endsWith('.ts') && !e.endsWith('.spec.ts'), (full) => {
    const src = readFileSync(full, 'utf8');
    const re = /export\s+(?:abstract\s+)?class\s+([A-Z][A-Za-z0-9_]*)/g;
    let m;
    while ((m = re.exec(src)) !== null) map.set(m[1], full);
  });
  return map;
}

// Builds a Map<symbol, importPath> from all ES named imports in a source string.
function buildEsImportMap(src) {
  const map = new Map();
  for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    for (const sym of m[1].split(',').map(s => s.replace(/\s+as\s+\w+/, '').trim())) {
      if (sym) map.set(sym, m[2]);
    }
  }
  return map;
}

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

// ─── Registry dinâmico: escaneia .d.ts dos pacotes instalados ─────────────────
// Extrai seletores (ɵɵComponentDeclaration) e pipes (ɵɵPipeDeclaration) de TODOS
// os pacotes em package.json, sem depender de maps hardcoded.
let _dynamicNgRegistry = null;

function buildDynamicNgRegistry() {
  if (_dynamicNgRegistry) return _dynamicNgRegistry;
  const elements = new Map();   // selector → { sym, pkg }
  const pipes = new Map();      // pipeName → { sym, pkg }
  const attributes = new Map(); // attrName → { sym, pkg }
  _dynamicNgRegistry = { elements, pipes, attributes };

  const nmDir = join(destPath, 'node_modules');
  const pkgJsonPath = join(destPath, 'package.json');
  if (!existsSync(pkgJsonPath) || !existsSync(nmDir)) return _dynamicNgRegistry;

  let allDeps;
  try {
    const p = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
    allDeps = { ...(p.dependencies ?? {}), ...(p.devDependencies ?? {}) };
  } catch { return _dynamicNgRegistry; }

  // Pacotes de FRAMEWORK Angular já são cobertos pelos TMPL maps / standalone.
  // Mas pacotes-produto do escopo @angular/ (google-maps, youtube-player, material, cdk)
  // PROVÊM elementos (<google-map>, <youtube-player>, <mat-card>) e precisam ser escaneados.
  const ANGULAR_FRAMEWORK = /^@angular\/(core|common|forms|router|platform-browser|platform-browser-dynamic|platform-server|animations|compiler|compiler-cli|elements|localize|service-worker|ssr|build|language-service)$/;
  for (const pkgName of Object.keys(allDeps)) {
    if (pkgName.startsWith('@types/') || pkgName.startsWith('@angular-devkit/') || ANGULAR_FRAMEWORK.test(pkgName)) continue;
    const pkgParts = pkgName.startsWith('@') ? pkgName.split('/') : [pkgName];
    const pkgDir = join(nmDir, ...pkgParts);
    if (!existsSync(pkgDir)) continue;

    // Localiza o .d.ts principal
    let dts = '';
    for (const cand of ['index.d.ts', 'public-api.d.ts']) {
      const f = join(pkgDir, cand);
      if (existsSync(f)) { try { dts = readFileSync(f, 'utf8'); } catch {} break; }
    }
    if (!dts) {
      try {
        const meta = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
        const t = meta.typings ?? meta.types ?? '';
        if (t) { const f = join(pkgDir, t); if (existsSync(f)) try { dts = readFileSync(f, 'utf8'); } catch {} }
      } catch {}
    }
    if (!dts || (!dts.includes('ɵcmp') && !dts.includes('ɵpipe'))) continue;

    // Mapeia classe exportada → módulo que a exporta (para componentes não-standalone)
    const moduleExports = new Map(); // ClassName → ModuleName
    for (const m of dts.matchAll(/class\s+(\w+Module)\b[^\n]*\{[\s\S]*?ɵɵNgModuleDeclaration[\s\S]*?\}/g)) {
      const modName = m[1];
      for (const exp of m[0].matchAll(/typeof\s+(\w+)/g)) {
        if (!moduleExports.has(exp[1])) moduleExports.set(exp[1], modName);
      }
    }

    // Extrai seletores de componentes: ɵɵComponentDeclaration<ClassName, "selector", ..., true|false>
    for (const m of dts.matchAll(/class\s+(\w+)\b[^{]*\{[^}]*ɵɵComponentDeclaration<\1\s*,\s*"([^"]+)"[^>]+(true|false)/gs)) {
      const [, className, rawSelector, standaloneStr] = m;
      const sym = standaloneStr === 'true' ? className : (moduleExports.get(className) ?? className);
      for (const sel of rawSelector.split(',').map(s => s.trim()).filter(Boolean)) {
        if (sel.startsWith('[')) {
          // Attribute directive: [attrName] or [attrName]=[val]
          const attr = sel.slice(1).split(/[\]=]/)[0].trim();
          if (attr && !attributes.has(attr)) attributes.set(attr, { sym, pkg: pkgName });
        } else if (!sel.startsWith('.') && !elements.has(sel)) {
          elements.set(sel, { sym, pkg: pkgName });
        }
      }
    }

    // Extrai nomes de pipes: ɵɵPipeDeclaration<ClassName, "name", true|false>
    for (const m of dts.matchAll(/class\s+(\w+)\b[^{]*\{[^}]*ɵɵPipeDeclaration<\1\s*,\s*"([^"]+)"[^>]*(true|false)/gs)) {
      const [, className, pipeName, standaloneStr] = m;
      const sym = standaloneStr === 'true' ? className : (moduleExports.get(className) ?? className);
      if (!pipes.has(pipeName)) pipes.set(pipeName, { sym, pkg: pkgName });
    }
  }

  const total = elements.size + pipes.size + attributes.size;
  if (total > 0) console.log(`  ↳ registry dinâmico: ${elements.size} elem + ${attributes.size} attr + ${pipes.size} pipes de pacotes instalados`);
  return _dynamicNgRegistry;
}

export function invalidateDynamicRegistry() { _dynamicNgRegistry = null; }

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
  const dynReg = buildDynamicNgRegistry();

  function resolveElem(name) {
    const e = TMPL_ELEM[name] ?? dynReg.elements.get(name);
    if (e && tmplPkgInstalled(e.pkg)) needed.set(e.sym, e.pkg);
  }
  function resolveAttr(name) {
    const a = TMPL_ATTR[name] ?? dynReg.attributes?.get(name);
    if (a && tmplPkgInstalled(a.pkg)) needed.set(a.sym, a.pkg);
  }

  // ── AST-based detection ────────────────────────────────────────────────────
  try {
    const ast = parseTemplate(tpl, tsFilePath, { preserveWhitespaces: false });
    function visitNode(node) {
      if (!node) return;
      if (node.name) resolveElem(node.name);
      for (const t of [...(node.attributes ?? []), ...(node.inputs ?? []), ...(node.outputs ?? []), ...(node.references ?? [])]) {
        resolveAttr(t.name);
      }
      if (node.children) for (const c of node.children) visitNode(c);
      // @if branches, @switch cases, @for empty block (Angular 17+ control flow)
      if (node.branches) for (const b of node.branches) { if (b.children) for (const c of b.children) visitNode(c); }
      if (node.cases) for (const c of node.cases) { if (c.children) for (const ch of c.children) visitNode(ch); }
      if (node.empty?.children) for (const c of node.empty.children) visitNode(c);
      // @defer blocks (Angular 17+): visit all sub-blocks so their components get imported
      if (node.placeholder?.children) for (const c of node.placeholder.children) visitNode(c);
      if (node.loading?.children) for (const c of node.loading.children) visitNode(c);
      if (node.error?.children) for (const c of node.error.children) visitNode(c);
    }
    for (const node of ast.nodes) visitNode(node);
  } catch {
    // Fallback regex (malformed templates)
    const allElemKeys = [...Object.keys(TMPL_ELEM), ...dynReg.elements.keys()];
    const elemRe = new RegExp(`<(${[...new Set(allElemKeys)].map(k => k.replace(/[-[\]]/g, '\\$&')).join('|')})[\\s\\/>]`, 'g');
    let m;
    while ((m = elemRe.exec(tpl)) !== null) resolveElem(m[1]);
    const allAttrKeys = [...Object.keys(TMPL_ATTR), ...dynReg.attributes.keys()];
    for (const attr of [...new Set(allAttrKeys)]) {
      const esc = attr.replace(/[-[\]]/g, '\\$&');
      if (new RegExp(`(?:[\\s\\["])${esc}(?:[\\s=\\]">/])`).test(tpl)) resolveAttr(attr);
    }
  }

  // ── Pipe detection (regex) ─────────────────────────────────────────────────
  const pipeRe = /\|\s*([\w]+)/g;
  let pm;
  while ((pm = pipeRe.exec(tpl)) !== null) {
    const p = TMPL_PIPE[pm[1]] ?? dynReg.pipes.get(pm[1]);
    if (p && tmplPkgInstalled(p.pkg)) needed.set(p.sym, p.pkg);
  }

  // ── Form directives ────────────────────────────────────────────────────────
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
        const decoratorType = dec.getName(); // 'Component' | 'Directive' | 'Pipe'
        // Get selector (Component/Directive) or name (Pipe)
        const selectorProp = objLit.getProperty('selector') ?? objLit.getProperty('name');
        if (!selectorProp || !selectorProp.isKind(SyntaxKind.PropertyAssignment)) continue;
        const raw = selectorProp.getInitializer()?.getText().replace(/['"`]/g, '').trim() ?? '';
        for (const sel of raw.split(',').map(s => s.trim()).filter(Boolean)) {
          index.set(sel, { symbol: className, filePath, decoratorType });
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
    const prefix = modified.slice(0, objEnd).trimEnd();
    const comma = (prefix.endsWith(',') || prefix.endsWith('{')) ? '' : ',';
    modified = prefix + comma + '\n  imports: [],\n' + modified.slice(objEnd);
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

  const classMap = buildClassMapInDir(srcDir);

  const MODULE_RE = /@NgModule\s*\(/;
  let total = 0;

  walkFiles(srcDir, e => e.endsWith('.module.ts'), (full) => {
    let src = readFileSync(full, 'utf8');
    const modIdx = src.search(MODULE_RE);
    if (modIdx === -1) return;

    // Find @NgModule decorator bounds
    let depth = 0, modEnd = -1;
    for (let i = src.indexOf('(', modIdx); i < src.length; i++) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')') { if (--depth === 0) { modEnd = i; break; } }
    }
    if (modEnd === -1) return;
    const decBody = src.slice(modIdx, modEnd + 1);

    // Collect declared class names
    const declM = decBody.match(/\bdeclarations\s*:\s*\[/);
    if (!declM) return;
    const declStart = modIdx + declM.index + declM[0].length - 1;
    let bdepth = 0, declEnd = -1;
    for (let i = declStart; i < src.length; i++) {
      if (src[i] === '[') bdepth++;
      else if (src[i] === ']') { if (--bdepth === 0) { declEnd = i; break; } }
    }
    if (declEnd === -1) return;
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
    if (!needed.size) return;

    // Find existing imports: [] in module
    const importsInfo = tmplGetDecoratorImportsArray(src, MODULE_RE);
    const existing = importsInfo?.existing ?? new Set();
    const toAdd = [...needed].filter(([sym]) => !existing.has(sym)).map(([sym, pkg]) => ({ sym, pkg }));
    if (!toAdd.length) return;

    const modified = tmplInjectImports(src, toAdd, MODULE_RE);
    if (modified !== src) {
      writeFileSync(full, modified);
      total++;
      console.log(`  ↳ ${basename(full)}: +${toAdd.map(x => x.sym).join(', ')}`);
    }
  });
  if (total > 0) console.log(`  ↳ NgModule imports: ${total} module(s) corrigido(s)`);
  return total;
}

// ─── Copia TODOS os imports do NgModule para cada componente standalone ──────

export function copyModuleImportsToComponents() {
  const srcDir = join(destPath, 'src');
  if (!existsSync(srcDir)) return 0;

  const classMap = buildClassMapInDir(srcDir);

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
    // Extract only top-level identifiers — ignore symbols nested inside forRoot() / config objects
    const content = src.slice(arrStart + 1, arrEnd);
    const symbols = [];
    let symDepth = 0, si = 0;
    while (si < content.length) {
      const c = content[si];
      if (c === '(' || c === '{' || c === '[') { symDepth++; si++; continue; }
      if (c === ')' || c === '}' || c === ']') { symDepth--; si++; continue; }
      if (symDepth === 0 && /[A-Z]/.test(c)) {
        const m = content.slice(si).match(/^[A-Z][A-Za-z0-9_]*/);
        if (m) { symbols.push(m[0]); si += m[0].length; continue; }
      }
      si++;
    }
    return symbols;
  }

  // Collect symbols exported (directly or transitively) by a local module class.
  // `result`         → sym → external-package-name  (for external re-exports)
  // `internalResult` → sym → absolute file path      (for internal component/pipe/directive exports)
  function collectModuleExports(className, depth, result, internalResult, visited = new Set()) {
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
        // Resolve to absolute path to decide: module (recurse) or component/pipe/directive (collect)
        const absBase = resolve(dirname(file), pkg);
        const absTs = existsSync(absBase + '.ts') ? absBase + '.ts' : absBase;
        if (existsSync(absTs)) {
          const expSrc = readFileSync(absTs, 'utf8');
          if (expSrc.includes('@NgModule')) {
            collectModuleExports(exported, depth + 1, result, internalResult, visited);
          } else {
            // Internal component/pipe/directive exported by this module
            internalResult.set(exported, absTs);
          }
        } else {
          // Can't resolve file — try recursing as module anyway
          collectModuleExports(exported, depth + 1, result, internalResult, visited);
        }
      }
    }
  }

  // Resolve all symbols a component declared in modSrc can access via its NgModule imports.
  // Returns [externals: Map<sym, pkg>, internals: Map<sym, absFilePath>]
  function resolveTransitiveExternals(modSrc) {
    const result = new Map();
    const internalResult = new Map();
    const esImports = buildEsImportMap(modSrc);
    for (const sym of extractDecoratorArray(modSrc, MODULE_RE, 'imports')) {
      const pkg = esImports.get(sym);
      if (!pkg) continue;
      if (!pkg.startsWith('.')) {
        result.set(sym, pkg); // external symbol — include directly
      } else {
        collectModuleExports(sym, 0, result, internalResult); // local module — follow exports
      }
    }
    return { externals: result, internals: internalResult };
  }

  // Symbols that must never appear in a component's imports[] array
  const BOOTSTRAP_ONLY = new Set([
    'BrowserModule', 'BrowserAnimationsModule', 'NoopAnimationsModule',
    'HttpClientModule', 'HttpClientJsonpModule',
    'Component', 'Directive', 'Pipe', 'NgModule', 'Injectable',
    'Input', 'Output', 'ViewChild', 'ViewChildren', 'ContentChild', 'ContentChildren',
    'HostListener', 'HostBinding', 'EventEmitter', 'ChangeDetectionStrategy',
    'ChangeDetectorRef', 'ElementRef', 'TemplateRef', 'ViewContainerRef',
    'inject', 'input', 'output', 'viewChild', 'viewChildren', 'contentChild', 'model',
  ]);

  walkFiles(srcDir, e => e.endsWith('.module.ts'), (full) => {
    const modSrc = readFileSync(full, 'utf8');
    if (!modSrc.includes('@NgModule')) return;

    const declared = extractDecoratorArray(modSrc, MODULE_RE, 'declarations');
    if (!declared.length) return;

    // All symbols reachable via this module's imports
    const { externals: allExternals, internals: internalExports } = resolveTransitiveExternals(modSrc);

    for (const cls of declared) {
      const compFile = classMap.get(cls);
      if (!compFile) continue;
      let compSrc = readFileSync(compFile, 'utf8');
      if (!compSrc.includes('@Component(')) continue;

      const arrInfo = tmplGetDecoratorImportsArray(compSrc, COMPONENT_RE);
      const existing = arrInfo?.existing ?? new Set();

      // 1. External package symbols from module imports
      const toAdd = [...allExternals]
        .filter(([sym]) => !existing.has(sym) && !BOOTSTRAP_ONLY.has(sym))
        .map(([sym, pkg]) => ({ sym, pkg }));

      // 2. Internal symbols exported by locally-imported modules (e.g. SharedModule exports TranslatePipe)
      for (const [sym, absFile] of internalExports) {
        if (existing.has(sym) || toAdd.some(x => x.sym === sym)) continue;
        if (BOOTSTRAP_ONLY.has(sym)) continue;
        if (absFile === compFile) continue; // declarado no MESMO arquivo → não auto-importar
        const rel = relative(dirname(compFile), absFile).replace(/\.ts$/, '');
        toAdd.push({ sym, pkg: rel.startsWith('.') ? rel : `./${rel}` });
      }

      // 3. Co-declared symbols from the same module (other components, pipes, directives).
      for (const otherCls of declared) {
        if (otherCls === cls) continue;
        if (existing.has(otherCls) || toAdd.some(x => x.sym === otherCls)) continue;
        if (BOOTSTRAP_ONLY.has(otherCls)) continue;
        const otherFile = classMap.get(otherCls);
        if (!otherFile) continue;
        // Várias classes no MESMO arquivo (ex: Tab1Component/Tab2Component/TabsComponent em
        // tabs.component.ts) já se enxergam — importar de si mesmo gera self-import (TS2440).
        if (otherFile === compFile) continue;
        const rel = relative(dirname(compFile), otherFile).replace(/\.ts$/, '');
        toAdd.push({ sym: otherCls, pkg: rel.startsWith('.') ? rel : `./${rel}` });
      }

      if (!toAdd.length) continue;

      const modified = tmplInjectImports(compSrc, toAdd, COMPONENT_RE);
      if (modified !== compSrc) {
        writeFileSync(compFile, modified);
        total++;
        console.log(`  ↳ ${basename(compFile)}: +${toAdd.map(x => x.sym).join(', ')}`);
      }
    }
  });
  if (total > 0) console.log(`  ↳ module imports copied to ${total} component(s)`);
  return total;
}

// ─── Adiciona imports faltantes em componentes standalone ────────────────────

export function fixStandaloneImports() {
  const COMPONENT_RE = /@Component\s*\(/;
  let total = 0;

  // Build the internal project index once (lazy) for detecting project-internal components
  const internalIndex = buildInternalProjectIndex();

  const srcDir = join(destPath, 'src');
  if (existsSync(srcDir)) walkFiles(srcDir, e => e.endsWith('.ts') && !e.endsWith('.spec.ts'), (full) => {
    let src = readFileSync(full, 'utf8');
    if (!src.includes('@Component(') || !src.includes('standalone: true')) return;
    const tpl = tmplGetTemplate(full, src);
    if (!tpl) return;

    const needed = tmplDetectNeeded(tpl, full);

    // Detect project-internal standalone components/directives/pipes referenced in the template
    for (const [selector, { symbol, filePath: depFile, decoratorType }] of internalIndex) {
      if (depFile === full) continue;
      let matches = false;
      if (decoratorType === 'Pipe') {
        matches = new RegExp(`\\|\\s*${selector}\\b`).test(tpl);
      } else if (selector.startsWith('[')) {
        const attr = selector.slice(1).replace(/\]$/, '').replace(/[-[\].*+?^${}()|\\]/g, '\\$&');
        matches = new RegExp(`[\\[\\s"]${attr}[\\]\\s=">/]`).test(tpl);
      } else {
        const escaped = selector.replace(/[-[\].*+?^${}()|\\]/g, '\\$&');
        matches = new RegExp(`<${escaped}[\\s\\/>]`).test(tpl);
      }
      if (!matches) continue;
      const rel = relative(dirname(full), depFile).replace(/\.ts$/, '');
      const importPath = rel.startsWith('.') ? rel : `./${rel}`;
      needed.set(symbol, importPath);
    }

    if (!needed.size) return;
    const arrInfo = tmplGetDecoratorImportsArray(src, COMPONENT_RE);
    const existing = arrInfo?.existing ?? new Set();
    const toAdd = [...needed].filter(([sym]) => !existing.has(sym)).map(([sym, pkg]) => ({ sym, pkg }));
    if (!toAdd.length) return;
    const modified = tmplInjectImports(src, toAdd, COMPONENT_RE);
    if (modified !== src) {
      writeFileSync(full, modified);
      total++;
      console.log(`  ↳ ${basename(full)}: +${toAdd.map(x => x.sym).join(', ')}`);
    }
  });
  if (total > 0) console.log(`  ↳ standalone imports: ${total} componente(s) corrigido(s)`);
  return total;
}

// ─── Garante standalone: true em @Pipe / @Directive ─────────────────────────

export function fixMissingStandalone() {
  let count = 0;
  const srcDir2 = join(destPath, 'src');
  if (existsSync(srcDir2)) walkFiles(srcDir2, e => e.endsWith('.ts'), (full) => {
    let src = readFileSync(full, 'utf8');
      const hasPipeOrDirective = src.includes('@Pipe(') || src.includes('@Directive(');
      const hasComponent = src.includes('@Component({');
      if (!hasPipeOrDirective && !hasComponent) return;

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
  });
  if (count > 0) console.log(`  ↳ standalone: true adicionado em ${count} arquivo(s)`);
  return count;
}

export function removeImportsFromNonStandalone() {
  let count = 0;
  const srcDir = join(destPath, 'src');
  if (!existsSync(srcDir)) return;
  walkFiles(srcDir, e => e.endsWith('.ts') && !e.endsWith('.spec.ts'), (full) => {
    const src = readFileSync(full, 'utf8');
    if (!src.includes('standalone: false') && !src.includes('standalone:false')) return;
    if (!src.includes('@Component(')) return;

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

    if (result !== src) { writeFileSync(full, result); count++; }
  });
  if (count > 0) console.log(`  ↳ imports: [] removido de ${count} componente(s) standalone: false`);
}

// Move standalone components/pipes/directives from NgModule declarations → imports
// Fixes NG6008: "Component X is standalone, and cannot be declared in an NgModule"
export function fixStandaloneInModuleDeclarations() {
  const srcDir = join(destPath, 'src');
  if (!existsSync(srcDir)) return 0;

  const classMap = buildClassMapInDir(srcDir);

  function isStandalone(className) {
    const file = classMap.get(className);
    if (!file || !existsSync(file)) return false;
    const src = readFileSync(file, 'utf8');
    return /standalone\s*:\s*true/.test(src);
  }

  const MODULE_RE = /@NgModule\s*\(/;
  let count = 0;

  walkFiles(srcDir, e => e.endsWith('.module.ts'), (full, e) => {
    let src = readFileSync(full, 'utf8');
    if (!src.includes('@NgModule')) return;

    // Find the declarations array manually (tmplGetDecoratorImportsArray only handles 'imports')
    const modIdx = src.search(MODULE_RE);
    if (modIdx === -1) return;
    let depth = 0, modEnd = -1;
    for (let i = src.indexOf('(', modIdx); i < src.length; i++) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')') { if (--depth === 0) { modEnd = i; break; } }
    }
    if (modEnd === -1) return;

    const body = src.slice(modIdx, modEnd + 1);
    const declM = body.match(/\bdeclarations\s*:\s*\[/);
    if (!declM) return;

    const declArrStart = modIdx + declM.index + declM[0].length - 1;
    let bd = 0, declArrEnd = -1;
    for (let i = declArrStart; i < src.length; i++) {
      if (src[i] === '[') bd++;
      else if (src[i] === ']') { if (--bd === 0) { declArrEnd = i; break; } }
    }
    if (declArrEnd === -1) return;

    const declContent = src.slice(declArrStart + 1, declArrEnd);
    const declared = declContent.match(/\b[A-Z][A-Za-z0-9_]*\b/g) ?? [];
    const toPromote = declared.filter(isStandalone);
    if (!toPromote.length) return;

    // Rebuild declarations array cleanly
    const toPromoteSet = new Set(toPromote);
    const toKeep = declared.filter(sym => !toPromoteSet.has(sym));
    const indentMatch = declContent.match(/\n([ \t]+)[A-Z]/);
    const itemIndent = indentMatch ? indentMatch[1] : '        ';
    const closeIndent = itemIndent.length >= 4 ? itemIndent.slice(0, -4) : '';
    const newDeclContent = toKeep.length > 0
      ? '\n' + toKeep.map(s => `${itemIndent}${s},`).join('\n') + '\n' + closeIndent
      : '\n' + closeIndent;
    let modified = src.slice(0, declArrStart + 1) + newDeclContent + src.slice(declArrEnd);
    declArrEnd = declArrStart + 1 + newDeclContent.length;

    const esImports = buildEsImportMap(modified);
    const toAdd = toPromote
      .filter(sym => {
        const imp = tmplGetDecoratorImportsArray(modified, MODULE_RE);
        return !imp?.existing.has(sym);
      })
      .map(sym => ({ sym, pkg: esImports.get(sym) ?? '.' }));

    if (toAdd.length) modified = tmplInjectImports(modified, toAdd, MODULE_RE);

    if (modified !== src) {
      writeFileSync(full, modified);
      count++;
      console.log(`  ↳ ${e}: ${toPromote.join(', ')} moved from declarations → imports`);
    }
  });
  if (count > 0) console.log(`  ↳ fixStandaloneInModuleDeclarations: ${count} module(s) corrigido(s)`);
  return count;
}

export function collectStandaloneFalseCount() {
  const srcDir = join(destPath, 'src');
  if (!existsSync(srcDir)) return 0;
  let count = 0;
  walkFiles(srcDir, e => e.endsWith('.ts') && !e.endsWith('.spec.ts'), (full) => {
    const src = readFileSync(full, 'utf8');
    if ((src.includes('standalone: false') || src.includes('standalone:false')) &&
        (src.includes('@Component(') || src.includes('@Pipe(') || src.includes('@Directive('))) {
      count++;
    }
  });
  return count;
}

export function convertOrphanedNonStandalone() {
  const srcDir = join(destPath, 'src');
  if (!existsSync(srcDir)) return 0;

  // Collect class names declared in still-existing NgModules
  const declaredInModule = new Set();
  walkFiles(srcDir, e => e.endsWith('.module.ts'), (full) => {
    const src = readFileSync(full, 'utf8');
    if (!src.includes('@NgModule')) return;
    const declIdx = src.search(/\bdeclarations\s*:/);
    if (declIdx === -1) return;
    const arrOpen = src.indexOf('[', declIdx);
    if (arrOpen === -1) return;
    let depth = 0, arrEnd = -1;
    for (let i = arrOpen; i < src.length; i++) {
      if (src[i] === '[') depth++;
      else if (src[i] === ']') { if (--depth === 0) { arrEnd = i; break; } }
    }
    if (arrEnd === -1) return;
    for (const m of src.slice(arrOpen + 1, arrEnd).matchAll(/\b[A-Z][A-Za-z0-9_]*\b/g)) {
      declaredInModule.add(m[0]);
    }
  });

  let count = 0;
  walkFiles(srcDir, e => e.endsWith('.ts') && !e.endsWith('.spec.ts'), (full) => {
    const src = readFileSync(full, 'utf8');
    if (!src.includes('@Component(')) return;
    if (!src.includes('standalone: false') && !src.includes('standalone:false')) return;

    const classNames = [...src.matchAll(/export\s+(?:abstract\s+)?class\s+([A-Z][A-Za-z0-9_]*)/g)].map(m => m[1]);
    if (classNames.some(cls => declaredInModule.has(cls))) return;

    let updated = src.replace(/\bstandalone\s*:\s*false/g, 'standalone: true');
    if (updated === src) return;
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
  });
  if (count > 0) console.log(`  ↳ ${count} componente(s) órfão(s) convertidos para standalone: true`);
  return count;
}

export function cleanupStandaloneTodos() {
  const srcDir = join(destPath, 'src');
  if (!existsSync(srcDir)) return 0;
  let count = 0;
  walkFiles(srcDir, e => e.endsWith('.ts') || e.endsWith('.html'), (full) => {
    const src = readFileSync(full, 'utf8');
    if (!src.includes('TODO(standalone-migration)')) return;
    const updated = src.split('\n')
      .filter(line => !/^\s*\/\/\s*TODO\(standalone-migration\)/.test(line))
      .join('\n')
      .replace(/\s*\/\*\s*TODO\(standalone-migration\)[^*]*\*\//g, '');
    if (updated !== src) { writeFileSync(full, updated); count++; }
  });
  if (count > 0) console.log(`  ↳ TODO(standalone-migration): removido de ${count} arquivo(s)`);
  return count;
}

export function fixCircularStandaloneImports() {
  const srcDir = join(destPath, 'src');
  if (!existsSync(srcDir)) return 0;

  const fileInfo = new Map();

  walkFiles(srcDir, e => e.endsWith('.ts') && !e.endsWith('.spec.ts'), (full) => {
    const src = readFileSync(full, 'utf8');
    if (!src.includes('standalone: true')) return;
    if (!/@(?:Component|Directive|Pipe)\s*\(/.test(src)) return;

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
  });

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

      // Checa se forwardRef já está IMPORTADO (não só presente no texto — acabamos de
      // inserir `forwardRef(() => c)`, então src.includes('forwardRef') seria sempre true).
      if (!/import\s+\{[^}]*\bforwardRef\b[^}]*\}\s+from\s+['"]@angular\/core['"]/.test(src)) {
        if (/^import\s+\{[^}]+\}\s+from\s+['"]@angular\/core['"]/m.test(src)) {
          src = src.replace(
            /^(import\s+\{)([^}]+)(\}\s+from\s+['"]@angular\/core['"])/m,
            (_, open, names, close) => `${open}${names.trimEnd()}, forwardRef${close}`,
          );
        } else {
          // Sem import de @angular/core ainda → adiciona um
          src = `import { forwardRef } from '@angular/core';\n${src}`;
        }
      }

      writeFileSync(fixFile, src);
      fixed++;
    }
  }

  if (fixed > 0) console.log(`  ↳ ${fixed} dependência(s) circular(es) corrigida(s) com forwardRef`);
  return fixed;
}

// ─── Build error loop: usa o compilador Angular como oráculo ─────────────────
// Roda ng build, parseia NG8001/NG8002/NG8004, resolve o símbolo buscando nos
// próprios .d.ts instalados e nas importações ES do projeto — sem hardcode.
export function autoFixBuildErrors() {
  const COMPONENT_RE = /@Component\s*\(/;
  const srcDir = join(destPath, 'src');
  if (!existsSync(srcDir)) return 0;

  // Constrói mapa de todos os imports ES já presentes no projeto: sym → pkg
  // Assim, se WebcamModule já foi adicionado em algum arquivo pelo cascade de módulos,
  // conseguimos encontrá-lo mesmo que o módulo original tenha sido removido.
  function buildProjectEsMap() {
    const map = new Map(); // sym → pkg
    walkFiles(srcDir, e => e.endsWith('.ts') && !e.endsWith('.spec.ts'), (full) => {
      const src = readFileSync(full, 'utf8');
      for (const m of src.matchAll(/^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/gm)) {
        const pkg = m[2];
        if (pkg.startsWith('.')) continue;
        for (const sym of m[1].split(',').map(s => s.replace(/\s+as\s+\w+/, '').trim()).filter(Boolean)) {
          if (!map.has(sym)) map.set(sym, pkg);
        }
      }
    });
    return map;
  }

  // Índice símbolo → pacote a partir dos .d.ts dos pacotes instalados (classes/const/fn
  // exportados). Usado para resolver TS2304 "Cannot find name 'X'" quando NENHUM arquivo do
  // projeto importa X (ex: NbAuthComponent, NbToastrModule referenciados no app.config/routes
  // gerados, mas sem o import ES). Cacheado.
  let _extIndex = null;
  function buildExternalSymbolIndex() {
    if (_extIndex) return _extIndex;
    _extIndex = new Map();
    const nmDir = join(destPath, 'node_modules');
    const pkgJsonPath = join(destPath, 'package.json');
    if (!existsSync(nmDir) || !existsSync(pkgJsonPath)) return _extIndex;
    let deps = {};
    try { const p = JSON.parse(readFileSync(pkgJsonPath, 'utf8')); deps = { ...(p.dependencies ?? {}), ...(p.devDependencies ?? {}) }; } catch {}
    for (const pkgName of Object.keys(deps)) {
      if (pkgName.startsWith('@types/')) continue;
      const parts = pkgName.startsWith('@') ? pkgName.split('/') : [pkgName];
      const pkgDir = join(nmDir, ...parts);
      if (!existsSync(pkgDir)) continue;
      let dts = '';
      try {
        const meta = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
        const t = meta.typings ?? meta.types;
        const cands = [t && join(pkgDir, t), join(pkgDir, 'index.d.ts'), join(pkgDir, 'public-api.d.ts')].filter(Boolean);
        for (const f of cands) { if (existsSync(f)) { dts = readFileSync(f, 'utf8'); break; } }
      } catch {}
      if (!dts) continue;
      // classes/funções/consts exportadas (declare class X / export declare class X / export { X })
      for (const m of dts.matchAll(/(?:export\s+)?declare\s+(?:abstract\s+)?(?:class|function|const|enum)\s+([A-Z]\w*)/g)) {
        if (!_extIndex.has(m[1])) _extIndex.set(m[1], pkgName);
      }
      for (const m of dts.matchAll(/export\s*\{([^}]+)\}/g)) {
        for (const sym of m[1].split(',').map(s => s.replace(/\s+as\s+\w+/, '').trim()).filter(s => /^[A-Z]\w*$/.test(s))) {
          if (!_extIndex.has(sym)) _extIndex.set(sym, pkgName);
        }
      }
    }
    return _extIndex;
  }

  // Detect available build configuration by reading angular.json — avoids launching
  // a full build process just to check if 'development' config exists.
  const ngBuildCmd = (() => {
    const ngPath = join(destPath, 'angular.json');
    try {
      const ng = JSON.parse(readFileSync(ngPath, 'utf8'));
      for (const proj of Object.values(ng.projects ?? {})) {
        if (proj.architect?.build?.configurations?.development) {
          return 'npx ng build --configuration development 2>&1';
        }
      }
    } catch {}
    return 'npx ng build 2>&1';
  })();

  let totalFixed = 0;
  const MAX_PASSES = 6;
  // Build once before the loop; rebuilt only after files are written (passFixed > 0)
  let projectEsMap = buildProjectEsMap();

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    // Remove códigos ANSI de cor — senão o split por "✘ [ERROR] NGxxxx:" não casa
    // (os escapes quebram o literal) e só o primeiro erro de cada tipo é parseado.
    const out = capture(ngBuildCmd).replace(/\x1b\[[0-9;]*m/g, '');
    if (!out) break;
    if (!out.includes('ERROR')) break;

    // NG6008/NG6004: standalone component still in NgModule declarations → fix and re-build
    if (out.includes('NG6008') || out.includes('NG6004')) {
      const fixed = fixStandaloneInModuleDeclarations();
      if (fixed > 0) { totalFixed += fixed; continue; }
    }

    // Coleta erros NG8001/NG8004 (import desconhecido) e NG2012 (import inválido)
    // Suporta dois formatos de output:
    //   esbuild: "✘ [ERROR] NG2012: ...\n  src/path.ts:88:8:\n    88 │     Symbol,"
    //   webpack: "Error: src/path.ts:88:9 - error NG2012: ...\n88     Symbol,"
    const errors = [];

    // ── esbuild format ──────────────────────────────────────────────────────
    const esbuildBlocks = out.split(/(?=✘ \[ERROR\] NG(?:800[14]|2012|6008|6004):)/);
    for (const block of esbuildBlocks) {
      let name = null; let type = null;
      // Angular ≤16 emitia "'<nb-card>'"; Angular 17+ emite "'nb-card'" (sem <>). Aceita ambos.
      const ng8001 = block.match(/NG8001[^']*'<?([^'<>]+)>?'/);
      const ng8004 = block.match(/NG8004[^']*'([^']+)'/);
      const ng2012 = block.match(/NG2012[^\n]*/);
      if (ng8001) { name = ng8001[1]; type = 'element'; }
      else if (ng8004) { name = ng8004[1]; type = 'pipe'; }
      else if (ng2012) { type = 'invalid-import'; }
      if (!type) continue;
      const tsMatch = block.match(/\b(src\/[^\s:'"]+\.(?:component|directive|pipe)\.ts)/);
      if (!tsMatch) continue;
      let resolvedTs = tsMatch[1];
      if (!resolvedTs) {
        const htmlMatch = block.match(/\b(src\/[^\s:'"]+\.component\.html)/);
        if (htmlMatch) resolvedTs = htmlMatch[1].replace('.html', '.ts');
      }
      if (!resolvedTs) continue;
      if (type === 'invalid-import') {
        // esbuild shows: "    88 │     NgProgressModule,"
        const symMatch = block.match(/│\s+([A-Z][A-Za-z0-9_]*)\s*[,\]]/);
        if (!symMatch) continue;
        errors.push({ name: symMatch[1], type: 'invalid-import', compFile: join(destPath, resolvedTs) });
      } else {
        errors.push({ name, type, compFile: join(destPath, resolvedTs) });
      }
    }

    // ── webpack format ──────────────────────────────────────────────────────
    // "Error: src/path.ts:LINE:COL - error NG2012: ..."  followed by  "LINE     Symbol,"
    const webpackLines = out.split('\n');
    for (let i = 0; i < webpackLines.length; i++) {
      const line = webpackLines[i];
      if (!line.includes('NG2012')) continue;
      // webpack: "Error: src/app/foo.component.ts:88:9 - error NG2012:"
      const fileLine = line.match(/Error:\s+(src\/[^\s:]+\.(?:component|directive|pipe)\.ts):(\d+):\d+\s+-\s+error NG2012/);
      if (!fileLine) continue;
      const resolvedTs = fileLine[1];
      const lineNo = parseInt(fileLine[2], 10);
      // The symbol is on the source-echo line: "88     NgProgressModule,"
      // Angular CLI prints it within the next ~3 lines
      for (let j = i + 1; j <= Math.min(i + 4, webpackLines.length - 1); j++) {
        const srcLine = webpackLines[j];
        const symMatch = srcLine.match(/^\s*\d+\s+([A-Z][A-Za-z0-9_]*)\s*[,\]]/);
        if (symMatch) {
          errors.push({ name: symMatch[1], type: 'invalid-import', compFile: join(destPath, resolvedTs) });
          break;
        }
      }
    }

    // TS2304: "Cannot find name 'X'" → símbolo usado sem import (ex: NbSidebarModule no
    // app.config, NbAuthComponent no app.routes, forwardRef). Resolve via imports do projeto
    // + índice dos .d.ts instalados e adiciona o import ES. (TS2663, com "Did you mean
    // instance member", é tratado à parte abaixo — aqui só os que precisam de import.)
    if (out.includes('TS2304')) {
      let fixed2304 = 0;
      const extIndex = buildExternalSymbolIndex();
      const blocks = out.split(/(?=✘ \[ERROR\] TS2304:)/);
      for (const block of blocks) {
        if (!block.includes('TS2304')) continue;
        const symMatch = block.match(/Cannot find name '(\w+)'/);
        const fileMatch = block.match(/\b(src\/[^\s:'"]+\.ts)/);
        if (!symMatch || !fileMatch) continue;
        const sym = symMatch[1];
        const filePath = join(destPath, fileMatch[1]);
        if (!existsSync(filePath)) continue;
        let src = readFileSync(filePath, 'utf8');
        if (new RegExp(`import\\s*\\{[^}]*\\b${sym}\\b`).test(src)) continue; // já importado
        const pkg = projectEsMap.get(sym) || extIndex.get(sym);
        if (!pkg) continue; // não resolvível → não é caso de import faltante (erro real)
        const lastIm = [...src.matchAll(/^import\s+.+;[ \t]*$/gm)].pop();
        const pos = lastIm ? lastIm.index + lastIm[0].length : 0;
        src = src.slice(0, pos) + `\nimport { ${sym} } from '${pkg}';` + src.slice(pos);
        writeFileSync(filePath, src);
        fixed2304++;
        console.log(`  ↳ ${basename(filePath)}: + import { ${sym} } from '${pkg}' (TS2304)`);
      }
      if (fixed2304 > 0) { totalFixed += fixed2304; continue; }
    }

    // TS2341: "Property 'X' is private and only accessible within class 'Y'" → o membro é
    // acessado no template, e templates Angular (estritos no 14+) não acessam membros private.
    // Torna o membro public (remove o modificador `private` da declaração).
    if (out.includes('TS2341')) {
      let fixed2341 = 0;
      const blocks = out.split(/(?=✘ \[ERROR\] TS2341:)/);
      for (const block of blocks) {
        if (!block.includes('TS2341')) continue;
        const m = block.match(/Property '(\w+)' is private/);
        const fileM = block.match(/\b(src\/[^\s:'"]+\.(?:ts|html))/);
        if (!m || !fileM) continue;
        const prop = m[1];
        const filePath = join(destPath, fileM[1].replace(/\.html$/, '.ts'));
        if (!existsSync(filePath)) continue;
        let src = readFileSync(filePath, 'utf8');
        const re = new RegExp(`(^[ \\t]*(?:@[\\w.]+\\([^)]*\\)\\s*)?)private(\\s+(?:readonly\\s+)?${prop}\\b)`, 'm');
        if (!re.test(src)) continue;
        src = src.replace(re, '$1$2');
        writeFileSync(filePath, src);
        fixed2341++;
        console.log(`  ↳ ${basename(filePath)}: '${prop}' private → public (TS2341 — usado no template)`);
      }
      if (fixed2341 > 0) { totalFixed += fixed2341; continue; }
    }

    // TS2663: "Cannot find name 'X'. Did you mean instance member 'this.X'?" → add `this.`
    if (out.includes('TS2663')) {
      let fixed2663 = 0;
      const ts2663Blocks = out.split(/(?=✘ \[ERROR\] TS2663:)/);
      for (const block of ts2663Blocks) {
        if (!block.includes('TS2663')) continue;
        const fileMatch = block.match(/\b(src\/[^\s:'"]+\.ts)/);
        const lineMatch = block.match(/\b(?:src\/[^\s:'"]+\.ts):(\d+):/);
        const symMatch = block.match(/Cannot find name '(\w+)'/);
        if (!fileMatch || !lineMatch || !symMatch) continue;
        const filePath = join(destPath, fileMatch[1]);
        const lineNo = parseInt(lineMatch[1], 10);
        const sym = symMatch[1];
        if (!existsSync(filePath)) continue;
        const lines = readFileSync(filePath, 'utf8').split('\n');
        const idx = lineNo - 1;
        if (idx < 0 || idx >= lines.length) continue;
        const oldLine = lines[idx];
        // Replace bare `sym.` with `this.sym().` or `this.sym.` depending on context
        // Use `this.sym()?.` for signal-style viewChild results, `this.sym.` otherwise
        const newLine = oldLine.replace(new RegExp(`(?<!this\\.)\\b${sym}\\b\\.`, 'g'), `this.${sym}()!.`);
        if (newLine !== oldLine) {
          lines[idx] = newLine;
          writeFileSync(filePath, lines.join('\n'));
          fixed2663++;
          console.log(`  ↳ ${basename(filePath)}:${lineNo}: '${sym}.' → 'this.${sym}()?.'' (TS2663)`);
        }
      }
      if (fixed2663 > 0) { totalFixed += fixed2663; continue; }
    }

    // TS2305: "Module 'X' has no exported member 'Y'" → import fantasma. Acontece quando
    // um símbolo é resolvido a partir de algo que NÃO é export real (ex: 'PageModule' que
    // só aparece em comentário JSDoc de exemplo no .d.ts do @nebular/theme). O compilador é
    // o oráculo: remove o import inválido e a entrada correspondente no imports[] do decorator.
    if (out.includes('TS2305')) {
      let fixed2305 = 0;
      const blocks = out.split(/(?=✘ \[ERROR\] TS2305:)/);
      for (const block of blocks) {
        if (!block.includes('TS2305')) continue;
        const symMatch = block.match(/has no exported member '([A-Za-z_]\w*)'/);
        const fileMatch = block.match(/\b(src\/[^\s:'"]+\.ts)/);
        if (!symMatch || !fileMatch) continue;
        const sym = symMatch[1];
        const filePath = join(destPath, fileMatch[1]);
        if (!existsSync(filePath)) continue;
        let src = readFileSync(filePath, 'utf8');
        const before = src;
        // 1) import dedicado só com o símbolo → remove a linha inteira
        src = src.replace(new RegExp(`^[ \\t]*import\\s*\\{\\s*${sym}\\s*\\}\\s*from\\s*['"][^'"]+['"];?[ \\t]*\\r?\\n`, 'm'), '');
        // 2) import múltiplo → remove só o símbolo da lista
        src = src.replace(new RegExp(`(import\\s*\\{[^}]*?)\\b${sym}\\b\\s*,?\\s*([^}]*\\}\\s*from)`, 'm'), '$1$2');
        // 3) entrada "bare" do símbolo no imports[]/declarations[] (linha própria)
        src = src.replace(new RegExp(`^[ \\t]*${sym}\\s*,?[ \\t]*\\r?\\n`, 'm'), '');
        // 4) limpa vírgulas órfãs que possam sobrar
        src = src.replace(/\[\s*,/g, '[').replace(/,(\s*,)+/g, ',').replace(/,(\s*[\]\)])/g, '$1');
        if (src !== before) {
          writeFileSync(filePath, src);
          fixed2305++;
          console.log(`  ↳ ${basename(filePath)}: removido import fantasma '${sym}' (TS2305 — não existe em ${(block.match(/Module '"?([^'"]+)"?'/) || [,'?'])[1]})`);
        }
      }
      if (fixed2305 > 0) { totalFixed += fixed2305; continue; }
    }

    // TS2345: Argument of type 'unknown' not assignable to 'void' — .emit(e) → .emit()
    if (out.includes('TS2345') && out.includes("parameter of type 'void'")) {
      let fixed2345 = 0;
      const ts2345Blocks = out.split(/(?=✘ \[ERROR\] TS2345:)/);
      for (const block of ts2345Blocks) {
        if (!block.includes("parameter of type 'void'")) continue;
        const fileMatch = block.match(/\b(src\/[^\s:'"]+\.ts)/);
        const lineMatch = block.match(/\b(?:src\/[^\s:'"]+\.ts):(\d+):/);
        if (!fileMatch || !lineMatch) continue;
        const filePath = join(destPath, fileMatch[1]);
        const lineNo = parseInt(lineMatch[1], 10);
        if (!existsSync(filePath)) continue;
        const lines = readFileSync(filePath, 'utf8').split('\n');
        const idx = lineNo - 1;
        if (idx < 0 || idx >= lines.length) continue;
        const oldLine = lines[idx];
        // Pattern: .emit(someArg) where emit output is void → .emit()
        // Also fix the subscribe callback: (e => emit(e)) → (() => emit())
        let newLine = oldLine.replace(/\.subscribe\(\s*\w+\s*=>\s*([^;]+\.emit)\([^)]+\)\s*\)/, '.subscribe(() => $1())');
        if (newLine === oldLine) newLine = oldLine.replace(/\.emit\([^)]+\)/, '.emit()');
        if (newLine !== oldLine) {
          lines[idx] = newLine;
          writeFileSync(filePath, lines.join('\n'));
          fixed2345++;
          console.log(`  ↳ ${basename(filePath)}:${lineNo}: .emit(arg) → .emit() (TS2345)`);
        }
      }
      if (fixed2345 > 0) { totalFixed += fixed2345; continue; }
    }

    // TS2322: type assignment mismatch → add `as TypeName` cast
    if (out.includes('TS2322')) {
      let fixed2322 = 0;
      const ts2322Blocks = out.split(/(?=✘ \[ERROR\] TS2322:)/);
      for (const block of ts2322Blocks) {
        if (!block.includes('TS2322')) continue;
        const fileMatch = block.match(/\b(src\/[^\s:'"]+\.ts)/);
        const lineMatch = block.match(/\b(?:src\/[^\s:'"]+\.ts):(\d+):/);
        // Extract target type from error message
        const typeMatch = block.match(/parameter of type '([^']+)'\s*\.\s*Type '([^']+)' is missing/);
        if (!fileMatch || !lineMatch || !typeMatch) continue;
        const targetType = typeMatch[1];
        const filePath = join(destPath, fileMatch[1]);
        const lineNo = parseInt(lineMatch[1], 10);
        if (!existsSync(filePath)) continue;
        const lines = readFileSync(filePath, 'utf8').split('\n');
        const idx = lineNo - 1;
        if (idx < 0 || idx >= lines.length) continue;
        const oldLine = lines[idx];
        // Add type cast to assignment: `this.x = expr;` → `this.x = expr as TargetType;`
        const newLine = oldLine.replace(/(=\s*)([^;]+)(;)$/, (_, eq, val, semi) => {
          const v = val.trim();
          if (v.endsWith(`as ${targetType}`)) return _;
          return `${eq}${v} as ${targetType}${semi}`;
        });
        if (newLine !== oldLine) {
          lines[idx] = newLine;
          writeFileSync(filePath, lines.join('\n'));
          fixed2322++;
          console.log(`  ↳ ${basename(filePath)}:${lineNo}: added 'as ${targetType}' cast (TS2322)`);
        }
      }
      if (fixed2322 > 0) { totalFixed += fixed2322; continue; }
    }

    if (!errors.length) break; // sem erros relevantes → pronto

    const dynReg = buildDynamicNgRegistry();
    let passFixed = 0;

    for (const { name, type, compFile } of errors) {
      if (!existsSync(compFile)) continue;
      let src = readFileSync(compFile, 'utf8');
      if (!src.includes('@Component(')) continue;

      // NG2012: invalid import — replace with TODO comment so the developer knows what to update
      if (type === 'invalid-import') {
        const arrInfo = tmplGetDecoratorImportsArray(src, COMPONENT_RE);
        if (!arrInfo || !arrInfo.existing.has(name)) continue;
        // Replace the symbol with a TODO comment inside the imports array
        const todo = `// TODO: [NG2012] ${name} — NgModule incompatível com Angular. Atualize o pacote para versão compatível.`;
        src = src.replace(new RegExp(`\\b${name}\\b,?([ \\t]*)\\n?`, 'g'), (m, trail, offset) => {
          if (offset >= arrInfo.start && offset <= arrInfo.end) return `${todo}\n`;
          return m;
        });
        // Comment out the ES import statement for this symbol
        src = src.replace(
          new RegExp(`^(import\\s+\\{[^}]*\\b${name}\\b[^}]*\\}\\s+from\\s+['"][^'"]+['"];?)`, 'm'),
          (m) => `// TODO: ${m}`,
        );
        writeFileSync(compFile, src);
        passFixed++;
        console.log(`  ↳ ${basename(compFile)}: '${name}' marcado como TODO (NG2012 — NgModule incompatível)`);
        continue;
      }

      if (!src.includes('standalone: true')) continue;

      // Angular core symbols that must NEVER be added to component imports[]
      const NEVER_IMPORT = new Set([
        'Component', 'Directive', 'Pipe', 'NgModule', 'Injectable', 'Inject',
        'Input', 'Output', 'ViewChild', 'ViewChildren', 'ContentChild', 'ContentChildren',
        'HostListener', 'HostBinding', 'EventEmitter', 'ChangeDetectionStrategy',
        'inject', 'input', 'output', 'viewChild', 'viewChildren', 'contentChild', 'model',
        'OnInit', 'OnDestroy', 'AfterViewInit', 'AfterContentInit', 'DoCheck',
        'ChangeDetectorRef', 'ElementRef', 'TemplateRef', 'ViewContainerRef', 'Injector',
      ]);

      // Resolve o símbolo: registry dinâmico → imports ES do projeto
      let found = type === 'element' ? dynReg.elements.get(name) : dynReg.pipes.get(name);
      if (!found) {
        // Procura no mapa de imports ES do projeto: qualquer símbolo cujo nome
        // contenha o nome do elemento/pipe (heurística para WebcamModule ← webcam, etc.)
        const needle = name.replace(/-([a-z])/g, (_, c) => c.toUpperCase()); // kebab → camel
        for (const [sym, pkg] of projectEsMap) {
          if (NEVER_IMPORT.has(sym)) continue;
          // Only consider symbols that are valid component imports
          if (type === 'element') {
            if (!sym.endsWith('Module') && !sym.endsWith('Component') && !sym.endsWith('Directive')) continue;
          } else if (type === 'pipe') {
            if (!sym.endsWith('Pipe') && !sym.endsWith('Module')) continue;
          }
          // Never add services or other non-importable symbols
          if (sym.endsWith('Service') || sym.endsWith('Guard') || sym.endsWith('Resolver') ||
              sym.endsWith('Interceptor') || sym.endsWith('Factory') || sym.endsWith('Strategy')) continue;
          const base = sym.replace(/Module$|Component$|Pipe$|Directive$/, '');
          if (!base) continue;
          if (sym.toLowerCase().includes(needle.toLowerCase()) || needle.toLowerCase().includes(base.toLowerCase())) {
            found = { sym, pkg }; break;
          }
        }
      }

      if (found && NEVER_IMPORT.has(found.sym)) found = null;

      if (!found) {
        console.log(`  ↳ ⚠  ${type} '${name}' não resolvido em ${basename(compFile)} — adicione manualmente`);
        continue;
      }

      const arrInfo = tmplGetDecoratorImportsArray(src, COMPONENT_RE);
      if (arrInfo?.existing.has(found.sym)) continue;

      const modified = tmplInjectImports(src, [found], COMPONENT_RE);
      if (modified !== src) {
        writeFileSync(compFile, modified);
        passFixed++;
        console.log(`  ↳ ${basename(compFile)}: +${found.sym} (${type} '${name}' — build error fix)`);
      }
    }

    totalFixed += passFixed;
    if (passFixed === 0) break; // nenhuma correção nesse pass → não há progresso
    projectEsMap = buildProjectEsMap(); // arquivos foram escritos — atualiza o mapa
    console.log(`  ↳ build error fix pass ${pass + 1}: ${passFixed} correção(ões)`);
  }

  return totalFixed;
}
