import vm from "node:vm";
import { parse } from "./comments.js";
import type { LangSpec } from "./lang.js";
import { sonLiterales } from "./literales.js";
import { hijos, type SyntaxNode } from "./parser.js";

/**
 * Probar código que NO exporta o que depende de su entorno (scripts que carga otra aplicación,
 * archivos que usan `window`, `document`, `app`…), SIN modificarlo: se carga tal cual en un contexto
 * aislado de Node (vm) y lo que usa del entorno se reemplaza por "dobles" que registran qué se usó
 * (o devuelven lo que el caso propone, como datos). Nada aquí es específico de una aplicación.
 */

export interface Analisis {
  /** Clases, funciones y constantes declaradas en el primer nivel del archivo. */
  declaraciones: string[];
  /** Nombres que el archivo usa sin declararlos y que no son del lenguaje (vienen de su entorno). */
  globales: string[];
  /** Usa `import`/`export` de módulos: se ejecuta como módulo normal, no aislado. */
  esModulo: boolean;
}

/**
 * Lo que el contexto aislado provee además del lenguaje (utilidades comunes de cualquier entorno y lo
 * de CommonJS). Lo demás que use el archivo viene de su entorno y se reemplaza por un doble.
 */
export const PROVISTOS = ["console", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "queueMicrotask", "structuredClone", "URL", "URLSearchParams", "TextEncoder", "TextDecoder", "atob", "btoa", "module", "exports", "require", "__dirname", "__filename"];

// Lo que existe DENTRO de un contexto aislado (no lo de Node: `fetch` o `process` no están ahí).
const DEL_LENGUAJE = new Set([
  ...(vm.runInNewContext("Object.getOwnPropertyNames(globalThis)") as string[]),
  "undefined", "NaN", "Infinity", "arguments", "this", "super",
  ...PROVISTOS,
]);

const DECLARA = /^(class_declaration|function_declaration|generator_function_declaration)$/;

export async function analizarScript(src: string, lang: LangSpec): Promise<Analisis> {
  const { root } = await parse(src, lang);
  const out: Analisis = { declaraciones: [], globales: [], esModulo: false };
  if (!root) return out;
  // 1. Primer nivel: lo que el archivo declara (y si es un módulo con import/export).
  for (const n of hijos(root)) {
    if (/^(import_statement|export_statement)$/.test(n.type)) out.esModulo = true;
    if (DECLARA.test(n.type)) {
      const nombre = n.childForFieldName("name")?.text;
      if (nombre) out.declaraciones.push(nombre);
    }
    if (/^(lexical_declaration|variable_declaration)$/.test(n.type))
      for (const d of hijos(n).filter((x) => x.type === "variable_declarator")) {
        const nombre = d.childForFieldName("name");
        if (nombre?.type === "identifier") out.declaraciones.push(nombre.text);
      }
  }
  // 2. Todo lo declarado en cualquier parte (parámetros, variables, funciones internas…).
  const declarados = new Set(out.declaraciones);
  const usados = new Set<string>();
  const walk = (n: SyntaxNode) => {
    if (n.type === "identifier") {
      const p = n.parent;
      const esDeclaracion =
        (p && /^(variable_declarator|function_declaration|class_declaration|method_definition|formal_parameters|required_parameter|optional_parameter|catch_clause|import_specifier|namespace_import|arrow_function|assignment_pattern|shorthand_property_identifier_pattern|object_pattern|array_pattern|rest_pattern|function_expression|class)$/.test(p.type)) ||
        (p?.type === "pair_pattern" && p.childForFieldName("value") === n);
      if (esDeclaracion) declarados.add(n.text);
      else usados.add(n.text);
    }
    for (const c of hijos(n)) walk(c);
  };
  walk(root);
  out.globales = [...usados].filter((x) => !declarados.has(x) && !DEL_LENGUAJE.has(x)).sort();
  return out;
}

/**
 * ¿Es una expresión de prueba aceptable sobre lo declarado en el archivo?
 *   `funcion(lit, …)` · `new Clase(lit…).metodo(lit, …)` · `Clase.estatico(lit, …)` · `objeto.metodo(lit, …)`
 */
export function validarExpresionAislada(expr: string, declaraciones: Set<string>): string | null {
  const e = expr.trim();
  const m = /^(?:new\s+([A-Za-z_$][\w$]*)\s*\((.*?)\)\s*\.\s*([A-Za-z_$][\w$]*)|([A-Za-z_$][\w$]*)(?:\s*\.\s*([A-Za-z_$][\w$]*))?)\s*\((.*)\)$/s.exec(e);
  if (!m) return "no es una llamada simple (funcion(...), new Clase().metodo(...) o Clase.metodo(...))";
  const raiz = m[1] ?? m[4]!;
  if (!declaraciones.has(raiz)) return `${raiz} no está declarado en el archivo`;
  // Lista blanca: toda la expresión queda cubierta por nombres declarados + listas de literales.
  for (const args of [m[2] ?? "", m[6] ?? ""]) if (!sonLiterales(args)) return "los argumentos deben ser valores literales (números, textos, true/false/null, listas u objetos de esos)";
  return null;
}

/** La raíz de la expresión ("Clase" en `new Clase().m()`). */
export const raizDe = (expr: string) => /^(?:new\s+)?([A-Za-z_$][\w$]*)/.exec(expr.trim())?.[1] ?? "";

/**
 * Programa (Node, sin dependencias) que carga el archivo aislado, ejecuta la expresión e imprime
 * `@@{ok, valor | error, dobles}`. Se corre en un proceso aparte con límite de tiempo.
 */
export function programaAislado(archivo: string, a: Analisis, expresion: string, dobles: Record<string, unknown>): string {
  return `import vm from "node:vm";
import fs from "node:fs";
const SRC = fs.readFileSync(${JSON.stringify(archivo)}, "utf8");
const DOBLES = ${JSON.stringify(dobles)};
const usados = new Set();
// Un "doble": acepta cualquier acceso o llamada y registra qué se usó; si el caso propuso un valor, lo devuelve.
const clave = (r) => r.replace(/^(window|globalThis|self)\\./, "");
function doble(ruta) {
  return new Proxy(function () {}, {
    get(_, k) {
      if (typeof k === "symbol" || k === "then") return undefined;
      if (k === "toString" || k === "valueOf") return () => "[doble " + ruta + "]";
      const r = clave(ruta + "." + k);
      usados.add(r);
      return r in DOBLES ? DOBLES[r] : doble(r);
    },
    apply(_, __, args) {
      const r = clave(ruta) + "(…)";
      usados.add(r);
      return r in DOBLES ? structuredClone(DOBLES[r]) : doble(r);
    },
    construct(_, args) {
      usados.add("new " + clave(ruta));
      return doble(clave(ruta) + "#instancia");
    },
  });
}
const ctx = vm.createContext({});
// Lo básico de cualquier entorno. La consola se crea DENTRO del contexto (sin objetos de Node a mano).
vm.runInContext("globalThis.console = { log() {}, info() {}, warn() {}, error() {}, debug() {} }; globalThis.module = { exports: {} }; globalThis.exports = module.exports;", ctx);
for (const k of ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "queueMicrotask", "structuredClone", "URL", "URLSearchParams", "TextEncoder", "TextDecoder", "atob", "btoa"]) ctx[k] = globalThis[k];
ctx.require = (m) => doble("require:" + m);
ctx.__filename = ${JSON.stringify(archivo)}; ctx.__dirname = ${JSON.stringify(archivo.replace(/[\\/][^\\/]*$/, ""))};
for (const g of ${JSON.stringify(a.globales.filter((g) => !/^(window|globalThis|self)$/.test(g)))}) ctx[g] = (g in DOBLES) ? DOBLES[g] : doble(g);
// window / globalThis / self: el mismo contexto; lo que no exista ahí, un doble.
const ventana = new Proxy(ctx, { get(t, k) { return k in t ? t[k] : (typeof k === "symbol" ? undefined : doble(String(k))); } });
ctx.window = ventana; ctx.self = ventana;
const salida = (o) => console.log("@@" + JSON.stringify({ ...o, dobles: [...usados].slice(0, 20) }));
try {
  // El archivo tal cual; lo declarado en el primer nivel queda a mano para la expresión.
  vm.runInContext(SRC + "\\n;globalThis.__cai = {" + ${JSON.stringify(a.declaraciones.map((d) => `${d}: typeof ${d} !== "undefined" ? ${d} : undefined`).join(", "))} + "};", ctx, { filename: ${JSON.stringify(archivo)}, timeout: 3000 });
  Object.assign(ctx, ctx.__cai);
} catch (e) {
  salida({ ok: false, infra: true, error: "no se pudo cargar el archivo aislado: " + String(e && e.message || e) });
  process.exit(0);
}
const _j = (v) => v === undefined ? "undefined" : typeof v === "function" ? "[función]" : typeof v === "number" && Number.isNaN(v) ? "NaN" : v === Infinity ? "Infinity" : v === -Infinity ? "-Infinity" : JSON.parse(JSON.stringify(v));
try {
  const v = await vm.runInContext(${JSON.stringify(expresion)}, ctx, { timeout: 3000 });
  salida({ ok: true, valor: _j(v), marcas: [...(ctx.__caiHits ?? [])] });
} catch (e) {
  salida({ ok: false, error: (e && e.name ? e.name + ": " : "") + String(e && e.message || e), marcas: [...(ctx.__caiHits ?? [])] });
}
`;
}

/**
 * Ayudante que se copia a la carpeta de tests (`_cai/aislado.mjs`): hace lo mismo que `programaAislado`
 * dentro de vitest, sin dependencias. Carga el archivo TAL CUAL (no hace falta exportar nada).
 */
export const AYUDANTE_AISLADO = `// Creado por ComplementAIry: carga un archivo tal cual en un contexto aislado (sin export) y
// reemplaza lo que usa de su entorno por "dobles" (los valores que indique cada test).
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const clave = (r) => r.replace(/^(window|globalThis|self)\\./, "");
function doble(ruta, dobles) {
  return new Proxy(function () {}, {
    get(_, k) {
      if (typeof k === "symbol" || k === "then") return undefined;
      if (k === "toString" || k === "valueOf") return () => "[doble " + ruta + "]";
      const r = clave(ruta + "." + k);
      return r in dobles ? dobles[r] : doble(r, dobles);
    },
    apply() {
      const r = clave(ruta) + "(…)";
      return r in dobles ? structuredClone(dobles[r]) : doble(r, dobles);
    },
    construct() {
      return doble(clave(ruta) + "#instancia", dobles);
    },
  });
}

/** Ejecuta \`expresion\` contra el archivo cargado aislado. Devuelve el valor (como JSON) o lanza su error. */
export async function ejecutarAislado(archivo, entorno, expresion, dobles = {}) {
  const ruta = archivo instanceof URL ? fileURLToPath(archivo) : archivo;
  const ctx = vm.createContext({});
  // Lo básico de cualquier entorno. La consola se crea DENTRO del contexto (sin objetos de Node a mano).
  vm.runInContext("globalThis.console = { log() {}, info() {}, warn() {}, error() {}, debug() {} }; globalThis.module = { exports: {} }; globalThis.exports = module.exports;", ctx);
  for (const k of ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "queueMicrotask", "structuredClone", "URL", "URLSearchParams", "TextEncoder", "TextDecoder", "atob", "btoa"]) ctx[k] = globalThis[k];
  ctx.require = (m) => doble("require:" + m, dobles);
  ctx.__filename = ruta;
  ctx.__dirname = path.dirname(ruta);
  for (const g of entorno.globales) if (!/^(window|globalThis|self)$/.test(g)) ctx[g] = g in dobles ? dobles[g] : doble(g, dobles);
  const ventana = new Proxy(ctx, { get: (t, k) => (k in t ? t[k] : typeof k === "symbol" ? undefined : doble(String(k), dobles)) });
  ctx.window = ventana;
  ctx.self = ventana;
  const expone = entorno.declaraciones.map((d) => d + ": typeof " + d + ' !== "undefined" ? ' + d + " : undefined").join(", ");
  vm.runInContext(fs.readFileSync(ruta, "utf8") + "\\n;globalThis.__cai = {" + expone + "};", ctx, { filename: ruta, timeout: 3000 });
  Object.assign(ctx, ctx.__cai);
  const v = await vm.runInContext(expresion, ctx, { timeout: 3000 });
  return v === undefined || typeof v === "function" ? v : JSON.parse(JSON.stringify(v));
}
`;
