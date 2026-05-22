import { spawnSync } from 'child_process';
import {
  readFileSync, writeFileSync, existsSync,
  readdirSync, statSync, mkdirSync, copyFileSync, unlinkSync,
} from 'fs';
import { join, relative } from 'path';
import * as ctx from './context.mjs';

// Re-export destPath and sourcePath so callers can import from utils if they like
export { destPath, sourcePath, SKIP_DIRS } from './context.mjs';

export function parseAddedLines(diffText) {
  const lines = [];
  let cur = 0;
  for (const line of (diffText ?? '').split('\n')) {
    const m = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (m) { cur = parseInt(m[1]) - 1; continue; }
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) lines.push(cur + 1);
    if (!line.startsWith('-')) cur++;
  }
  return [...new Set(lines)];
}

export function formatRanges(lines) {
  if (!lines?.length) return '';
  const sorted = [...new Set(lines)].sort((a, b) => a - b);
  const ranges = [];
  let s = sorted[0], e = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === e + 1) { e = sorted[i]; }
    else { ranges.push(s === e ? `${s}` : `${s}–${e}`); s = e = sorted[i]; }
  }
  ranges.push(s === e ? `${s}` : `${s}–${e}`);
  return ranges.join(', ');
}

// captureGitDiff reads ctx.diffDb via the live ES module namespace binding.
// When migrate.mjs calls setDiffDb(db), ctx.diffDb is updated and the reference
// read here (ctx.diffDb) will reflect the new value immediately.
export function captureGitDiff(h0, h1) {
  if (!h0 || !h1 || h0 === h1) return [];
  const raw = capture(`git diff ${h0} ${h1} --name-status -- ':!package-lock.json'`);
  if (!raw) return [];
  const result = [];
  for (const line of raw.split('\n').filter(Boolean)) {
    const parts = line.split('\t');
    const status = parts[0][0];          // A/M/D/R
    const path = parts[parts.length - 1];
    if (status === 'D') { result.push({ path, action: 'deleted', lines: [], h0, h1 }); continue; }
    const diff = capture(`git diff ${h0} ${h1} -- "${path}"`);
    ctx.diffDb?.prepare('INSERT OR REPLACE INTO diffs (path, h0, h1, diff) VALUES (?, ?, ?, ?)').run(path, h0, h1, diff || '');
    result.push({ path, action: status === 'A' ? 'created' : 'modified', lines: parseAddedLines(diff), h0, h1 });
  }
  return result;
}

export function copyDir(src, dst) {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src)) {
    if (ctx.SKIP_DIRS.has(entry)) continue;
    const s = join(src, entry), d = join(dst, entry);
    statSync(s).isDirectory() ? copyDir(s, d) : copyFileSync(s, d);
  }
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function writeJson(path, obj) {
  writeFileSync(path, JSON.stringify(obj, null, 2) + '\n');
}

export function checkDocker() {
  const check = spawnSync('docker', ['ps'], { shell: true, stdio: 'ignore' });
  if (check.status !== 0) {
    console.error('\n❌ Erro: O Docker é um requisito obrigatório para rodar a migração em isolamento.');
    console.error('Certifique-se de que o Docker está instalado e o daemon está rodando (tente executar `docker ps`).');
    process.exit(1);
  }
}

let cachedManager = null;
let lastUsedConfigManager = null;
const ensuredVersions = new Set();

function detectVersionManager() {
  const configManager = ctx.config.nodeVersionManager;
  if (cachedManager !== null && lastUsedConfigManager === configManager) return cachedManager;
  lastUsedConfigManager = configManager;

  if (configManager === 'nvm') {
    const homeDir = process.env.HOME || '';
    const nvmPaths = [
      process.env.NVM_DIR ? join(process.env.NVM_DIR, 'nvm.sh') : null,
      join(homeDir, '.nvm/nvm.sh'),
      '/usr/local/opt/nvm/nvm.sh'
    ].filter(Boolean);

    for (const p of nvmPaths) {
      if (existsSync(p)) {
        cachedManager = { type: 'nvm', path: p };
        return cachedManager;
      }
    }
    cachedManager = { type: 'nvm', path: join(homeDir, '.nvm/nvm.sh') };
    return cachedManager;
  }

  if (configManager && configManager !== 'auto') {
    cachedManager = configManager;
    return cachedManager;
  }

  // 1. Docker
  try {
    const res = spawnSync('docker', ['ps'], { shell: true });
    if (res.status === 0) {
      cachedManager = 'docker';
      return cachedManager;
    }
  } catch (e) {}

  if (configManager === 'auto' || !configManager) {
    console.error('\n❌ Erro: O Docker não foi detectado em execução (falha no comando `docker ps`).');
    console.error('Esta ferramenta exige o Docker para executar os passos de atualização do Angular de forma isolada.');
    console.error('Certifique-se de que o Docker está instalado e o daemon está rodando, ou configure um gerenciador local em ng-migrator.config.json se desejar assumir o risco.');
    process.exit(1);
  }

  if (configManager === 'fnm') return 'fnm';
  if (configManager === 'n') return 'n';
  if (configManager === 'asdf') return 'asdf';

  cachedManager = 'none';
  return cachedManager;
}

export function getTargetNodeVersion(angularVersion) {
  if (!angularVersion) return null;
  const major = String(angularVersion).split('.')[0];
  return ctx.config.nodeVersions[major] || null;
}

export function ensureNodeVersion(version) {
  if (!version || ensuredVersions.has(version)) return;

  const mgr = detectVersionManager();
  const mgrType = typeof mgr === 'object' ? mgr.type : mgr;
  const nvmPath = typeof mgr === 'object' ? mgr.path : '';

  if (mgrType === 'docker' || mgrType === 'none') {
    ensuredVersions.add(version);
    return;
  }

  console.log(`\n  ⚙  Garantindo que Node.js v${version} está instalado via ${mgrType}...`);

  let installCmd = null;
  if (mgrType === 'fnm') {
    installCmd = `fnm install ${version}`;
  } else if (mgrType === 'nvm') {
    installCmd = `bash -c "source ${nvmPath} && nvm install ${version}"`;
  } else if (mgrType === 'n') {
    installCmd = `n ${version}`;
  } else if (mgrType === 'asdf') {
    installCmd = `asdf install nodejs ${version}`;
  }

  if (installCmd) {
    const res = spawnSync(installCmd, { shell: true, stdio: 'inherit' });
    if (res.status !== 0) {
      console.warn(`  ⚠  Falha ao tentar instalar/verificar Node.js v${version} com o comando: ${installCmd}`);
    }
  }

  ensuredVersions.add(version);
}

export function wrapCommand(cmd, angularVersion, cwd = ctx.destPath) {
  const version = getTargetNodeVersion(angularVersion);
  if (!version) return cmd;

  const trimmed = cmd.trim();
  const isNodeCmd =
    trimmed.startsWith('npm ') ||
    trimmed.startsWith('npx ') ||
    trimmed.startsWith('node ') ||
    trimmed.startsWith('ng ') ||
    trimmed.startsWith('npm\t') ||
    trimmed.startsWith('npx\t') ||
    trimmed.startsWith('node\t') ||
    trimmed.startsWith('ng\t');

  if (!isNodeCmd) return cmd;

  const mgr = detectVersionManager();
  if (mgr === 'none') return cmd;

  ensureNodeVersion(version);

  const nodeMajor = parseInt(version, 10);
  const ngMajor = parseInt(angularVersion, 10);
  const shouldUseLegacyOpenSsl = nodeMajor >= 17 && ngMajor <= 16;

  if (ctx.config.customManagerCommand) {
    let customCmd = ctx.config.customManagerCommand
      .replace(/\{\{version\}\}/g, version)
      .replace(/\{\{command\}\}/g, cmd);
    if (shouldUseLegacyOpenSsl) {
      customCmd = `NODE_OPTIONS=--openssl-legacy-provider ${customCmd}`;
    }
    return customCmd;
  }

  const mgrType = typeof mgr === 'object' ? mgr.type : mgr;
  const nvmPath = typeof mgr === 'object' ? mgr.path : '';

  if (mgrType === 'docker') {
    const uid = typeof process.getuid === 'function' ? process.getuid() : '';
    const gid = typeof process.getgid === 'function' ? process.getgid() : '';
    const userOpt = uid && gid ? `--user ${uid}:${gid}` : '';

    let mountVol = ctx.destPath;
    let containerCwd = '/workspace';

    if (cwd && cwd.startsWith(ctx.destPath)) {
      const rel = relative(ctx.destPath, cwd);
      containerCwd = rel ? join('/workspace', rel).replace(/\\/g, '/') : '/workspace';
    } else if (cwd) {
      mountVol = cwd;
    }

    const home = process.env.HOME || '';
    const hostNpmCache = join(home, '.npm');
    const cacheMount = existsSync(hostNpmCache) ? `-v "${hostNpmCache}:/tmp/.npm"` : '';

    const opensslOpt = shouldUseLegacyOpenSsl ? '-e NODE_OPTIONS=--openssl-legacy-provider' : '';

    return `docker run --rm ${userOpt} --name ng-migrator-runner -v "${mountVol}:/workspace" ${cacheMount} -w "${containerCwd}" -e HOME=/tmp -e CI=1 -e FORCE_COLOR=1 ${opensslOpt} node:${version} ${cmd}`;
  }

  const envPrefix = shouldUseLegacyOpenSsl ? 'NODE_OPTIONS=--openssl-legacy-provider ' : '';

  if (mgrType === 'fnm') {
    return `${envPrefix}fnm exec --using=${version} ${cmd}`;
  } else if (mgrType === 'nvm') {
    const escapedCmd = cmd.replace(/"/g, '\\"');
    return `bash -c "source ${nvmPath} && ${envPrefix}nvm exec --silent ${version} ${escapedCmd}"`;
  } else if (mgrType === 'n') {
    return `${envPrefix}n use ${version} ${cmd}`;
  } else if (mgrType === 'asdf') {
    return `${envPrefix}ASDF_NODEJS_VERSION=${version} ${cmd}`;
  }

  return cmd;
}

export function run(cmd, { cwd = ctx.destPath, ignoreError = false } = {}) {
  const nodeVer = getTargetNodeVersion(ctx.currentAngularVersion);
  const wrapped = wrapCommand(cmd, ctx.currentAngularVersion, cwd);
  const mgr = detectVersionManager();
  const mgrType = typeof mgr === 'object' ? mgr.type : mgr;
  
  console.log(`  $ ${cmd}${nodeVer && wrapped !== cmd ? ` (Node v${nodeVer} via ${mgrType})` : ''}`);
  
  const env = { ...process.env, FORCE_COLOR: '1', CI: '1' };
  const nodeMajor = nodeVer ? parseInt(nodeVer, 10) : 0;
  const ngMajor = ctx.currentAngularVersion ? parseInt(ctx.currentAngularVersion, 10) : 0;
  if (nodeMajor >= 17 && ngMajor <= 16) {
    env.NODE_OPTIONS = '--openssl-legacy-provider';
  }

  const result = spawnSync(wrapped, {
    shell: true,
    cwd,
    stdio: 'inherit',
    env,
  });
  if (!ignoreError && result.status !== 0) {
    console.error(`\n  ✘ Comando falhou (exit ${result.status}): ${cmd}`);
  }
  return result;
}

export function capture(cmd, cwd = ctx.destPath) {
  const wrapped = wrapCommand(cmd, ctx.currentAngularVersion, cwd);
  const nodeVer = getTargetNodeVersion(ctx.currentAngularVersion);
  const env = { ...process.env, CI: '1' };
  const nodeMajor = nodeVer ? parseInt(nodeVer, 10) : 0;
  const ngMajor = ctx.currentAngularVersion ? parseInt(ctx.currentAngularVersion, 10) : 0;
  if (nodeMajor >= 17 && ngMajor <= 16) {
    env.NODE_OPTIONS = '--openssl-legacy-provider';
  }
  const result = spawnSync(wrapped, {
    shell: true, cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
  });
  return result.stdout?.toString().trim() ?? '';
}

export function runCapture(cmd, { cwd = ctx.destPath } = {}) {
  const nodeVer = getTargetNodeVersion(ctx.currentAngularVersion);
  const wrapped = wrapCommand(cmd, ctx.currentAngularVersion, cwd);
  const mgr = detectVersionManager();
  const mgrType = typeof mgr === 'object' ? mgr.type : mgr;
  
  console.log(`  $ ${cmd}${nodeVer && wrapped !== cmd ? ` (Node v${nodeVer} via ${mgrType})` : ''}`);
  
  const env = { ...process.env, FORCE_COLOR: '1', CI: '1' };
  const nodeMajor = nodeVer ? parseInt(nodeVer, 10) : 0;
  const ngMajor = ctx.currentAngularVersion ? parseInt(ctx.currentAngularVersion, 10) : 0;
  if (nodeMajor >= 17 && ngMajor <= 16) {
    env.NODE_OPTIONS = '--openssl-legacy-provider';
  }

  const result = spawnSync(wrapped, {
    shell: true, cwd,
    encoding: 'utf8',
    env,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  result.output = (result.stdout || '') + (result.stderr || '');
  return result;
}

export function npmInstall() {
  let r = run('npm install --no-audit --no-fund', { ignoreError: true });
  if (r.status !== 0) {
    console.log('  ↳ Tentando npm install --legacy-peer-deps --no-audit --no-fund...');
    r = run('npm install --legacy-peer-deps --no-audit --no-fund', { ignoreError: true });
  }
  if (r.status !== 0) {
    console.log('  ↳ Tentando npm install --legacy-peer-deps --force --no-audit --no-fund...');
    r = run('npm install --legacy-peer-deps --force --no-audit --no-fund', { ignoreError: true });
  }
  return r;
}

export function runUntilStable(cmd, label, maxPasses = 5) {
  for (let i = 0; i < maxPasses; i++) {
    console.log(`\n  🔄 ${label}${i > 0 ? ` (pass ${i + 1})` : ''}...`);
    const nodeVer = getTargetNodeVersion(ctx.currentAngularVersion);
    const wrapped = wrapCommand(cmd, ctx.currentAngularVersion, ctx.destPath);
    const mgr = detectVersionManager();
    const mgrType = typeof mgr === 'object' ? mgr.type : mgr;
    
    const env = { ...process.env, FORCE_COLOR: '1', CI: '1' };
    const nodeMajor = nodeVer ? parseInt(nodeVer, 10) : 0;
    const ngMajor = ctx.currentAngularVersion ? parseInt(ctx.currentAngularVersion, 10) : 0;
    if (nodeMajor >= 17 && ngMajor <= 16) {
      env.NODE_OPTIONS = '--openssl-legacy-provider';
    }

    const result = spawnSync(wrapped, {
      shell: true, cwd: ctx.destPath, stdio: ['inherit', 'pipe', 'inherit'],
      env,
    });
    const out = result.stdout?.toString() ?? '';
    process.stdout.write(out);
    if (out.includes('Nothing to be done')) break;
  }
}

export function extractBracketBlock(content, prefix) {
  const idx = content.indexOf(prefix);
  if (idx === -1) return null;
  let pos = idx + prefix.length;
  while (pos < content.length && content[pos] !== '[') pos++;
  if (pos >= content.length) return null;
  let depth = 0;
  for (let i = pos; i < content.length; i++) {
    if (content[i] === '[') depth++;
    else if (content[i] === ']') { if (--depth === 0) return content.slice(pos, i + 1); }
  }
  return null;
}

export function scanForContent(needle, extensions = ['.ts', '.html']) {
  const extSet = new Set(extensions);
  let found = false;
  function walk(dir) {
    if (found) return;
    for (const entry of readdirSync(dir)) {
      if (ctx.SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!extSet.has(full.slice(full.lastIndexOf('.')))) continue;
      if (readFileSync(full, 'utf8').includes(needle)) { found = true; }
    }
  }
  const srcDir = join(ctx.destPath, 'src');
  if (existsSync(srcDir)) walk(srcDir);
  return found;
}

let originalNpmrcContent = null;
let npmrcPath = null;
let hasNpmrcBackup = false;

export function setupTempNpmrc(dir) {
  npmrcPath = join(dir, '.npmrc');
  if (existsSync(npmrcPath)) {
    originalNpmrcContent = readFileSync(npmrcPath, 'utf8');
    hasNpmrcBackup = true;
  }
  const linesToAdd = [
    'legacy-peer-deps=true',
    'audit=false',
    'fund=false',
    'progress=false'
  ];
  let newContent = hasNpmrcBackup ? originalNpmrcContent : '';
  if (newContent && !newContent.endsWith('\n')) {
    newContent += '\n';
  }
  for (const line of linesToAdd) {
    const key = line.split('=')[0];
    if (newContent.includes(key + '=')) {
      newContent = newContent.replace(new RegExp(`^${key}\\s*=.*$`, 'gm'), line);
    } else {
      newContent += line + '\n';
    }
  }
  writeFileSync(npmrcPath, newContent, 'utf8');
  console.log('  ↳ Configurações de segurança adicionadas ao .npmrc temporário');
}

export function restoreNpmrc() {
  if (!npmrcPath || !existsSync(npmrcPath)) return;
  if (hasNpmrcBackup && originalNpmrcContent !== null) {
    try {
      writeFileSync(npmrcPath, originalNpmrcContent, 'utf8');
      console.log('  ↳ .npmrc original restaurado');
    } catch (e) {
      console.error('  ⚠️  Falha ao restaurar .npmrc original:', e.message);
    }
  } else {
    try {
      unlinkSync(npmrcPath);
      console.log('  ↳ .npmrc temporário removido');
    } catch (e) {
      // ignore
    }
  }
  originalNpmrcContent = null;
  npmrcPath = null;
  hasNpmrcBackup = false;
}

