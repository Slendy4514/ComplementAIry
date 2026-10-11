/**
 * Huella de CONSTRUCCIONES de un código (manifiesto I.6, Regla de Oro del Aprendiz): qué APIs, patrones
 * y librerías usa. La IA solo puede escribir construcciones que ya escribiste tú a mano (licencias).
 * Sin IA: tree-sitter. Se mide lo reconocible; lo desconocido no se inventa.
 */
import type { LangSpec } from "./lang.js";
import { getParser, nombrados, type SyntaxNode } from "./parser.js";

export interface Construccion {
  id: string;
  /** Para qué sirve, en palabras (lo muestra la kata). */
  que: string;
}

/** Catálogo de lo que se reconoce (además de `import:<paquete>`). */
export const CATALOGO: Record<string, string> = {
  "async-await": "funciones asíncronas con await",
  "promise-all": "varias promesas en paralelo (Promise.all / allSettled / race)",
  "promise-new": "crear una promesa a mano (new Promise)",
  fetch: "pedidos HTTP con fetch",
  "abort-controller": "cancelar pedidos o tareas (AbortController)",
  timers: "temporizadores (setTimeout / setInterval)",
  regex: "expresiones regulares",
  reduce: "acumular con reduce",
  "map-filter": "transformar listas con map / filter / flatMap",
  sort: "ordenar con comparador (sort)",
  recursion: "funciones recursivas",
  clase: "clases",
  herencia: "herencia (extends)",
  generador: "generadores (function* / yield)",
  "try-catch": "manejo de errores con try/catch",
  throw: "lanzar errores",
  destructuring: "desestructuración",
  spread: "spread / rest (...)",
  "map-set": "estructuras Map / Set",
  json: "JSON.parse / JSON.stringify",
  "eventos": "eventos (addEventListener / on / emit)",
  closure: "funciones que devuelven funciones (closures)",
  comprension: "comprensiones de listas (Python)",
  "context-manager": "with / context managers (Python)",
  decoradores: "decoradores",
  sql: "consultas SQL en strings",
  "sql-join": "JOIN en SQL",
  "fs": "lectura/escritura de archivos",
  "child-process": "procesos hijos",
  crypto: "criptografía y hashes",
};

const MEMBER_API: [RegExp, string][] = [
  [/^Promise\.(all|allSettled|race|any)$/, "promise-all"],
  [/\.reduce(Right)?$/, "reduce"],
  [/\.(map|filter|flatMap)$/, "map-filter"],
  [/\.sort$/, "sort"],
  [/^JSON\.(parse|stringify)$/, "json"],
  [/\.(addEventListener|on|once|emit)$/, "eventos"],
  [/^(fs|fsp|fs\.promises)\.\w+$/, "fs"],
  [/^crypto\.\w+$/, "crypto"],
];

function nombreLlamada(n: SyntaxNode): string {
  const f = n.childForFieldName("function");
  return f ? f.text.replace(/\s+/g, "") : "";
}

/** Construcciones (ids del catálogo + `import:<paquete>`) que usa un código. */
export async function construccionesDe(src: string, lang: LangSpec): Promise<Set<string>> {
  const out = new Set<string>();
  if (!lang.grammar || !["typescript", "tsx", "javascript", "python"].includes(lang.id)) return out;
  const parser = await getParser(lang.grammar);
  const tree = parser.parse(src);
  if (!tree) return out;
  const funciones: { nombre: string; nodo: SyntaxNode }[] = [];
  const visitar = (n: SyntaxNode) => {
    const t = n.type;
    if (t === "await_expression" || t === "await") out.add("async-await");
    if (t === "regex" || (t === "call" && /^re\.\w+$/.test(nombreLlamada(n)))) out.add("regex");
    if (t === "class_declaration" || t === "class_definition" || t === "class") out.add("clase");
    if (t === "class_heritage" || (t === "class_definition" && n.childForFieldName("superclasses"))) out.add("herencia");
    if (t === "generator_function_declaration" || t === "yield_expression" || t === "yield") out.add("generador");
    if (t === "try_statement") out.add("try-catch");
    if (t === "throw_statement" || t === "raise_statement") out.add("throw");
    if (t === "object_pattern" || t === "array_pattern" || t === "pattern_list") out.add("destructuring");
    if (t === "spread_element" || t === "rest_pattern" || t === "list_splat" || t === "dictionary_splat") out.add("spread");
    if (t === "list_comprehension" || t === "dictionary_comprehension" || t === "set_comprehension" || t === "generator_expression") out.add("comprension");
    if (t === "with_statement") out.add("context-manager");
    if (t === "decorator") out.add("decoradores");
    if (t === "new_expression") {
      const c = n.childForFieldName("constructor")?.text ?? "";
      if (c === "Promise") out.add("promise-new");
      if (c === "AbortController") out.add("abort-controller");
      if (c === "Map" || c === "Set" || c === "WeakMap") out.add("map-set");
    }
    if (t === "call_expression" || t === "call") {
      const nom = nombreLlamada(n);
      if (nom === "fetch") out.add("fetch");
      if (/^(setTimeout|setInterval|clearTimeout|clearInterval)$/.test(nom)) out.add("timers");
      if (nom === "require") {
        const arg = nombrados(n.childForFieldName("arguments") ?? n)[0]?.text.replace(/['"`]/g, "");
        if (arg) out.add(`import:${paquete(arg)}`);
      }
      if (/^(set|dict|Map|Set)$/.test(nom) && lang.id === "python") out.add("map-set");
      for (const [re, id] of MEMBER_API) if (re.test(nom)) out.add(id);
    }
    if (t === "import_statement" || t === "import_from_statement") {
      const s = n.childForFieldName("source")?.text ?? n.childForFieldName("module_name")?.text ?? nombrados(n).find((c) => c.type === "dotted_name")?.text ?? "";
      const mod = s.replace(/['"`]/g, "");
      if (mod) {
        out.add(`import:${paquete(mod)}`);
        if (/^(node:)?(fs|fs\/promises)$/.test(mod) || mod === "pathlib") out.add("fs");
        if (/^(node:)?child_process$/.test(mod) || mod === "subprocess") out.add("child-process");
        if (/^(node:)?crypto$/.test(mod) || /^(hashlib|cryptography|bcrypt|jsonwebtoken|jose)$/.test(mod)) out.add("crypto");
      }
    }
    if (t === "string" || t === "template_string" || t === "string_fragment") {
      if (/\b(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\b/i.test(n.text) && /\b(FROM|INTO|SET|WHERE)\b/i.test(n.text)) out.add("sql");
      if (/\bJOIN\b/i.test(n.text)) out.add("sql-join");
    }
    if (/^(function_declaration|function_definition|method_definition|arrow_function|function_expression)$/.test(t)) {
      const nombre = n.childForFieldName("name")?.text ?? (n.parent?.type === "variable_declarator" ? n.parent.childForFieldName("name")?.text : undefined);
      if (nombre) funciones.push({ nombre, nodo: n });
      const cuerpo = n.childForFieldName("body");
      if (cuerpo && /^(arrow_function|function_expression|lambda)$/.test(cuerpo.type)) out.add("closure");
      if (cuerpo) for (const r of nombrados(cuerpo)) if (r.type === "return_statement" && nombrados(r).some((x) => /^(arrow_function|function_expression|lambda)$/.test(x.type))) out.add("closure");
    }
    for (const c of nombrados(n)) visitar(c);
  };
  visitar(tree.rootNode);
  // Recursión: una función que se llama a sí misma.
  for (const f of funciones) if (new RegExp(`\\b${f.nombre.replace(/[$]/g, "\\$")}\\s*\\(`).test(f.nodo.childForFieldName("body")?.text ?? "")) out.add("recursion");
  tree.delete();
  return out;
}

/** "@scope/pkg/sub" → "@scope/pkg"; "pkg/sub" → "pkg"; relativos → "local". */
export function paquete(mod: string): string {
  if (mod.startsWith(".") || mod.startsWith("/")) return "local";
  const m = mod.replace(/^node:/, "node:").split("/");
  return mod.startsWith("@") ? m.slice(0, 2).join("/") : m[0]!.split(".")[0]!;
}

/** Construcciones que NO necesitan licencia (triviales o locales). */
export const SIN_LICENCIA = new Set(["import:local", "destructuring", "spread", "throw", "json"]);

/** Descripción legible de una construcción. */
export function describir(id: string): string {
  if (id.startsWith("import:")) return `usar la librería ${id.slice(7)}`;
  return CATALOGO[id] ?? id;
}
