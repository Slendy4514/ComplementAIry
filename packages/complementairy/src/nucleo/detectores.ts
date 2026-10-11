/**
 * Detectores de lo que la IA suele pasar por alto (manifiesto V.5, II.2 y VI.1). Sin IA: tree-sitter.
 * Cada hallazgo exige un test tuyo o un "no aplica porque…" (con tus palabras) antes de cerrar la tarea.
 *
 *  carrera         estado compartido (variable de módulo o `this.x`) modificado después de un `await`
 *  promesa-escribe Promise.all/allSettled cuyos callbacks escriben estado compartido
 *  timer           setTimeout/setInterval sin guardar el id (no se puede cancelar: debounce roto)
 *  fetch-bucle     fetch/axios dentro de un bucle o un map sin limitador (rate limiting)
 *  cache           un Map/objeto usado como caché (get/set o has/set) sin delete/clear/TTL (invalidación)
 *  anidado         bucle dentro de bucle o búsqueda (find/includes/indexOf) dentro de un bucle → escalabilidad (II.2)
 *  estructura      Map/Set/WeakMap/árbol nuevo → explica por qué esa estructura (II.2)
 *  seguridad       APIs de seguridad (crypto, bcrypt, jwt, eval, child_process) → decisión o línea roja (VI.1)
 */
import type { LangSpec } from "./lang.js";
import { getParser, nombrados, type SyntaxNode } from "./parser.js";

export type TipoHallazgo = "carrera" | "promesa-escribe" | "timer" | "fetch-bucle" | "cache" | "anidado" | "estructura" | "seguridad";

export interface Hallazgo {
  tipo: TipoHallazgo;
  linea: number;
  funcion?: string;
  texto: string;
  /** Clave estable (tipo + función + huella del fragmento) para recordar cómo lo resolviste. */
  clave: string;
}

export const QUE_PIDE: Record<TipoHallazgo, string> = {
  carrera: "un test con dos llamadas concurrentes (o «no aplica porque…»)",
  "promesa-escribe": "un test que corra las promesas en paralelo y verifique el estado final",
  timer: "guardar el id del temporizador y cancelarlo (o explicar por qué no hace falta)",
  "fetch-bucle": "un limitador de pedidos (o explicar el volumen esperado)",
  cache: "cómo se invalida la caché (delete/clear/TTL) o por qué no hace falta",
  anidado: "tu predicción de cuánto tarda con 10× datos (se mide ejecutando)",
  estructura: "por qué esta estructura de datos y no otra, con tus palabras",
  seguridad: "una decisión (o marcar la carpeta como línea roja: la IA no escribe seguridad)",
};

const BUCLE = /^(for_statement|for_in_statement|for_of_statement|while_statement|do_statement)$/;
const FUNC = /^(function_declaration|function_definition|method_definition|arrow_function|function_expression|generator_function_declaration)$/;
const ITERA = /\.(map|forEach|filter|reduce|flatMap|some|every)$/;
const BUSCA = /\.(find|findIndex|includes|indexOf|filter|some)$/;

const callee = (n: SyntaxNode) => (n.childForFieldName("function")?.text ?? "").replace(/\s+/g, "");
const huella = (t: string) => {
  let h = 0;
  for (const c of t.replace(/\s+/g, "")) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0;
  return (h >>> 0).toString(36);
};

function funcionDe(n: SyntaxNode): SyntaxNode | null {
  for (let p = n.parent; p; p = p.parent) if (FUNC.test(p.type)) return p;
  return null;
}
function nombreFuncion(f: SyntaxNode | null): string | undefined {
  if (!f) return undefined;
  return f.childForFieldName("name")?.text ?? (f.parent?.type === "variable_declarator" ? f.parent.childForFieldName("name")?.text : undefined);
}
function dentroDeBucle(n: SyntaxNode, hasta: SyntaxNode | null): boolean {
  for (let p = n.parent; p && p !== hasta; p = p.parent) {
    if (BUCLE.test(p.type)) return true;
    if (p.type === "call_expression" && ITERA.test(callee(p))) return true;
    if (FUNC.test(p.type) && p.parent?.type !== "arguments") return false;
  }
  return false;
}

/** Nombres declarados al nivel del módulo (estado compartido). */
function globalesDeModulo(root: SyntaxNode): Set<string> {
  const out = new Set<string>();
  for (const c of nombrados(root)) {
    const decl = c.type === "export_statement" ? nombrados(c)[0] : c;
    if (decl && /^(lexical_declaration|variable_declaration)$/.test(decl.type) && /^\s*(let|var)\b/.test(decl.text))
      for (const d of nombrados(decl)) if (d.type === "variable_declarator") out.add(d.childForFieldName("name")?.text ?? "");
  }
  out.delete("");
  return out;
}

export async function detectar(src: string, lang: LangSpec): Promise<Hallazgo[]> {
  if (!lang.grammar || !["typescript", "tsx", "javascript"].includes(lang.id)) return detectarPython(src, lang);
  const parser = await getParser(lang.grammar);
  const tree = parser.parse(src);
  if (!tree) return [];
  const raiz = tree.rootNode;
  const globales = globalesDeModulo(raiz);
  const out: Hallazgo[] = [];
  const add = (tipo: TipoHallazgo, n: SyntaxNode, texto: string) => {
    const f = funcionDe(n);
    const funcion = nombreFuncion(f);
    out.push({ tipo, linea: n.startPosition.row + 1, ...(funcion ? { funcion } : {}), texto, clave: `${tipo}:${funcion ?? "-"}:${huella(n.text.slice(0, 200))}` });
  };
  const escribeCompartido = (n: SyntaxNode) => {
    if (n.type !== "assignment_expression" && n.type !== "augmented_assignment_expression" && n.type !== "update_expression") return null;
    const izq = (n.childForFieldName("left") ?? n.childForFieldName("argument") ?? nombrados(n)[0])?.text ?? "";
    const base = izq.split(/[.[]/)[0] ?? "";
    return globales.has(base) || izq.startsWith("this.") ? izq : null;
  };
  const cacheVars = new Map<string, { n: SyntaxNode; get: boolean; set: boolean; borra: boolean }>();
  const visitar = (n: SyntaxNode) => {
    const t = n.type;
    // carrera: escritura de estado compartido después de un await en la misma función async
    const w = escribeCompartido(n);
    if (w) {
      const f = funcionDe(n);
      if (f && /^\s*(export\s+)?(async|.*\basync\b)/.test(f.text.slice(0, 40))) {
        const antes = f.text.slice(0, n.startIndex - f.startIndex);
        if (/\bawait\b/.test(antes)) add("carrera", n, `«${w}» se modifica después de un await: otra llamada puede intercalarse`);
      }
    }
    if (t === "call_expression") {
      const c = callee(n);
      if (/^Promise\.(all|allSettled)$/.test(c)) {
        const escribe: string[] = [];
        const buscar = (x: SyntaxNode) => {
          const e = escribeCompartido(x);
          if (e) escribe.push(e);
          for (const y of nombrados(x)) buscar(y);
        };
        buscar(n);
        if (escribe.length) add("promesa-escribe", n, `promesas en paralelo que escriben ${[...new Set(escribe)].join(", ")}`);
      }
      if (/^(setTimeout|setInterval)$/.test(c)) {
        const p = n.parent;
        const guardado = p && (p.type === "variable_declarator" || p.type === "assignment_expression" || p.type === "return_statement" || p.type === "arrow_function");
        if (!guardado) add("timer", n, `${c} sin guardar su id: no se puede cancelar (debounce/limpieza)`);
      }
      if (/^(fetch|axios(\.\w+)?|got|http\.request|https\.request)$/.test(c) && dentroDeBucle(n, null) && !/limit|throttle|pLimit|queue|semaphore/i.test(funcionDe(n)?.text ?? "")) add("fetch-bucle", n, `${c} dentro de un bucle sin limitador`);
      if (BUSCA.test(c) && dentroDeBucle(n, null)) add("anidado", n, `búsqueda ${c.split(".").pop()} dentro de un bucle (crece con n²)`);
      const m = /^([\w$]+)\.(get|has|set|delete|clear)$/.exec(c);
      if (m) {
        const v = cacheVars.get(m[1]!) ?? { n, get: false, set: false, borra: false };
        if (m[2] === "get" || m[2] === "has") v.get = true;
        if (m[2] === "set") v.set = true;
        if (m[2] === "delete" || m[2] === "clear") v.borra = true;
        cacheVars.set(m[1]!, v);
      }
      if (/^(eval|Function|exec|execSync|spawn|crypto\.\w+|bcrypt\.\w+|jwt\.\w+|jsonwebtoken\.\w+|createHash|createCipheriv|randomBytes)$/.test(c)) add("seguridad", n, `${c}: código de seguridad o ejecución`);
    }
    if (t === "new_expression") {
      const c = n.childForFieldName("constructor")?.text ?? "";
      if (/^(Map|Set|WeakMap|WeakSet)$/.test(c)) add("estructura", n, `nueva estructura ${c}`);
      if (c === "Function") add("seguridad", n, "new Function: ejecuta código armado en tiempo de ejecución");
    }
    if (BUCLE.test(t)) {
      const cuerpo = n.childForFieldName("body");
      if (cuerpo) {
        let interno: SyntaxNode | null = null;
        const buscar = (x: SyntaxNode) => {
          if (interno) return;
          if (x !== n && BUCLE.test(x.type)) interno = x;
          else if (!FUNC.test(x.type)) for (const y of nombrados(x)) buscar(y);
        };
        buscar(cuerpo);
        if (interno) add("anidado", n, "bucle dentro de bucle (crece con n²)");
      }
    }
    for (const c of nombrados(n)) visitar(c);
  };
  visitar(raiz);
  for (const [nombre, v] of cacheVars) if (v.get && v.set && !v.borra && /cache|cach[eé]|memo|store/i.test(nombre + (funcionDe(v.n)?.text.slice(0, 80) ?? "") ) ) add("cache", v.n, `«${nombre}» funciona como caché sin invalidación (delete/clear/TTL)`);
  for (const [nombre, v] of cacheVars) if (v.get && v.set && !v.borra && !/cache|cach[eé]|memo|store/i.test(nombre) && globales.has(nombre)) add("cache", v.n, `«${nombre}» (de módulo) guarda resultados sin invalidación`);
  tree.delete();
  // Un hallazgo por clave.
  const vistos = new Set<string>();
  return out.filter((h) => !vistos.has(h.clave) && vistos.add(h.clave));
}

/** Python: detección por patrones de línea (mismo contrato, menos preciso). */
function detectarPython(src: string, lang: LangSpec): Hallazgo[] {
  if (lang.id !== "python") return [];
  const out: Hallazgo[] = [];
  const lineas = src.split("\n");
  let enAsync = false;
  let vioAwait = false;
  let profBucle: number[] = [];
  lineas.forEach((l, i) => {
    const ind = l.length - l.trimStart().length;
    profBucle = profBucle.filter((p) => p < ind);
    if (/^\s*async\s+def\b/.test(l)) {
      enAsync = true;
      vioAwait = false;
    } else if (/^\s*def\b/.test(l)) enAsync = false;
    if (enAsync && /\bawait\b/.test(l)) vioAwait = true;
    const h = (tipo: TipoHallazgo, texto: string) => out.push({ tipo, linea: i + 1, texto, clave: `${tipo}:${i}:${l.trim().slice(0, 40)}` });
    if (enAsync && vioAwait && /^\s*(self\.\w+|global\s+\w+|\w+\[[^\]]+\])\s*[+\-*/]?=/.test(l)) h("carrera", "estado compartido modificado después de un await");
    if (/^\s*(for|while)\b/.test(l)) {
      if (profBucle.length) h("anidado", "bucle dentro de bucle (crece con n²)");
      profBucle.push(ind);
    }
    if (profBucle.length && /\b(requests|httpx|aiohttp)\.\w+\(/.test(l)) h("fetch-bucle", "pedido HTTP dentro de un bucle sin limitador");
    if (/\b(hashlib|bcrypt|jwt|cryptography|subprocess|eval|exec)\b/.test(l)) h("seguridad", "código de seguridad o ejecución");
    if (/@(functools\.)?(lru_cache|cache)\b/.test(l)) h("cache", "caché sin invalidación explícita");
  });
  return out;
}
