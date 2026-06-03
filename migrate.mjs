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
  MODERNIZATION_STEPS, skipSteps,
} from './migrator/context.mjs';
import {
  checkDocker, copyDir, run, capture, captureGitDiff, npmInstall, runCapture,
  setupTempNpmrc, restoreNpmrc, readJson,
} from './migrator/utils.mjs';
import { getInstalledMajor } from './migrator/packages.mjs';
import { preflight, cleanupLegacyFiles } from './migrator/preflight.mjs';
import {
  fixLegacyMaterial, verifyTsconfigPaths, syncVersions,
  resolveNodeTypesOverride, extraPackages, extractConflictPackages,
  pinCompatibleThirdParty, listConflictPackageNames, captureAngularEcosystem,
  upgradeThirdPartyForIvy,
} from './migrator/ng-update.mjs';
import { runModernizationMigrations } from './migrator/orchestrate.mjs';
import { runCorrections, runProactiveCorrections } from './migrator/corrections/index.mjs';
import {
  fixMangledSassNamespaceDefs, fixJsonNamedImports, ensureSkipLibCheck,
  fixThrowError, fixSubjectVoid, fixSubjectNextArgless, fixRxjsInternalCompat,
} from './migrator/transforms.mjs';
import { writeReport, writeMigrationData, hydrateReportFromDisk, markRollbackInReport } from './migrator/report.mjs';
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

// Migrações criadas antes do marcador [ng-migrator-step:KEY] (trailer) não o têm; seus commits de
// modernização usam o assunto histórico abaixo. Esta tabela espelha esses assuntos para que
// --rollback-to/--resume-from também funcionem em destinos legados (pré-trailer). Migrações novas
// usam o trailer como lookup primário — isto é só rede de compatibilidade retroativa.
const LEGACY_STEP_SUBJECTS = {
  flexLayout: 'refactor: @angular/flex-layout → Tailwind',
  inject: 'refactor: inject()',
  signals: 'refactor: signals',
  reservedKeywords: 'refactor: reserved keyword variables',
  untypedForms: 'refactor: untyped forms',
  throwError: 'refactor: throwError factory + RxJS/TS fixes',
  fixMoment: 'refactor: moment: namespace import → default import',
  standalone: 'refactor: standalone migration',
  standaloneFixed: 'refactor: standalone: true patch + imports',
  controlFlow: 'refactor: control-flow',
  ngClassToClass: 'refactor: ngClass → class',
  ngStyleToStyle: 'refactor: ngStyle → style',
  appConfig: 'refactor: app.config.ts + app.routes.ts',
  lazyRoutes: 'refactor: lazy routes',
  builder: 'refactor: application builder',
  polyfills: 'refactor: polyfills inline',
  tsconfig: 'refactor: tsconfig ES2022/bundler',
  pathAliases: 'refactor: tsconfig path aliases',
  eslint: 'refactor: ESLint',
  sass: 'refactor: SCSS @use',
  modules: 'refactor: remove unused modules',
  styleUrl: 'refactor: styleUrls → styleUrl',
  selfClosing: 'refactor: self-closing tags',
  cleanupImports: 'refactor: cleanup unused imports',
  thirdPartyVersions: 'refactor: update third-party packages',
  lintFix: 'chore: eslint --fix',
};

// Resolve o commit de um step na ordem: 1) trailer [ng-migrator-step:KEY] (migrações novas);
// 2) ngNN → "chore: Angular N"; 3) fallback legado pelo assunto do commit (migrações pré-trailer).
function findStepCommit(step) {
  const ngMatch = step.match(/^ng(\d+)$/);
  let commit = capture(`git log -E --grep="\\[ng-migrator-step:${step}\\]" --format=%H -n 1`).trim().split('\n')[0];
  if (!commit && ngMatch) {
    commit = capture(`git log -E --grep="^chore: Angular ${ngMatch[1]}$" --format=%H -n 1`).trim().split('\n')[0];
  }
  if (!commit && LEGACY_STEP_SUBJECTS[step]) {
    // -F (fixed-strings): os assuntos têm caracteres especiais de regex (→, (), :)
    commit = capture(`git log -F --grep="${LEGACY_STEP_SUBJECTS[step]}" --format=%H -n 1`).trim().split('\n')[0];
  }
  return commit || null;
}

// --resume-from: retoma uma migração já existente a partir de um step (git reset --hard
// pro commit antes do step) — sem refazer copy/preflight/git-init nem os steps anteriores.
const resuming = !!opts.resumeFrom;
if ((resuming || opts.rollbackTo) && !existsSync(join(destPath, '.git'))) {
  console.error(`\n❌ --resume-from / --rollback-to requerem um destino já migrado (com git) em: ${destPath}`);
  process.exit(1);
}

// Se em split-versions e o destPath já tem um repositório git, continua de onde parou
// sem re-copiar o projeto nem reinicializar o git. (resume/rollback também pulam cópia/preflight.)
const continuingFromExisting = (opts.splitVersions && existsSync(join(destPath, '.git'))) || resuming || !!opts.rollbackTo;

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

// --rollback-to: volta o destino pro ESTADO de um step (commit do próprio step) e PARA —
// recupera um ponto que buildava limpo, sem re-rodar. Reseta + reinstala node_modules e sai.
// Roda antes de abrir o diffDb (pra o reset --hard não mexer no .ng-migrator/diffs.db aberto).
if (opts.rollbackTo) {
  const step = opts.rollbackTo;
  const commit = findStepCommit(step);
  if (!commit) {
    console.error(`\n❌ Step '${step}' não encontrado no histórico de ${destPath}.`);
    console.error(`   Válidos: ng12..ng${opts.to}, ${MODERNIZATION_STEPS.join(', ')}.`);
    process.exit(1);
  }
  console.log(`\n⏪ Rollback: git reset --hard ${commit.slice(0, 8)} (estado APÓS o step '${step}')`);
  run(`git reset --hard ${commit}`);
  // Reescreve o report pro estado pós-rollback: marca o ponto e zera os steps posteriores, pra o
  // dashboard refletir exatamente onde a árvore está (não mostra como feito o que foi descartado).
  mkdirSync(migratorDir, { recursive: true });
  hydrateReportFromDisk();
  markRollbackInReport(step);
  writeMigrationData();
  let v = 11;
  try {
    const p = readJson(join(destPath, 'package.json'));
    const cv = p.dependencies?.['@angular/core'] ?? p.devDependencies?.['@angular/core'] ?? '';
    const mm = String(cv).match(/(\d+)/); if (mm) v = parseInt(mm[1], 10);
  } catch {}
  setCurrentAngularVersion(v);
  console.log(`\n📦 Reinstalando node_modules para o estado restaurado (Angular ${v})...`);
  const r = npmInstall();
  if (r.status !== 0 || r.nodeModulesOk === false) {
    console.error('\n⚠ npm install reportou problemas — confira as dependências antes de buildar.');
  } else {
    console.log(`\n✅ Rollback concluído — projeto restaurado ao estado do step '${step}' e dependências reinstaladas.`);
  }
  restoreNpmrc();
  process.exit(0);
}

// Pasta para arquivos gerados pelo migrador (relatórios, dados, patch)
mkdirSync(migratorDir, { recursive: true });
let diffDb = new Database(join(migratorDir, 'diffs.db'));
diffDb.exec('CREATE TABLE IF NOT EXISTS diffs (path TEXT, h0 TEXT, h1 TEXT, diff TEXT, PRIMARY KEY (path, h0, h1))');
setDiffDb(diffDb);

if (continuingFromExisting) {
  // Preserva o histórico já registrado (ng-update steps, modernizações anteriores, buildChecks,
  // peer, diffs) — senão o report novo (vazio) sobrescreveria o MIGRATION-DATA.json e o dashboard
  // perderia tudo antes do ponto de retomada.
  if (hydrateReportFromDisk()) console.log('  ↳ Histórico anterior carregado (resume preserva os steps já feitos)');
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
  // Angular 12+ barra named import de *.json (`import { version } from '../package.json'`) →
  // converte para default import + destructuring (quebra já no 1º update). One-shot no início.
  fixJsonNamedImports();
  // skipLibCheck cedo: evita erros de .d.ts de terceiros/@types nos builds intermediários.
  ensureSkipLibCheck();

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

// --resume-from: reseta o destino pro estado ANTES do step alvo e define o ponto de entrada.
let resumeStartVersion = null;
if (resuming) {
  const step = opts.resumeFrom;
  const ngMatch = step.match(/^ng(\d+)$/);
  const commit = findStepCommit(step);
  if (!commit) {
    console.error(`\n❌ Step '${step}' não encontrado no histórico de ${destPath}.`);
    console.error(`   Válidos: ng12..ng${opts.to}, ${MODERNIZATION_STEPS.join(', ')}.`);
    process.exit(1);
  }
  console.log(`\n⏪ Resume: git reset --hard ${commit.slice(0, 8)}~1 (estado antes do step '${step}')`);
  run(`git reset --hard ${commit}~1`);
  delete report.rolledBackTo;   // avançando de novo: o marcador de rollback deixa de valer
  if (ngMatch) {
    resumeStartVersion = parseInt(ngMatch[1], 10);          // loop de ng update começa aqui
  } else {
    const idx = MODERNIZATION_STEPS.indexOf(step);
    if (idx === -1) { console.error(`\n❌ step de modernização desconhecido: '${step}'`); process.exit(1); }
    for (let i = 0; i < idx; i++) skipSteps.add(MODERNIZATION_STEPS[i]); // pula os steps anteriores
    resumeStartVersion = opts.to + 1;                       // pula o loop de ng update inteiro
  }
  report.initialCommit = capture('git rev-parse HEAD');
}

// 4. Instala dependências da versão atual
const detectedVersion = resuming
  ? (() => {                       // no resume, a versão vem do package.json já resetado
      try {
        const p = readJson(join(destPath, 'package.json'));
        const v = p.dependencies?.['@angular/core'] ?? p.devDependencies?.['@angular/core'] ?? '';
        const m = String(v).match(/(\d+)/);
        return m ? parseInt(m[1], 10) : 11;
      } catch { return 11; }
    })()
  : (opts.from ?? getInstalledMajor('@angular/core'));
report.sourceVersion = detectedVersion || null;
writeMigrationData();
console.log(`\n📦 Versão ${resuming ? 'do destino (resume)' : 'detectada'}: Angular ${detectedVersion || '?'}`);

// Define o contexto de versão do Angular inicial para as execuções do Node
setCurrentAngularVersion(detectedVersion || 11);

// Resume precisa reinstalar (o node_modules não é commitado e o reset mudou o package.json).
if (!continuingFromExisting || resuming) {
  console.log(resuming ? '📦 Reinstalando dependências (resume)...' : '📦 Instalando dependências...');
  if (npmInstall().status !== 0) {
    console.error('\n❌ npm install falhou. Verifique o package.json e tente novamente.');
    process.exit(1);
  }

  buildCheck(`ngUpdate_${detectedVersion || 11}`);
}

// Congela o conjunto de pacotes @angular/* em lockstep com o core (detecção em runtime,
// com node_modules já instalado) — usado por extraPackages/syncVersions em todos os steps.
captureAngularEcosystem();

// 5. ng update incremental (no resume, começa no step pedido — ou pula o loop se for modernização)
const startVersion = resuming ? resumeStartVersion : (detectedVersion || 11) + 1;
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

  // ── "Preflight" DESTE update: remove/converte só o que quebraria a subida para v ──────────
  // Princípio: não remover nada eager no início — cada item sai no ponto onde de fato quebra,
  // e só se a migração chega lá. Assim alvo baixo (ex: 11→12) não perde nada que ainda funciona.

  // Correções PROATIVAS deste major (gatilho `gate`) — rodam ANTES do update, para casos "ceiling"
  // sem versão no alvo. Ex: @angular/flex-layout (sem v16+) → Tailwind no gate v16. No-op se nenhuma
  // correção casa o major ou se a lib não está no projeto. Abaixo do v16, intocado.
  await runProactiveCorrections(v);

  // Angular Material remove os pacotes legacy-* no v17 → migra MatLegacy* → Mat* antes de subir.
  if (v === 17) {
    console.log(`\n  🔄 Migrando Material legacy → MDC...`);
    fixLegacyMaterial();
  }

  // v16+: o ngcc foi removido → libs de terceiros em major antigo (View Engine) viram NG6002.
  // Sobe as que versionam junto com o Angular para a versão Ivy; reporta as irresolvíveis.
  // Abaixo do v16, intocadas (funcionam via ngcc) — "subir só onde quebra".
  if (v >= 16) upgradeThirdPartyForIvy(v);

  verifyTsconfigPaths();
  resolveNodeTypesOverride(v);  // evita EOVERRIDE no npm install do ng update
  // Resolve versões compatíveis de libs de terceiros ANTES do ng update, para que
  // os peer deps já estejam satisfeitos e o update não precise de --force.
  // Log de resolução de peer deps deste step — rastreável na UI (como os diffs).
  const peerLog = { strategy: opts.peerStrategy, prePinned: [], attempts: [], forced: false, forcedConflicts: [], failedNonPeer: false, failureTail: '' };
  // Pré-resolução de versões compatíveis só faz sentido na estratégia 'resolve'.
  if (opts.peerStrategy === 'resolve') {
    peerLog.prePinned = pinCompatibleThirdParty(v);
    // Reconcilia o node_modules SÓ com os pacotes pinados (não full install): o pin altera
    // o package.json, mas o node_modules ainda tem a versão antiga — sem isso o ng update
    // aborta com "invalid: pkg@<versão antiga>" (árvore inconsistente). Instala só o necessário.
    if (peerLog.prePinned.length > 0) {
      const specs = peerLog.prePinned.map(p => `'${p.name}@${p.to}'`).join(' ');
      console.log(`\n  🔄 Reconciliando node_modules (pinados): ${peerLog.prePinned.map(p => p.name).join(', ')}`);
      run(`npm install ${specs} --legacy-peer-deps --no-audit --no-fund`, { ignoreError: true });
    }
  }
  // Usa --package para ser explícito sobre o pacote E o binário a executar (ng).
  // Sem isso, npm 6 (Node 14) pode resolver "npx @angular/cli@12 update" para o
  // pacote npm "update" (colisão de cache em _npx/) em vez do Angular CLI.
  const ngCli = `npx --yes --package=@angular/cli@${v} ng`;
  let packageList = packages.split(' ');
  // 1ª tentativa: sem --force (vale para ambas as estratégias)
  let result = runCapture(`${ngCli} update ${packages} --allow-dirty`);
  peerLog.attempts.push({ iteration: 0, kind: 'initial', added: [], ok: result.status === 0 });

  if (opts.peerStrategy === 'force') {
    // Estratégia 'force': ao primeiro erro, --force imediato — sem resolver versões.
    if (result.status !== 0) {
      console.warn(`\n  ⚠ ng update v${v} falhou — --force imediato (peer-strategy=force)...`);
      peerLog.forcedConflicts = listConflictPackageNames(result.output);
      result = run(`${ngCli} update ${packageList.join(' ')} --allow-dirty --force`, { ignoreError: true });
      peerLog.forced = true;
    }
  } else {
    // Estratégia 'resolve' (default): loop iterativo resolvendo versões compatíveis via
    // registry. Cada iteração pode revelar conflitos secundários que só surgem após
    // resolver os primeiros — por isso o loop, não um único retry.
    const MAX_RESOLVE_ITERATIONS = 6;
    for (let iter = 0; result.status !== 0 && iter < MAX_RESOLVE_ITERATIONS; iter++) {
      const conflictPkgs = extractConflictPackages(result.output, v, packageList);
      if (conflictPkgs.length === 0) break;  // nada novo a resolver → cai pro fallback
      packageList = [...packageList, ...conflictPkgs];
      console.warn(`\n  ⚠ ng update v${v} peer conflict (iter ${iter + 1}) — incluindo: ${conflictPkgs.join(' ')}`);
      result = runCapture(`${ngCli} update ${packageList.join(' ')} --allow-dirty`);
      peerLog.attempts.push({ iteration: iter + 1, kind: 'resolve', added: conflictPkgs, ok: result.status === 0 });
    }
    // Fallback final: --force SÓ se a falha for de peer dependency — é exatamente (e
    // somente) isso que o --force bypassa. Se a falha não é de peer, forçar não ajuda:
    // registra o motivo e segue; syncVersions + --migrate-only fazem o bump da versão.
    if (result.status !== 0) {
      const conflicts = listConflictPackageNames(result.output);
      if (conflicts.length > 0) {
        console.warn(`\n  ⚠ ng update v${v} — peer conflict irresolvível (${conflicts.join(', ')}) — fallback --force...`);
        peerLog.forcedConflicts = conflicts;
        result = run(`${ngCli} update ${packageList.join(' ')} --allow-dirty --force`, { ignoreError: true });
        peerLog.forced = true;
      } else {
        console.warn(`\n  ⚠ ng update v${v} falhou por motivo NÃO relacionado a peer deps — não vou forçar (--force não resolveria). syncVersions/--migrate-only assumem.`);
        peerLog.failedNonPeer = true;
        // Filtra o ruído de npm (warn/notice/deprecated/gyp) para que o erro real não
        // seja afogado — caso contrário a cauda mostra só "npm warn deprecated ...".
        const meaningful = (result.output || '')
          .split('\n')
          .filter(l => l.trim() && !/npm (warn|notice|WARN|http)|deprecated|gyp (info|http|verb)|idealTree|reify/i.test(l));
        peerLog.failureTail = meaningful.slice(-18).join('\n');
      }
    }
  }
  const ok = result.status === 0;

  if (!ok) console.warn(`\n  ⚠ ng update v${v} reportou erros — sincronizando versões manualmente.`);

  // Garante que nenhum pacote ficou para trás (ng update pode falhar silenciosamente)
  console.log(`\n  🔄 Sincronizando versões para v${v}...`);
  syncVersions(v);

  // Falha de npm install NÃO pode ser silenciosa: se o node_modules não instalar, todos
  // os steps seguintes rodam sem deps (ng update "Found 0 dependencies", pinCompatibleThirdParty
  // congela libs) e o resultado final fica quebrado disfarçado de "done". Aborta com diagnóstico.
  const installResult = npmInstall();
  if (installResult.status !== 0 || installResult.nodeModulesOk === false) {
    const tail = (installResult.output || '')
      .split('\n').filter(l => l.trim() && !/npm (warn|notice|WARN|http)|deprecated|gyp (info|http|verb)/i.test(l))
      .slice(-25).join('\n');
    report.notes.push(
      `[CRÍTICO] npm install falhou no Angular ${v} — node_modules não foi instalado. Migração abortada para não gerar resultado inválido.` +
      (tail ? `\nÚltimas linhas do erro:\n${tail}` : ''),
    );
    writeReport();
    writeMigrationData();
    console.error(`\n❌ npm install falhou no Angular ${v} e o node_modules ficou ausente/incompleto.`);
    console.error(`   Abortando — continuar produziria um projeto quebrado (deps não instaladas).`);
    if (tail) console.error(`\n--- erro do npm install ---\n${tail}\n`);
    process.exit(1);
  }

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

  // O schematic do Material (no ng update) pode manglear `@function`/`@mixin` custom que shadowam
  // nomes do Material em `@function mat.define-X(` (Sass inválido). Desfaz antes do build deste step.
  fixMangledSassNamespaceDefs();

  // RxJS 6→7 quebra `throwError(valor)`, `Subject.next()` (sem arg) e `rxjs/internal-compatibility`
  // JÁ quando o rxjs vira 7 (tipicamente no ng13) — não só no fim. São transforms de texto puro
  // tied à DEPENDÊNCIA (não schematics do Angular), então rodam com segurança neste boundary. Os
  // schematics de modernização (standalone/signals) seguem no fim (maturidade). One-shot via flag.
  if (!report.modernize._rxjsCompatBoundary && getInstalledMajor('rxjs') >= 7) {
    console.log(`\n  🔄 RxJS 7 compat (throwError factory + Subject.next + internal-compatibility)...`);
    const rxH0 = capture('git rev-parse HEAD');
    report.modernize.throwErrorFixed = fixThrowError();
    fixSubjectVoid();
    fixSubjectNextArgless();
    fixRxjsInternalCompat();
    report.modernize._rxjsCompatBoundary = true;
    // Commit separado + diff por arquivo (mostra na UI quais arquivos a modernização tocou).
    run('git add -A && git commit -m "refactor: RxJS 7 compat (throwError/Subject/internal-compatibility)" -m "[ng-migrator-step:throwError]"', { ignoreError: true });
    report.details['throwError'] = captureGitDiff(rxH0, capture('git rev-parse HEAD'));
  }

  run('git add -A');
  run(`git commit -m "chore: Angular ${v}" -m "[ng-migrator-step:ng${v}]" --allow-empty`);

  const h = capture('git rev-parse HEAD');
  report.details[`ngUpdate_${v}`] = captureGitDiff(ngUpdatePrevHash, h);
  ngUpdatePrevHash = h;

  steps.push({ version: v, ok });
  // Em resume a partir de um ngNN, o report hidratado pode já ter a entrada desta versão —
  // substitui em vez de duplicar.
  const existingIdx = report.ngUpdateSteps.findIndex((s) => s.version === v);
  if (existingIdx >= 0) report.ngUpdateSteps.splice(existingIdx, 1);
  report.ngUpdateSteps.push({ version: v, ok, peer: peerLog });
  report.ngUpdateSteps.sort((a, b) => a.version - b.version);
  if (opts.ngUpdateChecks) buildCheck(`ngUpdate_${v}`);

  // Steps de CORREÇÃO disparados pelo build-check: se este step tem erros, roda as correções
  // específicas (ngx-mask, etc.) cujo detect casa o erro. Conserta de verdade (runtime-safe),
  // diferente da neutralização. Re-builda e re-checa após aplicar.
  if (opts.ngUpdateChecks && (report.buildChecks?.[`ngUpdate_${v}`]?.total ?? 0) > 0) {
    const applied = await runCorrections(v);
    if (applied.length) {
      run(`git add -A && git commit -m "fix: correções específicas de lib (ng${v})" -m "[ng-migrator-step:corrections]" --allow-empty`, { ignoreError: true });
      buildCheck(`ngUpdate_${v}`); // re-mede após as correções
    }
  }
  writeMigrationData();
}

// 6. Modernização: inject() + signals + output()
if (opts.modernize) {
  setCurrentAngularVersion(opts.to);
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' Modernização (inject / signals / output)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  runModernizationMigrations(); // cada step já grava commit individualmente

  // Correções específicas de lib disparadas pelos erros do ESTADO FINAL — moment (TS2349 após o
  // esModuleInterop) e renames do @angular/material só aparecem depois das mudanças do próprio
  // migrador, não no loop de ng update. Conserta de verdade (runtime-safe). Re-checa após aplicar.
  const finalCorr = await runCorrections(opts.to);
  if (finalCorr.length) {
    run('git add -A && git commit -m "fix: correções específicas de lib (estado final)" -m "[ng-migrator-step:corrections]" --allow-empty', { ignoreError: true });
    buildCheck('corrections');
  }
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
