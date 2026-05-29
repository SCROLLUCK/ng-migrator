import { writeFileSync, appendFileSync } from 'fs';
import { join, resolve, relative, isAbsolute } from 'path';
import { destPath, migratorDir, report } from './context.mjs';
import { capture } from './utils.mjs';
import { writeMigrationData } from './report.mjs';

let prevErrors = new Map(); // code → Set of message snippets
let initialized = false;

function initBuildCheckLog() {
  if (initialized) return;
  const buildCheckLog = join(migratorDir, 'BUILD-CHECKS.md');
  writeFileSync(buildCheckLog, `# Build checks por step da migração\n`);
  initialized = true;
}

export function buildCheck(stepKey) {
  initBuildCheckLog();
  const buildCheckLog = join(migratorDir, 'BUILD-CHECKS.md');
  console.log(`\n  🔍 [${stepKey}] build check...`);
  const raw = capture('npx ng build --no-progress 2>&1; true');

  // Extrai pares (código, trecho da mensagem) de cada linha de erro
  const current = new Map();
  const errorsByFile = {};
  for (const line of raw.split('\n')) {
    const cleanLine = line.replace(/\x1b\[[0-9;]*m/g, '');
    const m = cleanLine.match(/\b((?:TS|NG)\d{4,5})\b/);
    if (!m) continue;
    const code = m[1];
    // Pega até 120 chars do contexto depois do código para identificar o erro
    const msg = cleanLine.trim().slice(0, 120);
    if (!current.has(code)) current.set(code, new Set());
    current.get(code).add(msg);

    // Tenta extrair o caminho do arquivo com erro
    const fileMatch = cleanLine.match(/(?:Error:\s+)?([^\s:]+\.[a-zA-Z0-9]+):\d+:\d+/);
    if (fileMatch) {
      const filePath = fileMatch[1];
      let relPath;
      try {
        const absPath = isAbsolute(filePath) ? filePath : resolve(destPath, filePath);
        relPath = relative(destPath, absPath).replace(/\\/g, '/');
      } catch {
        relPath = filePath.replace(/\\/g, '/');
      }
      if (!errorsByFile[relPath]) {
        errorsByFile[relPath] = [];
      }
      errorsByFile[relPath].push(code);
    }
  }

  const newCodes   = [...current.keys()].filter(c => !prevErrors.has(c));
  const fixedCodes = [...prevErrors.keys()].filter(c => !current.has(c));
  const totalErrors = [...current.values()].reduce((n, s) => n + s.size, 0);

  // Saída no console
  if (newCodes.length)   console.log(`  ⚠️  NEW   : ${newCodes.join(' ')}`);
  if (fixedCodes.length) console.log(`  ✅  FIXED : ${fixedCodes.join(' ')}`);
  if (!newCodes.length && !fixedCodes.length) {
    console.log(totalErrors === 0 ? `  ✅  build OK` : `  ➡️  sem mudança (${totalErrors} erros)`);
  }

  // Escreve no BUILD-CHECKS.md
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  let section = `\n## [${stepKey}] ${ts}\n`;
  section += `**Total erros:** ${totalErrors}\n`;
  if (newCodes.length) {
    section += `\n### ⚠️ Introduzidos\n`;
    for (const c of newCodes) {
      section += `- **${c}**\n`;
      for (const msg of current.get(c)) section += `  - \`${msg}\`\n`;
    }
  }
  if (fixedCodes.length) {
    section += `\n### ✅ Resolvidos\n`;
    section += fixedCodes.map(c => `- ${c}`).join('\n') + '\n';
  }
  if (!newCodes.length && !fixedCodes.length) {
    section += totalErrors === 0 ? `\n✅ Build limpo.\n` : `\n➡️ Sem mudança.\n`;
  }

  appendFileSync(buildCheckLog, section);
  report.buildChecks = report.buildChecks || {};
  report.buildChecks[stepKey] = { total: totalErrors, new: newCodes, fixed: fixedCodes, errorsByFile };
  writeMigrationData();

  prevErrors = current;
}
