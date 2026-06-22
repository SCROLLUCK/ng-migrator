# CLAUDE.md

Este arquivo é a fonte de verdade arquitetural do ng-migrator.
**Toda decisão relevante tomada no código DEVE ser registrada aqui.** Cada mudança de decisão é um gatilho para atualizar este arquivo.

## Comandos

```bash
# Instalar dependências
npm install

# Rodar o migrador no diretório atual (cria pasta irmã -ng21)
node migrate.mjs

# Rodar em um projeto específico
node migrate.mjs ./caminho/para/projeto-angular

# Migrar até uma versão específica
node migrate.mjs ./proj --to 17

# Começar a partir de uma versão diferente (projeto já em v14, por ex.)
node migrate.mjs ./proj --from 14

# Migrar na PRÓPRIA pasta (sem pasta irmã) — exige git limpo; cria branch ng-migrator/to-ng22
node migrate.mjs ./proj --in-place                # ideal p/ saltos curtos (ex: 21→22)
node migrate.mjs ./proj --in-place --branch chore/ng22   # nome de branch customizado

# Simular sem executar nada
node migrate.mjs --dry-run

# Estratégia de conflitos de peer dependency (default: resolve)
node migrate.mjs ./proj --peer-strategy force   # pula resolução, --force direto

# Retomar uma migração existente a partir de um step (sem refazer o que já passou)
node migrate.mjs ./proj --resume-from ng14       # reset pro estado antes do ng14 e segue
node migrate.mjs ./proj --resume-from signals    # pula o ng update; modernização a partir de 'signals'
node migrate.mjs ./proj --rollback-to ng16      # volta o projeto pro estado pós-ng16 (build limpo) e PARA
```

## Stack do dashboard (src/)

O dashboard é uma aplicação React com as seguintes tecnologias — **use sempre estas, nunca `style={{}}`**:

- **Tailwind CSS v4** para todo estilo. As cores do tema estão definidas como variáveis CSS em `src/index.css` e mapeadas como classes Tailwind:
  - `bg-background`, `bg-surface`, `bg-surface2`
  - `border-border`
  - `text-foreground`, `text-muted`
  - `text-red`, `text-green`, `text-amber`, `text-blue`
- **shadcn/ui** (base-ui) para componentes: `Button`, `Checkbox`, `Input`, `Select`, `Card`, `Badge`, `Progress`, `ScrollArea`, `Collapsible`, `Table`, `Separator` — todos em `src/components/ui/`
- **`cn()`** de `@/lib/utils` para combinar classes condicionalmente
- **`class-variance-authority` (cva)** para variantes de componentes

Nunca use `style={{}}` inline nos componentes React. Exceção: valores verdadeiramente dinâmicos que não podem ser expressos em Tailwind (ex: larguras calculadas em JS, `width: \`${pct}%\``).

## Arquitetura

O entry point é `migrate.mjs` (~200 linhas — só o pipeline principal). Toda a lógica fica nos módulos em `migrator/`:

| Arquivo | Responsabilidade |
|---|---|
| `migrator/context.mjs` | CLI args, `sourcePath`, `destPath`, `report`, `SKIP_DIRS`, `diffDb` / `setDiffDb`, carrega `ng-migrator.config.json` e carrega/rastreia `currentAngularVersion` |
| `migrator/utils.mjs` | `run`, `capture`, `copyDir`, `readJson`, `writeJson`, `runUntilStable`, `checkDocker`, `detectVersionManager`, `wrapCommand` (Docker isolation), diff helpers |
| `migrator/packages.mjs` | `getPkg`, `hasPackage`, `getMajor`, `getInstalledMajor` |
| `migrator/preflight.mjs` | `preflight`, `cleanupLegacyFiles`, `fixTsconfigLocations`, `fixKarmaConf` |
| `migrator/ng-update.mjs` | `syncVersions`, `verifyTsconfigPaths`, `fixLegacyMaterial`, `resolveNodeTypesOverride`, `extraPackages`, `extractConflictPackages`, `patchThirdPartyVersions` |
| `migrator/standalone.mjs` | Mapas TMPL_ELEM/ATTR/PIPE, `tmplDetectNeeded` (AST + fallback regex), `buildInternalProjectIndex`, todas as funções standalone |
| `migrator/modules.mjs` | `convertLazyModulesToRoutes`, `convertRemainingRoutingModules`, `removeUnusedModules` |
| `migrator/transforms.mjs` | `fixUntypedForms`, `fixSassImports`, `fixStyleUrls`, `modernizeTsconfig`, `addEslint`, etc. |
| `migrator/app-config.mjs` | `createAppConfigAndRoutes`, `extractImportProvidersFromModules` |
| `migrator/report.mjs` | `writeReport`, `writeMigrationData` |
| `migrator/orchestrate.mjs` | `runModernizationMigrations` (com `commitStep` local) |
| `migrator/corrections/` | Steps de **correção** específicos de lib (auto-descobertos): `index.mjs` (`loadCorrections`/`runCorrections`/`runProactiveCorrections`), `_lib.mjs` (helpers compartilhados — prefixo `_` não é correção) + um arquivo por correção (`ngx-mask.mjs`, `moment-default-import.mjs`, `material.mjs`, `angular-flex-layout-tailwind.mjs`, `ngx-currency.mjs`, `ngx-color-picker.mjs`, `ngx-ui-loader-path.mjs`, `ngx-webcam.mjs`, `ngx-swiper-wrapper.mjs`) |

Sem build step, sem testes automatizados.

---

## Regras invioláveis

### Fixes sempre genéricos, nunca específicos de biblioteca (modernização) — EXCETO correções
Todo fix de **modernização** deve resolver um padrão conhecido do Angular/TypeScript/RxJS, não um problema de uma lib específica. Se a solução só se aplica a `ngx-something`, não pertence à modernização.

**A exceção consciente: steps de CORREÇÃO** (`migrator/corrections/`). São uma categoria **separada** das modernizações e **podem ser específicas de lib** — porque são cirúrgicas, disparadas por erro, e isoladas. Resolvem quebras conhecidas que a modernização genérica não cobre (ex: `ngx-mask` v15+ removeu `NgxMaskModule` → `NgxMaskDirective`/`provideNgxMask()`). Distinção crucial vs **neutralização** (autoFixBuildErrors comenta `// TODO`/remove import → builda mas **runtime quebrado**): uma correção migra a API **de verdade** (runtime-safe).

**Extensível**: cada correção é um arquivo `.mjs` auto-contido em `migrator/corrections/`, **auto-descoberto** (adicionar = soltar arquivo; no futuro, upload pela UI). Formato: `{ name, description, apply(ctx), + UM gatilho }`. Há **dois tipos de gatilho** — uma correção declara exatamente um:

- **`detect(ctx)` — ERROR-DRIVEN** (a maioria): roda quando o erro aparece no build. `detect(ctx)` recebe `{ raw, codes:Set, angularMajor, hasPackage, getInstalledMajor }`. `runCorrections(v)` builda, extrai os códigos de erro, casa os `detect` e aplica. **Disparado no loop pelo build-check** (`opts.ngUpdateChecks`) e **também ao FIM da modernização** (esses erros surgem depois das mudanças do próprio migrador — esModuleInterop / update do Material — não só no loop). `runtimeRaw` opcional permite disparar por erro de runtime no futuro.
- **`gate(angularMajor)` — PROATIVO/ceiling**: roda numa versão específica **antes** do `ng update`, sem esperar erro. Para casos sem versão no major alvo, onde esperar o erro seria tarde demais (o `npm install` do update já teria falhado). `runProactiveCorrections(v)` roda no topo do loop, antes do update, casa `gate(v)` e aplica.

`apply(ctx)` recebe `{ destPath, srcDir, angularMajor, transformTs(fn), transformHtml(fn), transformStyles(fn), setCompilerOption(key,value), installDevDeps(pkgs) }` (`transformStyles` = idem para `.scss`/`.css`; `angularMajor` = major do step, p/ correções com gate amplo `v>=15` aplicarem cada transform no major certo — ambos adicionados p/ a correção única de Material). **Toda correção é AUTOCONTIDA**: a lógica do bug vive inteira no arquivo da correção — ela só usa o ctx (mecanismos genéricos), os helpers compartilhados de `_lib.mjs`, e `fs`/`path` (builtins do Node), **nunca importa lógica interna do migrador**. O ctx fornece o COMO genérico (andar pelos arquivos, instalar dep isolada em Docker, setar tsconfig); a correção fornece o QUÊ específico (qual atributo converter, qual dep instalar). Ex: a de flex-layout inlina toda a conversão fxLayout→Tailwind e chama `ctx.installDevDeps(['tailwindcss@^3', …])` em vez de rodar npm direto. Por isso `transformHtml`/`installDevDeps` foram adicionados ao ctx (a conversão precisava deles) — uma correção nunca embute conhecimento que pertence ao núcleo.

**`_lib.mjs` — helpers compartilhados** (para as correções não reinventarem a roda): transforms de string genéricos (`rewriteNamedImport`, `removeImport`, `renameIdentifiers`, `removeSymbolFromArrays`, `addProviderToNgModule`) e de `package.json` (`readPackageJson`, `writePackageJson`, `hasDependency`, `removeDependencies`). São **agnósticos ao bug** e **autocontidos** (só `fs`/`path`), então o subsistema de corrections continua portátil (uma correção de UI importaria `./_lib.mjs`, que viaja junto). `removeSymbolFromArrays` limpa vírgulas residuais (`[, x]`→`[x]`); o cast da correção `material` captura o **receiver inteiro** (`(this.formField._control.ngControl as NgControl).name`, não `formField(._control…`). Arquivos com prefixo `_` não são correções (o auto-discovery os ignora).

Toda correção registra em `report.corrections` (separado de `report.notes`/neutralizado) e commita com trailer `[ng-migrator-step:corrections]`.

**Passos de modernização que eram, na verdade, correções — JÁ MIGRADOS para `corrections/`**:
- `moment-default-import.mjs` (era `fixMomentImport`): `import * as moment` → default import + `esModuleInterop`; específico do **moment**, disparado por `TS2349`/`TS1192`.
- `material.mjs` (eram renames do `fixTsCompat`, depois `material-api-renames`, agora absorvidos na correção única de Material): `_countGroupLabelsBeforeLegacyOption`→`…BeforeOption`, `_getLegacyOptionScrollPosition`→`…OptionScrollPosition`, `ngControl as NgControl`; específicos do **@angular/material** v15.
- `angular-flex-layout-tailwind.mjs` (era o step `flexLayout`/gate v16 inline): `@angular/flex-layout` → Tailwind; **proativo** (gate v16, ver seção abaixo).

O `ModuleWithProviders<T>` e o de-double-comma do `fixTsCompat` **continuam genéricos** (modernização). `fixMomentImport` em `transforms.mjs` ficou órfão (substituído pela correção).

### Nunca modificar o projeto de origem — EXCETO `--in-place` (opt-in explícito)
O migrador opera sempre sobre a cópia em `destPath`. O projeto original em `sourcePath` é somente-leitura.

**Exceção consciente: `--in-place`.** Para saltos curtos (ex: 21→22) o usuário pode migrar na própria pasta (sem pasta irmã `-ngN`). Como o migrador commita por step e usa `git reset --hard` no resume/rollback, isso só é seguro com guard-rails: `--in-place` **exige** repo git **com working tree limpo** (assim há ponto de restauração) e roda numa **branch dedicada** (default `ng-migrator/to-ng<alvo>`, customizável via `--branch <nome>` ou pelo campo na UI — validada por allow-list `^[A-Za-z0-9][A-Za-z0-9._/-]*$`, sem `..`/trailing `/`) criada a partir do HEAD limpo — a branch original do usuário fica intacta; ele revisa o diff e faz merge (ou `git branch -D` para descartar). `destPath = sourcePath` (em `context.mjs`); no git-init, `git checkout -b <branch>` em vez de `git init`; os artefatos do migrador (`.ng-migrator/`, `MIGRATION-*`) entram em `.git/info/exclude` para não sujar a branch. Incompatível com `--split-versions` e `--dest`. Aborta se a branch já existe (use `--resume-from` nela). O caminho default (pasta irmã) continua sendo o seguro/recomendado para migrações longas.

**Monorepo:** o projeto pode estar numa subpasta cujo `.git` fica num ancestral (ex: `<root>/frontend` com `.git` em `<root>/.git`). Por isso a detecção usa `git rev-parse --is-inside-work-tree` (não um `.git` literal na pasta), e o `info/exclude` é resolvido via `git rev-parse --git-path info/exclude` (pode vir relativo, ex: `../.git/info/exclude`). Como `git add -A` e `git reset --hard` são **repo-wide**, o requisito de "limpo" e a branch dedicada valem para o **repositório inteiro** — a branch de migração troca o monorepo todo (só a subpasta migrada muda de conteúdo). Em monorepo, commit/stash de pendências em outras pastas também é exigido antes.

### Toda decisão de design atualiza este arquivo
Cada vez que uma decisão arquitetural é tomada, revisada ou corrigida no código, o CLAUDE.md deve ser atualizado imediatamente com a decisão e o seu porquê. Isso evita que o mesmo erro seja descoberto duas vezes.

---

## Conhecimento Angular que guia as decisões

### Sistema NgModule → Standalone: mapeamento completo

Ao converter um componente de NgModule para standalone, ele deve importar explicitamente **três categorias**:

1. **`ModuleM.imports` externos** — pacotes de terceiros disponíveis via módulo (ex: `MatButtonModule`)
2. **`ModuleM.imports` locais (transitivos)** — o que os módulos locais importados exportam. Se `SharedModule` exporta `TranslatePipe`, qualquer componente declarado num módulo que importa `SharedModule` precisa importar `TranslatePipe` diretamente.
3. **`ModuleM.declarations` (co-declarados)** — todo componente/pipe/directive declarado no mesmo módulo está disponível entre si. Após standalone, eles precisam ser imports explícitos.

Implementado em `copyModuleImportsToComponents()` com as 3 camadas. `fixStandaloneImports()` serve como segunda passagem baseada em análise de template.

**Guard de self-import**: quando várias classes são declaradas no **mesmo arquivo** (ex: `Tab1Component`, `Tab2Component`, `TabsComponent` em `tabs.component.ts`), elas já se enxergam — não se deve gerar `import { Tab1Component } from './tabs.component'` (self-import), que causa `TS2440`/`TS2395`/"already declared". As camadas 2 e 3 pulam quando o arquivo de origem do símbolo é o próprio arquivo do componente (`otherFile === compFile`).

### Detecção de pipes internos no template

Pipes internos do projeto (ex: `TranslatePipe` com `@Pipe({ name: 'translate' })`) são usados em templates como `| translate`. O `buildInternalProjectIndex` indexa todas as declarações standalone do projeto com seu `decoratorType`. O `fixStandaloneImports` usa padrões diferentes por tipo:
- `Pipe` → regex `\|\s*pipeName\b`
- Attribute directive `[attr]` → regex de binding
- Component → regex `<selector[\s\/>]`

### provideHttpClient — withInterceptorsFromDi() obrigatório na migração

`HttpClientModule` → `provideHttpClient()` **quebra interceptors silenciosamente** se houver interceptors class-based registrados via `HTTP_INTERCEPTORS` multi-token.

**Regra**: se `scanForContent('HTTP_INTERCEPTORS')` retornar verdadeiro, usar `provideHttpClient(withInterceptorsFromDi())`. O `withInterceptorsFromDi()` preserva o sistema de DI-based interceptors. Sem ele, qualquer interceptor de autenticação/logging para de funcionar sem nenhum erro de compilação.

### provideAnimations() na migração, não provideAnimationsAsync()

`BrowserAnimationsModule` → `provideAnimations()` (síncrono), não `provideAnimationsAsync()`.

**Motivo**: `provideAnimationsAsync()` carrega animações via dynamic import lazy. Em apps que usam animações no AppComponent ou em componentes carregados imediatamente, o primeiro frame renderiza sem animação. Para migração segura, usar sync. O desenvolvedor pode optar por async explicitamente depois.

### provideRouter — preservar opções do RouterModule.forRoot

`RouterModule.forRoot(routes, options)` → `provideRouter(routes, ...withFeatures)`.

As opções mapeiam para:
| RouterModule.forRoot option | provideRouter with*() |
|---|---|
| `preloadingStrategy: X` | `withPreloading(X)` |
| `scrollPositionRestoration: 'top'` | `withInMemoryScrolling({ scrollPositionRestoration: 'top' })` |
| `enableTracing: true` | `withDebugTracing()` |
| `useHash: true` | `withHashLocation()` |

A função `extractRouterWithFeatures()` em `app-config.mjs` extrai essas opções do routing module **antes** de deletá-lo.

### app.config.ts pós-schematic: restaurar providers do AppModule e fiar provideRouter

Quando o `standalone-bootstrap` schematic **já gerou** o `app.config.ts`, `createAppConfigAndRoutes()` entra no branch de pós-processamento. O schematic tem **três buracos críticos** (descobertos no stress-test orion, build limpo mas app quebrada no boot/runtime — ver `MIGRATOR-IMPROVEMENTS.md` §5/§6.4):

- **Descarta o `providers: []` do AppModule.** Carrega só o `imports` (via `importProvidersFrom(...)`) e **larga o array `providers`** — serviços `@Injectable()` **sem** `providedIn:'root'`, interceptors (`HTTP_INTERCEPTORS`/`AuthInterceptor`), value-tokens (`MAT_DIALOG_DEFAULT_OPTIONS`, `MAT_FORM_FIELD_DEFAULT_OPTIONS`), adapters (`DateAdapter`/`MAT_DATE_FORMATS`), `LOCALE_ID`/`MAT_DATE_LOCALE` via factory, `MatPaginatorIntl` custom, **e o próprio `provideHttpClient(withInterceptorsFromDi())`**. Sintoma: build 100% limpo, mas no boot **NG0201 "No provider found"** → cascata **NG0200 circular dependency**, app trava no loading. Pista: o `app.config.ts` **importa** os símbolos mas **não os usa** no array. `transcribeAppModuleProviders(cfg, appDir)` recupera o AppModule original (lê o arquivo; se o schematic já deletou, via **git** — `git log --diff-filter=D` + `git show <commit>~1:…`), extrai o `providers:[]` (slice balanceado) e transcreve cada entrada pro `app.config.ts`, **pulando**: (a) as já presentes (token/classe já no array) e (b) as que referenciam **pacote removido** (`!hasPackage(pkg)` do import — pega ex. `{provide: SWIPER_CONFIG}` do `ngx-swiper-wrapper` quando desinstalado, regra genérica). Cada entrada só entra **com seus imports** (recuperados das linhas de import do AppModule — mesmo dir, paths idênticos), nunca um provider sem import.

- **Não fia `provideRouter(ROUTES)`.** O schematic às vezes ignora o roteamento, deixando o `ROUTES`/`routes` órfão. Sem `provideRouter`, a app não navega e **todos os módulos `loadChildren` (lazy) ficam tree-shaken** → seus erros **não aparecem no `ng build`** ("build limpo" é enganoso; validar exige **bootar** a app). `ensureProvideRouter(cfg, appDir)` acha o export de rotas (`app.routes.ts`/`app.routing.ts`/`app-routing.module.ts`), extrai as features do `forRoot` (`extractRouterWithFeatures`) e injeta `provideRouter(<sym>, ...features)` + imports. (Hash routing via `{provide: LocationStrategy, useClass: HashLocationStrategy}` é coberto pela restauração de providers acima, então `withHashLocation()` nem sempre é necessário.)

- **Descarta a lógica do `constructor()` do AppModule.** O AppModule costuma ter um `constructor` com **init de bootstrap** (`translate.use(LANG_DEFAULT)` p/ idioma, `matIconRegistry.registerFontClassAlias('fas','fas')` p/ ícones, `registerLocaleData`…). Ao **deletar** o AppModule, o schematic perde isso → no orion: i18n mostrava **chaves cruas** ("username" em vez de "Usuário") e ícones FontAwesome quebravam (build/console limpos, só o conteúdo errado). `restoreAppModuleConstructorInit(cfg, appDir)` recupera a classe `AppModule` (via git), extrai o corpo do `constructor()`, converte os campos injetados (`this.x` de `x = inject(T)` ou DI de param) em `inject()` **locais** e re-emite como **`provideAppInitializer(() => { … })`** + imports (tipos dos injects e qualquer símbolo do corpo com import no AppModule, ex: `LANG_PT_NAME`). Aborta se sobra `this.<membro>` não-injetado (não dá pra mover com segurança). Mesma raiz do 1º buraco: o standalone-bootstrap só leva `imports`, larga `providers` E a lógica do construtor.

Os três rodam no branch `existsSync(configPath)` de `createAppConfigAndRoutes`, antes do dedup final. Registram em `report.modernize` (`appModuleProvidersRestored`, `provideRouterWired`, `appModuleInitRestored`).

### Resolução genérica de versões compatíveis de terceiros (em vez de --force)

O `ng update` falha com `Incompatible peer dependencies found` quando uma lib de terceiros não suporta o major Angular alvo. A reação antiga era chutar `pkg@<angularMajor>` (errado: o major da lib raramente coincide com o do Angular — `@nebular/theme@12` é da era ng16, `@swimlane/ngx-charts@12` é de 2018/ng6) e, ao falhar, cair em `--force` — empurrando versões incompatíveis silenciosamente.

A abordagem correta **resolve a versão certa no registry**:

- `resolveCompatibleVersion(pkg, angularMajor)` — busca o packument (`curl <registry>/<pkg>`), itera as versões estáveis em ordem decrescente e retorna a **maior** cujo `peerDependencies['@angular/core']` inclui o major alvo (via `angularVersionInRange()`). Resultado cacheado.
- `angularVersionInRange(major, peerRange)` — usa **`semver.intersects(peerRange, '>=M.0.0 <M+1.0.0')`**, não regex. O parsing manual anterior falhava em `>= 6.0.0` (espaço após operador), `>=5` (sem minor), `>=14 <16` (range composto) e unions — marcando pacotes compatíveis (ex: `@akveo/ng2-completer` `>=6`, `@asymmetrik/ngx-leaflet` `>=5`) como incompatíveis e gerando notes falsas + resolução desnecessária. `semver` já é dependência transitiva do ecossistema Angular. **`includePrerelease` é condicional**: só é passado quando o `peerRange` tem um **tag de pré-release real**, detectado por **`/\d-[0-9A-Za-z]/`** (dígito-hífen-alfanum, ex: `12.0.0-beta`) — **não** `includes('-')`. Com versões **parciais** (`>=14`, `14 - 15`), `includePrerelease: true` faz o `semver.intersects` casar a **band adjacente** por engano (`intersects(">=14", ">=13.0.0 <14.0.0", {includePrerelease:true})` → `true`, BUG). E `includes('-')` casava errado o **range com hífen** `14 - 15` (peer real do `ngx-pipes@3.2.0`), reintroduzindo o bug. Sem isso, `ngx-pipes@3.2.x` (peer `>=14`/`14 - 15`, ng14+) era dado como compatível com ng13 e instalado lá → `ɵɵPipeDeclaration requires 2 type argument(s)` (`.d.ts` da API Ivy do ng14+, mas o core do ng13 tem 2 args). Com a detecção correta, a resolução pega a `3.0.0` (peer `^13.0.0`). Betas (flex-layout etc.) seguem cobertos.
- `pinCompatibleThirdParty(angularMajor)` — roda **antes de cada `ng update`**, em **dois passos**:
  - **Passo 1 (âncoras)** — libs que peer-dependem de `@angular/core`. Fixa cada uma na versão compatível resolvida e registra o major-alvo em `anchorMajors` (ex: `@nebular/theme → 17`).
  - **Passo 2 (companheiros)** — libs que **não** têm peer `@angular/core`, mas peer-dependem de uma âncora (ex: `@nebular/eva-icons` peer-depende de `@nebular/theme`, não do core). `resolveCompanionVersion()` acha a maior versão cujos peers para as âncoras casam o major fixado (eva-icons segue theme: 8→8, 9→9, 17→17). Sem isso, o companheiro travava na versão antiga e forçava `--force`.
- `extractConflictPackages()` (retry do update) também usa `resolveCompatibleVersion` em vez de `@<major>` para libs de terceiros; quando não há versão compatível, **não injeta** um `@<major>` inexistente (isso fazia o `ng update` abortar com "Package does not exist").
- **Reconciliação do node_modules após o pin**: o pin altera o `package.json`, mas o `node_modules` ainda tem a versão antiga; o `ng update` aborta com `invalid: pkg@<versão antiga>` (árvore inconsistente). Após `pinCompatibleThirdParty`, o pipeline roda `npm install <só os pacotes pinados>@<versão> --legacy-peer-deps` (instalação parcial, não full) para reconciliar a árvore antes do `ng update`.

Sem listas hardcoded — funciona para qualquer lib que declare `peerDependencies` (de `@angular/core` ou de outra âncora). Se nenhuma versão compatível existir no registry (ex: lib abandonada como `ng2-smart-table`, sem versão para ng11+), registra em `report.notes` para correção manual — o migrador não troca a lib por um fork (isso seria específico de biblioteca).

`resolveCompatibleVersion` **prefere a versão cujo major == Angular alvo** (lib que versiona junto, ex: `ngx-mask@16` para ng16 — o build Ivy *daquele* Angular), caindo para a maior estável com peer compatível, depois pré-release. Evita pegar a `latest` (ex: `@18`, build de ng18) que por forward-compat não roda no ng16.

### upgradeThirdPartyForIvy — subir libs View Engine no gate v16 (ngcc removido)

O `ngcc` foi **removido no Angular 16**. Libs de terceiros em major **antigo** (compiladas em View Engine / pré-Ivy — ex: `ngx-mask@11`, `ngx-toastr@13` de 2021) não são mais consumíveis → `NG6002 "does not appear to be an NgModule class"` em cascata por todos os módulos que as importam. O `pinCompatibleThirdParty` **não** as sobe porque o peer é **frouxo** (`>=10` cobre 16). Mas elas **versionam junto com o Angular** (existe `ngx-mask@16` etc.).

`upgradeThirdPartyForIvy(v)` roda **no loop, gate `v >= 16`** (segue o princípio "subir só onde quebra" — abaixo do v16 as libs funcionam via ngcc, então `11→15` não sofre churn): para cada lib de terceiros com major instalado < alvo, resolve a versão Ivy (`resolveCompatibleVersion` → `highestStableWithMajor` para libs sem peer mas que trackeiam, ex: `ngx-echarts`) e **pina exato**. Reporta em `report.notes` **quem subiu** (mudança de API a revisar — a maioria das libs é estável entre majors; ngx-mask é a exceção) e **quem é irresolvível** (`ngx-currency` pulou 3→19 sem ng16; `ngx-swiper-wrapper` abandonada → troca manual). O migrador **não** conserta uso de API específico da lib (seria específico de biblioteca) — sobe a versão e reporta.

**Acesso à rede é premissa do pipeline**, não exceção: todo passo já faz `npm install`/`ng update`. A consulta ao registry (`curl`, via host — `wrapCommand` só embrulha `npm/npx/node` em Docker) segue a mesma premissa. Registry default `https://registry.npmjs.org/`, sobrescrito por `NPM_CONFIG_REGISTRY`.

`patchThirdPartyVersions()` continua existindo como **auditoria final** (passo 12): reporta no `report.notes` qualquer incompatibilidade remanescente que a resolução não cobriu.

### removeUnusedModules — verificar nome de classe, não só path

Verificar apenas o path do arquivo (`/${base}'`) não detecta referências via barrel imports ou path aliases. A verificação correta usa o nome da classe exportada (`export class FooModule`) porque ela aparece em qualquer import, independente do caminho.

### addTsconfigPathAliases — só adiciona aliases de diretórios que existem

Aliases como `@features/*` só fazem sentido se `src/app/features/` existir. Adicionar aliases para diretórios ausentes é misleading. A função verifica `existsSync` antes de cada alias.

### @angular/build em syncVersions

Angular 17+ introduziu `@angular/build` (esbuild/Vite builder). Deve estar em `ANGULAR_PKGS` para ser sincronizado junto com os demais pacotes Angular.

### zone.js versioning

| Angular | zone.js |
|---|---|
| < 17 | ~0.13.x |
| 17-20 | ~0.14.x |
| 21+ | ~0.16.x |

### Angular 22 — alvo default + TS 6 + Node

`opts.to` default é **22**. O grosso das breaking changes do v22 é tratado pelos **schematics automáticos do próprio `ng update@22`** (genéricas do Angular, não viram correção): `OnPush` vira default (migração injeta `ChangeDetectionStrategy.Eager`), `strictTemplates` default (injeta `strictTemplates: false`), optional chaining `?.` em template passa a devolver `undefined` (era `null`; `$safeNavigationMigration()`), HttpClient Fetch default (`withFetch()` removido / `withXhr()` adicionado), `canMatch` ganha 3º param `currentSnapshot`, incremental hydration default (`withNoIncrementalHydration()`). O migrador **não** duplica nenhuma — só roda o update.

O que o migrador trata por conta própria (tabelas de versão):
- **Node**: v22 dropa Node 20; `nodeVersions['22'] = '22'` (Node 22 LTS basta; 24/26 também servem).
- **TypeScript 6 obrigatório** (5.9 não é mais suportado): `TS_FLOOR[22]='6.0'` / `TS_TARGET[22]='~6.0.0'` em `ng-update.mjs` (rede de segurança se o `ng update` não bumpar o TS). O fallback de versões futuras passou a apontar para o 22 (`> 22 → TS_*[22]`). `@types/node` segue sem override (17+).
- **`paramsInheritanceStrategy: 'always'`** (rotas filhas SEMPRE herdam params/data do pai; era `'emptyOnly'`): **sem migração automática** e é mudança de **runtime** (não quebra build) → o migrador só registra `report.notes` no gate `v === 22` (não dá pra detectar/corrigir genericamente). Para manter o antigo: `withRouterConfig({ paramsInheritanceStrategy: 'emptyOnly' })`.

zone.js (`>= 21 → ~0.16.x`), `@angular/build` e o ecossistema detectado em runtime já cobrem o 22.

### ESLint — ng-cli-compat removido no @angular-eslint v17+

`plugin:@angular-eslint/ng-cli-compat` foi removido no v17. A função `fixEslintConfig()` em `transforms.mjs` substitui por `plugin:@angular-eslint/recommended` e remove `ng-cli-compat--formatting-add-on`.

Regras `@typescript-eslint/quotes` e `@typescript-eslint/dot-notation` foram removidas no `@typescript-eslint` v8 — movidas para o ESLint core (`quotes`, `dot-notation`).

### @angular-eslint removido no preflight (re-adicionado no fim)

`@angular-eslint/*` desatualizado (ex: `@angular-eslint@1`, era ng10/11) peer-depende de `@angular-devkit/architect`/`@angular/cli` antigos (`~0.1100`, `>=12 <13`…). Isso faz o `ng update` **abortar com `Incompatible peer dependencies`** e cair em `--force` em **todo step** — churn inútil, porque o `addEslint()` (step `eslint`) roda `ng add @angular/eslint` no fim e re-instala a versão correta. Por isso o `preflight()` **remove todo o toolchain `@angular-eslint/*`** (mesma lógica do TSLint — lint é dev-only, não afeta build/runtime). Os arquivos de config (`.eslintrc`/`eslint.config`) ficam; o `addEslint()` cuida da config no final. `eslint`/`@typescript-eslint/*` **não** são removidos (não peer-dependem de pacotes Angular, então não disparam conflito por versão; o `ng-update.mjs` já alinha as versões deles).

### Princípio: remover/transformar só no ponto onde realmente quebra (preflight por update)

Remoções/transformações destrutivas **não** devem ser eager no `preflight()` inicial. Isso (a) deixa **lacunas que quebram os builds intermediários** (pacote removido mas código ainda usando) e (b) **estraga migrações de alvo baixo** — se o usuário sobe só `11→12`, não faz sentido remover algo que só quebra no v16/v17; o projeto final dele para de rodar.

Regra: cada item sai **no ponto onde de fato quebra**, e **só se a migração chega lá**. Na prática há um "preflight por `ng update`" — no topo de cada iteração do loop (`migrate.mjs`), gateado por versão:

| Item | Quebra de fato em | Onde é tratado |
|---|---|---|
| `tslint`/`codelyzer`/`protractor`/`@angular-eslint` | peer-conflict **já no 1º `ng update`** | `preflight()` inicial (correto — é o ponto onde quebram) |
| `node-sass` | 1º boundary de troca de Node (Docker sem Python) | `preflight()` inicial |
| **`@angular/flex-layout`** | sem versão **v16+** | **correção proativa** `angular-flex-layout-tailwind` (`gate(v)===16`), via `runProactiveCorrections(v)` no topo do loop |
| **Material `legacy-*`** | removido no **v17** | gate `v === 17` no loop (`fixLegacyMaterial`) |
| **`core-js`** (polyfills legados) | só no **builder esbuild (v17)** | `inlinePolyfills()` (step do builder) — `preflight()` **não** remove |
| **RxJS 6→7** (`throwError`/`Subject.next`/`internal-compatibility`) | quando o **rxjs vira 7** (tipicamente ng13) | boundary no loop (`getInstalledMajor('rxjs') >= 7`), não só no fim |

**Modernizações tied a uma dependência rodam no boundary da dependência, não no fim.** Os fixes de **RxJS 6→7** (`fixThrowError` → factory, `fixSubjectVoid` → `new Subject<void>()` só p/ lifecycle, `fixSubjectNextArgless` → `.next()` argless vira `.next(undefined as any)`, `fixRxjsInternalCompat` → `rxjs/internal-compatibility` removido no 7) são **transforms de texto puro** atrelados ao rxjs, não schematics do Angular.

**`Subject.next()` argless: corrigir a CHAMADA, não o tipo.** RxJS 6 tinha `next(value?: T)` (opcional) → `subject.next()` buildava limpo no ng11. RxJS 7 é `next(value: T)` (obrigatório) → `TS2554`. **Só `Subject<void>` permite `.next()` argless** (regra do TS p/ params `void`); `<any>`/`<boolean>` **não** (`new Subject<any>().next()` → TS2554, comprovado). Mas um Subject pode receber **valor** em outro componente — `<void>` quebraria os `.next(valor)`. Então o fix universal é na **chamada**: `fixSubjectNextArgless` troca `.next()` → `.next(undefined as any)` (replica o RxJS 6, vale p/ qualquer tipo, idempotente). **Exclui receivers `*stepper`** (`MatStepper`/`CdkStepper`: `stepper.next()` é "próximo passo", **0-arg** — passar arg dá TS2554 "Expected 0 arguments, but got 1"). Iteradores toleram o arg (value opcional). Se surgir outro componente com `.next()` 0-arg, adicionar ao denylist. `fixSubjectVoid` passa a converter p/ `<void>` **só** os Subjects de lifecycle (destroy/unsubscribe…), nunca por "tem `.next()` argless". O rxjs vira 7 já no **ng13** (o `ng update` resolve), mas a modernização rodava no fim → os erros (`TS2554` em `.next()`, `TS2307` em `internal-compatibility`, `throwError(valor)`) quebravam os builds intermediários. Por isso rodam **no loop, no boundary `rxjs >= 7`** (one-shot via `report.modernize._rxjsCompatBoundary`). O `fixTsCompat()` (que tem **renames de Material v15**, NÃO seguros no ng13) **fica no fim** — só o `fixRxjsInternalCompat` foi extraído dele para o boundary. Os schematics de modernização do Angular (standalone, signals, control-flow) **seguem no fim** (maturidade do schematic — ver "rodar intercalado bagunça"). O step `throwError` da modernização vira rede de segurança idempotente (`|| ` preserva a contagem do boundary).

### flex-layout → Tailwind: correção PROATIVA no gate v16 (não eager, não em alvo < 16)

`@angular/flex-layout` não tem versão Angular 16+. Removê-lo eager no `preflight()` deixa **imports órfãos** (`FlexLayoutModule` nos `.module.ts`, `fx*` nos templates) → `TS2307: Cannot find module '@angular/flex-layout'` no `SharedModule` → como **todo módulo importa o `SharedModule`**, vira `NG6002` em cada um → cascata de `NG8001`/`NG8004`/`NG8002` por todo o app (num projeto real: **373 erros** a partir de **um** pacote faltando, mascarando se a migração funcionou).

**É uma correção** (específica do `@angular/flex-layout`), não uma modernização genérica. Mas é **proativa** (gatilho `gate`, não `detect`): tem que rodar **antes** de subir para o 16 — esperar o erro de build seria tarde, o `npm install` do `ng update@16` já teria falhado por não achar candidato. Por isso vive em `corrections/angular-flex-layout-tailwind.mjs` com `gate(v) === 16`, disparada por `runProactiveCorrections(v)` no topo do loop. É **AUTOCONTIDA**: toda a conversão (fxLayout/fxFlex/… → classes Tailwind, remoção do `FlexLayoutModule`, scaffolding do Tailwind) está inlinada no arquivo — usa só `fs`/`path` + os mecanismos do ctx (`transformHtml`/`transformTs`/`installDevDeps`), **sem importar nada do migrador** (`migrator/flex-layout.mjs` foi removido). Abaixo do v16 fica **intocado** — `11→12`/`11→15` mantêm o flex-layout funcionando. Tem **guard**: no-op se o projeto não declara `@angular/flex-layout` (não instala Tailwind à toa). A **rede de segurança** para resume que pula o loop vive em `migrate.mjs` (antes da modernização): `if (opts.to >= 16 && hasPackage('@angular/flex-layout')) await runProactiveCorrections(16)` — dispara a MESMA correção (`hasPackage` é o sinal de "ainda não migrado"; a correção remove o pacote ao converter). Assim a lógica do flex-layout fica 100% isolada na correção, fora da modernização (`orchestrate.mjs` não a referencia mais). `core-js` segue o mesmo princípio de "subir/remover só onde quebra": não é removido no preflight (não quebra `ng update`, só o esbuild) — `inlinePolyfills()` limpa os imports legados no step do builder via `stripLegacyPolyfillImports()`.

**Decisão: manter Tailwind (não trocar pelo fork `@ngbracket/ngx-layout`).** Havia a opção de trocar `@angular/flex-layout` pelo drop-in `@ngbracket/ngx-layout` (fork mantido, mesma API `fx*`, `@22` suporta ng22) — preservaria os layouts sem tocar nos templates. Optou-se por **manter a conversão Tailwind** (sem dep de fork de terceiros). Por isso a fidelidade da conversão importa, e três bugs foram corrigidos (validados no orion login — ver `MIGRATOR-IMPROVEMENTS.md` §6.2/§6.6):
- **Unidade do `fxFlex`**: `fxFlex="420px"` virava `w-[420%]` (largava o `px`, anexava `%`). Agora detecta unidade de comprimento (`px/em/rem/…`) e preserva → `w-[420px]`.
- **`flex` faltando**: `fxLayoutAlign` emitia só `justify-*/items-*` (sem `display:flex`) → não alinhava. Agora emite `flex justify-* items-*`; `processTag` deduplica o `flex` quando o elemento também tem `fxLayout`.
- **Preflight**: o `tailwind.config` gerado inclui `corePlugins: { preflight: false }` — o reset base do Tailwind quebrava Material/estilos existentes (logo gigante, inputs crus). **Limite conhecido**: o eixo do `fxFlex` (largura em row, altura em column) depende do `fxLayout` do pai; a conversão é por-elemento (sem contexto do pai), então `fxFlex="50"` num container `column` ainda vira `w-1/2` (largura). Caso minoritário, não corrigido (exigiria conversão tree-aware).

### NG2012 — NgModules incompatíveis com Ivy

Quando `autoFixBuildErrors` encontra `NG2012` (NgModule não compilado com Ivy), o símbolo é substituído por `// TODO: [NG2012]` no array `imports` e a linha de `import` ES é comentada. Nunca remove silenciosamente — o desenvolvedor precisa saber o que precisar atualizar.

### TS2305 — import fantasma (símbolo só existe em comentário do .d.ts)

`autoFixBuildErrors` também trata `TS2305` ("Module 'X' has no exported member 'Y'"): remove o `import` inválido e a entrada correspondente no `imports[]`/`declarations[]` do decorator. Surge quando um símbolo é resolvido a partir de algo que **não é export real** — ex: `PageModule` aparece só em **comentário JSDoc de exemplo** no `.d.ts` do `@nebular/theme`, e foi indevidamente importado de lá. Além de limpar o lixo, isso **desbloqueia o build-loop**: erros de TypeScript interrompem o `ng build` antes da fase de template, então resolver os TS2305 deixa o oráculo alcançar e tratar os NG2012/NG8001 seguintes.

### TS2304 — símbolo usado sem import (resolução via registry de exports)

`autoFixBuildErrors` trata `TS2304` ("Cannot find name 'X'"): resolve `X` no **mapa de imports do projeto** (`projectEsMap`) ou no **índice de símbolos exportados pelos `.d.ts` instalados** (`buildExternalSymbolIndex` — varre `declare class/function/const` e `export { … }` de cada dep) e adiciona o `import` ES. Pega símbolos que o `createAppConfigAndRoutes`/standalone-bootstrap referenciam sem importar: `NbSidebarModule`/`NbMenuModule`… no `importProvidersFrom` do `app.config.ts`, `NbAuthComponent`/`NbLoginComponent`… nas rotas de auth do `app.routes.ts`, e `forwardRef`. Só adiciona se o símbolo for resolvível (senão é erro real, não import faltante).

### TS2341 — membro `private` acessado no template

Templates Angular (estritos no 14+) não acessam membros `private`. `autoFixBuildErrors` trata `TS2341` ("Property 'X' is private…") tornando o membro **public** (remove o modificador `private` da declaração no `.ts` — resolvendo `.html` → `.ts` quando o template é externo).

### forwardRef precisa ser importado ao ser injetado

O fix de dependência circular injeta `forwardRef(() => X)` no `imports[]`. A checagem para importar `forwardRef` era `!src.includes('forwardRef')` — mas como o texto `forwardRef(() => X)` **acabou de ser inserido**, a checagem dava sempre `true` e o `import { forwardRef }` nunca era adicionado (→ TS2304). Agora a checagem testa o **import** real (`import { … forwardRef … } from '@angular/core'`), e cria o import se não existir.

### cleanup-unused-imports roda 2× (o 2º quebra ciclos NG0919)

`copyModuleImportsToComponents` é liberal: copia para cada componente os imports co-declarados (irmãos + pai do mesmo módulo), mesmo os não usados no template. Isso cria **imports circulares** entre componentes → `NG0919` ("Cannot read @Component metadata") em runtime. O schematic `cleanup-unused-imports` remove os excedentes, mas precisa de um **programa TS compilável** — o 1º passe (antes do `autoFixBuildErrors`) não removia nada porque o build ainda tinha erros. Por isso roda um **2º passe depois do `autoFixBuildErrors`**, com o build já saneado, quebrando os ciclos.

### resolveNodeTypesOverride — previne EOVERRIDE do npm 9+

npm 9+ (Node 18+) rejeita instalações onde um `overrides` define um range incompatível com a dependência direta (`EOVERRIDE`). A função `resolveNodeTypesOverride(targetVersion)` deve ser chamada imediatamente **antes** de cada `ng update` para alinhar o override de `@types/node` com a versão correta de TypeScript disponível em cada step:

| Angular | @types/node | Motivo |
|---|---|---|
| ≤ 12 | `^14.18.0` | TS 4.1–4.3 — pré-4.5 syntax |
| 13–16 | `^16.18.0` | TS 4.4–4.9 — sem `Symbol.Disposable` |
| 17+ | remove override | TS 5.2+ suporta `@types/node@20+` |

### Artefatos do schematic `signals` que precisam de correção manual

O schematic `@angular/core:signals --best-effort-mode` produz três tipos de artefatos que precisam de correção imediata:

1. **`fixVoidOutputEmit()`** — `output()` sem type param infere `void`. Calls `.emit(value)` que sobraram precisam ter o argumento removido.
2. **`fixReadonlySignalInputAssignments()`** — o schematic converte `@Input()` para `input()`, mas se a propriedade é atribuída diretamente no código (`this.prop = value`), isso gera TS2540 (read-only). Detecta e reverte esses casos de volta para `@Input()`. ⚠️ O revert **captura o modificador de acesso** (`public`/`private`) que precede `readonly` e emite `@Input() public name` — senão o modificador fica sobrando na frente (`public @Input()` → **TS1436**, decorator depois do modificador).
3. **`fixReadonlySignalQueryAssignments()`** — mesmo problema para queries: `@ViewChild`/`@ContentChild` → `viewChild()`/`contentChild()` (signal readonly). Se a query é atribuída (`this.x = …` — comum em `ViewContainerRef` de chart), dá TS2540. Reverte ao decorator original, inferindo o tipo do `<T>` ou do `{ read: R }`.
4. **`fixSignalPropertyAccess()`** — migração incompleta deixa `this.signalProp.method` em vez de `this.signalProp().method`. Produz TS2339.

### fixDoubleCommas — artefato do standalone-bootstrap

O schematic `standalone-bootstrap` e `fixStandaloneInModuleDeclarations` podem introduzir `,,` (double commas) em arrays TypeScript quando remove itens. `fixDoubleCommas()` deve ser chamado imediatamente após esses schematics.

### fixSubjectEmit — roda depois do standalone-bootstrap, não antes

`@Output() xxx = new Subject<T>()` deve ser `new EventEmitter<T>()`. O `fixSubjectEmit()` é chamado **depois** do `standalone-bootstrap` porque o schematic pode regenerar arquivos de componentes, revertendo correções feitas anteriormente no step de signals.

### fixTs2663SignalAccess — roda após builder e tsconfig

TS2663 ("Cannot find name 'prop'. Did you mean 'this.prop'?") surge quando o schematic de signals converte `this.prop.x` para `prop.x` (sem `this.`). O esbuild builder é mais estrito que o webpack e expõe esses erros. A função faz um `ng build` para obter localizações precisas e corrige cirurgicamente. Roda duas vezes: após o migration para `application builder` e após `modernizeTsconfig` (o `skipLibCheck: true` + ES2022 reduz ruído tornando o TS2663 mais visível).

### control-flow — pula se ng update já aplicou

`ng update @angular/core@19` aplica a migração `control-flow` como parte do update. Executar o schematic novamente é no-op e gera avisos. Verificar `scanForContent('*ngIf', ['.html'])` antes de executar evita o schematic desnecessário.

### --split-versions — uma pasta por versão Angular

`--split-versions` faz o migrador criar uma pasta separada por versão Angular (ex: `proj-ng-versions/ng12`, `ng13`, ...). A pasta de cada versão é criada copiando a anterior com:
- `copyDir()` para arquivos-fonte (exclui `.git` e `node_modules`)
- `cp -a .git newDest` — preserva o histórico git para `captureGitDiff` funcionar
- `cp -al node_modules newDest` — hard-link instantâneo, sem reinstalar

Se o destino já tem um `.git` (run anterior parou no meio), o pipeline pula cópia, preflight, git init e npm install — continua de onde parou.

### --resume-from — retomar de um step específico

Como **cada step é commitado** no git do destino, dá pra retomar de qualquer ponto sem refazer o que já passou (útil ao corrigir o migrador e re-rodar só de um ponto — evita repetir o lento loop de `ng update`).

- Cada commit leva um trailer **`[ng-migrator-step:<key>]`** (`commitStep` na modernização; `[ng-migrator-step:ng<v>]` no `ng update`) → torna o step localizável.
- `--resume-from <step>` (ex: `ng14`, `signals`, `builder`):
  1. Localiza o commit do step (pelo trailer; fallback por mensagem `chore: Angular N` para `ngNN` em destinos antigos), faz **`git reset --hard <commit>~1`** (estado **antes** do step — descarta os commits posteriores) e **reinstala** o `node_modules` (não é commitado; a versão de Node vem do `@angular/core` do `package.json` resetado).
  2. **Entrada**: se `ngNN` → o loop de `ng update` começa em NN, depois modernização; se for key de modernização → **pula o loop inteiro** e adiciona ao `skipSteps` todas as keys **anteriores** ao alvo (rodando a modernização a partir dele).
- Ordem canônica das keys em `MODERNIZATION_STEPS` (context.mjs) = ordem em `runModernizationMigrations`.
- Destinos migrados **antes** deste suporte só têm o trailer em runs novos — para esses, retome de um `ngNN` (fallback por mensagem) ou re-rode uma vez.

---

## Pipeline

0. **Docker Preflight Check**: Executa `checkDocker()` para validar se o Docker está ativo. Se não, interrompe a execução com erro.
1. **Copia** o projeto para pasta irmã com sufixo `-ng{target}` (ou `--dest`)
2. Remove lockfiles antigos (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`)
3. **`preflight()`** — remove `ngcc` dos scripts, remove `codelyzer`/`protractor`/`karma-coverage-istanbul-reporter`/`core-js` e **todo o ecossistema `tslint*`** (`tslint`, `tslint-language-service`, … — morto desde 2019, peer TS < 3 conflita em todo step) e **`@angular-eslint/*`** (peer Angular antigo força `--force` em todo step — re-adicionado por `addEslint()`; ver "@angular-eslint removido no preflight"); bumpa `@types/jasmine`, `jasmine-core`, `@types/node`, `ts-node`; troca `node-sass` → `sass` (ver "node-sass")
4. **`cleanupLegacyFiles()`** — remove `tslint.json`, projeto e2e do `angular.json`, chama `fixKarmaConf()`
5. Se source >= v15: `fixLegacyMaterial()` imediatamente
6. **`git init`** + commit inicial — `ng update` exige repositório git
7. **`npm install`** das dependências da versão atual (executado via `wrapCommand` com a versão de Node adequada para a versão inicial do Angular)
8. Loop `startVersion → targetVersion` (cada iteração executa comandos de Node/npm isolados via container Docker para a respectiva versão do Angular, monitorada via `currentAngularVersion`):
   - `runProactiveCorrections(v)` — correções proativas (gatilho `gate`) deste major, antes do update (ex: flex-layout → Tailwind no v16)
   - Antes do v17: `fixLegacyMaterial()` (converte `MatLegacy*` → `Mat*`)
   - `resolveNodeTypesOverride(v)` — alinha override `@types/node` para evitar EOVERRIDE
   - `pinCompatibleThirdParty(v)` — (só na estratégia `resolve`) fixa versões compatíveis de libs de terceiros antes do update
   - `npx ng update @angular/core@v @angular/cli@v [material@v] --allow-dirty` + loop de resolução de peer deps (ver "Estratégia de conflitos de peer dependency")
   - `syncVersions(v)` — força `@angular/*` atrasados para `^v.0.0`, rxjs 6→7, zone.js
   - `npm install`
   - `git commit "chore: Angular vN"`
   - `writeReport(true)` — atualiza `MIGRATION-STATUS.html` e `MIGRATION-REPORT.md` em tempo real
   (Antes da modernização, em `migrate.mjs`) **rede de segurança** do `@angular/flex-layout` → Tailwind: `if (opts.to >= 16 && hasPackage('@angular/flex-layout')) await runProactiveCorrections(16)` — só dispara em resume que pula o loop; o caminho normal é a correção proativa no v16.
9. **Modernização** (salvo com `--no-modernize`) — cada step faz commit individual e rastreia arquivos/linhas via `captureGitDiff`:
   1. `inject-migration` schematic
   2. `signals` schematic (`--best-effort-mode`) + `fixVoidOutputEmit` + `fixReadonlySignalInputAssignments` + `fixSignalPropertyAccess`
   2b. `fixReservedKeywordVariables` — renomeia variáveis geradas com palavras reservadas
   2c. `fixUntypedForms()` — `UntypedFormBuilder/Group/Control/Array` → typed
   2d. `fixThrowError()` + `fixSubjectVoid()` + `fixTsCompat()` — RxJS 7 + TS compat (renames Material e moment **saíram** daqui → viraram correções)
   3. `standalone-migration` (convert → prune → bootstrap) + `fixDoubleCommas` + `fixSubjectEmit`
   3b. `fixMissingStandalone()` + `fixStandaloneInModuleDeclarations()` + `fixDoubleCommas` + `fixStandaloneImports()`
   3c. `control-flow` schematic — pula se `*ngIf/*ngFor` não encontrado (ng update@19 já aplicou)
   3d. `ngclass-to-class` schematic
   3e. `ngstyle-to-style` schematic
   4. `createAppConfigAndRoutes()` — gera `app.config.ts` e `app.routes.ts`
   4b. `convertLazyModulesToRoutes()` + `convertRemainingRoutingModules()` — NgModule routes → `.routes.ts`
   5. `use-application-builder` migration (esbuild/Vite) + `fixTs2663SignalAccess`
   5b. `inlinePolyfills()` — remove polyfills legados (`core-js/es6|es7/*`, `classlist.js`, `intl` — paths inexistentes no core-js 3 / desnecessários), move `zone.js` para `angular.json`, remove `polyfills.ts`
   6. `modernizeTsconfig()` — ES2022, `moduleResolution: "bundler"`, `useDefineForClassFields: false` + re-run `fixTs2663SignalAccess`
   6b. `addTsconfigPathAliases()` — aliases para diretórios existentes em `src/app/`
   6c. `addEslint()` — `ng add @angular/eslint`
   7. `fixSassImports()` — `@import` → `@use … as *` (conservador: mantém `@import` em arquivos que usam mixin sem namespace — ver "fixSassImports conservador")
   8. `removeUnusedModules()` — remove `.module.ts` não referenciados + segundo pass standalone se necessário
   9. `fixStyleUrls()` — `styleUrls: []` → `styleUrl` singular
   10. `self-closing-tag` schematic
   11. `cleanup-unused-imports` schematic + `autoFixBuildErrors` (NG8001/NG8004 genérico)
   12. `patchThirdPartyVersions()` — detecta e reporta libs com peer deps incompatíveis
   13. `runCorrections(opts.to)` — correções error-driven (`detect`) ao FIM da modernização: builda o estado final, casa por código de erro e aplica (ex: `moment-default-import` dispara após `esModuleInterop`). A correção `material` é **proativa** (`gate v>=15`, roda no loop via `runProactiveCorrections`, não aqui). Commit `[ng-migrator-step:corrections]` + re-build-check se aplicou algo.
   Final. `eslint --fix` (único, no final, não contamina diffs individuais)
10. **`writeReport()`** — relatório final com git diff --stat, MIGRATION.patch e seção "File changes per step"

### Isolamento de Ambiente com Docker

Para evitar incompatibilidades de pacotes/Node.js locais e prevenir a modificação acidental do ambiente host do usuário, o `ng-migrator` implementa isolamento de execução:

1. **Preflight**: Verifica a execução do Docker com `docker ps`. Aborta em caso de indisponibilidade de forma amigável.
2. **Encapsulamento de Comandos**: A função `wrapCommand` analisa comandos executados (como `npm install`, `npx ng ...`) e os executa através de `docker run --rm --name ng-migrator-runner node:<versao> <comando>`.
3. **Mapeamento de Usuário e Permissões**: Informa `--user $(id -u):$(id -g)` na inicialização do container para manter a propriedade dos arquivos gerados com o usuário host (evitando arquivos gerados com permissões de `root`).
4. **Cache de Instalação**: Monta o cache do npm do host (`~/.npm`) no container em `/tmp/.npm` para acelerar instalações de pacotes.
5. **Configuração Flexível (`ng-migrator.config.json`)**: Permite que o usuário defina a estratégia (`nodeVersionManager`: `"docker" | "nvm" | "fnm" | "n" | "asdf" | "none" | "auto"`), mapeie versões do Angular para Node (`nodeVersions`) ou utilize comandos customizados (`customManagerCommand`).

### Rastreamento de mudanças em tempo real

- `writeReport(true)` é chamado após cada step do ng update loop e de cada modernização
- Gera `MIGRATION-STATUS.html` (auto-refresh a cada 4s no browser) e `MIGRATION-REPORT.md`
- `captureGitDiff(h0, h1)` — usa `git diff --name-status` + `git diff` por arquivo para extrair paths e linhas adicionadas (`parseAddedLines` / `formatRanges`)
- Cada step de modernização faz `git add -A && git commit` individualmente para isolar o diff

### Log ao vivo no dashboard — migração via CLI também aparece em tempo real

O dashboard (`ng-migrator-ui.mjs`, polling de `/api/status` a cada 3s + SSE `/api/terminal`) precisa de uma **fonte de logs** pra migrações iniciadas **fora** da UI (via CLI/nohup) — ele detecta o processo no `ps` mas **não tem como capturar o stdout de um processo que não iniciou**. A ponte é um **arquivo de log** que o migrador grava e a UI segue com `tail -f`.

- **Migrador (`migrate.mjs`)**: no topo do pipeline, **re-executa a si mesmo via `tee`** (`sh -c 'exec node … 2>&1 | tee <log>'`, top-level await, guardado por `NG_MIGRATOR_TEE`) → captura **TODA** a saída, **inclusive a dos child processes** (npm/docker/ng update usam `stdio:'inherit'`, então **não** passam por `process.stdout.write` — um tee em JS os perderia; só o re-exec via shell pega). O log fica **DENTRO de `<dest>/.ng-migrator/migration.log`** (`migratorDir`), junto dos demais artefatos — não no diretório pai. Seguro mesmo p/ pasta-irmã que ainda não existe: o `mkdirSync(migratorDir)` no topo cria `<dest>/.ng-migrator/`, e o `copyDir` posterior só faz `mkdirSync(dest)`+copia o source **dentro** (não apaga o dest) → o log sobrevive. Pulado em `--dry-run`.
- **UI iniciada (POST /api/migrate)**: passa `NG_MIGRATOR_TEE=1` → o migrador **não** re-executa (a UI já captura o stdout do `spawn` direto e faz broadcast; mantém o PID direto pro `/api/stop`). O arquivo+tail é só pro caso CLI.
- **UI — detecção externa (`detectAndAttachExternalMigration`, poll 5s)**: deriva o `dest` dos args com a **mesma regra** do migrador (`--dest X`; `--in-place` → pos; senão `<pos>-ng<--to|22>` — o default é **22**, não 21 como era antes), **pula a linha do wrapper `| tee`** (args vêm com aspas), dá `tail -n 200 -f` no log e **seta `currentMigrationData.destPath`** — é isso que faz o `/api/status` voltar a reler o `MIGRATION-DATA.json` e a view estruturada (steps/correções) atualizar. Sem o destPath setado, o status ficava congelado.

Mudou `ng-migrator-ui.mjs`? **Reiniciar o server** (o frontend em `dist` não precisa rebuild se `src/` não mudou). Migrações já em andamento com o `migrate.mjs` **antigo** (sem o tee) não geram o log → só as **novas** aparecem ao vivo.

### Ecossistema Angular detectado em runtime (sem lista hardcoded)

Os pacotes oficiais do escopo `@angular/*` (material, cdk, google-maps, youtube-player, localize, elements, service-worker, framework…) versionam em **lockstep** com o `@angular/core`. Se um ficar para trás, no step seguinte o `ng update` aborta com *"Updating multiple major versions of '@angular/X' at once is not supported. Please migrate each major version individually."* — falha **não relacionada a peer deps** (não resolvida por `--force`). Foi o que segurava `@angular/google-maps` em v11 num projeto real.

Em vez de uma lista hardcoded (que não escala e exige manutenção a cada release), o conjunto é **detectado em runtime**:

- `captureAngularEcosystem()` — chamado **uma vez no início** (após o npm install, com `node_modules` populado): varre `node_modules/@angular/*` e congela os pacotes cujo **major instalado == major do core**. É o sinal genérico de "versiona junto": pacotes de terceiros que só usam o escopo `@angular/` (ex: `@angular/fire`) ficam num major diferente e são naturalmente excluídos.
- O conjunto é **congelado no início, não redetectado por step** — senão um pacote que ficasse para trás deixaria de casar o major e seria excluído (reproduzindo o bug). Frozen no v11, `google-maps@11 == core@11` → entra → é forçado a `@v` em todo step.
- `extraPackages(v)` inclui cada um, mas só se `publishesMajor(pkg, v)` (registry) — assim um pacote deprecado que parou de publicar (ex: `@angular/flex-layout@16` inexistente) sai do conjunto sozinho, sem hardcode.
- `syncVersions` também sincroniza esse conjunto (`ANGULAR_PKGS` ∪ ecossistema detectado) como rede de segurança.
- **Pacotes do ecossistema beta-only** (ex: `@angular/flex-layout`, que **nunca** teve um `12.0.0` estável — só `12.0.0-beta.35`): cravar `^v.0.0` dá `npm ERR! ETARGET No matching version` e quebra o `npm install` do step. `resolveEcosystemSpec(name, major)` consulta o registry e: se há versão **estável** no major → `^v.0.0`; se só há **pré-releases** → fixa a **maior versão exata** (`12.0.0-beta.35`); se não há nenhuma (flex-layout no v16) → `null` (mantido, e convertido no gate v16). `syncVersions` usa isso para o ecossistema runtime (framework/devkit seguem `^v.0.0`); `extraPackages` usa a versão exata no `ng update pkg@<ver>`. Genérico — vale para qualquer pacote do escopo com versionamento não-padrão, sem lista hardcoded.

`@nguniversal/express-engine` (fora do escopo `@angular/`) continua tratado à parte em `extraPackages` — apenas até v16 (a partir do v17 vira `@angular/ssr`).

### Por que --allow-dirty e --force?

- `--allow-dirty`: bypassa a verificação de uncommitted changes (necessário pois fizemos `git init` e o working tree nunca está limpo entre passos)
- `--force`: bypassa verificações de peer dependency compatibility entre versões intermediárias

### Estratégia de conflitos de peer dependency (`--peer-strategy`)

O usuário escolhe como o `ng update` lida com `Incompatible peer dependencies found` (CLI `--peer-strategy`, UI checkbox "Forçar peer deps"):

- **`resolve`** (default) — antes do update, `pinCompatibleThirdParty(v)` fixa versões compatíveis (ver seção "Resolução genérica de versões compatíveis"). Se o update ainda falhar, entra um **loop iterativo** (`MAX_RESOLVE_ITERATIONS = 6`): cada iteração extrai os pacotes conflitantes do output (`extractConflictPackages`, que resolve a versão certa via registry) e re-tenta o `ng update` incluindo-os. Conflitos secundários (que só aparecem depois de resolver os primeiros — ex: `@nebular/eva-icons` casado com `@nebular/theme`) são absorvidos pelas iterações seguintes. `--force` só roda como **último recurso**, e apenas para o que sobrou irresolvível (ex: libs abandonadas como `ng2-smart-table`, sem nenhuma versão compatível publicada).

  **`--force` é condicionado a haver conflito de peer dependency real** (`listConflictPackageNames(output).length > 0`). O `--force` do `ng update` *só* bypassa a checagem de peer deps — então, se a falha não for de peer (erro de schematic/migração, etc.), forçar não resolveria nada. Nesse caso o migrador **não força**: marca `peer.failedNonPeer` e guarda a cauda do output (`peer.failureTail`) para diagnóstico na UI; `syncVersions` + `--migrate-only` cuidam do bump da versão. Isso evita o "tudo forçado" causado por tratar qualquer saída não-zero como motivo para `--force`.
- **`force`** — pula `pinCompatibleThirdParty` e o loop; ao primeiro erro do `ng update`, aplica `--force` imediatamente. Mais rápido, porém empurra versões incompatíveis silenciosamente. Útil quando o usuário aceita o risco para ganhar velocidade.

O motivo de o loop ser iterativo, e não um único retry: o `ng update` reporta os conflitos de peer dependency **em camadas** — resolver os primeiros revela os próximos.

### node-sass — trocar por dart-sass no preflight

`node-sass` é um módulo **nativo**: compila libsass via `node-gyp`, que exige **Python + toolchain de build**. As imagens Docker `node:NN` usadas no isolamento não têm Python. No boundary onde o Node troca de major (ex: ng12 node:14 → ng13 node:16), o `node-sass` tenta **recompilar** o binário nativo, não encontra Python (`Can't find Python executable "python"`), e o `npm install` falha **inteiro** — deixando o `node_modules` incompleto. `node-sass` está deprecado; `preflight()` o troca por `sass` (dart-sass, JS puro, sem build nativo — o que o Angular CLI já usa). Fix genérico: vale para qualquer projeto que ainda dependa de `node-sass`.

### fixMangledSassNamespaceDefs — desfaz definição Sass com namespace (schematic do Material)

O `ng update` do **Angular Material** roda um schematic que renomeia `mat-X(` → `mat.define-X(` em TODA ocorrência — inclusive na **definição** de `@function`/`@mixin` **custom** que shadowam um nome do Material (ex: projeto define a sua própria `@function mat-light-theme(...)` com params extras). Vira `@function mat.define-light-theme(` — **Sass inválido** (`expected "("`) → quebra o build do step. Sass nunca permite definição com namespace. `fixMangledSassNamespaceDefs()` (em `transforms.mjs`, rodado **no loop após cada ng update**, antes do build do step) faz 2 passes: (1) coleta cross-file os nomes definidos como `NS.name`; (2) remove o prefixo `NS.` desses nomes em **todos** os `.scss` (definição **e** chamadas — podem estar em arquivos diferentes), restaurando a função custom sem colidir com o `mat.` real. Genérico, idempotente.

### Correção ÚNICA `material` — @angular/material legacy→MDC (v15) … NG8023 (v19)

**Toda a migração do Material vive em UM arquivo `corrections/material.mjs`** (decisão: um `material.mjs` que trata todos os problemas de Material, não vários `material-mdc-*`). Absorveu `material-mdc-styles` e `material-api-renames` (removidos).

O `ng update @angular/material` migra a API básica, mas **não cobre** tema/CSS custom do app, vários defaults do MDC, templates (chip/slider), o cast de `ngControl`, nem o crash de timing do `_control` → build/runtime podem ficar limpos mas a app fica **visualmente quebrada** + quebras pontuais (ver `MIGRATOR-IMPROVEMENTS.md` §1bis/§6).

**Gatilho — o desafio das versões:** as quebras do Material acontecem em majors **diferentes** (api-renames v15, Sass/CSS/templates v15-17, NG8023 v19) e uma correção tem **um** gatilho. Solução: **`gate: v => v >= 15`** (dispara no topo de CADA iteração do loop a partir do v15) + um **`apply` CIENTE DA VERSÃO** (lê `ctx.angularMajor` — campo novo do ApplyContext) que aplica cada transform só onde é válido/necessário. Tudo **IDEMPOTENTE** (re-rodar nos majors seguintes não duplica; só o 1º firing que muca commita). É **proativa** (não dá pra ser error-driven: o estrago é majoritariamente visual, sem código TS/NG → `runCorrections` faz `return` em `!codes.size`). Robusta a `--from` (o 1º gate `>= 15` pega o api-renames mesmo começando em 16). Usa `transformTs`/`transformHtml`/`transformStyles`.

**Por major** (cada bloco é idempotente):
- **v15+** — TS: `_countGroupLabelsBeforeLegacyOption`→`…BeforeOption`, `_getLegacyOptionScrollPosition`→`…OptionScrollPosition`, `(x._control.ngControl as NgControl)` (+ **garante o import de `NgControl`** — gap antigo que gerava TS2304), `._control.ngControl`→`._control?.ngControl` (crash de timing §5.4). CSS: renames de classe. Sass: mixins legados. Templates: chip-list→grid/set, slider.
- **v17+** — Sass: theme-map FLAT→aninhado, typography legacy→M2 (traduz a config DO APP), defaults compactos (anexados ao FIM do tema).
- **v19+** — Templates: NG8023 botão com 2+ diretivas de estilo.

Cobre:
- **theme-map FLAT→aninhado (§6.5, dominante):** funções custom (`define-light-theme`/`mat-light-theme`) montam o theme-map no formato FLAT do M2 (`@return (primary:…, accent:…, is-dark:…)`). O `mat.all-component-themes` do MDC exige a chave `color` aninhada — sem ela **nenhum componente recebe cor**. `fixThemeMapFunctions` acha o `@return (…)` FLAT (tem `primary`+`accent`+`is-dark`/`foreground`, sem `color:`) e reescreve como `map-merge(mat.m2-define-{light,dark}-theme((color/typography/density)), (<flat original>))` (detecta `is-dark:true` p/ dark; preserva as chaves flat extras `success`/`info`/… que o mixin custom-theme lê no topo).
- **renames de classe CSS legada→MDC (§6.1, dominante):** o CSS do app mira `.mat-card`/`.mat-form-field`/… que o MDC renomeou. Allowlist (`MDC_RENAMED`) com **boundary exato** (`\.mat-${cls}(?![\\w-])` → `.mat-button` ≠ `.mat-button-toggle`); estruturais sem mapa 1:1 (`form-field-wrapper`, `tab-label`, `chip-list`…) ficam em `MDC_STRUCTURAL`, **não** são renomeadas e entram no summary p/ revisão manual.
- **typography legacy→M2 (§6.7, decisão = traduzir a config DO APP, não valores fixos):** pré-pass cross-file acha o var (`$custom-typography`); `translateLegacyTypographyCall` converte `define-legacy-typography-config`→`m2-define-typography-config` remapeando os levels (`$display-4`→`$headline-1`, `$body-1`↔`$body-2`… **single-pass** com alternação longest-first p/ não cascatear — `headline`→`headline-5` pegaria o `headline-1` recém-criado); o theme-map fia `typography: $custom-typography` (preserva os TAMANHOS do app). Funciona via `@import` (escopo global no call-site).
- **mixins Sass legados (rede de segurança):** `mat.legacy-core`→`mat.core`, `mat.all-legacy-component-themes`→`mat.all-component-themes`, `mat.legacy-X-theme`→`mat.X-theme`; tipografia legacy (removida no v17, sem equivalente) → comenta o `@include`.
- **renames especiais não-prefixo:** `.mat-error`→`.mat-mdc-form-field-error`, `.mat-hint`→`.mat-mdc-form-field-hint` (`MDC_SPECIAL`).
- **defaults de comportamento do MDC (§6.7, anexados ao FIM do tema, após `all-component-themes`):** `@include <ns>.form-field-density(-2)` (form-field 56→48px do legacy), `.mat-button-toggle-checkbox-wrapper { display:none !important }` (esconde o ✓ NOVO do MDC), `.mat-mdc-form-field-subscript-wrapper { min-height:0 }` (colapsa o espaço de erro reservado). Decisão = **preservar o look do legacy** (testado: login orion pixel-equivalente). ⚠️ esses miram **internos do Material** → **CSS global** (a Emulated encapsulation de `*.component.scss` não os alcança — comprovado: a mesma regra em `login.component.scss` não pegava, em `theme.scss` pegou).
- **templates (transformHtml):** `<button mat-button mat-icon-button>` (2+ diretivas) → mantém a mais específica (`icon-button > fab > mini-fab > stroked/raised/flat > button`), remove as outras (**NG8023** v19); `<mat-chip-list>` → `<mat-chip-grid>`+`<mat-chip-row>` se há `matChipInputFor`, senão `<mat-chip-set>` (+ remove `[selectable]`/`[removable]`); `<mat-slider [value] thumbLabel>` → `<mat-slider discrete><input matSliderThumb [value] [(ngModel)]>` (value/ngModel/formControl movem p/ o input; `thumbLabel`→`discrete`; `tickInterval`/`invert`/`vertical` caem). Chip/slider são **best-effort** (heurística por arquivo).
- **runtime (transformTs):** `._control.ngControl`→`._control?.ngControl` (no MDC o `_control` pode estar undefined no `ngOnInit` de directives → crash; optional chaining previne).

**Ainda fora (app-specific/incerto → `report.notes`):** shadow `mat-elevation-zN` ignorada pelo card MDC, button stretch (botão MDC é inline-flex, não estica com align-stretch). O **eixo** do `fxFlex` não é coisa de Material (é da correção flex-layout). Os casos complexos de chip/slider (swipers aninhados, bindings exóticos) ficam p/ revisão.

### fixJsonNamedImports — named import de *.json vira default import (Angular 12+)

Angular 12+ trata `.json` como módulo de **default export** e barra `import { version } from '../package.json'` com *"Should not import the named export 'version' … from default-exporting module"* → quebra o build já no 1º update. `fixJsonNamedImports()` (em `transforms.mjs`, chamado **uma vez no início**, após `cleanupLegacyFiles`) troca por **default import + destructuring**: `import _packageJson from '…'; const { version } = _packageJson;`. Mantém os bindings (incl. `as` aliases) idênticos — **não reescreve usos** (mais seguro que renomear identificadores). Vale para qualquer `import { … } from '….json'`.

### fixSassImports conservador — não quebrar mixins de theming

A migração `@import` → `@use` é correta, mas o **`@use` não repassa membros transitivos** como o `@import` fazia: se A faz `@use 'tema' as *` e o tema faz `@use 'lib'`, os mixins/funções de `lib` **não** ficam disponíveis em A (faltaria `@forward`). Em sistemas de theming (Nebular, Bootstrap, Material) isso quebra o build com `Undefined mixin` (ex: `@include nb-install-component()`).

Regra conservadora em `fixSassImports()`: se o arquivo `.scss` chama um **mixin sem namespace** (`@include nome(...)` sem `.`) **ou uma função de theming** (atribuição `$var: hyphen-fn(...)` — ex: `$nb-themes: nb-register-theme(...)`), ele provavelmente depende de membros vindos via `@import` → **mantém `@import`** (removendo só o `~`, que o esbuild builder não suporta) em vez de converter para `@use`. (O `@include` cobre componentes; a função cobre o **entrypoint do tema**, ex: `themes.scss`, que não tem `@include` mas registra o tema via função — era onde a regra antiga falhava e quebrava o `nb-install-component` a jusante.) O dart-sass ainda aceita `@import` (com deprecation warning até o Sass 3.0). Registra `report.notes` com a contagem e orienta usar `@forward` se quiser migrar. Material é tratado à parte (convertido **com namespace** `mat` + reescrita das chamadas), então não cai nessa regra. Reescrever a cadeia de `@forward` de uma lib específica fica fora do escopo (seria fix específico de biblioteca).

### npm install no loop não pode falhar silenciosamente

`npmInstall()` retorna `{ status, output, nodeModulesOk }`. A última tentativa usa `runCapture` (guarda o output do erro real) e há um **sanity check**: confirma que `node_modules/@angular/core` existe — porque em bind-mounts Docker o `npm install` pode retornar 0 mas deixar `node_modules` vazio, ou a tentativa final (`rm -rf node_modules` + reinstall) pode falhar deixando a pasta deletada.

No loop de `ng update`, o resultado do `npmInstall()` é **checado**: se falhar ou `node_modules` ficar inválido, registra uma nota `[CRÍTICO]` com a cauda do erro (filtrada de ruído npm), grava o relatório e **aborta** (`process.exit(1)`). Sem isso, uma instalação que destrói o `node_modules` passava batido — os steps seguintes rodavam com "Found 0 dependencies", `pinCompatibleThirdParty` congelava as libs (ex: nebular preso na versão de um major antigo) e o resultado quebrado saía disfarçado de "done". Falha de instalação é sempre fatal e diagnosticável, nunca silenciosa.

### maxBuffer alto em capture/runCapture — build truncado desabilitava correções em silêncio

`capture`/`runCapture` (utils.mjs) usavam `spawnSync` **sem `maxBuffer`** → default **1MB**. Um build com muitos warnings (milhares de `NG8113` de import não-usado, por over-import) passa de 1MB → o stdout vinha **TRUNCADO**, e os códigos de erro reais (ex: `TS2349` do moment) ficavam **fora** da janela. Consequência grave e silenciosa: `runCorrections` extraía os códigos de um output truncado → `codes` sem os erros reais → **nenhuma correção error-driven disparava** (no orion: 116 `TS2349` do moment sobreviviam porque o `moment-default-import` nunca via o código). Fix: **`maxBuffer: 256 * 1024 * 1024`** nos dois. Comprovado: output do build = 2.96MB, NG8113 começando na linha 5, TS2349 só na linha 33k (~1.4MB) → truncado no 1MB. Isso destrava TODAS as correções error-driven e o `pruneOverImports` (que precisa ver os milhares de NG8113).

### buildCheck conta ERROS e WARNINGS separados (2 badges)

O `buildCheck` (build-check.mjs) contava **qualquer linha** com código `TS/NG` como "erro" — incluindo `▲ [WARNING] NG8113` (import não-usado, **não** bloqueia o build). Com o maxBuffer revelando todos os warnings, o "total de erros" inflava (no orion: "13 mil erros" eram ~9,5k NG8113). Agora erros (`✘ [ERROR]`) e warnings (`▲ [WARNING]`) vão pra **mapas separados** (`current`/`warnings`), `report.buildChecks[step]` guarda `{ total, warnings }`, e a UI mostra **dois badges** (`BuildBadge`: erros + `⚠ N warnings`). Warnings não entram em `errorsByFile`. Deixa claro que os milhares de diagnósticos do over-import são warnings transitórios, não erros. (Os picos intermediários altos — ex: 13k durante a migração standalone, que quebra a app de propósito antes do cleanup convergir — agora aparecem honestos por causa do maxBuffer; antes o truncamento de 1MB os mostrava como "~1779".)

### pruneOverImports — ORÁCULO NG8113 remove over-imports (contraparte do autoFixBuildErrors)

`copyModuleImportsToComponents` é liberal (copia irmãos co-declarados pra todo componente) → milhares de imports não-usados → `NG8113` + ciclos `NG0919`. O schematic `cleanup-unused-imports` precisa de **programa compilável** (não roda com erros no build), então não removia nada enquanto sobrava erro. **`pruneOverImports()`** (standalone.mjs) usa o **`NG8113` como oráculo** (igual o `autoFixBuildErrors` usa o erro pra ADICIONAR import, este usa o warning pra REMOVER): builda, parseia cada `▲ [WARNING] NG8113: <Símbolo> is not used within the template of <Comp>` + o `arquivo:linha` exato, e remove o símbolo do `imports[]` (split por vírgula no nível 0, preservando `importProvidersFrom(...)`) + o import ES se ficou órfão. **Funciona com o build SUJO** (NG8113 é emitido junto com erros). Fixpoint (re-builda até zerar). Validado em **66 componentes reais** (4727 removidos, 0 falhas: array balanceado, flagados removidos, não-flagados preservados, 0 órfãos, nenhum import ainda-usado removido). Roda no step `cleanupImports` (após o autoFix, complementando o schematic) **e** uma vez no fim (após as correções, que adicionam diretivas → alguns imports ficam não-usados). No orion: **4740 → ~182** NG8113.

### #1 — autoFixBuildErrors resolve NG8002 (binding) via registry de diretiva

O `buildDynamicNgRegistry` agora parseia **`ɵɵDirectiveDeclaration`** (além de `ɵɵComponentDeclaration`/`ɵɵPipeDeclaration`) → extrai **seletores de atributo** e **inputs** de diretivas de terceiros. Resolve `NG8002` ("can't bind to 'X'") onde X é seletor de atributo (`[colorPicker]`) ou input (`[options]` do `currencyMask`): adiciona a diretiva ao `imports[]` do componente. Regras do registry (aprendidas com uma regressão que gerou 13k erros no v4):
- **Scan recursivo p/ single-entry**: a declaração costuma morar em sub-arquivo re-exportado do root (ex: `ngx-currency/lib/ngx-currency.directive.d.ts`; o `index.d.ts` é só `export * from './public-api'`). Pacotes single-entry (sem subpath de código em `exports`) têm TODOS os `.d.ts` concatenados; multi-entry (Material: `exports` com `./theming`) NÃO (o símbolo exige import de subpath → coberto pela cópia via grafo de NgModule).
- **Só registra NÃO-standalone se o módulo foi resolvido** (`moduleExports.get(cls)`). Senão (classe nua) seria injetada em `imports[]` → **NG2011** (no v4: `ShortenPipe` do `ngx-pipes` não-standalone → cascata de NG2011). Não-standalone sem módulo → pulado (o grafo de NgModule cobre).
- **Seletores/inputs de DIRETIVA vão pro mapa `dirAttributes`/`inputs`, usados SÓ pelo autoFix** (error-driven). NUNCA entram em `attributes` (consumido pelo `tmplDetectNeeded` ESPECULATIVO da migração standalone): muitas diretivas têm seletor genérico (`[text]`/`[slider]`/`[rg]` do ngx-color-picker) que casaria qualquer template e injetaria errado. Speculativo = conservador (só componentes, como antes).

### NG8002 ordering — autoFix roda DEPOIS das correções finais

As correções que convertem module→diretiva standalone (`ngx-currency`/`ngx-mask`/`ngx-color-picker`) **CRIAM** `NG8002` por-componente (a diretiva precisa entrar no `imports[]` de cada componente que usa o binding). O `autoFixBuildErrors` (#1) já rodou no step `cleanupImports` **antes** dessas correções → não via esses erros. Por isso roda **de novo** após `runCorrections(opts.to)` em `migrate.mjs` (+ o `pruneOverImports` extra). No v6: `options`/`colorPicker`/`cpPosition` fecharam; sobraram só NgProgress/matBadge (itens conhecidos).

### Skew de patch entre pacotes de framework — pin EXATO no conflito, não --force

O framework versiona em lockstep com peer **EXATO** entre si (`platform-browser-dynamic@X` exige `platform-browser@X`). No v20, o `ng update` resolvia patches divergentes (`platform-browser-dynamic@20.0.7` vs `platform-browser@20.3.25`) → o peer exato quebrava → `--force` com a mensagem **enganosa** "sem versão compatível" (embora a lib OBVIAMENTE tenha o major 20). Fix em `extractConflictPackages`: pra `@angular/*` em conflito, pina na **versão EXATA** (`highestStableWithMajor` → maior patch estável do major) em vez de `@v` — todos batem no mesmo patch → resolve sem forçar (`@angular-devkit/*` segue `@v` pelo esquema 0.NNxx.y). **NÃO** se mexe no `syncVersions` pra isso: reescrever spec já no major alvo (`^14.3.0` → `^14.0.0`) é churn inútil (mesmo major, mesmo patch resolvido) e rebaixa o floor — `syncVersions` só alinha quem está **atrás** do alvo.

### Material — transforms de template IDEMPOTENTES (correção roda a cada major)

A correção `material` tem `gate: v => v >= 15` → roda no topo de CADA iteração do loop (15..22 = até 8x). Todo transform tem que ser **idempotente**. O `fixSlider` não era: a regex casava a tag de abertura `<mat-slider …>` (o `</mat-slider>` era opcional) e, num slider JÁ convertido, **prependia** outro `<input matSliderThumb></mat-slider>` por iteração → 5-6 inputs duplicados (HTML mangled). Fix: lookahead negativo `(?!\s*<input\s+matSliderThumb)` pula sliders já convertidos. (`fixChipList` já era idempotente: converte `<mat-chip-list>`→`<mat-chip-grid>`, o re-run não acha mais `chip-list`.)

### Baseline commit antes da modernização — isola os diffs dos steps

Antes de `runModernizationMigrations`, um `git commit` de baseline (`[ng-migrator-step:baseline]`) commita mudanças PENDENTES deixadas pelo loop de ng update (ex: `package.json`/`angular.json` ajustados por `syncVersions`/npm). Sem isso, o `git add -A` do PRIMEIRO step de modernização (ex: throwError) varre esses arquivos pro seu commit → o diff do step mostra arquivos que ele nem tocou (o "3 arquivos vs 46" no dashboard).

### Dashboard — formulário reflete os settings REAIS de uma migração externa

Quando a UI se pluga numa migração iniciada via CLI (`detectAndAttachExternalMigration`), o `currentMigrationData` recebe `status:'running'` + `cliConfig` (parseado dos args: `modernize`/`ngUpdateChecks`/`forcePeerDeps`). O `/api/status` preserva o `cliConfig` (o `MIGRATION-DATA.json` não o tem → o spread o perderia) e marca `running` se `migrationProcess || externalTailProcess`. O `ConfigCard` (frontend), enquanto `isRunning`, mostra os valores REAIS (origem/target/estratégia do `MIGRATION-DATA.json`; in-place = `destPath === sourcePath`; modernize/peer do `cliConfig`) em vez dos defaults/localStorage — senão o formulário enganava (mostrava origem/target/estratégia errados de uma migração externa). `handleLoadMigration` limpa o terminal e, se a migração carregada é a que está rodando ao vivo, segue ao vivo (`viewedData=null`) em vez de congelar num snapshot estático (que parava de atualizar e parecia "travado no antigo").
