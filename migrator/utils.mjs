import { spawnSync } from 'child_process';
import {
  readFileSync, writeFileSync, existsSync,
  readdirSync, statSync, mkdirSync, copyFileSync,
} from 'fs';
import { join } from 'path';
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

export function run(cmd, { cwd = ctx.destPath, ignoreError = false } = {}) {
  console.log(`  $ ${cmd}`);
  const result = spawnSync(cmd, {
    shell: true,
    cwd,
    stdio: 'inherit',
    env: { ...process.env, FORCE_COLOR: '1', CI: '1' },
  });
  if (!ignoreError && result.status !== 0) {
    console.error(`\n  ✘ Comando falhou (exit ${result.status}): ${cmd}`);
  }
  return result;
}

export function capture(cmd, cwd = ctx.destPath) {
  const result = spawnSync(cmd, {
    shell: true, cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CI: '1' },
  });
  return result.stdout?.toString().trim() ?? '';
}

// Like run(), but also captures combined stdout+stderr for post-processing.
export function runCapture(cmd, { cwd = ctx.destPath } = {}) {
  console.log(`  $ ${cmd}`);
  const result = spawnSync(cmd, {
    shell: true, cwd,
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '1', CI: '1' },
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  result.output = (result.stdout || '') + (result.stderr || '');
  return result;
}

export function npmInstall() {
  let r = run('npm install', { ignoreError: true });
  if (r.status !== 0) {
    console.log('  ↳ Tentando com --legacy-peer-deps...');
    r = run('npm install --legacy-peer-deps', { ignoreError: true });
  }
  return r;
}

export function runUntilStable(cmd, label, maxPasses = 5) {
  for (let i = 0; i < maxPasses; i++) {
    console.log(`\n  🔄 ${label}${i > 0 ? ` (pass ${i + 1})` : ''}...`);
    const result = spawnSync(cmd, {
      shell: true, cwd: ctx.destPath, stdio: ['inherit', 'pipe', 'inherit'],
      env: { ...process.env, FORCE_COLOR: '1', CI: '1' },
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
