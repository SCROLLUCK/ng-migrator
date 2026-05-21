import { join } from 'path';
import { destPath } from './context.mjs';
import { readJson } from './utils.mjs';

export function getPkg() {
  return readJson(join(destPath, 'package.json'));
}

export function hasPackage(name) {
  const pkg = getPkg();
  return !!(pkg.dependencies?.[name] ?? pkg.devDependencies?.[name]);
}

export function getMajor(versionStr = '') {
  const m = versionStr.match(/(\d+)/);
  return m ? parseInt(m[1]) : 0;
}

export function getInstalledMajor(name) {
  const pkg = getPkg();
  const v = pkg.dependencies?.[name] ?? pkg.devDependencies?.[name] ?? '';
  return getMajor(v);
}
