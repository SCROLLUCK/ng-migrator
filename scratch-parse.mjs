import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, resolve, relative, isAbsolute } from 'path';

const destPath = '/home/lucas/REPOS/orion-web-ng21';
const buildCheckLog = join(destPath, 'BUILD-CHECKS.md');
const dataPath = join(destPath, '.ng-migrator', 'MIGRATION-DATA.json');

if (!existsSync(buildCheckLog)) {
  console.error(`Build check log not found at: ${buildCheckLog}`);
  process.exit(1);
}

if (!existsSync(dataPath)) {
  console.error(`Migration data json not found at: ${dataPath}`);
  process.exit(1);
}

const content = readFileSync(buildCheckLog, 'utf8');
const parts = content.split('## [');

const errorsByStep = {};

for (const part of parts) {
  const lineEnd = part.indexOf('\n');
  if (lineEnd === -1) continue;
  const header = part.slice(0, lineEnd);
  const stepMatch = header.match(/^([^\]]+)\]/);
  if (!stepMatch) continue;
  const stepKey = stepMatch[1];

  const errorsByFile = {};
  const lines = part.slice(lineEnd).split('\n');
  for (const line of lines) {
    // Tenta achar código de erro (TSxxxx ou NGxxxx) na mesma linha para mapear o tipo
    const m = line.match(/\b((?:TS|NG)\d{4,5})\b/);
    const code = m ? m[1] : 'UNKNOWN';

    // Match file pattern: optional Error: prefix, path with extension, colon, line, colon, column
    const fileMatch = line.match(/(?:Error:\s+)?([^\s:`]+?\.[a-zA-Z0-9]+):\d+:\d+/);
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
  errorsByStep[stepKey] = errorsByFile;
}

const migrationData = JSON.parse(readFileSync(dataPath, 'utf8'));
migrationData.buildChecks = migrationData.buildChecks || {};

for (const [stepKey, errors] of Object.entries(errorsByStep)) {
  if (migrationData.buildChecks[stepKey]) {
    migrationData.buildChecks[stepKey].errorsByFile = errors;
    console.log(`Updated ${stepKey} with ${Object.keys(errors).length} error files`);
  } else {
    migrationData.buildChecks[stepKey] = {
      total: Object.values(errors).reduce((a, b) => a + b.length, 0),
      new: [],
      fixed: [],
      errorsByFile: errors
    };
    console.log(`Created buildCheck for ${stepKey} with ${Object.keys(errors).length} error files`);
  }
}

writeFileSync(dataPath, JSON.stringify(migrationData, null, 2) + '\n');
console.log('Successfully updated MIGRATION-DATA.json with errorsByFile!');
