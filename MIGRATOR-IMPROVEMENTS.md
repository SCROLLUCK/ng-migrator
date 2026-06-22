# ng-migrator — Pontos de melhoria (mapa do stress-test orion-web 11→22)

Descobertos migrando o **orion-web** (Angular 11 → 22, projeto real, ~6000 erros de build no
estado final da migração). Cada item: **problema → evidência → fix → status**. Ordenado por impacto.

Legenda status: ✅ feito · 🔜 a portar · 🔬 investigar

---

## 0. Estabilização (rodadas v5→v7) — ✅ IMPLEMENTADO

Convergência do orion 11→22: **602 → ~31 erros reais** (+ NG8113 over-import de **4740 → ~182**). Detalhes em CLAUDE.md (cada um virou seção lá). Resumo:

- **`maxBuffer: 256MB`** em `capture`/`runCapture` — o default de 1MB truncava o build (milhares de NG8113) e os códigos de erro reais sumiam → **correções error-driven não disparavam em silêncio** (moment deixava 116 TS2349). Destrava corrections + `pruneOverImports`.
- **`pruneOverImports()`** — oráculo NG8113 (contraparte do autoFix): remove over-imports cirurgicamente, **funciona com build sujo** (≠ schematic `cleanup-unused-imports`). Validado em 66 componentes (4727 removidos, 0 falhas). 4740 → ~182.
- **#1 NG8002 self-healing** — `autoFixBuildErrors` resolve `NG8002` via registry de `ɵɵDirectiveDeclaration` (seletor/input→diretiva). Regressão corrigida: só registra standalone-ou-módulo-resolvido (fim do NG2011 ngx-pipes) + attrs de diretiva em mapa separado (não vaza `[text]` genérico pro `tmplDetectNeeded` especulativo). + roda **após as correções** (que criam os NG8002).
- **buildCheck conta erros e warnings SEPARADOS** (2 badges na UI) — "13 mil erros" eram ~9,5k NG8113 (warning, transitório).
- **Skew de patch de framework** (`platform-browser-dynamic@20.0.7` vs `platform-browser@20.3.25`) → `--force` com mensagem enganosa. Fix: `extractConflictPackages` pina `@angular/*` na versão EXATA no retry do conflito (não `@v`). `syncVersions` só alinha quem está atrás (sem churn em spec já no major).
- **Material slider idempotente** — `gate v>=15` roda até 8x; o `fixSlider` prependia `<input matSliderThumb>` a cada vez (mangled). Lookahead pula já-convertidos.
- **Baseline commit** antes da modernização — isola os diffs dos steps (fim do "3 vs 46 arquivos").
- **Real-time UI via CLI** — migrador faz tee de TODA a saída (inclusive child procs) p/ `<dest>/.ng-migrator/migration.log`; UI auto-attacha (status `running`), formulário reflete os args REAIS (`cliConfig`), load segue ao-vivo se for a migração rodando.

**Restantes (pós-v7):** correção do **NgProgress** (NG8002 `spinner`/`speed`/…), `matBadge` (Material multi-entry), uns TS misc/syntax.

---

## 1. GENÉRICOS (afetam qualquer projeto) — alta prioridade

### 1.1 ✅ IMPLEMENTADO — `modernizeTsconfig` seta `strict: false` em projetos não-strict
> Em `transforms.mjs`: gateado em `opts.to >= 22` (TS6), se `co.strict === undefined` → `strict: false` (preserva não-strict; projeto `strict:true` fica intacto) + `ignoreDeprecations: "6.0"` (TS6 vira deprecation-warning em erro). Confirmado no orion: tsconfig nunca teve strict (undefined em todas as versões), mas TS6 ligava a família por default → ~2500 erros.
- **Problema:** TypeScript 6 (exigido pelo Angular 22) liga as checagens da família `strict` por
  **default** (strictPropertyInitialization, noImplicitAny, strictNullChecks). Projeto que nunca foi
  strict é inundado.
- **Evidência:** orion (nunca teve `strict` no tsconfig) → **~2500 erros** TS2564/TS7006/TS7053/
  TS18047/TS18048. Setar `strict:false` + flags explícitas zerou todos.
- **Fix:** `modernizeTsconfig` detecta se o projeto era strict; se não, grava
  `"strict": false` (ou as flags individuais) explicitamente. Preserva o comportamento do projeto;
  o dev opta por strict depois.

### 1.2 ✅ IMPLEMENTADO — Completar a migração standalone (declarável `standalone:false` em `imports[]`)
> A lacuna estava no `fixMissingStandalone` (`standalone.mjs`): o branch de `@Pipe`/`@Directive` **pulava** quando já havia a chave `standalone` — incluindo `standalone: false` (que o `ng update@19` adiciona). Então pipes/directives ficavam `standalone:false`, eram copiados pro `imports[]` de componentes standalone → **NG2011/NG2012** (orion: 4872). Fix: o branch agora **flipa `standalone:false`→`true`** (igual ao de @Component); depois `fixStandaloneInModuleDeclarations` os move de declarations→imports. Bônus: `buildInternalProjectIndex` só indexa standalone → uma vez flipados, são detectados pelo `fixStandaloneImports` (resolve parte do §1.4 também).
- **Problema:** o `ng update@19` marca pipes/diretivas em `declarations` de módulo como
  `standalone: false`. A migração standalone dos **componentes** copia esses símbolos pros
  `imports[]` deles → `standalone:false` não pode ir em `imports` → **NG2011/NG2012**.
- **Evidência:** orion → **4872 NG2011** (14 utilitários em `shared.module`, importados em ~348
  componentes cada).
- **Fix (generic step):** símbolo que aparece em `imports[]` de componente standalone **tem que ser
  standalone**. Para cada declarável `standalone:false` nessa situação: flipar p/ `standalone:true`
  e **mover de `declarations` → `imports`** no NgModule (preservando `exports`).

### 1.3 ✅ IMPLEMENTADO — pins do `upgradeThirdPartyForIvy` não persistiam no `package.json`
- **Causa-raiz (achada):** `upgradeThirdPartyForIvy` (gate v16) pinava `@21` no package.json, mas o **reconcile do node_modules só instalava os pins do `pinCompatibleThirdParty`** (que roda depois). Então o `pinCompatibleThirdParty` decidia compatibilidade pela versão **antiga ainda no node_modules** (@8, peer não cobre o major) → **re-resolvia e sobrescrevia** o pin Ivy. A subida era reportada mas não persistia → NG2012 em cascata.
- **Fix (`migrate.mjs`):** reconciliar os pins Ivy no node_modules **logo após** `upgradeThirdPartyForIvy` (antes do `pinCompatibleThirdParty`) — aí o `pinCompatibleThirdParty` vê a versão Ivy correta e respeita o pin.

### 1.4 ✅ COBERTO — diretivas usadas por **atributo**
- `fixStandaloneImports` **já detecta atributo** (`standalone.mjs` linha ~714: selector `[colorPicker]`
  → regex de binding no template) para diretivas **internas**. O que faltava era elas estarem no
  índice: `buildInternalProjectIndex` só indexa **standalone**, e o §1.2 (pipes/directives presos em
  `standalone:false`) as deixava de fora → agora flipadas, entram no índice e são detectadas.
- As de **terceiros** (`currencyMask`/NgxCurrency, `[colorPicker]`/ColorPicker) já são **corrections**
  dedicadas (`ngx-currency`, `ngx-color-picker`) que adicionam a diretiva ao `imports[]`. `matBadge`
  (Material) cai na cópia transitiva do `copyModuleImportsToComponents` (SharedModule re-export).

### 1.5 ✅ `runCorrections` buildava com `--configuration development` (inexistente em alguns workspaces)
- **FEITO.** Era o motivo de **nenhuma correction error-driven** disparar no orion (só a flex-layout
  proativa). Agora usa `ng build --no-progress` (config default, = build-check). Commitado.

### 1.6 ✅ IMPLEMENTADO — resolução de versão de terceiros: no-downgrade + semver em 0.x (achados no run v2 via dashboard)
Dois bugs na resolução de versão (`ng-update.mjs`), pegos comparando o package.json do run automático:
- **DOWNGRADE pra versão anciã** (`pinCompatibleThirdParty`): quando a lib ainda **não publicou** release pro major alvo, as versões novas têm peer com teto conservador (ex: `ngx-infinite-scroll@21` = `>=21 <22`) que não cobre o alvo, e o `resolveCompatibleVersion` cai na **única** que "cobre" — uma anciã de peer largo (`@8.0.2` = `>=8`) → **View Engine → NG6002**. Visto no v2: `ngx-infinite-scroll ^21→8.0.2`, `ngx-toastr ^20→19.1.0`. **Fix:** guard `if (getMajor(target) < getMajor(instalado)) → mantém` (forward-compat: a versão nova roda no major novo mesmo com peer conservador; nota em `report.notes`).
- **Libs 0.x não subiam** (`upgradeThirdPartyForIvy`): a condição era `getMajor(target) > installedMajor` — em libs 0.x (ex: `ngx-webcam 0.3.2→0.4.x`) o major é sempre `0` (`0 > 0` = false) → não subia, o eixo que quebra é o **minor**. **Fix:** comparar por **`semver.gt(target, instalado)`** (cobre 0.x e segue impedindo downgrade). *(Obs: ngx-webcam especificamente ainda precisa da correção dedicada porque o 0.4.x dropou o peer — ver §2.2.)*

---

## 1bis. @angular/material — correção ABRANGENTE ✅ IMPLEMENTADA (`material.mjs`)

> **Tudo numa correção única `corrections/material.mjs`** (gate `v>=15`, version-aware via `ctx.angularMajor`): v15 = API/ngControl/`_control`/CSS/Sass/templates(chip/slider); v17 = theme-map/typography/defaults; v19 = NG8023 botão. Absorveu `material-mdc-styles` + `material-api-renames`. Cada bloco idempotente. Validado contra o orion (Sass v17, TS v15, templates v19). Detalhes de Sass/CSS/typography/defaults no §6 (6.1/6.5/6.7); templates e `_control` abaixo.

**As breaking changes do Material são recorrentes, previsíveis e em lockstep** (Material + CDK +
companions como ngx-toastr versionam juntos). Não devem virar fix manual por projeto — viraram
**uma correção de Material única e completa** no migrador, cobrindo TS + template + Sass. Tudo abaixo
foi encontrado e resolvido manualmente no orion (validado) e está na correção:

**API TypeScript (v15 — JÁ na correção `material-api-renames` + `fixLegacyMaterial`):**
- `MatLegacy*` → `Mat*`; `_countGroupLabelsBeforeLegacyOption`→`…BeforeOption`,
  `_getLegacyOptionScrollPosition`→`…OptionScrollPosition`; `ngControl as NgControl`.
- ⚠️ O cast `as NgControl` precisa **garantir o import** de `NgControl` (`@angular/forms`) — hoje
  falta (gerou TS2304 no orion). **Adicionar ao apply.**

**Templates (v17):**
- `<mat-chip-list #x>` → `<mat-chip-grid #x>` (se tem `matChipInputFor`) ou `<mat-chip-set>` (display);
  `<mat-chip>` → `<mat-chip-row>` (no grid); **remover** `[selectable]`/`[removable]`.
- `<mat-slider [value] [thumbLabel] tickInterval ...>` → `<mat-slider discrete ...><input matSliderThumb
  [value] [(ngModel)] aria-* ...></mat-slider>`. `thumbLabel`→`discrete`; value/ngModel/aria movem p/
  o `<input matSliderThumb>`; dropar `tickInterval`/`invert`/`vertical`.

**Templates (v19):**
- Botão com 2+ diretivas de estilo (`mat-button mat-icon-button`, `mat-icon-button mat-stroked-button`,
  `mat-button mat-raised-button`…) → **NG8023** "Multiple components match". Manter a mais específica
  (prioridade icon-button > mini-fab > fab > stroked/raised/flat > button), remover as outras.

**Sass / theming (v17):**
- `mat.legacy-core()` → `mat.core()`; `mat.all-legacy-component-themes($t)` → `mat.all-component-themes($t)`;
  `mat.legacy-<comp>-theme` → `mat.<comp>-theme`.
- Tipografia legacy REMOVIDA: `mat.legacy-typography-hierarchy`, `mat.legacy-<comp>-typography`,
  `mat.all-legacy-component-typographies` → não têm equivalente direto (a config usa levels antigos
  `$display-4`/`$headline`/`$subheading-1`). Migração completa = remapear p/ M2 (`$headline-1..6`,
  `$body-1/2`, `$subtitle-1/2`); fix mínimo = comentar os `@include` removidos (cai no default).
- `ng update @angular/material` **deveria** rodar esses schematics de Sass/template — no orion **não
  rodou/não cobriu**. Investigar por que (rodou antes do standalone? schematic não cobre custom theme?).

**Companions em lockstep (subir junto com o Material):**
- `ngx-toastr` < 20 importa `ComponentFactoryResolver` (removido v17) → subir p/ versão Ivy (20.x).
  Generalizar: qualquer dep que importe símbolo removido do `@angular/core` → candidata a upgrade.

**Núcleo Angular relacionado (não-Material, mas recorrente):**
- `ComponentFactoryResolver` removido (v17): `resolver.resolveComponentFactory(X)` +
  `vcr.createComponent(factory)` → `vcr.createComponent(X)`; `ref.instance.input = x` → `ref.setInput(...)`.

---

## 2. CORREÇÕES novas (lib-specific) — validadas no orion

### 2.1 ✅ Criadas e commitadas
- `ngx-currency-standalone` — NgxCurrencyModule → NgxCurrencyDirective + provideEnvironmentNgxCurrency()
- `ngx-color-picker-standalone` — ColorPickerModule → ColorPickerDirective
- `ngx-ui-loader-path` — import `ngx-ui-loader/public-api` → `ngx-ui-loader`

### 2.2 Correções de lib (validadas no orion)
- ✅ **ngx-webcam** (`ngx-webcam.mjs`, gate v16+) — `0.3.x` (View Engine) → `^0.4.0` (Ivy), mantém `WebcamModule`. Resolve **225 NG2012**. **Por que precisou de correção** (não o `upgradeThirdPartyForIvy` genérico): o `0.4.x` **dropou** o peer `@angular/core` (o resolve não acha pela peer range) e o major é sempre `0`.
- 🔜 **ngx-infinite-scroll** — InfiniteScrollModule → InfiniteScrollDirective (+ subir p/ versão Ivy). A subida de versão agora é coberta pelo **fix de semver no `upgradeThirdPartyForIvy`** (libs 0.x); falta só a conversão Module→Directive.
- ✅ **@angular/material button NG8023 / slider v17 / chip-list** — IMPLEMENTADOS na correção `material.mjs` (templates, v15/v19). Botão: mantém a diretiva mais específica. Slider: `<mat-slider discrete><input matSliderThumb>`. Chip-list→grid/set. Chip/slider best-effort (heurística por arquivo).
- **ComponentFactoryResolver removido v17** — `resolver.resolveComponentFactory(X)` +
  `vcr.createComponent(factory)` → `vcr.createComponent(X)` direto. Genérico do Angular.

### 2.3 Casos difíceis (decisão de design / troca de lib)
- ✅ **ngx-swiper-wrapper (morto, sem Ivy) → swiper-element** (`ngx-swiper-wrapper.mjs`, gate v16+) — remove `SwiperModule` dos `imports[]`+ES import (limpa os **298 NG2012** do over-import), `<swiper>`→`<swiper-container>` + dropa `[config]`, `CUSTOM_ELEMENTS_SCHEMA` nos componentes que usam, `register()` no main, package.json `swiper@^11` + remove `ngx-swiper-wrapper`. **Build-clean.** ⚠️ os **slides** (`<div class="swiper-slide">`) NÃO viram `<swiper-slide>` (converter só a abertura por regex deixaria o `</div>` órfão → HTML malformado); + a **config** vai via runtime → carrosséis precisam de **validação visual**.
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

## 5. RUNTIME — build limpo mas app quebrada (descoberto via headless boot) ⚠️ alta prioridade

> Insight central: **"build limpo" engana**. Os módulos `loadChildren` (lazy) são **tree-shaken** quando o roteamento não está fiado — então erros dentro deles nunca aparecem no `ng build`. Só ao bootar a app (router ativo) eles compilam e os erros surgem. Validar a migração **exige bootar a app**, não só buildar.

### 5.1 ✅ IMPLEMENTADO — `standalone-bootstrap` DESCARTA o `providers: []` do AppModule
> `transcribeAppModuleProviders()` em `app-config.mjs`: recupera o AppModule original (via git se já deletado), extrai o `providers:[]` e transcreve pro `app.config.ts` (pula os já presentes e os que referenciam pacote removido via `hasPackage`). Validado no orion: 15 providers restaurados, 0 órfãos.
- A migração standalone carrega o `imports` do AppModule (via `importProvidersFrom(...)`) mas **dropa o array `providers` inteiro**. Serviços `@Injectable()` **sem** `providedIn:'root'`, interceptors (`HTTP_INTERCEPTORS`), value-tokens (`MAT_DIALOG_DEFAULT_OPTIONS`, `MAT_FORM_FIELD_DEFAULT_OPTIONS`), adapters (`DateAdapter`/`MAT_DATE_FORMATS`), `LOCALE_ID`/`MAT_DATE_LOCALE` via factory, `MatPaginatorIntl` custom, **e o próprio `provideHttpClient(withInterceptorsFromDi())`** somem.
- Sintoma: app builda 100% limpo, mas no boot → **NG0201 "No provider found for X"** (no orion: `_ToastService` injetado pelo `AppGuard`), cascateando em **NG0200 circular dependency**. App trava na tela de loading.
- Pista diagnóstica: o `app.config.ts` **importa** os símbolos dos providers (LOCALE_ID, MAT_*_DEFAULT_OPTIONS, DecimalPipe…) mas **não os usa** no array — o extrator pegou os imports e largou as entradas.
- Fix no migrador: `extractImportProvidersFromModules`/`createAppConfigAndRoutes` deve **transcrever o `providers: []` do AppModule** pro `app.config.ts` (objetos `{provide,useClass/useValue/useFactory/deps}`, classes soltas, `provideHttpClient`), não só o `imports`. Dropar só o que é obsoleto (ex: `{provide: SWIPER_CONFIG…}` do ngx-swiper-wrapper, já migrado p/ swiper-element).

### 5.2 ✅ IMPLEMENTADO — `provideRouter(ROUTES)` não é fiado no app.config (ROUTES órfão)
> `ensureProvideRouter()` em `app-config.mjs`: se o `app.config.ts` não tem `provideRouter(`, acha o export de rotas (`app.routes.ts`/`app.routing.ts`/`app-routing.module.ts`), extrai features do `forRoot` (via `extractRouterWithFeatures`) e injeta `provideRouter(<sym>, ...features)` + imports. Validado no orion: `provideRouter(ROUTES)`.
- A migração gera `app.routes.ts`/`ROUTES` mas **não adiciona `provideRouter(ROUTES, …)`** no `app.config.ts` → URL fica em `/`, nenhuma rota navega, **todos os lazy modules ficam tree-shaken** (escondendo erros 5.x). Preservar opções do `RouterModule.forRoot` (ex: `useHash:true` → `withHashLocation()`).
- Fix: garantir `provideRouter(ROUTES, ...withFeatures)` nos providers do app.config (já há `extractRouterWithFeatures` — só não está sendo emitido aqui).

### 5.3 🟠 Over-imports da migração standalone → ciclos `Class extends value undefined`
- `copyModuleImportsToComponents` copia TODOS os imports co-declarados pra cada componente (mesmo não usados) → **imports circulares** que o esbuild/Vite expõe no boot como `Class extends value undefined` (um componente filho herda do pai via cadeia circular). NG8113 marca os não-usados; removê-los (exatamente 2 ocorrências = import+array, não `*Module`) quebra os ciclos. Confirma a diretiva já existente "esses imports excessivos são o fix de module→standalone; precisa de outra abordagem".
- Fix: a 2ª passada do `cleanup-unused-imports` precisa de fato remover (precisa de build compilável); hoje deixa passar.

### 5.4 ✅ IMPLEMENTADO — Directives que acessam interno do Material (`_control`) quebram por timing
> Na correção `material.mjs` (v15+): `._control.ngControl`→`._control?.ngControl` (optional chaining previne o crash). O defer (`Promise.resolve().then`) é mais invasivo p/ um transform genérico — fica como melhoria; o optional chaining já elimina o `Cannot read 'ngControl' of undefined`.

### 5.5 ✅ IMPLEMENTADO — Peer companion não instalado: `ngx-markdown` → `marked`
> `pinCompatibleThirdParty` ganhou um **PASSO 3** (`ng-update.mjs`): pros pacotes-âncora, lê os `peerDependencies` da versão que VAI ficar instalada (target pinado via packument, senão o instalado) e adiciona como dep direta os peers **não-Angular** ausentes (não no package.json, não em node_modules) — com `--legacy-peer-deps` o npm não instala peers sozinho. Resolve o `Could not resolve "marked"`.

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
| Tail determinístico (renames, typing, signal-mutation, marked) | ~50 |
| **Build final** | **0 erros (incl. lazy modules)** ✅ |
| **Runtime** | **0 erros de console; login renderiza** ✅ (após restaurar providers 5.1, fiar router 5.2, quebrar ciclos 5.3, fix validator 5.4) |

---

## 6. VISUAL — build/runtime OK mas app visualmente quebrada (Playwright ng11 vs ng22) ⚠️ alta prioridade

> Insight: **"runtime sem erros de console" também engana**. A app boota e renderiza, mas o **visual** pode estar destruído. Validar exige **comparar screenshots** da versão origem (ng11) vs migrada, lado a lado, na MESMA rota. Método: servir a v11 via Docker `node:14` numa porta, a v22 noutra, e screenshotar com Playwright. No orion, o login da v22 estava irreconhecível (logo gigante, sem card, inputs full-width, i18n cru) apesar de 0 erros.

### 6.1 ✅ IMPLEMENTADO — CSS customizado mira classes Material LEGADAS (MDC renomeou no v15-17)
> Correção `material-mdc-styles.mjs` (gate v17): `transformStyles` renomeia `.mat-X`→`.mat-mdc-X` (allowlist com boundary exato: `.mat-button` ≠ `.mat-button-toggle`); estruturais sem mapa 1:1 (`form-field-wrapper`, `tab-label`…) são puladas e reportadas no summary. Validado no orion.
- O Material v15-17 migrou pro **MDC**, **renomeando/reestruturando** as classes do DOM: `.mat-card`→`.mat-mdc-card`, `.mat-form-field`→`.mat-mdc-form-field`, `.mat-card-content`→`.mat-mdc-card-content`, `.mat-button`→`.mat-mdc-button`, `.mat-chip`→`.mat-mdc-chip`, `.mat-tab-*`→`.mat-mdc-tab-*`, etc. (alguns **sumiram**: `.mat-form-field-wrapper`, `.mat-button-focus-overlay`).
- Todo **CSS customizado do app** que mira essas classes legadas **deixa de casar** → card/inputs/botões/chips/tabs/dialogs perdem estilo **em todo o app**. No orion: **122 seletores `.mat-*` legados** distintos em **59 arquivos `.scss`** (`.mat-card` 22×, `.mat-chip` 12×, `.mat-card-content` 12×, `.mat-form-field-wrapper` 10×…).
- Evidência (Playwright): o `.login` da ng11 tem filhos `MAT-CARD bg=branco` + `DIV.mat-card-image bg=rgb(50,51,61)` (header escuro); na ng22 esses filhos têm `background: transparent` (estilo não casa) → card some.
- **Fix (parte da correção abrangente de Material — §1bis):** transform de SCSS que renomeia os seletores `.mat-X` → `.mat-mdc-X` para as classes com equivalente MDC. Os poucos sem equivalente direto (wrapper/focus-overlay) → reportar em `report.notes` p/ revisão manual (mudança estrutural do DOM, sem mapa 1:1). **Específico do Material → é correção, não modernização genérica.**

### 6.2 ✅ IMPLEMENTADO — `@tailwind base` (preflight) da correção flex-layout reseta TODO o estilo base
> O `tailwind.config` gerado por `angular-flex-layout-tailwind` agora inclui **`corePlugins: { preflight: false }`**.
- O **preflight** do Tailwind (`@tailwind base`) é um **reset global** que zera bordas, normaliza `img/svg` (`max-width:100%`), reseta form elements — **quebrando Material e estilos existentes** num app já estilizado (logo vira gigante, inputs viram caixas cruas). Com `preflight:false` as utilities (`flex`/`w-…`) seguem funcionando sem o reset destrutivo. Validado no orion.

### 6.3 ⚖️ flex-layout → Tailwind: decisão = MANTER Tailwind (não trocar por fork)
- A conversão `fxLayout`/`fxFlex`/`fxFill`/`fxLayoutAlign` → classes Tailwind é **aproximada**. Houve a opção de trocar pelo **drop-in `@ngbracket/ngx-layout`** (fork mantido do flex-layout, mesma API, `@22.0.0` suporta ng22) — preservaria 100% dos layouts sem tocar nos templates. **Decisão do projeto: manter a conversão Tailwind** (sem depender de fork de terceiros), corrigindo os bugs concretos da conversão (§6.6) + preflight (§6.2). O `@ngbracket` fica documentado como alternativa, não adotado.
- ⚠️ **Limite conhecido:** o **eixo** do `fxFlex` (largura em row, altura em column) depende do `fxLayout` do **pai** — a conversão é por-elemento (sem contexto do pai), então `fxFlex="50"` num container `column` ainda vira `w-1/2` (largura) em vez de altura. Caso minoritário; não corrigido (exigiria conversão tree-aware). Os bugs de unidade e de `flex` faltando (mais impactantes) **foram** corrigidos (§6.6).

### 6.4 ✅ IMPLEMENTADO — Init do construtor do AppModule é PERDIDA na migração standalone (i18n/ícones)
> `restoreAppModuleConstructorInit()` em `app-config.mjs`: recupera o AppModule (git), extrai o corpo do `constructor()`, converte campos injetados (`this.x`) em `inject()` locais e re-emite como `provideAppInitializer(() => {…})` + imports. Validado no orion: reproduz exatamente o `translate.use(LANG_PT_NAME)` + `matIconRegistry.registerFontClassAlias` + 3 imports. Aborta se sobra `this.<membro>` não-injetado.
- O `AppModule` costuma ter um **`constructor`** com inicialização de bootstrap (ex: `translate.use(LANG_PT)` p/ idioma default, `matIconRegistry.registerFontClassAlias('fas','fas')` p/ ícones, `registerLocaleData`). Quando o standalone migration **deleta o AppModule**, essa lógica **some** → no orion: i18n mostrava **chaves cruas** ("username" em vez de "Usuário") e ícones FontAwesome quebravam.
- **Fix no migrador:** ao deletar o AppModule, extrair o corpo do `constructor()` (e `ngDoBootstrap`/`APP_INITIALIZER` existentes) e re-emitir como **`provideAppInitializer(() => { … inject(X) … })`** no `app.config.ts`, trazendo os imports. Irmão do §5.1 (mesma raiz: o standalone-bootstrap só leva `imports`, larga providers E a lógica do construtor).

### 6.5 ✅ IMPLEMENTADO (theming) — função de tema custom retorna theme-map FLAT do M2 (incompatível com MDC)
> Correção `material-mdc-styles.mjs` (gate v17): `fixThemeMapFunctions` acha o `@return (…)` FLAT (tem `primary`/`accent` + `is-dark`/`foreground`, sem `color:`) e o reescreve como `map-merge(mat.m2-define-{light,dark}-theme((color/typography/density)), (<flat original>))` — detecta `is-dark:true` p/ dark. **Typography (§6.7) RESOLVIDA aqui** (decisão = traduzir a config do app, não valores fixos): pré-pass acha o var de typography (`$custom-typography`), `translateLegacyTypographyCall` converte `define-legacy-typography-config`→`m2-define-typography-config` remapeando os levels (`$display-4`→`$headline-1`, `$body-1`↔`$body-2`, etc., single-pass p/ não cascatear), e o theme-map fia `typography: $custom-typography` (preserva os TAMANHOS do app, ex: 12px). Validado no orion (light+dark+typography).
- Apps com tema custom costumam ter uma **`@function` própria** (ex: `mat-light-theme`/`define-light-theme`, renomeada pela migração) que monta o theme-map **à mão**, no formato FLAT do M2 antigo: `@return (primary: $p, accent: $a, warn: $w, foreground: …, background: …)`. O MDC `mat.all-component-themes($theme)` exige a estrutura NOVA **aninhada** (`color: (primary, accent, warn)`, `density`, `typography`). Sem a chave `color`, **nenhum componente Material recebe cor** → no orion: botão `mat-raised-button` com `background: transparent` (devia ser cinza), outline/label do form-field **preto** (#32333d primary) em vez da cor certa, **em TODO o app**.
- **Fix:** reescrever a função custom pra gerar o tema via `mat.m2-define-light-theme((color: (primary,accent,warn), typography, density))` e **`map-merge`** com as paletas extras flat (success/info/danger/alert/edit) que o mixin custom-theme lê no topo. Preserva os dois consumidores. Validado no orion: botão e inputs voltaram a ter cor. Específico de Material → **correção** (parte da abrangente §1bis).
- **Sub-achado (focus color):** o tema custom estilizava `.mat-focused .mat-form-field-label`/`.mat-form-field-outline-thick` (legado) com `accent`. No MDC os filhos viraram `.mdc-floating-label`/`.mdc-notched-outline__leading|notch|trailing` (e o MDC colore via CSS var em seletor de specificity maior — **precisa `!important`**). É §6.1 dentro do tema. Sem isso, o focus do input fica primary (escuro) em vez de accent (azul).

### 6.6 ✅ IMPLEMENTADO — Bugs concretos da conversão flex-layout→Tailwind
> Corrigidos em `angular-flex-layout-tailwind.mjs` (validado: reproduz os fixes manuais do orion login).
- **`fxFlex="420px"` → `w-[420%]`** (era): a conversão largava o `px` e anexava `%` → card com 420% de largura. **Fix:** detecta unidade de comprimento (`px/em/rem/…`) e preserva (`w-[420px]`); só número puro vira `%`.
- **`fxLayoutAlign="center center"` → `justify-center items-center` SEM `flex`** (era): sem `display:flex` as classes de alinhamento não fazem nada (link/logo não centralizavam, botão não esticava). **Fix:** `fxLayoutAlignToTw` agora emite `flex justify-* items-*`; `processTag` deduplica o `flex` quando o elemento também tem `fxLayout`.

### 6.7 ✅ PARCIAL — Defaults dos componentes MDC diferem do legacy (restaurar pra bater com o original)
> Em `material-mdc-styles.mjs` (anexado ao fim do tema, após `all-component-themes`): **density -2** (form-field 56→48px), **`.mat-button-toggle-checkbox-wrapper { display:none !important }`** (esconde o ✓ novo do MDC), **`.mat-mdc-form-field-subscript-wrapper { min-height:0 }`** (colapsa o espaço de erro reservado, mantém expansão quando há erro). Typography compacta resolvida no §6.5 (tradução da config do app). **Decisão = preservar o look do legacy** (testado: login orion pixel-equivalente). **Ainda fora** (app-specific/incerto, → `report.notes`): shadow `mat-elevation-zN` no card MDC, button stretch.
Mesmo com as classes CSS renomeadas (§6.1), o **comportamento default** de cada componente MDC mudou. Validado igualando o login do orion pixel-a-pixel (diff caiu de 92k→35k pixels). Cada item é um ajuste de tema/CSS **global** (não pode ser scoped no componente — ver nota de encapsulation abaixo):
- **`mat-card` ignora `mat-elevation-zN`:** o card MDC usa a própria `--mdc-elevated-card-container-elevation` (baixa, ~z2). A classe `mat-elevation-z12` não aplica → card sem sombra. Fix: `box-shadow` explícito do nível original.
- **`mat-card` perdeu o padding:** legacy `.mat-card` tinha `padding:16px`; MDC `.mat-mdc-card` tem 0. Card-content (16px lateral) e card-actions (8px todos os lados) também mudaram. → altura/posição do card mudam (no orion: card 17px mais baixo → 9px deslocado no centro vertical). Fix: restaurar paddings legacy.
- **`mat-form-field` mais alto + reserva subscript:** MDC density 0 = infix **56px** (legacy 48px) **+ 22px de subscript** sempre reservado. Fix: `mat.form-field-density(-2)` (56→48) **depois** de `all-component-themes`, e colapsar `.mat-mdc-form-field-subscript-wrapper` (orion mostrava erro como badge absoluto, não em espaço reservado).
- **Typography MDC = 14/16px:** o orion usava `$custom-typography` compacta (12px), que estava nos `@include legacy-typography` (REMOVIDOS no v17). Sem ela, tudo fica maior. Fix: gerar config M2 compacta (mapear `$body-1`/`$button`/`$subtitle-*` do legado) e passar no theme-map; `body{font-size:12px}` global (a typography não seta o body).
- **`mat-button-toggle` mostra ✓ de seleção (FEATURE NOVA do MDC):** o legacy não tinha. Fix: esconder `.mat-button-toggle-checkbox-wrapper` (`display:none !important` — o MDC seta `inline-block` com mesma specificity) **OU** `hideSingleSelectionIndicator` via `MAT_BUTTON_TOGGLE_DEFAULT_OPTIONS`.
- **`mat-error` cor/posição default:** texto vermelho no subscript (MDC) vs o badge custom do orion (branco em vermelho, absoluto). A regra custom do orion mirava `.mat-form-field-invalid .mat-form-field-subscript-wrapper`/`.mat-error` (legado) → não casa. Fix: replicar com `.mat-mdc-form-field-subscript-wrapper`/`.mat-mdc-form-field-error` + `position:relative` no `.mat-mdc-form-field`.
- **`mat-button` (MDC, inline-flex) não estica com `align-stretch`:** o legacy esticava. Fix: `width:100%` no botão quando o layout esperava stretch.
- **Focus do form-field usa primary (escuro) em vez de accent:** ver §6.5 sub-achado (seletores `.mdc-floating-label`/`.mdc-notched-outline__*` com `!important`).

> ⚠️ **Encapsulation:** vários desses ajustes miram elementos **internos** do Material (criados pelo componente, ex: `.mat-button-toggle-checkbox-wrapper`, `.mdc-floating-label`, `.mat-mdc-form-field-subscript-wrapper`). Eles **não têm o `_ngcontent` do componente do app** → uma regra em `*.component.scss` (Emulated encapsulation) **não os alcança**. A correção de Material **tem que escrever essas regras em CSS global** (theme.scss/styles.scss), não scoped. (No orion: a regra do checkmark em `login.component.scss` não funcionou; em `theme.scss` funcionou.)

> **Lição central:** `@ngbracket/ngx-layout` (§6.3) resolve **só o layout** (fxLayout/fxFlex) — e resolve bem (posição/fundo/card idênticos). As diferenças que sobram são **100% da reimplementação do Material legacy→MDC** (componentes reescritos pelo Google sobre web components). São dois eixos de migração independentes; o visual exige tratar **ambos**.

### Resumo visual do orion (login ng11 vs ng22) — **LOGIN ~pixel-equivalente** ✅
| Causa | Status |
|---|---|
| 6.2 Tailwind preflight reseta base | ✅ corrigido (preflight:false) |
| 6.4 init do AppModule perdida (i18n/ícones) | ✅ corrigido (provideAppInitializer) |
| 6.5 theme-map custom FLAT incompatível c/ MDC (botões/inputs sem cor) | ✅ corrigido (mat.m2-define-light-theme + merge) — **dominante** |
| 6.1 CSS mira classes Material legadas (122 seletores, 59 arquivos) | ✅ corrigido no orion (rename .mat-X→.mat-mdc-X + seletores MDC no focus) |
| 6.3/6.6 flex-layout→Tailwind muda layout + bugs px→%/sem-flex (604 arquivos) | 🟠 corrigido pontual no login; estratégico = trocar por @ngbracket/ngx-layout |

> **Login do orion ng22 agora é pixel-equivalente ao ng11** (header, card 420px, inputs com focus azul/accent, toggle de idioma, botão Entrar full-width, link centralizado). Validou as 5 causas-raiz visuais end-to-end. Mudanças app-wide (rename Material CSS 68 arq + theme-map) ainda **uncommitted** — validar nas telas auth antes de portar.
