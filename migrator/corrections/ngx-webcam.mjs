// Correção: ngx-webcam 0.3.x (View Engine) → 0.4.x (Ivy). gate v16+.
//
// O `ngx-webcam@0.3.x` é compilado em View Engine. Com o ngcc REMOVIDO no Angular 16, todo
// componente que importa o `WebcamModule` vira **NG6002/NG2012** ("WebcamModule não é um NgModule")
// em cascata (no orion: 225 erros). O `0.4.x` é Ivy e mantém a MESMA API (`WebcamModule`) — só a
// versão muda, sem tocar em template/código.
//
// Por que NÃO é coberto pelo `upgradeThirdPartyForIvy` genérico: o `ngx-webcam@0.4.x` **dropou** a
// declaração de peer `@angular/core`, então o `resolveCompatibleVersion` (que casa pela peer range)
// não o encontra; e o major é sempre `0` (não há versão com major == alvo). Caso lib-specific →
// correção (gate proativo, antes do v16 quebrar). AUTOCONTIDA: só fs/path + ctx.

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

export default {
  name: 'ngx-webcam-ivy',
  description: 'ngx-webcam 0.3.x (View Engine) → ^0.4.0 (Ivy) — mantém WebcamModule',
  gate: (angularMajor) => angularMajor >= 16,
  apply(ctx) {
    const pkgPath = join(ctx.destPath, 'package.json');
    if (!existsSync(pkgPath)) return { files: [], summary: 'sem package.json' };
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    const section = pkg.dependencies?.['ngx-webcam'] ? 'dependencies'
      : pkg.devDependencies?.['ngx-webcam'] ? 'devDependencies' : null;
    if (!section) return { files: [], summary: 'ngx-webcam não usado' };
    const cur = pkg[section]['ngx-webcam'];
    // idempotente: já em 0.4+ (ou major >= 1) → no-op
    const m = cur.match(/(\d+)\.(\d+)/);
    if (m && (Number(m[1]) > 0 || Number(m[2]) >= 4)) return { files: [], summary: `ngx-webcam já em ${cur}` };
    pkg[section]['ngx-webcam'] = '^0.4.0';
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    return { files: ['package.json'], summary: `ngx-webcam ${cur} → ^0.4.0 (Ivy)` };
  },
};
