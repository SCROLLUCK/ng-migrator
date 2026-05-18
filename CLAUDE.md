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
3. **`git init`** + commit inicial — `ng update` exige repositório git
4. **`npm install`** das dependências da versão atual
5. Loop `startVersion → targetVersion`:
   - `npx ng update @angular/core@v @angular/cli@v [material@v] --allow-dirty --force`
   - `npm install` após cada passo (com fallback `--legacy-peer-deps`)
   - `git commit` do estado de cada versão
6. Relatório final com quais passos tiveram aviso

### Pacotes extras por versão

A função `extraPackages(version)` decide quais pacotes adicionais incluir no `ng update` de cada versão:
- `@angular/material` e `@angular/cdk` — acompanham a mesma versão se presentes
- `@nguniversal/express-engine` — apenas até v16 (a partir do v17 vira `@angular/ssr`)

### Por que --allow-dirty e --force?

- `--allow-dirty`: bypassa a verificação de uncommitted changes (necessário pois fizemos `git init` e o working tree nunca está limpo entre passos)
- `--force`: bypassa verificações de peer dependency compatibility entre versões intermediárias
