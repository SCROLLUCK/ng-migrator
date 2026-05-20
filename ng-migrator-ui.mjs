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
import { readFileSync, existsSync, statSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn, spawnSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = 4242;
const DIST_DIR = join(__dirname, 'dist');

// ─── State ────────────────────────────────────────────────────────────────────

let migrationProcess = null;
let terminalLines = [];
const sseClients = new Set();

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

// ─── ng serve after migration ─────────────────────────────────────────────────

function startServe(cwd) {
  broadcast(`\n━━━ Iniciando ng serve em ${cwd} ━━━`);
  currentMigrationData.status = 'serving';

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
  migrationProcess.on('close', (code) => {
    broadcast(`\n━━━ ng serve encerrado (exit code: ${code}) ━━━`);
    broadcastDone(code);
    migrationProcess = null;
    currentMigrationData.status = code === 0 ? 'done' : 'error';
  });
}

// ─── Broadcast terminal output to SSE clients ─────────────────────────────────

function broadcast(line) {
  terminalLines.push(line);
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
      const fresh = readMigrationData(currentMigrationData.destPath);
      if (fresh) {
        currentMigrationData = {
          ...fresh,
          status: migrationProcess ? 'running' : (fresh.status || 'done'),
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
    const { source, to, from, dest, modernize, steps, cleanDest, runAfter } = body;

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

    // Determine destPath for data polling
    const destPath = dest || `${source}-ng${to || 21}`;

    // Delete destination folder if requested
    if (cleanDest && existsSync(destPath)) {
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

    // Spawn migration process
    const env = {
      ...process.env,
      FORCE_COLOR: '1',
      CI: '1',
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
      const fresh = readMigrationData(destPath);
      if (fresh) {
        currentMigrationData = { ...fresh, status: code === 0 ? 'done' : 'error' };
      } else {
        currentMigrationData.status = code === 0 ? 'done' : 'error';
      }

      if (code === 0 && runAfter) {
        startServe(destPath);
      } else {
        broadcastDone(code);
      }
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, dest: destPath }));
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
    const result = spawnSync('git', ['diff', h0, h1, '--', filePath], {
      cwd: dest,
      encoding: 'utf8',
    });
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify({ diff: result.stdout || '' }));
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
