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

  NG2003: {
    family: 'ng',
    title: { en: 'No injection token', pt: 'Sem token de injeção' },
    desc: {
      en: "No suitable injection token for a constructor parameter (e.g. injecting an interface/abstract type). Use @Inject(TOKEN) or an InjectionToken.",
      pt: "Sem token de injeção adequado para um parâmetro do construtor (ex: injetar interface/tipo abstrato). Use @Inject(TOKEN) ou um InjectionToken.",
    },
  },
  NG2010: {
    family: 'ng',
    title: { en: "'imports' only valid on standalone", pt: "'imports' só vale em standalone" },
    desc: {
      en: "`imports` is only valid on a component marked `standalone: true`. Surfaces mid-migration when a component gained `imports` but isn't standalone yet.",
      pt: "`imports` só é válido num componente `standalone: true`. Aparece no meio da migração quando um componente ganhou `imports` mas ainda não é standalone.",
    },
  },
  NG8023: {
    family: 'ng',
    title: { en: 'Multiple components match element', pt: 'Múltiplos componentes casam o elemento' },
    desc: {
      en: "More than one component matches the same element in a template (ambiguous selector) — usually duplicate/overlapping selectors imported into the same component.",
      pt: "Mais de um componente casa o mesmo elemento no template (seletor ambíguo) — geralmente seletores duplicados/sobrepostos importados no mesmo componente.",
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
  TS2339: {
    family: 'ts',
    title: { en: 'Property does not exist on type', pt: 'Propriedade não existe no tipo' },
    desc: {
      en: "Property 'X' does not exist on type 'Y'. A typo, a missing type, or accessing a member the type doesn't declare.",
      pt: "Propriedade 'X' não existe no tipo 'Y'. Erro de digitação, tipo faltando, ou acesso a membro que o tipo não declara.",
    },
  },
  TS2345: {
    family: 'ts',
    title: { en: 'Argument type not assignable', pt: 'Tipo do argumento não atribuível' },
    desc: {
      en: "Argument of type 'A' is not assignable to parameter of type 'B'. Passing the wrong type to a function/method.",
      pt: "Argumento do tipo 'A' não é atribuível ao parâmetro do tipo 'B'. Passando o tipo errado para uma função/método.",
    },
  },
  TS2366: {
    family: 'ts',
    title: { en: 'Function lacks ending return', pt: 'Função sem return final' },
    desc: {
      en: "Function lacks an ending return and its return type doesn't include 'undefined'. Add a return or widen the type.",
      pt: "Função sem return ao final e o tipo de retorno não inclui 'undefined'. Adicione um return ou amplie o tipo.",
    },
  },
  TS2416: {
    family: 'ts',
    title: { en: 'Override type mismatch', pt: 'Override com tipo incompatível' },
    desc: {
      en: "A property/method isn't assignable to the same member in the base type — an override with an incompatible signature (stricter checks surface it).",
      pt: "Uma propriedade/método não é atribuível ao mesmo membro do tipo base — um override com assinatura incompatível (checagens mais estritas expõem).",
    },
  },
  TS2454: {
    family: 'ts',
    title: { en: 'Used before assigned', pt: 'Usado antes de atribuir' },
    desc: {
      en: "Variable 'X' is used before being assigned (strictNullChecks). Initialize it or guard the access.",
      pt: "Variável 'X' usada antes de ser atribuída (strictNullChecks). Inicialize ou proteja o acesso.",
    },
  },
  TS2532: {
    family: 'ts',
    title: { en: "Object is possibly 'undefined'", pt: "Objeto possivelmente 'undefined'" },
    desc: {
      en: "Object is possibly 'undefined'. Add optional chaining (?.) or a null guard (strictNullChecks).",
      pt: "Objeto possivelmente 'undefined'. Use optional chaining (?.) ou um guard de nulo (strictNullChecks).",
    },
  },
  TS2538: {
    family: 'ts',
    title: { en: 'Invalid index type', pt: 'Tipo de índice inválido' },
    desc: {
      en: "Type 'X' cannot be used as an index type (e.g. indexing with undefined/object). Narrow the key type.",
      pt: "Tipo 'X' não pode ser usado como índice (ex: indexar com undefined/objeto). Restrinja o tipo da chave.",
    },
  },
  TS2551: {
    family: 'ts',
    title: { en: 'Property does not exist (suggestion)', pt: 'Propriedade não existe (sugestão)' },
    desc: {
      en: "Property 'X' does not exist on type 'Y'. Did you mean 'Z'? Variant of TS2339 with a near-match suggestion (often a rename).",
      pt: "Propriedade 'X' não existe no tipo 'Y'. Quis dizer 'Z'? Variante do TS2339 com sugestão de nome (geralmente um rename).",
    },
  },
  TS2564: {
    family: 'ts',
    title: { en: 'Property has no initializer', pt: 'Propriedade sem inicializador' },
    desc: {
      en: "Property has no initializer and isn't definitely assigned in the constructor (strictPropertyInitialization). Initialize it, use '!' or make it optional.",
      pt: "Propriedade sem inicializador e não definitivamente atribuída no construtor (strictPropertyInitialization). Inicialize, use '!' ou torne opcional.",
    },
  },
  TS2571: {
    family: 'ts',
    title: { en: "Object is of type 'unknown'", pt: "Objeto é do tipo 'unknown'" },
    desc: {
      en: "Object is of type 'unknown' (e.g. a caught error). Narrow it with a type guard before using it.",
      pt: "Objeto é do tipo 'unknown' (ex: erro capturado). Restrinja com um type guard antes de usar.",
    },
  },
  TS2769: {
    family: 'ts',
    title: { en: 'No overload matches call', pt: 'Nenhuma sobrecarga casa a chamada' },
    desc: {
      en: "No overload matches this call. The arguments don't fit any of the function's overload signatures.",
      pt: "Nenhuma sobrecarga casa esta chamada. Os argumentos não batem com nenhuma assinatura sobrecarregada da função.",
    },
  },
  TS2790: {
    family: 'ts',
    title: { en: "'delete' operand must be optional", pt: "operando de 'delete' deve ser opcional" },
    desc: {
      en: "The operand of a 'delete' operator must be optional. Make the property optional (?) to delete it.",
      pt: "O operando de um 'delete' deve ser opcional. Torne a propriedade opcional (?) para poder deletá-la.",
    },
  },
  TS7005: {
    family: 'ts',
    title: { en: "Variable implicitly 'any'", pt: "Variável implicitamente 'any'" },
    desc: {
      en: "Variable implicitly has an 'any' type (noImplicitAny). Add an explicit type annotation.",
      pt: "Variável tem tipo 'any' implícito (noImplicitAny). Adicione uma anotação de tipo explícita.",
    },
  },
  TS7006: {
    family: 'ts',
    title: { en: "Parameter implicitly 'any'", pt: "Parâmetro implicitamente 'any'" },
    desc: {
      en: "Parameter implicitly has an 'any' type (noImplicitAny). Annotate the parameter type. Common when stricter defaults land at v22.",
      pt: "Parâmetro tem tipo 'any' implícito (noImplicitAny). Anote o tipo do parâmetro. Comum quando os defaults mais estritos chegam no v22.",
    },
  },
  TS7008: {
    family: 'ts',
    title: { en: "Member implicitly 'any'", pt: "Membro implicitamente 'any'" },
    desc: {
      en: "Class member implicitly has an 'any' type (noImplicitAny). Add an explicit type.",
      pt: "Membro de classe com tipo 'any' implícito (noImplicitAny). Adicione um tipo explícito.",
    },
  },
  TS7015: {
    family: 'ts',
    title: { en: 'Implicit any from index', pt: 'any implícito por índice' },
    desc: {
      en: "Element implicitly has 'any' because the index expression isn't of type 'number'. Type the index or add an index signature.",
      pt: "Elemento com 'any' implícito porque o índice não é 'number'. Tipe o índice ou adicione uma index signature.",
    },
  },
  TS7034: {
    family: 'ts',
    title: { en: "Variable implicitly 'any' (inferred)", pt: "Variável 'any' implícito (inferido)" },
    desc: {
      en: "Variable implicitly has type 'any' in locations where its type can't be determined. Annotate it explicitly.",
      pt: "Variável com tipo 'any' implícito onde o tipo não pôde ser determinado. Anote explicitamente.",
    },
  },
  TS7053: {
    family: 'ts',
    title: { en: 'Implicit any from index signature', pt: 'any implícito por index signature' },
    desc: {
      en: "Element implicitly has 'any' because the expression can't index the type (no matching index signature). Add an index signature or narrow the key.",
      pt: "Elemento com 'any' implícito porque a expressão não pode indexar o tipo (sem index signature). Adicione uma index signature ou restrinja a chave.",
    },
  },
  TS18046: {
    family: 'ts',
    title: { en: "Value is of type 'unknown'", pt: "Valor é do tipo 'unknown'" },
    desc: {
      en: "A value is of type 'unknown' (often a caught error). Narrow it with a type guard before using.",
      pt: "Um valor é do tipo 'unknown' (geralmente um erro no catch). Restrinja com um type guard antes de usar.",
    },
  },
  TS18047: {
    family: 'ts',
    title: { en: "Value is possibly 'null'", pt: "Valor possivelmente 'null'" },
    desc: {
      en: "Value is possibly 'null' (strictNullChecks). Add a null guard or optional chaining.",
      pt: "Valor possivelmente 'null' (strictNullChecks). Adicione guard de nulo ou optional chaining.",
    },
  },
  TS18048: {
    family: 'ts',
    title: { en: "Value is possibly 'undefined'", pt: "Valor possivelmente 'undefined'" },
    desc: {
      en: "Value is possibly 'undefined' (strictNullChecks). Add a guard or optional chaining.",
      pt: "Valor possivelmente 'undefined' (strictNullChecks). Adicione guard ou optional chaining.",
    },
  },
}

/** Lista o glossário (ordenado: Angular primeiro, depois por código). */
export function glossaryList(): Array<{ code: string } & ErrorInfo> {
  return Object.entries(ERROR_GLOSSARY)
    .map(([code, info]) => ({ code, ...info }))
    .sort((a, b) => (a.family === b.family ? a.code.localeCompare(b.code) : a.family === 'ng' ? -1 : 1))
}
