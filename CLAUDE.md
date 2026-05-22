# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
| `migrator/ng-update.mjs` | `syncVersions`, `verifyTsconfigPaths`, `fixLegacyMaterial`, `extraPackages`, `extractConflictPackages` |
| `migrator/standalone.mjs` | Mapas TMPL_ELEM/ATTR/PIPE, `tmplDetectNeeded` (AST + fallback regex), `buildInternalProjectIndex`, todas as funções standalone |
| `migrator/modules.mjs` | `convertLazyModulesToRoutes`, `convertRemainingRoutingModules`, `removeUnusedModules` |
| `migrator/transforms.mjs` | `fixUntypedForms`, `fixSassImports`, `fixStyleUrls`, `modernizeTsconfig`, `addEslint`, etc. |
| `migrator/app-config.mjs` | `createAppConfigAndRoutes`, `extractImportProvidersFromModules` |
| `migrator/flex-layout.mjs` | `migrateFlexLayoutToTailwind` |
| `migrator/report.mjs` | `writeReport`, `writeMigrationData` |
| `migrator/orchestrate.mjs` | `runModernizationMigrations` (com `commitStep` local) |

Sem build step, sem testes automatizados.

### Estratégia: ng update incremental + AST

O migrador **orquestra o `ng update` oficial** do Angular CLI em cada major version. Para análise de templates e imports standalone, usa:
- **`@angular/compiler` `parseTemplate`** — AST real do template (evita falsos positivos do regex)
- **`ts-morph`** — índice de componentes standalone internos do projeto (`buildInternalProjectIndex`) para que `fixStandaloneImports` adicione imports relativos corretos

### Pipeline

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
   - `npx ng update @angular/core@v @angular/cli@v [material@v] --allow-dirty --force`
   - `syncVersions(v)` — força `@angular/*` atrasados para `^v.0.0`, rxjs 6→7, zone.js
   - `npm install`
   - `git commit "chore: Angular vN"`
   - `writeReport(true)` — atualiza `MIGRATION-STATUS.html` e `MIGRATION-REPORT.md` em tempo real
9. **Modernização** (salvo com `--no-modernize`) — cada step faz commit individual e rastreia arquivos/linhas via `captureGitDiff`:
   1. `inject-migration` schematic
   2. `signals` schematic (`--best-effort-mode`)
   3. `fixUntypedForms()` — `UntypedFormBuilder/Group/Control/Array` → typed
   4. `fixThrowError()` — `throwError(v)` → `throwError(() => v)` (RxJS 7)
   5. `standalone-migration` (convert → prune → bootstrap)
   6. `fixMissingStandalone()` — patch `standalone: true` em pipes/directives ignorados
   7. `control-flow` schematic (runUntilStable)
   8. `ngclass-to-class` schematic
   9. `ngstyle-to-style` schematic
   10. `createAppConfigAndRoutes()` — gera `app.config.ts` e `app.routes.ts`
   11. `convertLazyModulesToRoutes()` — `loadChildren` NgModule → `.routes.ts`
   12. `use-application-builder` migration (esbuild/Vite)
   13. `inlinePolyfills()` — move `zone.js` para `angular.json`, remove `polyfills.ts`
   14. `modernizeTsconfig()` — ES2022, `moduleResolution: "bundler"`, `useDefineForClassFields: false`
   15. `addTsconfigPathAliases()` — `@app`, `@core`, `@shared`, `@features`, `@environments`
   16. `addEslint()` — `ng add @angular/eslint`
   17. `fixSassImports()` — `@import` → `@use … as *`
   18. `removeUnusedModules()` — remove `.module.ts` não referenciados
   19. `fixStyleUrls()` — `styleUrls: []` → `styleUrl` singular
   20. `self-closing-tag` schematic
   21. `cleanup-unused-imports` schematic
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
