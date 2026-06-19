// Glossário de erros conhecidos (Angular template/compiler + TypeScript) que aparecem nos build-checks
// da migração. Cada entrada tem título + descrição em en/pt e a causa típica no contexto da migração.
// Usado pelo KnownErrorsModal. Mantido como dado puro (sem JSX) para ser fácil de estender.

export type Lang = 'en' | 'pt'

export interface ErrorInfo {
  /** Família para agrupar/colorir: 'ng' (Angular) ou 'ts' (TypeScript). */
  family: 'ng' | 'ts'
  title: Record<Lang, string>
  desc: Record<Lang, string>
}

export const ERROR_GLOSSARY: Record<string, ErrorInfo> = {
  // ── Angular template / compiler ───────────────────────────────────────────
  NG8001: {
    family: 'ng',
    title: { en: 'Unknown element', pt: 'Elemento desconhecido' },
    desc: {
      en: "'<x>' is not a known element. The component/element isn't imported. In standalone, add the component to the importing component's `imports`; for web components, add CUSTOM_ELEMENTS_SCHEMA.",
      pt: "'<x>' não é um elemento conhecido. O componente/elemento não está importado. No standalone, adicione-o aos `imports` do componente; para web components, use CUSTOM_ELEMENTS_SCHEMA.",
    },
  },
  NG8002: {
    family: 'ng',
    title: { en: "Can't bind to property", pt: 'Binding desconhecido' },
    desc: {
      en: "Can't bind to 'x' since it isn't a known property of the element. The directive/component that declares the @Input isn't imported, or it's a typo.",
      pt: "Não é possível fazer bind a 'x' porque não é uma propriedade conhecida do elemento. A diretiva/componente que declara o @Input não está importada, ou é erro de digitação.",
    },
  },
  NG8003: {
    family: 'ng',
    title: { en: 'Template reference not found', pt: 'Referência de template não encontrada' },
    desc: {
      en: "No directive found with exportAs 'x' (e.g. #f=\"ngForm\" without FormsModule/ReactiveFormsModule imported).",
      pt: "Nenhuma diretiva com exportAs 'x' (ex: #f=\"ngForm\" sem FormsModule/ReactiveFormsModule importado).",
    },
  },
  NG8004: {
    family: 'ng',
    title: { en: 'Pipe not found', pt: 'Pipe não encontrado' },
    desc: {
      en: "No pipe found with name 'x'. The pipe isn't imported (standalone) or its declaring module isn't imported.",
      pt: "Nenhum pipe com o nome 'x'. O pipe não está importado (standalone) ou o módulo que o declara não foi importado.",
    },
  },
  NG6002: {
    family: 'ng',
    title: { en: 'Import is not an NgModule', pt: 'Import não é NgModule' },
    desc: {
      en: "A class in NgModule.imports doesn't appear to be an NgModule — usually a View Engine (pre-Ivy) third-party lib. ngcc was removed in v16, so old libs must be upgraded to an Ivy version.",
      pt: "Uma classe em NgModule.imports não parece ser um NgModule — geralmente uma lib de terceiros View Engine (pré-Ivy). O ngcc foi removido no v16, então libs antigas precisam subir para uma versão Ivy.",
    },
  },
  NG2012: {
    family: 'ng',
    title: { en: 'NgModule incompatible with Ivy', pt: 'NgModule incompatível com Ivy' },
    desc: {
      en: 'An NgModule was not compiled with Ivy. The migrator marks the symbol with `// TODO: [NG2012]` (neutralized) — the lib needs updating for it to work at runtime.',
      pt: 'Um NgModule não foi compilado com Ivy. O migrador marca o símbolo com `// TODO: [NG2012]` (neutralizado) — a lib precisa ser atualizada para funcionar em runtime.',
    },
  },
  NG1010: {
    family: 'ng',
    title: { en: 'Invalid @NgModule argument', pt: 'Argumento de @NgModule inválido' },
    desc: {
      en: "Something in the @NgModule decorator couldn't be resolved (e.g. a symbol imported from a module that doesn't really export it).",
      pt: "Algo no decorator @NgModule não pôde ser resolvido (ex: um símbolo importado de um módulo que não o exporta de verdade).",
    },
  },
  NG0919: {
    family: 'ng',
    title: { en: 'Cannot read @Component metadata (runtime)', pt: 'Não lê metadata de @Component (runtime)' },
    desc: {
      en: 'Runtime error usually caused by circular imports between standalone components. The migrator runs `cleanup-unused-imports` twice to break these cycles.',
      pt: 'Erro de runtime geralmente causado por imports circulares entre componentes standalone. O migrador roda `cleanup-unused-imports` duas vezes para quebrar os ciclos.',
    },
  },

  // ── TypeScript ─────────────────────────────────────────────────────────────
  TS2305: {
    family: 'ts',
    title: { en: 'Module has no exported member', pt: 'Módulo não exporta o membro' },
    desc: {
      en: "`import { X } from 'mod'` but 'X' isn't a real export (removed/renamed API, or it only exists in a JSDoc comment of the .d.ts).",
      pt: "`import { X } from 'mod'` mas 'X' não é um export real (API removida/renomeada, ou só existe num comentário JSDoc do .d.ts).",
    },
  },
  TS2724: {
    family: 'ts',
    title: { en: 'No exported member (with suggestion)', pt: 'Membro não exportado (com sugestão)' },
    desc: {
      en: "Variant of TS2305: the member isn't exported, but the compiler suggests a similarly-named one.",
      pt: 'Variante do TS2305: o membro não é exportado, mas o compilador sugere um de nome parecido.',
    },
  },
  TS2307: {
    family: 'ts',
    title: { en: 'Cannot find module', pt: 'Módulo não encontrado' },
    desc: {
      en: "Cannot find module 'x'. The package was removed or isn't installed (e.g. @angular/flex-layout, which has no v16+ — converted to Tailwind by a correction).",
      pt: "Não encontra o módulo 'x'. O pacote foi removido ou não está instalado (ex: @angular/flex-layout, sem v16+ — convertido para Tailwind por uma correção).",
    },
  },
  TS2304: {
    family: 'ts',
    title: { en: 'Cannot find name', pt: 'Nome não encontrado' },
    desc: {
      en: "A symbol is used without being imported. The migrator resolves it from the project/installed .d.ts index and adds the import when possible.",
      pt: 'Um símbolo é usado sem import. O migrador resolve pelo índice de .d.ts do projeto/instalados e adiciona o import quando possível.',
    },
  },
  TS2322: {
    family: 'ts',
    title: { en: 'Type not assignable', pt: 'Tipo não atribuível' },
    desc: {
      en: "Type 'A' is not assignable to type 'B'. E.g. Material v15 widened `_control.ngControl` to a union — needs an `as NgControl` cast.",
      pt: "Tipo 'A' não atribuível a 'B'. Ex: Material v15 alargou `_control.ngControl` para uma união — precisa de cast `as NgControl`.",
    },
  },
  TS2341: {
    family: 'ts',
    title: { en: 'Property is private', pt: 'Propriedade é privada' },
    desc: {
      en: "Property 'x' is private. Templates can't access private members (strict templates, v14+). The migrator makes the member public.",
      pt: "Propriedade 'x' é privada. Templates não acessam membros privados (strict templates, v14+). O migrador torna o membro público.",
    },
  },
  TS2349: {
    family: 'ts',
    title: { en: 'Expression is not callable', pt: 'Expressão não chamável' },
    desc: {
      en: "Calling a non-callable expression. Classic case: `moment()` with `import * as moment` once esModuleInterop is on — fixed by the moment-default-import correction.",
      pt: "Chamada de algo não-chamável. Caso clássico: `moment()` com `import * as moment` depois que o esModuleInterop liga — corrigido pela correção moment-default-import.",
    },
  },
  TS2540: {
    family: 'ts',
    title: { en: 'Assignment to read-only', pt: 'Atribuição a somente-leitura' },
    desc: {
      en: "Cannot assign to a read-only property. The signals schematic turns @Input/@ViewChild into readonly signals; if the code assigns to them, the migrator reverts to the decorator.",
      pt: 'Não pode atribuir a propriedade somente-leitura. O schematic de signals transforma @Input/@ViewChild em signals readonly; se o código atribui a eles, o migrador reverte ao decorator.',
    },
  },
  TS2554: {
    family: 'ts',
    title: { en: 'Wrong number of arguments', pt: 'Número de argumentos errado' },
    desc: {
      en: "Expected N arguments but got M. E.g. RxJS 7 made `Subject.next()` require an argument — the migrator rewrites `.next()` to `.next(undefined as any)`.",
      pt: 'Esperava N argumentos, recebeu M. Ex: RxJS 7 tornou `Subject.next()` obrigatório com argumento — o migrador reescreve `.next()` para `.next(undefined as any)`.',
    },
  },
  TS2663: {
    family: 'ts',
    title: { en: "Cannot find name (did you mean this.x?)", pt: 'Nome não encontrado (quis dizer this.x?)' },
    desc: {
      en: "A member is accessed without `this.`. Artifact of the signals schematic (`this.prop.x` → `prop.x`); the esbuild builder exposes it. The migrator fixes it surgically.",
      pt: 'Membro acessado sem `this.`. Artefato do schematic de signals (`this.prop.x` → `prop.x`); o builder esbuild expõe. O migrador corrige cirurgicamente.',
    },
  },
  TS1192: {
    family: 'ts',
    title: { en: 'Module has no default export', pt: 'Módulo sem export default' },
    desc: {
      en: "`import X from 'mod'` but the module has no default export. Needs esModuleInterop or a namespace import (related to the moment fix).",
      pt: "`import X from 'mod'` mas o módulo não tem export default. Precisa de esModuleInterop ou import de namespace (relacionado ao fix do moment).",
    },
  },
  TS6133: {
    family: 'ts',
    title: { en: 'Declared but never used', pt: 'Declarado mas nunca usado' },
    desc: {
      en: "A variable/import is declared but never used. Common after standalone/cleanup migrations; resolved by `cleanup-unused-imports` and `eslint --fix`.",
      pt: 'Variável/import declarado mas nunca usado. Comum após migrações standalone/cleanup; resolvido por `cleanup-unused-imports` e `eslint --fix`.',
    },
  },
  TS1005: {
    family: 'ts',
    title: { en: 'Syntax error (token expected)', pt: 'Erro de sintaxe (token esperado)' },
    desc: {
      en: "A parse error (e.g. ';' expected). During migration usually means a third-party .d.ts uses newer syntax than the step's TypeScript — the migrator pins compatible @types/node versions.",
      pt: "Erro de parse (ex: ';' esperado). Na migração, geralmente um .d.ts de terceiros usa sintaxe mais nova que o TypeScript do step — o migrador fixa versões compatíveis de @types/node.",
    },
  },
}

/** Lista o glossário (ordenado: Angular primeiro, depois por código). */
export function glossaryList(): Array<{ code: string } & ErrorInfo> {
  return Object.entries(ERROR_GLOSSARY)
    .map(([code, info]) => ({ code, ...info }))
    .sort((a, b) => (a.family === b.family ? a.code.localeCompare(b.code) : a.family === 'ng' ? -1 : 1))
}
