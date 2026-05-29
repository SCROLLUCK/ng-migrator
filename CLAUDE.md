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

### Detecção genérica de incompatibilidades de terceiros

`patchThirdPartyVersions()` não tem listas hardcoded de bibliotecas. Escaneia `node_modules/<pkg>/package.json` de todos os pacotes instalados, verifica `peerDependencies['@angular/core']` contra a versão alvo usando `angularVersionInRange()`, e reporta incompatibilidades no `report.notes`. O desenvolvedor é responsável por atualizar as versões — o migrador não tem como saber qual versão nova é compatível sem acesso à rede.

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
3. **`preflight()`** — remove `ngcc` dos scripts, remove `codelyzer`/`tslint`/`protractor`/`karma-coverage-istanbul-reporter`; bumpa `@types/jasmine`, `jasmine-core`, `@types/node`, `ts-node`
4. **`cleanupLegacyFiles()`** — remove `tslint.json`, projeto e2e do `angular.json`, chama `fixKarmaConf()`
5. Se source >= v15: `fixLegacyMaterial()` imediatamente
6. **`git init`** + commit inicial — `ng update` exige repositório git
7. **`npm install`** das dependências da versão atual (executado via `wrapCommand` com a versão de Node adequada para a versão inicial do Angular)
8. Loop `startVersion → targetVersion` (cada iteração executa comandos de Node/npm isolados via container Docker para a respectiva versão do Angular, monitorada via `currentAngularVersion`):
   - Antes do v17: `fixLegacyMaterial()` (converte `MatLegacy*` → `Mat*`)
   - `resolveNodeTypesOverride(v)` — alinha override `@types/node` para evitar EOVERRIDE
   - `npx ng update @angular/core@v @angular/cli@v [material@v] --allow-dirty --force`
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
   7. `fixSassImports()` — `@import` → `@use … as *`
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

### Pacotes extras por versão

A função `extraPackages(version)` decide quais pacotes adicionais incluir no `ng update` de cada versão:
- `@angular/material` e `@angular/cdk` — acompanham a mesma versão se presentes
- `@nguniversal/express-engine` — apenas até v16 (a partir do v17 vira `@angular/ssr`)

### Por que --allow-dirty e --force?

- `--allow-dirty`: bypassa a verificação de uncommitted changes (necessário pois fizemos `git init` e o working tree nunca está limpo entre passos)
- `--force`: bypassa verificações de peer dependency compatibility entre versões intermediárias
