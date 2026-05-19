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

## Arquitetura

Projeto single-file: toda a lógica está em `migrate.mjs`. Sem build step, sem testes automatizados. Sem dependências de produção.

### Estratégia: ng update incremental

O migrador **não faz transformações de AST diretamente**. Em vez disso, orquestra o `ng update` oficial do Angular CLI em cada major version, aproveitando os schematics testados pela equipe do Angular para cada passo.

### Pipeline

1. **Copia** o projeto para pasta irmã com sufixo `-ng{target}` (ou `--dest`)
2. Remove lockfiles antigos (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`)
3. **`preflight()`** — remove `ngcc` dos scripts, remove `codelyzer`/`tslint`/`protractor`/`karma-coverage-istanbul-reporter`; bumpa `@types/jasmine`, `jasmine-core`, `@types/node`, `ts-node`
4. **`cleanupLegacyFiles()`** — remove `tslint.json`, projeto e2e do `angular.json`, chama `fixKarmaConf()`
5. Se source >= v15: `fixLegacyMaterial()` imediatamente
6. **`git init`** + commit inicial — `ng update` exige repositório git
7. **`npm install`** das dependências da versão atual
8. Loop `startVersion → targetVersion`:
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
