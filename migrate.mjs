#!/usr/bin/env node
/**
 * ng-migrator — Angular gradual migration via ng update
 *
 * Copia o projeto e executa ng update incrementalmente em cada major version,
 * aproveitando os schematics oficiais do Angular para cada passo.
 *
 * Uso:
 *   node migrate.mjs                        # migra ./  → ./-ng21
 *   node migrate.mjs ./meu-projeto          # migra pasta específica
 *   node migrate.mjs ./proj --to 17         # migra até v17
 *   node migrate.mjs ./proj --dry-run       # simula sem gravar
 *   node migrate.mjs ./proj --from 14       # começa a partir de v14 (projeto já em v14)
 *   node migrate.mjs ./proj --no-modernize   # pula inject()/signals/output() migration
 */

import { spawnSync } from 'child_process';
import { existsSync, unlinkSync, mkdirSync, rmSync } from 'fs';
import { join, dirname, basename } from 'path';
import Database from 'better-sqlite3';

import {
  sourcePath, destPath, opts, report, migratorDir, setDiffDb, setCurrentAngularVersion, setDestPath,
} from './migrator/context.mjs';
import {
  checkDocker, copyDir, run, capture, captureGitDiff, npmInstall, runCapture,
  setupTempNpmrc, restoreNpmrc
} from './migrator/utils.mjs';
import { getInstalledMajor } from './migrator/packages.mjs';
import { preflight, cleanupLegacyFiles } from './migrator/preflight.mjs';
import {
  fixLegacyMaterial, verifyTsconfigPaths, syncVersions,
  resolveNodeTypesOverride, extraPackages, extractConflictPackages,
} from './migrator/ng-update.mjs';
import { runModernizationMigrations } from './migrator/orchestrate.mjs';
import { writeReport, writeMigrationData } from './migrator/report.mjs';
import { buildCheck } from './migrator/build-check.mjs';

// ═══════════════════════════════════════════════════════════════════════════════
// PIPELINE PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(' ng-migrator  •  Angular gradual migration');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(` Origem:  ${sourcePath}`);
console.log(` Destino: ${destPath}`);
console.log(` Alvo:    Angular ${opts.to}`);
if (opts.dryRun) console.log(' Modo:    DRY RUN');
if (!opts.modernize) console.log(' Modernize: desativado (--no-modernize)');
console.log('');

if (opts.dryRun) {
  console.log('(dry-run: nenhuma operação executada)');
  process.exit(0);
}

// 1.5 Verifica se o Docker está em execução antes de começar
checkDocker();

// Se em split-versions e o destPath já tem um repositório git, continua de onde parou
// sem re-copiar o projeto nem reinicializar o git.
const continuingFromExisting = opts.splitVersions && existsSync(join(destPath, '.git'));

if (continuingFromExisting) {
  console.log(`📁 Continuando de pasta existente: ${destPath}`);
} else {
  // 1. Copia o projeto
  console.log('📁 Copiando projeto...');
  copyDir(sourcePath, destPath);
}

// Configura o .npmrc temporário no destino
setupTempNpmrc(destPath);

// Garante a restauração do .npmrc ao sair do processo ou em caso de crash
process.on('exit', () => restoreNpmrc());
process.on('SIGINT', () => { restoreNpmrc(); process.exit(1); });
process.on('SIGTERM', () => { restoreNpmrc(); process.exit(1); });
process.on('uncaughtException', (err) => {
  console.error('Erro não tratado durante a migração:', err);
  restoreNpmrc();
  process.exit(1);
});

// Pasta para arquivos gerados pelo migrador (relatórios, dados, patch)
mkdirSync(migratorDir, { recursive: true });
let diffDb = new Database(join(migratorDir, 'diffs.db'));
diffDb.exec('CREATE TABLE IF NOT EXISTS diffs (path TEXT, h0 TEXT, h1 TEXT, diff TEXT, PRIMARY KEY (path, h0, h1))');
setDiffDb(diffDb);

if (continuingFromExisting) {
  // Lê o commit HEAD existente como ponto de partida para captureGitDiff
  report.initialCommit = capture('git rev-parse HEAD');
} else {
  // Remove lockfiles antigos
  for (const f of ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml']) {
    const p = join(destPath, f);
    if (existsSync(p)) { unlinkSync(p); console.log(`  ↳ ${f} removido`); }
  }

  // 2. Pré-voo: limpa package.json e remove arquivos legados
  console.log('\n🧹 Limpeza inicial...');
  preflight();
  cleanupLegacyFiles();

  // Se o projeto já tem imports legacy (source >= v15), migra agora
  if ((opts.from ?? getInstalledMajor('@angular/core')) >= 15) {
    console.log('\n🔄 Migrando Material legacy → MDC (projeto fonte já em v15+)...');
    fixLegacyMaterial();
  }

  // 3. Git init — ng update exige repositório git
  console.log('\n🔧 Inicializando repositório git...');
  run('git init');
  run('git add -A');
  run('git commit -m "chore: snapshot antes da migração"');
  report.initialCommit = capture('git rev-parse HEAD');
}

// 4. Instala dependências da versão atual
const detectedVersion = opts.from ?? getInstalledMajor('@angular/core');
report.sourceVersion = detectedVersion || null;
writeMigrationData();
console.log(`\n📦 Versão detectada: Angular ${detectedVersion || '?'}`);

// Define o contexto de versão do Angular inicial para as execuções do Node
setCurrentAngularVersion(detectedVersion || 11);

if (!continuingFromExisting) {
  console.log('📦 Instalando dependências...');
  if (npmInstall().status !== 0) {
    console.error('\n❌ npm install falhou. Verifique o package.json e tente novamente.');
    process.exit(1);
  }

  buildCheck(`ngUpdate_${detectedVersion || 11}`);
}

// 5. ng update incremental
const startVersion = (detectedVersion || 11) + 1;
const steps = [];
let ngUpdatePrevHash = capture('git rev-parse HEAD');

for (let v = startVersion; v <= opts.to; v++) {
  if (opts.splitVersions) {
    // 1. Restore the temp .npmrc in the previous directory
    restoreNpmrc();

    // 2. Close the current SQLite diff database connection
    diffDb.close();

    // 3. Determine new version folder path — use dirname(destPath) so --versions-dir is respected
    const newDest = join(dirname(destPath), `ng${v}`);

    // 4. Copy the previous version folder to the new one
    // Remove pasta antiga primeiro para evitar estado stale de runs anteriores
    console.log(`\n📁 Gerando pasta para nova versão: ng${v - 1} → ng${v}`);
    if (existsSync(newDest)) rmSync(newDest, { recursive: true, force: true });
    copyDir(destPath, newDest);
    // copyDir skips .git e node_modules (SKIP_DIRS) — copiar explicitamente:
    // .git: preserva o histórico git para captureGitDiff funcionar entre versões
    // node_modules: hard-link (-l) para não re-instalar tudo do zero — quase instantâneo
    //   e garante que ng update encontre os pacotes instalados para rodar os schematics
    spawnSync('cp', ['-a', join(destPath, '.git'), newDest], { stdio: 'ignore' });
    spawnSync('cp', ['-al', join(destPath, 'node_modules'), newDest], { stdio: 'ignore' });

    // 5. Update destPath to the new folder
    setDestPath(newDest);

    // 6. Create the new migratorDir and reopen/reconnect the SQLite DB
    mkdirSync(migratorDir, { recursive: true });
    diffDb = new Database(join(migratorDir, 'diffs.db'));
    diffDb.exec('CREATE TABLE IF NOT EXISTS diffs (path TEXT, h0 TEXT, h1 TEXT, diff TEXT, PRIMARY KEY (path, h0, h1))');
    setDiffDb(diffDb);

    // 7. Setup the temporary .npmrc in the new folder
    setupTempNpmrc(destPath);
  }

  setCurrentAngularVersion(v);
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(` Angular ${v - 1} → ${v}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  const packages = [`@angular/core@${v}`, `@angular/cli@${v}`, ...extraPackages(v)].join(' ');

  // Before v17: Angular Material drops legacy-* — migrate them first
  if (v === 17) {
    console.log(`\n  🔄 Migrando Material legacy → MDC...`);
    fixLegacyMaterial();
  }

  verifyTsconfigPaths();
  resolveNodeTypesOverride(v);  // evita EOVERRIDE no npm install do ng update
  // Usa --package para ser explícito sobre o pacote E o binário a executar (ng).
  // Sem isso, npm 6 (Node 14) pode resolver "npx @angular/cli@12 update" para o
  // pacote npm "update" (colisão de cache em _npx/) em vez do Angular CLI.
  const ngCli = `npx --yes --package=@angular/cli@${v} ng`;
  // 1ª tentativa: sem --force
  let packageList = packages.split(' ');
  let result = runCapture(`${ngCli} update ${packages} --allow-dirty`);

  // 2ª tentativa: detectar pacotes conflitantes do output e incluí-los no comando
  if (result.status !== 0) {
    const conflictPkgs = extractConflictPackages(result.output, v, packageList);
    if (conflictPkgs.length > 0) {
      const allPkgs = [...packageList, ...conflictPkgs].join(' ');
      console.warn(`\n  ⚠ ng update v${v} peer conflict — retentando com: ${conflictPkgs.join(' ')}`);
      packageList = allPkgs.split(' ');
      result = runCapture(`${ngCli} update ${allPkgs} --allow-dirty`);
    }
  }

  // 3ª tentativa: fallback com --force
  if (result.status !== 0) {
    console.warn(`\n  ⚠ ng update v${v} ainda falhou — tentando com --force...`);
    result = run(`${ngCli} update ${packageList.join(' ')} --allow-dirty --force`, { ignoreError: true });
  }
  const ok = result.status === 0;

  if (!ok) console.warn(`\n  ⚠ ng update v${v} reportou erros — sincronizando versões manualmente.`);

  // Garante que nenhum pacote ficou para trás (ng update pode falhar silenciosamente)
  console.log(`\n  🔄 Sincronizando versões para v${v}...`);
  syncVersions(v);

  npmInstall();

  // 4ª tentativa: se ng update falhou completamente, roda schematics via --migrate-only.
  // Usa a CLI local (node_modules) — NÃO via npx --package=@angular/cli@v — para evitar
  // que o Angular CLI tente baixar a versão mais recente da CLI (que pode exigir Node mais novo).
  if (!ok) {
    console.log(`\n  🔄 Tentando schematics via --migrate-only...`);
    const migrateOnlyResult = run(
      `node node_modules/@angular/cli/bin/ng update @angular/core --migrate-only --from=${v - 1}.0.0 --to=${v}.0.0 --allow-dirty --force`,
      { ignoreError: true }
    );
    if (migrateOnlyResult.status === 0) {
      console.log(`  ↳ Schematics aplicados via --migrate-only`);
    }
  }

  run('git add -A');
  run(`git commit -m "chore: Angular ${v}" --allow-empty`);

  const h = capture('git rev-parse HEAD');
  report.details[`ngUpdate_${v}`] = captureGitDiff(ngUpdatePrevHash, h);
  ngUpdatePrevHash = h;

  steps.push({ version: v, ok });
  report.ngUpdateSteps.push({ version: v, ok });
  if (opts.ngUpdateChecks) buildCheck(`ngUpdate_${v}`);
  writeMigrationData();
}

// 6. Modernização: inject() + signals + output()
if (opts.modernize) {
  setCurrentAngularVersion(opts.to);
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' Modernização (inject / signals / output)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  runModernizationMigrations(); // cada step já grava commit individualmente
}

// ─── Relatório final ─────────────────────────────────────────────────────────

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(' Resultado');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
for (const { version, ok } of steps) {
  console.log(`  ${ok ? '✅' : '⚠ '} Angular ${version}`);
}

const warnings = steps.filter(s => !s.ok);
if (warnings.length) {
  console.log(`\n  ⚠ ${warnings.length} passo(s) com aviso (schematics podem não ter rodado completamente).`);
  console.log('    Verifique o output acima e o histórico git para detalhes.');
}

console.log(`\n  Projeto migrado: ${destPath}`);

writeReport();
writeMigrationData();
restoreNpmrc();

console.log('\n Próximos passos:');
console.log(` 1. cd ${destPath}`);
console.log(' 2. ng build      → verifica erros de compilação');
console.log(' 3. ng serve      → testa a aplicação');
console.log('');

// Abre o projeto no VS Code se disponível
const codeCheck = spawnSync('code --version', { shell: true, stdio: 'ignore' });
if (codeCheck.status === 0) {
  console.log('🖥  Abrindo projeto no VS Code...');
  spawnSync(`code "${destPath}"`, { shell: true, stdio: 'ignore' });
}
