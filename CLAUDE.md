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

# Simular sem executar nada
node migrate.mjs --dry-run

# Estratégia de conflitos de peer dependency (default: resolve)
node migrate.mjs ./proj --peer-strategy force   # pula resolução, --force direto
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
| `migrator/flex-layout.mjs` | `migrateFlexLayoutToTailwind` |
| `migrator/report.mjs` | `writeReport`, `writeMigrationData` |
| `migrator/orchestrate.mjs` | `runModernizationMigrations` (com `commitStep` local) |

Sem build step, sem testes automatizados.

---

## Regras invioláveis

### Fixes sempre genéricos, nunca específicos de biblioteca
Todo fix deve resolver um padrão conhecido do Angular/TypeScript/RxJS, não um problema de uma lib específica. Se a solução só se aplica a `ngx-something`, não pertence ao migrador — pertence à documentação de migração daquela lib.

### Nunca modificar o projeto de origem
O migrador opera sempre sobre a cópia em `destPath`. O projeto original em `sourcePath` é somente-leitura.

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

### Resolução genérica de versões compatíveis de terceiros (em vez de --force)

O `ng update` falha com `Incompatible peer dependencies found` quando uma lib de terceiros não suporta o major Angular alvo. A reação antiga era chutar `pkg@<angularMajor>` (errado: o major da lib raramente coincide com o do Angular — `@nebular/theme@12` é da era ng16, `@swimlane/ngx-charts@12` é de 2018/ng6) e, ao falhar, cair em `--force` — empurrando versões incompatíveis silenciosamente.

A abordagem correta **resolve a versão certa no registry**:

- `resolveCompatibleVersion(pkg, angularMajor)` — busca o packument (`curl <registry>/<pkg>`), itera as versões estáveis em ordem decrescente e retorna a **maior** cujo `peerDependencies['@angular/core']` inclui o major alvo (via `angularVersionInRange()`). Resultado cacheado.
- `angularVersionInRange(major, peerRange)` — usa **`semver.intersects(peerRange, '>=M.0.0 <M+1.0.0')`**, não regex. O parsing manual anterior falhava em `>= 6.0.0` (espaço após operador), `>=5` (sem minor), `>=14 <16` (range composto) e unions — marcando pacotes compatíveis (ex: `@akveo/ng2-completer` `>=6`, `@asymmetrik/ngx-leaflet` `>=5`) como incompatíveis e gerando notes falsas + resolução desnecessária. `semver` já é dependência transitiva do ecossistema Angular.
- `pinCompatibleThirdParty(angularMajor)` — roda **antes de cada `ng update`**, em **dois passos**:
  - **Passo 1 (âncoras)** — libs que peer-dependem de `@angular/core`. Fixa cada uma na versão compatível resolvida e registra o major-alvo em `anchorMajors` (ex: `@nebular/theme → 17`).
  - **Passo 2 (companheiros)** — libs que **não** têm peer `@angular/core`, mas peer-dependem de uma âncora (ex: `@nebular/eva-icons` peer-depende de `@nebular/theme`, não do core). `resolveCompanionVersion()` acha a maior versão cujos peers para as âncoras casam o major fixado (eva-icons segue theme: 8→8, 9→9, 17→17). Sem isso, o companheiro travava na versão antiga e forçava `--force`.
- `extractConflictPackages()` (retry do update) também usa `resolveCompatibleVersion` em vez de `@<major>` para libs de terceiros; quando não há versão compatível, **não injeta** um `@<major>` inexistente (isso fazia o `ng update` abortar com "Package does not exist").
- **Reconciliação do node_modules após o pin**: o pin altera o `package.json`, mas o `node_modules` ainda tem a versão antiga; o `ng update` aborta com `invalid: pkg@<versão antiga>` (árvore inconsistente). Após `pinCompatibleThirdParty`, o pipeline roda `npm install <só os pacotes pinados>@<versão> --legacy-peer-deps` (instalação parcial, não full) para reconciliar a árvore antes do `ng update`.

Sem listas hardcoded — funciona para qualquer lib que declare `peerDependencies` (de `@angular/core` ou de outra âncora). Se nenhuma versão compatível existir no registry (ex: lib abandonada como `ng2-smart-table`, sem versão para ng11+), registra em `report.notes` para correção manual — o migrador não troca a lib por um fork (isso seria específico de biblioteca).

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

### ESLint — ng-cli-compat removido no @angular-eslint v17+

`plugin:@angular-eslint/ng-cli-compat` foi removido no v17. A função `fixEslintConfig()` em `transforms.mjs` substitui por `plugin:@angular-eslint/recommended` e remove `ng-cli-compat--formatting-add-on`.

Regras `@typescript-eslint/quotes` e `@typescript-eslint/dot-notation` foram removidas no `@typescript-eslint` v8 — movidas para o ESLint core (`quotes`, `dot-notation`).

### NG2012 — NgModules incompatíveis com Ivy

Quando `autoFixBuildErrors` encontra `NG2012` (NgModule não compilado com Ivy), o símbolo é substituído por `// TODO: [NG2012]` no array `imports` e a linha de `import` ES é comentada. Nunca remove silenciosamente — o desenvolvedor precisa saber o que precisar atualizar.

### TS2305 — import fantasma (símbolo só existe em comentário do .d.ts)

`autoFixBuildErrors` também trata `TS2305` ("Module 'X' has no exported member 'Y'"): remove o `import` inválido e a entrada correspondente no `imports[]`/`declarations[]` do decorator. Surge quando um símbolo é resolvido a partir de algo que **não é export real** — ex: `PageModule` aparece só em **comentário JSDoc de exemplo** no `.d.ts` do `@nebular/theme`, e foi indevidamente importado de lá. Além de limpar o lixo, isso **desbloqueia o build-loop**: erros de TypeScript interrompem o `ng build` antes da fase de template, então resolver os TS2305 deixa o oráculo alcançar e tratar os NG2012/NG8001 seguintes.

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
2. **`fixReadonlySignalInputAssignments()`** — o schematic converte `@Input()` para `input()`, mas se a propriedade é atribuída diretamente no código (`this.prop = value`), isso gera TS2540 (read-only). Detecta e reverte esses casos de volta para `@Input()`.
3. **`fixSignalPropertyAccess()`** — migração incompleta deixa `this.signalProp.method` em vez de `this.signalProp().method`. Produz TS2339.

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

---

## Pipeline

0. **Docker Preflight Check**: Executa `checkDocker()` para validar se o Docker está ativo. Se não, interrompe a execução com erro.
1. **Copia** o projeto para pasta irmã com sufixo `-ng{target}` (ou `--dest`)
2. Remove lockfiles antigos (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`)
3. **`preflight()`** — remove `ngcc` dos scripts, remove `codelyzer`/`protractor`/`karma-coverage-istanbul-reporter`/`core-js` e **todo o ecossistema `tslint*`** (`tslint`, `tslint-language-service`, … — morto desde 2019, peer TS < 3 conflita em todo step); bumpa `@types/jasmine`, `jasmine-core`, `@types/node`, `ts-node`; troca `node-sass` → `sass` (ver "node-sass")
4. **`cleanupLegacyFiles()`** — remove `tslint.json`, projeto e2e do `angular.json`, chama `fixKarmaConf()`
5. Se source >= v15: `fixLegacyMaterial()` imediatamente
6. **`git init`** + commit inicial — `ng update` exige repositório git
7. **`npm install`** das dependências da versão atual (executado via `wrapCommand` com a versão de Node adequada para a versão inicial do Angular)
8. Loop `startVersion → targetVersion` (cada iteração executa comandos de Node/npm isolados via container Docker para a respectiva versão do Angular, monitorada via `currentAngularVersion`):
   - Antes do v17: `fixLegacyMaterial()` (converte `MatLegacy*` → `Mat*`)
   - `resolveNodeTypesOverride(v)` — alinha override `@types/node` para evitar EOVERRIDE
   - `pinCompatibleThirdParty(v)` — (só na estratégia `resolve`) fixa versões compatíveis de libs de terceiros antes do update
   - `npx ng update @angular/core@v @angular/cli@v [material@v] --allow-dirty` + loop de resolução de peer deps (ver "Estratégia de conflitos de peer dependency")
   - `syncVersions(v)` — força `@angular/*` atrasados para `^v.0.0`, rxjs 6→7, zone.js
   - `npm install`
   - `git commit "chore: Angular vN"`
   - `writeReport(true)` — atualiza `MIGRATION-STATUS.html` e `MIGRATION-REPORT.md` em tempo real
9. **Modernização** (salvo com `--no-modernize`) — cada step faz commit individual e rastreia arquivos/linhas via `captureGitDiff`:
   0. `flexLayout` — `@angular/flex-layout` → Tailwind CSS (se presente)
   1. `inject-migration` schematic
   2. `signals` schematic (`--best-effort-mode`) + `fixVoidOutputEmit` + `fixReadonlySignalInputAssignments` + `fixSignalPropertyAccess`
   2b. `fixReservedKeywordVariables` — renomeia variáveis geradas com palavras reservadas
   2c. `fixUntypedForms()` — `UntypedFormBuilder/Group/Control/Array` → typed
   2d. `fixThrowError()` + `fixSubjectVoid()` + `fixTsCompat()` — RxJS 7 + TS compat
   2e. `fixMomentImport()` — `import * as moment` → default import
   3. `standalone-migration` (convert → prune → bootstrap) + `fixDoubleCommas` + `fixSubjectEmit`
   3b. `fixMissingStandalone()` + `fixStandaloneInModuleDeclarations()` + `fixDoubleCommas` + `fixStandaloneImports()`
   3c. `control-flow` schematic — pula se `*ngIf/*ngFor` não encontrado (ng update@19 já aplicou)
   3d. `ngclass-to-class` schematic
   3e. `ngstyle-to-style` schematic
   4. `createAppConfigAndRoutes()` — gera `app.config.ts` e `app.routes.ts`
   4b. `convertLazyModulesToRoutes()` + `convertRemainingRoutingModules()` — NgModule routes → `.routes.ts`
   5. `use-application-builder` migration (esbuild/Vite) + `fixTs2663SignalAccess`
   5b. `inlinePolyfills()` — move `zone.js` para `angular.json`, remove `polyfills.ts`
   6. `modernizeTsconfig()` — ES2022, `moduleResolution: "bundler"`, `useDefineForClassFields: false` + re-run `fixTs2663SignalAccess`
   6b. `addTsconfigPathAliases()` — aliases para diretórios existentes em `src/app/`
   6c. `addEslint()` — `ng add @angular/eslint`
   7. `fixSassImports()` — `@import` → `@use … as *` (conservador: mantém `@import` em arquivos que usam mixin sem namespace — ver "fixSassImports conservador")
   8. `removeUnusedModules()` — remove `.module.ts` não referenciados + segundo pass standalone se necessário
   9. `fixStyleUrls()` — `styleUrls: []` → `styleUrl` singular
   10. `self-closing-tag` schematic
   11. `cleanup-unused-imports` schematic + `autoFixBuildErrors` (NG8001/NG8004 genérico)
   12. `patchThirdPartyVersions()` — detecta e reporta libs com peer deps incompatíveis
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

### Ecossistema Angular detectado em runtime (sem lista hardcoded)

Os pacotes oficiais do escopo `@angular/*` (material, cdk, google-maps, youtube-player, localize, elements, service-worker, framework…) versionam em **lockstep** com o `@angular/core`. Se um ficar para trás, no step seguinte o `ng update` aborta com *"Updating multiple major versions of '@angular/X' at once is not supported. Please migrate each major version individually."* — falha **não relacionada a peer deps** (não resolvida por `--force`). Foi o que segurava `@angular/google-maps` em v11 num projeto real.

Em vez de uma lista hardcoded (que não escala e exige manutenção a cada release), o conjunto é **detectado em runtime**:

- `captureAngularEcosystem()` — chamado **uma vez no início** (após o npm install, com `node_modules` populado): varre `node_modules/@angular/*` e congela os pacotes cujo **major instalado == major do core**. É o sinal genérico de "versiona junto": pacotes de terceiros que só usam o escopo `@angular/` (ex: `@angular/fire`) ficam num major diferente e são naturalmente excluídos.
- O conjunto é **congelado no início, não redetectado por step** — senão um pacote que ficasse para trás deixaria de casar o major e seria excluído (reproduzindo o bug). Frozen no v11, `google-maps@11 == core@11` → entra → é forçado a `@v` em todo step.
- `extraPackages(v)` inclui cada um como `@pkg@v`, mas só se `publishesMajor(pkg, v)` (registry) — assim um pacote deprecado que parou de publicar (ex: `@angular/flex-layout@16` inexistente) sai do conjunto sozinho, sem hardcode.
- `syncVersions` também sincroniza esse conjunto (`ANGULAR_PKGS` ∪ ecossistema detectado) como rede de segurança.

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

### fixSassImports conservador — não quebrar mixins de theming

A migração `@import` → `@use` é correta, mas o **`@use` não repassa membros transitivos** como o `@import` fazia: se A faz `@use 'tema' as *` e o tema faz `@use 'lib'`, os mixins/funções de `lib` **não** ficam disponíveis em A (faltaria `@forward`). Em sistemas de theming (Nebular, Bootstrap, Material) isso quebra o build com `Undefined mixin` (ex: `@include nb-install-component()`).

Regra conservadora em `fixSassImports()`: se o arquivo `.scss` chama um **mixin sem namespace** (`@include nome(...)` sem `.`), ele provavelmente depende de membros vindos via `@import` → **mantém `@import`** (removendo só o `~`, que o esbuild builder não suporta) em vez de converter para `@use`. O dart-sass ainda aceita `@import` (com deprecation warning até o Sass 3.0). Registra `report.notes` com a contagem e orienta usar `@forward` se quiser migrar. Material é tratado à parte (convertido **com namespace** `mat` + reescrita das chamadas), então não cai nessa regra. Reescrever a cadeia de `@forward` de uma lib específica fica fora do escopo (seria fix específico de biblioteca).

### npm install no loop não pode falhar silenciosamente

`npmInstall()` retorna `{ status, output, nodeModulesOk }`. A última tentativa usa `runCapture` (guarda o output do erro real) e há um **sanity check**: confirma que `node_modules/@angular/core` existe — porque em bind-mounts Docker o `npm install` pode retornar 0 mas deixar `node_modules` vazio, ou a tentativa final (`rm -rf node_modules` + reinstall) pode falhar deixando a pasta deletada.

No loop de `ng update`, o resultado do `npmInstall()` é **checado**: se falhar ou `node_modules` ficar inválido, registra uma nota `[CRÍTICO]` com a cauda do erro (filtrada de ruído npm), grava o relatório e **aborta** (`process.exit(1)`). Sem isso, uma instalação que destrói o `node_modules` passava batido — os steps seguintes rodavam com "Found 0 dependencies", `pinCompatibleThirdParty` congelava as libs (ex: nebular preso na versão de um major antigo) e o resultado quebrado saía disfarçado de "done". Falha de instalação é sempre fatal e diagnosticável, nunca silenciosa.
