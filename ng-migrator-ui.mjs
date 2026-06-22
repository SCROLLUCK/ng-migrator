#!/usr/bin/env node
/**
 * ng-migrator-ui — HTTP server for the ng-migrator dashboard
 *
 * Serves dashboard/dist/ static files and provides API endpoints:
 *   GET  /api/status    — current migration data JSON
 *   GET  /api/terminal  — SSE stream of terminal output
 *   POST /api/migrate   — start migration
 *   POST /api/stop      — kill migration process
 */

import { createServer } from 'http';
import { readFileSync, writeFileSync, unlinkSync, readdirSync, existsSync, statSync, rmSync } from 'fs';
import { join, dirname, basename } from 'path';
import Database from 'better-sqlite3';
import { fileURLToPath, pathToFileURL } from 'url';
import { spawn, spawnSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.NG_MIGRATOR_UI_PORT) || 4242;
const DIST_DIR = join(__dirname, 'dist');
const CORRECTIONS_DIR = join(__dirname, 'migrator', 'corrections');

// ─── State ────────────────────────────────────────────────────────────────────

let migrationProcess = null;
let terminalLines = [];
const sseClients = new Set();

// ─── Attach to external migration (started via nohup/CLI) ────────────────────

let externalTailProcess = null;

function detectAndAttachExternalMigration() {
  // Skip if we already own the process or are already tailing
  if (migrationProcess || externalTailProcess) return;

  // Find running migrate.mjs processes
  const ps = spawnSync('ps', ['-eo', 'args'], { encoding: 'utf8' });
  if (!ps.stdout) return;

  for (const line of ps.stdout.split('\n')) {
    if (!line.includes('migrate.mjs')) continue;
    if (line.includes('| tee ')) continue; // wrapper de re-exec do tee (args vêm com aspas) — usa o processo node real

    // Deriva o dest dos args (mesma regra do migrate.mjs):
    //  --dest X            → X
    //  --in-place [pos]    → pos (migra na própria pasta)
    //  <pos> [--to N]      → <pos>-ngN   (N default 22, NÃO 21)
    const destMatch = line.match(/--dest\s+(\S+)/);
    let dest = destMatch?.[1]?.replace(/^['"]|['"]$/g, '');
    if (!dest) {
      // 1º token após migrate.mjs que NÃO é flag (nem valor de flag) = source posicional
      const after = line.split(/migrate\.mjs\s+/)[1] || '';
      const toks = after.split(/\s+/);
      let src = null;
      for (let i = 0; i < toks.length; i++) {
        if (toks[i].startsWith('-')) { if (/^--(to|from|dest|branch|peer-strategy)$/.test(toks[i])) i++; continue; }
        src = toks[i]; break;
      }
      if (src) {
        if (/--in-place\b/.test(line)) dest = src.replace(/\/+$/, '');
        else { const to = (line.match(/--to\s+(\d+)/) || [, '22'])[1]; dest = src.replace(/\/+$/, '') + '-ng' + to; }
      }
    }
    if (!dest) continue;

    // Log fica DENTRO de `<dest>/.ng-migrator/migration.log` (mesma regra do migrate.mjs).
    // Fallback pro caminho antigo `<parent>/<nome>-migration.log` (migrações já em andamento com
    // o migrate.mjs anterior, que gravava no pai).
    const name = basename(dest).replace(/-ng\d+$/, '');
    const newLog = join(dest, '.ng-migrator', 'migration.log');
    const oldLog = join(dirname(dest), `${name}-migration.log`);
    const logFile = existsSync(newLog) ? newLog : oldLog;
    if (!existsSync(logFile)) continue;

    console.log(`[api] external migration detected → tailing ${logFile}`);
    // Parseia as flags reais dos args (CLI) p/ o formulário da UI refletir o que ESTÁ rodando, em
    // vez dos defaults/localStorage (enganoso). origem/target/estratégia vêm do MIGRATION-DATA.json;
    // estas (que não estão no data) vêm da linha de comando.
    const cliConfig = {
      modernize: !/--no-modernize\b/.test(line),
      ngUpdateChecks: /--ng-update-checks\b/.test(line),
      forcePeerDeps: /--peer-strategy\s+force\b/.test(line),
    };
    currentMigrationData = { ...currentMigrationData, destPath: dest, status: 'running', cliConfig };

    // Tail last 200 lines and follow
    externalTailProcess = spawn('tail', ['-n', '200', '-f', logFile], { stdio: ['ignore', 'pipe', 'ignore'] });
    externalTailProcess.stdout.on('data', (data) => {
      for (const ln of data.toString().split('\n')) {
        if (ln) broadcast(ln);
      }
    });
    externalTailProcess.on('close', () => {
      externalTailProcess = null;
      // Refresh final status from MIGRATION-DATA.json
      const fresh = readMigrationData(dest);
      if (fresh) currentMigrationData = { ...fresh, status: fresh.status || 'done' };
    });
    break;
  }
}

// Poll every 5s for external processes
setInterval(detectAndAttachExternalMigration, 5000);

// SQLite diff DBs: keyed by dest path to support multiple loaded migrations.
const diffDbByDest = new Map();

function openDiffDb(destPath) {
  if (diffDbByDest.has(destPath)) return diffDbByDest.get(destPath);
  const dbPath = join(destPath, '.ng-migrator', 'diffs.db');
  if (!existsSync(dbPath)) return null;
  try {
    const db = new Database(dbPath, { readonly: true });
    diffDbByDest.set(destPath, db);
    return db;
  } catch { return null; }
}

// Default migration data when idle
const defaultMigrationData = {
  status: 'idle',
  sourceVersion: null,
  targetVersion: 21,
  sourcePath: '',
  destPath: '',
  date: '',
  ngUpdateSteps: [],
  modernize: {
    flexLayoutMigrated: null,
    inject: false,
    signals: false,
    untypedFormsFixed: 0,
    throwErrorFixed: 0,
    standalone: false,
    standaloneFixed: 0,
    controlFlow: false,
    ngClassToClass: false,
    ngStyleToStyle: false,
    appConfig: false,
    appRoutes: false,
    lazyRoutesConverted: 0,
    mainSimplified: false,
    builder: false,
    polyfillsInlined: false,
    tsconfigModernized: false,
    pathAliases: false,
    eslintAdded: false,
    sassImports: 0,
    modulesRemoved: 0,
    styleUrlFixed: 0,
    selfClosingTags: false,
    cleanupImports: false,
  },
  details: {},
  notes: [],
  filesCreated: [],
};

let currentMigrationData = { ...defaultMigrationData };
let activeSplitVersions = false;
let parentVersionsDir = '';

// ─── ng serve after migration ─────────────────────────────────────────────────

function startServe(cwd) {
  broadcast(`\n━━━ Installing packages in ${cwd} ━━━`);
  currentMigrationData.status = 'serving';

  const install = spawn('npm', ['install'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, FORCE_COLOR: '1' },
    cwd,
    detached: true,
  });

  install.stdout.on('data', (data) => {
    for (const line of data.toString().split('\n')) {
      if (line) broadcast(line);
    }
  });
  install.stderr.on('data', (data) => {
    for (const line of data.toString().split('\n')) {
      if (line) broadcast(`[stderr] ${line}`);
    }
  });
  install.on('close', (code) => {
    if (code !== 0) {
      broadcast(`\n━━━ npm install failed (exit code: ${code}) ━━━`);
      broadcastDone(code);
      migrationProcess = null;
      currentMigrationData.status = 'error';
      return;
    }

    broadcast(`\n━━━ Opening project in VS Code ━━━`);
    try {
      const vscode = spawn('code', [cwd], { stdio: 'ignore', detached: true });
      vscode.unref();
    } catch {
      broadcast('[ui] Could not open VS Code (is "code" in PATH?)');
    }

    broadcast(`\n━━━ Starting ng serve in ${cwd} ━━━`);
    migrationProcess = spawn('npx', ['ng', 'serve', '--open'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '1' },
      cwd,
      detached: true,
    });

    migrationProcess.stdout.on('data', (data) => {
      for (const line of data.toString().split('\n')) {
        if (line) broadcast(line);
      }
    });
    migrationProcess.stderr.on('data', (data) => {
      for (const line of data.toString().split('\n')) {
        if (line) broadcast(`[stderr] ${line}`);
      }
    });
    migrationProcess.on('close', (serveCode) => {
      broadcast(`\n━━━ ng serve encerrado (exit code: ${serveCode}) ━━━`);
      broadcastDone(serveCode);
      migrationProcess = null;
      currentMigrationData.status = serveCode === 0 ? 'done' : 'error';
    });
  });
}

// ─── Broadcast terminal output to SSE clients ─────────────────────────────────

function broadcast(line) {
  terminalLines.push(line);
  if (terminalLines.length > 2000) {
    terminalLines.shift();
  }
  const payload = `data: ${JSON.stringify(line)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch {
      sseClients.delete(res);
    }
  }
}

function broadcastDone(code) {
  const payload = `data: ${JSON.stringify({ done: true, code })}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch {
      sseClients.delete(res);
    }
  }
}

// ─── Read migration data from MIGRATION-DATA.json ────────────────────────────

function readMigrationData(destPath) {
  if (!destPath) return null;
  // New location: .ng-migrator/MIGRATION-DATA.json; fallback to root for old runs
  const dataPath = existsSync(join(destPath, '.ng-migrator', 'MIGRATION-DATA.json'))
    ? join(destPath, '.ng-migrator', 'MIGRATION-DATA.json')
    : join(destPath, 'MIGRATION-DATA.json');
  if (!existsSync(dataPath)) return null;
  try {
    return JSON.parse(readFileSync(dataPath, 'utf8'));
  } catch {
    return null;
  }
}

// ─── MIME types ───────────────────────────────────────────────────────────────

const MIME = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.json': 'application/json',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
};

function getMime(filePath) {
  const ext = filePath.slice(filePath.lastIndexOf('.'));
  return MIME[ext] || 'application/octet-stream';
}

// ─── Parse request body ───────────────────────────────────────────────────────

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

// ─── HTTP server ──────────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  // ── API routes ──────────────────────────────────────────────────────────────

  if (path === '/api/status' && req.method === 'GET') {
    // Try to refresh from MIGRATION-DATA.json if migration is running
    if (currentMigrationData.destPath) {
      const pollPath = activeSplitVersions ? parentVersionsDir : currentMigrationData.destPath;
      const fresh = readMigrationData(pollPath);
      if (fresh) {
        currentMigrationData = {
          ...fresh,
          // `running` se a UI iniciou (migrationProcess) OU se está seguindo o log de uma
          // migração externa/CLI (externalTailProcess) — senão o badge ficava 'done' durante o run.
          status: (migrationProcess || externalTailProcess) ? 'running' : (fresh.status || 'done'),
          // preserva o cliConfig detectado dos args (o MIGRATION-DATA.json não o tem → o spread o perderia)
          cliConfig: currentMigrationData.cliConfig,
        };
      }
    }
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify(currentMigrationData));
    return;
  }

  // Lista as correções disponíveis em migrator/corrections/ (carrega cada uma p/ ler metadados).
  if (path === '/api/corrections' && req.method === 'GET') {
    try {
      const { loadCorrections } = await import('./migrator/corrections/index.mjs');
      const list = (await loadCorrections()).map(c => ({
        name: c.name,
        description: c.description || '',
        trigger: typeof c.gate === 'function' ? 'proactive' : 'error-driven',
      })).sort((a, b) => a.name.localeCompare(b.name));
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ corrections: list }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err.message || err) }));
    }
    return;
  }

  // Recebe um arquivo .mjs de correção, VALIDA a forma (name + apply + detect|gate) carregando-o de
  // forma isolada na própria pasta (p/ os imports `./_lib.mjs` resolverem), e salva se válido.
  if (path === '/api/corrections' && req.method === 'POST') {
    const body = await parseBody(req);
    let { filename, content } = body;
    if (!content || typeof content !== 'string') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'content (conteúdo do arquivo .mjs) é obrigatório.' }));
      return;
    }
    // Nome de arquivo seguro: só basename, termina em .mjs, sem prefixo `_` (helper) nem index.mjs.
    let safe = basename(String(filename || '')).trim();
    if (safe && !safe.endsWith('.mjs')) safe += '.mjs';
    if (!safe || safe === 'index.mjs' || safe.startsWith('_') || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.mjs$/.test(safe)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Nome de arquivo inválido: '${filename}'. Use algo como 'minha-correcao.mjs' (sem '/', sem prefixo '_').` }));
      return;
    }
    const finalPath = join(CORRECTIONS_DIR, safe);
    if (existsSync(finalPath)) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Já existe uma correção '${safe}'. Renomeie ou remova a existente.` }));
      return;
    }
    // Valida num arquivo temporário NA pasta de corrections (prefixo `_` → não é auto-descoberto).
    const tmpPath = join(CORRECTIONS_DIR, `_upload_check_${Date.now()}.mjs`);
    try {
      writeFileSync(tmpPath, content);
      const mod = await import(pathToFileURL(tmpPath).href + `?v=${Date.now()}`);
      const c = mod.default;
      const hasTrigger = typeof c?.detect === 'function' || typeof c?.gate === 'function';
      if (!c?.name || typeof c.apply !== 'function' || !hasTrigger) {
        throw new Error("export default inválido: precisa de { name, apply, e detect ou gate }.");
      }
      writeFileSync(finalPath, content);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: true, name: c.name, file: safe, trigger: typeof c.gate === 'function' ? 'proactive' : 'error-driven' }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Correção inválida: ${String(err.message || err)}` }));
    } finally {
      try { unlinkSync(tmpPath); } catch { /* ignore */ }
    }
    return;
  }

  if (path === '/api/terminal' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no',
    });

    // Send buffered lines first
    for (const line of terminalLines) {
      res.write(`data: ${JSON.stringify(line)}\n\n`);
    }

    sseClients.add(res);

    // Heartbeat every 15s
    const heartbeat = setInterval(() => {
      try {
        res.write(': heartbeat\n\n');
      } catch {
        clearInterval(heartbeat);
        sseClients.delete(res);
      }
    }, 15000);

    req.on('close', () => {
      clearInterval(heartbeat);
      sseClients.delete(res);
    });
    return;
  }

  if (path === '/api/migrate' && req.method === 'POST') {
    if (migrationProcess) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Migration already running.' }));
      return;
    }

    const body = await parseBody(req);
    const { source, to, from, dest, modernize, steps, cleanDest, runAfter, splitVersions, inPlace, branch, ngUpdateChecks, peerStrategy, resumeFrom, rollbackTo } = body;

    if (!source) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'source path is required.' }));
      return;
    }

    if (!existsSync(source)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Path does not exist: ${source}` }));
      return;
    }

    // Build the command
    const args = [join(__dirname, 'migrate.mjs'), source];
    if (to) args.push('--to', String(to));
    if (from) args.push('--from', String(from));
    if (dest) args.push('--dest', dest);
    if (modernize === false) args.push('--no-modernize');
    if (splitVersions) args.push('--split-versions');
    if (inPlace) args.push('--in-place');
    if (inPlace && branch && branch.trim()) args.push('--branch', branch.trim());
    if (ngUpdateChecks) args.push('--ng-update-checks');
    if (peerStrategy === 'force') args.push('--peer-strategy', 'force');
    // Retomar/voltar a um step: operam no destino existente — nunca limpam a pasta.
    if (resumeFrom) args.push('--resume-from', String(resumeFrom));
    if (rollbackTo) args.push('--rollback-to', String(rollbackTo));

    activeSplitVersions = !!splitVersions;
    if (activeSplitVersions) {
      parentVersionsDir = join(dirname(source), `${basename(source)}-ng-versions`);
    } else {
      parentVersionsDir = '';
    }

    // Determine destPath for data polling / deletion. In-place migra na própria pasta de origem.
    const destPath = inPlace
      ? source
      : activeSplitVersions
        ? parentVersionsDir
        : (dest || `${source}-ng${to || 22}`);

    // Delete destination folder if requested (nunca no resume/rollback nem in-place — este migra na
    // própria pasta de origem, apagá-la seria catastrófico; o in-place exige git limpo, não cleanDest)
    if (cleanDest && !resumeFrom && !rollbackTo && !inPlace && existsSync(destPath)) {
      try {
        rmSync(destPath, { recursive: true, force: true });
        console.log(`[ui] Destination folder deleted: ${destPath}`);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Failed to delete destination: ${err.message}` }));
        return;
      }
    }

    // Skip steps via env var
    const skipStepsEnv = Array.isArray(steps) && steps.length > 0
      ? steps.join(',')
      : '';

    // Stop any external tail if running
    if (externalTailProcess) { externalTailProcess.kill(); externalTailProcess = null; }

    // Reset state
    terminalLines = [];
    currentMigrationData = {
      ...defaultMigrationData,
      status: 'running',
      targetVersion: to || 21,
      sourcePath: source,
      destPath,
      date: new Date().toISOString().slice(0, 10),
    };

    // Spawn migration process. NG_MIGRATOR_TEE=1 impede o re-exec via `tee` do migrador:
    // aqui a UI JÁ captura o stdout do processo (pipe abaixo) e faz broadcast no SSE, então não
    // precisa do log em arquivo nem da camada extra (mantém o PID direto p/ o /api/stop). O log
    // em arquivo + tail só são necessários p/ migrações iniciadas FORA da UI (CLI).
    const env = {
      ...process.env,
      FORCE_COLOR: '1',
      CI: '1',
      NG_MIGRATOR_TEE: '1',
    };
    if (skipStepsEnv) {
      env.NG_MIGRATOR_SKIP_STEPS = skipStepsEnv;
    }

    migrationProcess = spawn('node', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
      detached: true, // own process group so stop kills the whole tree
    });

    migrationProcess.stdout.on('data', (data) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (line) broadcast(line);
      }
    });

    migrationProcess.stderr.on('data', (data) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (line) broadcast(`[stderr] ${line}`);
      }
    });

    migrationProcess.on('close', (code) => {
      broadcast(`\n━━━ Migration ${code === 0 ? 'completed' : 'finished'} (exit code: ${code}) ━━━`);
      migrationProcess = null;

      // Final data read
      const pollPath = activeSplitVersions ? parentVersionsDir : destPath;
      const fresh = readMigrationData(pollPath);
      if (fresh) {
        currentMigrationData = { ...fresh, status: code === 0 ? 'done' : 'error' };
      } else {
        currentMigrationData.status = code === 0 ? 'done' : 'error';
      }

      const serveDestPath = activeSplitVersions
        ? join(parentVersionsDir, `ng${to || 21}`)
        : destPath;

      if (code === 0 && runAfter) {
        startServe(serveDestPath);
      } else {
        broadcastDone(code);
      }
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, dest: activeSplitVersions ? join(parentVersionsDir, `ng${to || 21}`) : destPath }));
    return;
  }

  if (path === '/api/diff' && req.method === 'GET') {
    const dest = url.searchParams.get('dest');
    const filePath = url.searchParams.get('path');
    const h0 = url.searchParams.get('h0');
    const h1 = url.searchParams.get('h1');
    if (!dest || !filePath || !h0 || !h1) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing parameters' }));
      return;
    }
    const db = openDiffDb(dest);
    let diffText;
    if (db) {
      const row = db.prepare('SELECT diff FROM diffs WHERE path = ? AND h0 = ? AND h1 = ?').get(filePath, h0, h1);
      if (row !== undefined) diffText = row.diff;
    }
    if (diffText === undefined) {
      diffText = spawnSync('git', ['diff', h0, h1, '--', filePath], { cwd: dest, encoding: 'utf8' }).stdout || '';
    }
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify({ diff: diffText }));
    return;
  }

  if (path === '/api/load-migration' && req.method === 'GET') {
    const loadPath = url.searchParams.get('path');
    const loaded = readMigrationData(loadPath);
    if (!loaded) {
      res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'MIGRATION-DATA.json not found at this path' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(loaded));
    return;
  }

  if (path === '/api/browse' && req.method === 'GET') {
    let selected = null;
    try {
      if (process.platform === 'darwin') {
        const r = spawnSync('osascript', ['-e', 'POSIX path of (choose folder with prompt "Selecione o projeto Angular")'], { encoding: 'utf8' });
        if (r.status === 0) selected = r.stdout.trim().replace(/\/$/, '');
      } else if (process.platform === 'win32') {
        const ps = `Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = 'Selecione o projeto Angular'; if ($d.ShowDialog() -eq 'OK') { $d.SelectedPath }`;
        const r = spawnSync('powershell', ['-Command', ps], { encoding: 'utf8' });
        if (r.status === 0) selected = r.stdout.trim();
      } else {
        // Linux: try zenity, fallback to kdialog
        let r = spawnSync('zenity', ['--file-selection', '--directory', '--title=Selecione o projeto Angular'], { encoding: 'utf8' });
        if (r.status === 0) {
          selected = r.stdout.trim();
        } else {
          r = spawnSync('kdialog', ['--getexistingdirectory', process.env.HOME || '/'], { encoding: 'utf8' });
          if (r.status === 0) selected = r.stdout.trim();
        }
      }
    } catch {
      // native dialog unavailable — return null, frontend falls back to manual input
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ path: selected }));
    return;
  }

  if (path === '/api/stop' && req.method === 'POST') {
    if (migrationProcess) {
      const pid = migrationProcess.pid;
      // Kill the entire process group (negative pid) to take down npm/npx children too
      try { process.kill(-pid, 'SIGTERM'); } catch { migrationProcess.kill('SIGTERM'); }
      setTimeout(() => {
        try { process.kill(-pid, 'SIGKILL'); } catch { /* already dead */ }
      }, 3000);
      broadcast('\n[ui] Migration stopped by user.');
      currentMigrationData.status = 'error';
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // OPTIONS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  // ── Static file serving ────────────────────────────────────────────────────

  if (!existsSync(DIST_DIR)) {
    res.writeHead(503, { 'Content-Type': 'text/plain' });
    res.end('Dashboard not built. Run: npm run dashboard:build');
    return;
  }

  let filePath = join(DIST_DIR, path === '/' ? 'index.html' : path);

  // SPA fallback
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(DIST_DIR, 'index.html');
  }

  try {
    const content = readFileSync(filePath);
    res.writeHead(200, {
      'Content-Type': getMime(filePath),
      'Cache-Control': filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000',
    });
    res.end(content);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`\n  ng-migrator-ui  ✓  http://localhost:${PORT}`);
  console.log(`  Dashboard:       ${DIST_DIR}`);
  console.log(`  API:             /api/status  /api/terminal  /api/migrate  /api/stop\n`);

  // Open browser (skipped when started via Vite plugin — NO_OPEN=1)
  if (!process.env.NO_OPEN) {
  const url = `http://localhost:${PORT}`;
  const opener =
    process.platform === 'darwin' ? 'open' :
    process.platform === 'win32'  ? 'cmd' : 'xdg-open';
  const openerArgs = process.platform === 'win32' ? ['/c', 'start', url] : [url];

  try {
    const child = spawn(opener, openerArgs, { stdio: 'ignore', detached: true });
    child.unref();
  } catch {
    // Browser open is optional — ignore errors
  }
  } // end NO_OPEN guard
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already in use. Kill the existing process or change the port.`);
  } else {
    console.error('\n  Server error:', err.message);
  }
  process.exit(1);
});
