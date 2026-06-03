// ─── Correção: ngx-mask (NgModule → standalone) ──────────────────────────────
//
// ESTE ARQUIVO É O EXEMPLO DE REFERÊNCIA do formato de correção. Copie a estrutura para escrever
// novas correções. Veja a doc dos campos e do `ctx` em `index.mjs` (typedefs) e no README.
//
// O problema: ngx-mask v15+ REMOVEU o `NgxMaskModule`. A diretiva virou standalone
// (`NgxMaskDirective`) e a config global virou o provider `provideNgxMask()`. Apps NgModule que
// faziam `imports: [NgxMaskModule.forRoot()]` quebram com:
//   TS2305 'NgxMaskModule' has no exported member   (e NG6002/NG1010 a jusante).
// Esta correção migra o uso DE VERDADE (runtime-safe) — não apenas remove pra "buildar".

/** @type {import('./index.mjs').Correction} */
export default {
  /** Id único da correção (kebab-case). */
  name: 'ngx-mask-standalone',

  /** Uma linha para o report (o que esta correção faz). */
  description: 'ngx-mask v15+: NgxMaskModule → NgxMaskDirective (standalone) + provideNgxMask()',

  /**
   * Ativa quando: o projeto usa `ngx-mask`, o erro menciona `NgxMaskModule`, e há um dos códigos
   * típicos da remoção do módulo. Mantenha o `detect` BARATO e ESPECÍFICO (evita rodar à toa).
   * @param {import('./index.mjs').DetectContext} ctx
   * @returns {boolean}
   */
  detect({ raw, codes, hasPackage }) {
    return hasPackage('ngx-mask')
      && /NgxMaskModule/.test(raw)
      && (codes.has('TS2305') || codes.has('TS2724') || codes.has('NG6002') || codes.has('NG1010'));
  },

  /**
   * Aplica a transformação em cada `.ts`. Use `ctx.transformTs(fn)`: `fn(content)` devolve o novo
   * conteúdo (ou o mesmo, se não houver mudança). `transformTs` grava só o que mudou e devolve os
   * arquivos alterados. Retorne `{ files, summary }`.
   * @param {import('./index.mjs').ApplyContext} ctx
   * @returns {{ files: string[], summary: string }}
   */
  apply({ transformTs }) {
    const files = transformTs((content) => {
      if (!content.includes('NgxMaskModule')) return content;  // arquivo não afetado
      let out = content;

      // 1) Import: `import { NgxMaskModule, ... } from 'ngx-mask'`
      //         → `import { NgxMaskDirective, provideNgxMask, ... } from 'ngx-mask'`
      out = out.replace(/import\s*\{([^}]*)\}\s*from\s*(['"])ngx-mask\2\s*;?/g, (_full, names, quote) => {
        const symbols = new Set(
          names.split(',').map(s => s.trim()).filter(Boolean).filter(s => s !== 'NgxMaskModule'),
        );
        symbols.add('NgxMaskDirective');
        symbols.add('provideNgxMask');
        return `import { ${[...symbols].join(', ')} } from ${quote}ngx-mask${quote};`;
      });

      // 2) `imports: [ ... NgxMaskModule.forRoot(...) / NgxMaskModule ... ]` → `NgxMaskDirective`
      out = out.replace(/NgxMaskModule\s*\.\s*for(?:Root|Child)\s*\([^)]*\)/g, 'NgxMaskDirective');
      out = out.replace(/\bNgxMaskModule\b/g, 'NgxMaskDirective');

      // 3) A config global do `forRoot` virou provider → garante `provideNgxMask()` nos providers.
      if (/@NgModule\s*\(/.test(out) && !/provideNgxMask\s*\(/.test(out)) {
        out = /providers\s*:\s*\[/.test(out)
          ? out.replace(/providers\s*:\s*\[/, 'providers: [provideNgxMask(), ')
          : out.replace(/@NgModule\s*\(\s*\{/, full => `${full}\n  providers: [provideNgxMask()],`);
      }
      return out;
    });

    return { files, summary: `NgxMaskModule → NgxMaskDirective + provideNgxMask() em ${files.length} arquivo(s)` };
  },
};
