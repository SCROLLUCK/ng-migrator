// Correção específica: ngx-mask v15+ removeu o `NgxMaskModule`. Agora a diretiva é standalone
// (`NgxMaskDirective`) + `provideNgxMask()` (providers). Apps NgModule que faziam
// `imports: [NgxMaskModule.forRoot()]` quebram com `TS2305 'NgxMaskModule' has no exported member`
// (e NG6002 a jusante). Esta correção migra o uso — runtime-correto, não só "builda".
//
// É um exemplo do formato: detect() casa o erro; apply() faz a transformação cirúrgica.
export default {
  name: 'ngx-mask-standalone',
  description: 'ngx-mask v15+: NgxMaskModule → NgxMaskDirective (standalone) + provideNgxMask()',

  detect({ raw, codes, hasPackage }) {
    return hasPackage('ngx-mask')
      && /NgxMaskModule/.test(raw)
      && (codes.has('TS2305') || codes.has('TS2724') || codes.has('NG6002') || codes.has('NG1010'));
  },

  apply({ transformTs }) {
    const files = transformTs((src) => {
      if (!src.includes('NgxMaskModule')) return src;
      let out = src;

      // import { NgxMaskModule, ... } from 'ngx-mask'
      //   → import { NgxMaskDirective, provideNgxMask, ... } from 'ngx-mask'
      out = out.replace(/import\s*\{([^}]*)\}\s*from\s*(['"])ngx-mask\2\s*;?/g, (_m, names, q) => {
        const set = new Set(
          names.split(',').map(s => s.trim()).filter(Boolean).filter(s => s !== 'NgxMaskModule'),
        );
        set.add('NgxMaskDirective');
        set.add('provideNgxMask');
        return `import { ${[...set].join(', ')} } from ${q}ngx-mask${q};`;
      });

      // imports: [ ... NgxMaskModule.forRoot(...) / NgxMaskModule ... ] → NgxMaskDirective (standalone)
      out = out.replace(/NgxMaskModule\s*\.\s*for(?:Root|Child)\s*\([^)]*\)/g, 'NgxMaskDirective');
      out = out.replace(/\bNgxMaskModule\b/g, 'NgxMaskDirective');

      // Garante provideNgxMask() nos providers do @NgModule (a config global do forRoot virou provider).
      if (/@NgModule\s*\(/.test(out) && !/provideNgxMask\s*\(/.test(out)) {
        if (/providers\s*:\s*\[/.test(out)) {
          out = out.replace(/providers\s*:\s*\[/, 'providers: [provideNgxMask(), ');
        } else {
          out = out.replace(/@NgModule\s*\(\s*\{/, m => `${m}\n  providers: [provideNgxMask()],`);
        }
      }
      return out;
    });
    return { files, summary: `NgxMaskModule → NgxMaskDirective + provideNgxMask() em ${files.length} arquivo(s)` };
  },
};
