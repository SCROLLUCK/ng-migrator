# ng-migrator — Pontos de melhoria (mapa do stress-test orion-web 11→22)

Descobertos migrando o **orion-web** (Angular 11 → 22, projeto real, ~6000 erros de build no
estado final da migração). Cada item: **problema → evidência → fix → status**. Ordenado por impacto.

Legenda status: ✅ feito · 🔜 a portar · 🔬 investigar

---

## 1. GENÉRICOS (afetam qualquer projeto) — alta prioridade

### 1.1 `modernizeTsconfig` deve setar `strict: false` em projetos não-strict 🔜
- **Problema:** TypeScript 6 (exigido pelo Angular 22) liga as checagens da família `strict` por
  **default** (strictPropertyInitialization, noImplicitAny, strictNullChecks). Projeto que nunca foi
  strict é inundado.
- **Evidência:** orion (nunca teve `strict` no tsconfig) → **~2500 erros** TS2564/TS7006/TS7053/
  TS18047/TS18048. Setar `strict:false` + flags explícitas zerou todos.
- **Fix:** `modernizeTsconfig` detecta se o projeto era strict; se não, grava
  `"strict": false` (ou as flags individuais) explicitamente. Preserva o comportamento do projeto;
  o dev opta por strict depois.

### 1.2 Completar a migração standalone (declarável `standalone:false` em `imports[]`) 🔜
- **Problema:** o `ng update@19` marca pipes/diretivas em `declarations` de módulo como
  `standalone: false`. A migração standalone dos **componentes** copia esses símbolos pros
  `imports[]` deles → `standalone:false` não pode ir em `imports` → **NG2011/NG2012**.
- **Evidência:** orion → **4872 NG2011** (14 utilitários em `shared.module`, importados em ~348
  componentes cada).
- **Fix (generic step):** símbolo que aparece em `imports[]` de componente standalone **tem que ser
  standalone**. Para cada declarável `standalone:false` nessa situação: flipar p/ `standalone:true`
  e **mover de `declarations` → `imports`** no NgModule (preservando `exports`).

### 1.3 Bug: pins de versão do `upgradeThirdPartyForIvy` não persistem no `package.json` 🔬
- **Problema:** o passo reporta "lib subida p/ vN (Ivy)" em `report.notes`, mas o `package.json`
  fica na versão antiga (View Engine) → NG2012 em cascata.
- **Evidência:** orion notes diziam `ngx-infinite-scroll → 21.0.0`, mas `package.json` tinha
  `^8.0.2` (e `node_modules` idem). Subir manualmente p/ 21 (Ivy) zerou os 348 NG2011.
- **Fix:** garantir que o pin grave no `package.json` **e** sobreviva ao `npm install` seguinte
  (provável conflito de peer resolvendo de volta p/ a versão antiga). Investigar a ordem
  pin → reconcile → install.

### 1.4 `fixStandaloneImports` não cobre diretivas usadas por **atributo** 🔜
- **Problema:** componente standalone usa uma diretiva via binding de atributo no template
  (`currencyMask [options]`, `[colorPicker]`, `matBadge`) mas não a importa (dependia do
  SharedModule re-exportar). → **NG8002** "Can't bind to 'X'".
- **Evidência:** orion → NgxCurrencyDirective (9 comps), ColorPickerDirective (6), MatBadgeModule (2).
- **Fix:** ampliar a detecção de imports faltantes para **bindings de atributo de diretiva**, não só
  elementos/pipes.

### 1.5 ✅ `runCorrections` buildava com `--configuration development` (inexistente em alguns workspaces)
- **FEITO.** Era o motivo de **nenhuma correction error-driven** disparar no orion (só a flex-layout
  proativa). Agora usa `ng build --no-progress` (config default, = build-check). Commitado.

---

## 2. CORREÇÕES novas (lib-specific) — validadas no orion

### 2.1 ✅ Criadas e commitadas
- `ngx-currency-standalone` — NgxCurrencyModule → NgxCurrencyDirective + provideEnvironmentNgxCurrency()
- `ngx-color-picker-standalone` — ColorPickerModule → ColorPickerDirective
- `ngx-ui-loader-path` — import `ngx-ui-loader/public-api` → `ngx-ui-loader`

### 2.2 🔜 A criar (validadas manualmente no orion)
- **ngx-infinite-scroll** — InfiniteScrollModule → InfiniteScrollDirective (+ subir p/ versão Ivy).
- **ngx-webcam** — só subir p/ 0.4.x (Ivy); mantém WebcamModule.
- **@angular/material button NG8023** — `<button mat-button mat-icon-button>` (ambos) → remover o
  `mat-button` redundante. Material v19+ não tolera (Multiple components match). Orion: ~1200 botões.
- **@angular/material slider v17** — `<mat-slider [value] [thumbLabel]>` → `<mat-slider><input
  matSliderThumb>`. (ainda não feito no orion)
- **ComponentFactoryResolver removido v17** — `resolver.resolveComponentFactory(X)` +
  `vcr.createComponent(factory)` → `vcr.createComponent(X)` direto. Genérico do Angular.

### 2.3 🔬 Casos difíceis (decisão de design / troca de lib)
- **ngx-swiper-wrapper (morto, sem Ivy) → swiper-element** — web component: `register()` no main,
  `<swiper-container>`/`<swiper-slide>`, `CUSTOM_ELEMENTS_SCHEMA`, config via ViewChild. Templates
  variados (swipers aninhados, ngTemplateOutlet) → precisa validação visual. Correção **proativa**
  (gate, como flex-layout) seria o encaixe.
- **@ngx-progressbar/core (View Engine no latest 5.3.2) → ngx-progressbar (standalone)** — troca de lib.

---

## 3. ARTEFATOS de migração existente — refinar

### 3.1 Signals: acesso a viewChild/input sem `this.X()` em alguns contextos 🔜
- `fixSignalPropertyAccess`/`fixTs2663SignalAccess` deixaram passar usos em `ngOnInit` e métodos
  (ex: `appAutocomplete._reset` em vez de `this.appAutocomplete()._reset`; `paginator.pageIndex`).
- Orion: ~17 TS2663. Fix: cobrir mais contextos (não só acesso direto no corpo).

### 3.2 Signals: mutação de input de componente filho (TS2540 read-only) 🔬
- Código mutava `childComp.inputProp = x` (válido pré-signals). Migração tornou o input signal
  (readonly) → TS2540. Não há fix mecânico seguro — **reportar** em `report.notes` para revisão.

### 3.3 Corrections de lib: provider/config perdidos em contexto standalone 🔜
- `addProviderToNgModule` só age em `@NgModule`. Em `importProvidersFrom(X.forRoot(config))`
  (app.config standalone), a correção troca `X.forRoot(config)` → `XDirective` e **perde o config**
  (ex: `NgxMaskModule.forRoot(MASK_OPTIONS)` → perde MASK_OPTIONS, sem `provideNgxMask(MASK_OPTIONS)`).
- Fix: tratar o caso `importProvidersFrom(X.forRoot(cfg))` → mover `provideX(cfg)` pros providers.

---

## 4. Resumo do impacto no orion (6000+ → ~50)
| Categoria | Erros zerados |
|---|---|
| TS6 strict default (1.1) | ~2500 |
| Standalone incompleto (1.2) | 4872 (NG2011) |
| Libs NgModule removido (corrections) | ~960 (TS2305 + NG2012 swiper) |
| moment default import | 83 |
| NG8023 botão Material | ~1200 |
| Imports standalone faltando (1.4) | ~11 |
| Restante (swiper runtime, NgProgress, renames, typing) | ~50 (em andamento) |
