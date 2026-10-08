import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse, type Comment } from "./comments.js";
import { langFor } from "./lang.js";
import { home } from "./profile.js";
import { eolOf } from "./render.js";
import { stripJsonc } from "./snippets.js";

/**
 * Biblioteca de snippets: el único código que entra a tus archivos "desde la IA" es código
 * que ya existe y que vos aprobaste (tus snippets o la base de estructuras muy conocidas).
 * La IA solo sugiere CUÁL usar (`@guia[..] snippet: nombre arg=valor`); la expansión es
 * determinista y la disparás vos.
 */

export interface Snippet {
  nombre: string;
  descripcion: string;
  scopes: string[];
  body: string[];
  origen: "proyecto" | "usuario" | "base";
  archivo: string;
}

const KIT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "kit", "snippets");

function leer(file: string, origen: Snippet["origen"]): Snippet[] {
  let data: Record<string, { prefix?: string | string[]; body?: string | string[]; description?: string; scope?: string }>;
  try {
    data = JSON.parse(stripJsonc(fs.readFileSync(file, "utf8"))) as typeof data;
  } catch {
    return [];
  }
  return Object.entries(data).flatMap(([key, v]) => {
    if (!v?.body) return [];
    const prefix = Array.isArray(v.prefix) ? v.prefix[0] : v.prefix;
    return [
      {
        nombre: prefix ?? key,
        descripcion: v.description ?? key,
        scopes: (v.scope ?? "").split(",").map((s) => s.trim()).filter(Boolean),
        body: Array.isArray(v.body) ? v.body : v.body.split("\n"),
        origen,
        archivo: file,
      },
    ];
  });
}

const archivosEn = (dir: string) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".code-snippets")).map((f) => path.join(dir, f)) : []);

/** Todos los snippets disponibles. Precedencia por nombre: proyecto > usuario > base. */
export function biblioteca(root: string): Snippet[] {
  const fuentes: [string, Snippet["origen"]][] = [
    ...archivosEn(path.join(root, ".vscode")).map((f): [string, Snippet["origen"]] => [f, /^(cai|aicode)-base\.code-snippets$/.test(path.basename(f)) ? "base" : "proyecto"]),
    ...archivosEn(path.join(home(), "snippets")).map((f): [string, Snippet["origen"]] => [f, "usuario"]),
  ];
  // La base que trae ComplementAIry siempre está (al final): la copia del proyecto la sobreescribe
  // por nombre, y los snippets base nuevos aparecen aunque el proyecto tenga una copia vieja.
  fuentes.push(...archivosEn(KIT).map((f): [string, Snippet["origen"]] => [f, "base"]));
  const orden = { proyecto: 0, usuario: 1, base: 2 };
  const out = new Map<string, Snippet>();
  // Mismo nombre en lenguajes distintos (p. ej. "test" de JS y de Python) son snippets distintos.
  const key = (s: Snippet) => `${s.nombre}|${[...s.scopes].sort().join(",")}`;
  for (const s of fuentes.flatMap(([f, o]) => leer(f, o)).sort((a, b) => orden[a.origen] - orden[b.origen])) if (!out.has(key(s))) out.set(key(s), s);
  return [...out.values()];
}

/** Ids de lenguaje de VSCode que corresponden a un lenguaje de ComplementAIry. */
const VSCODE_IDS: Record<string, string[]> = {
  typescript: ["typescript"],
  tsx: ["typescriptreact", "typescript"],
  javascript: ["javascript", "javascriptreact"],
  python: ["python"],
};

export function paraLenguaje(snippets: Snippet[], langId: string): Snippet[] {
  const ids = VSCODE_IDS[langId] ?? [langId];
  return snippets.filter((s) => !s.scopes.length || s.scopes.some((x) => ids.includes(x)));
}

/** `nombre arg=valor arg2="con espacios"` → { nombre, args } (el resto del texto se ignora). */
export function parseLlamada(texto: string): { nombre: string; args: Record<string, string> } | null {
  const m = /^\s*([\w.-]+)/.exec(texto);
  if (!m) return null;
  const args: Record<string, string> = {};
  for (const a of texto.slice(m[0].length).matchAll(/([\w-]+)=("([^"]*)"|'([^']*)'|[^\s]+)/g)) args[a[1]!] = a[3] ?? a[4] ?? a[2]!;
  return { nombre: m[1]!, args };
}

/**
 * Expande el cuerpo de un snippet. Un marcador `${1:metodo}` se reemplaza por el argumento
 * `metodo=...` si vino; si no, queda su texto por defecto.
 * - modo "texto": resultado final, sin marcadores (para la CLI).
 * - modo "vscode": conserva los marcadores con los valores ya puestos (tabulás entre ellos).
 */
export function expandir(body: string[], args: Record<string, string>, modo: "texto" | "vscode", archivo = ""): string {
  let s = body.join("\n");
  const esc = (v: string) => (modo === "vscode" ? v.replace(/[$}\\]/g, "\\$&") : v);
  // Elecciones ${1|a,b|}
  s = s.replace(/\$\{(\d+)\|([^|]*)\|\}/g, (_m, n: string, opts: string) => (modo === "vscode" ? `\${${n}|${opts}|}` : opts.split(",")[0]!));
  // Marcadores con valor por defecto (sin anidar).
  s = s.replace(/\$\{(\d+):([^${}]*)\}/g, (_m, n: string, def: string) => {
    const v = args[def] ?? def;
    return modo === "vscode" ? `\${${n}:${esc(v)}}` : v;
  });
  // Variables conocidas.
  const vars: Record<string, string> = { TM_FILENAME: path.basename(archivo), TM_FILENAME_BASE: path.basename(archivo).replace(/\.[^.]+$/, "") };
  s = s.replace(/\$\{?([A-Z_]+)\}?/g, (m, v: string) => (v in vars ? vars[v]! : modo === "vscode" ? m : ""));
  if (modo === "texto") s = s.replace(/\$\{\d+\}|\$\d+/g, "").replace(/\\([$}\\])/g, "$1").replace(/[ \t]+$/gm, "");
  return s;
}

// --- Expansión dentro de un archivo -------------------------------------------------

/** Pedido de snippet en un comentario: `@snippet: nombre args` (humano) o `@guia[id] snippet: nombre args` (sugerencia de la IA). */
export function pedidoDe(c: Comment): { texto: string; id: string | null; activo: boolean } | null {
  if (c.kind === "snippet") return { texto: c.content.replace(/^@snippet:?\s*/i, ""), id: null, activo: true };
  const m = /^@guia\[([\w.-]+)\] snippet(?:\s*\[([ xX✓])\])?:\s*(.*)$/s.exec(c.content);
  return m ? { texto: m[3]!, id: m[1]!, activo: !!m[2] && m[2] !== " " } : null;
}

export interface Expansion {
  /** Líneas (1-based, inclusivas) que se reemplazan. */
  desde: number;
  hasta: number;
  indent: string;
  texto: string;
  snippet: Snippet;
}

/** Unidad de indentación del archivo (tab o N espacios). */
function unidad(src: string): string {
  if (/^\t/m.test(src)) return "\t";
  const n = Math.min(...[...src.matchAll(/^( +)\S/gm)].map((m) => m[1]!.length).filter((x) => x > 0));
  return " ".repeat(Number.isFinite(n) ? n : 2);
}

/**
 * Calcula la expansión del pedido en `linea` (o de todos los `@snippet:` del humano si no hay línea).
 * Las sugerencias de la IA (`@guia ... snippet:`) solo se expanden si las elegís por línea: aceptarlas es tu acción.
 */
export async function planExpansion(
  root: string,
  rel: string,
  src: string,
  linea?: number,
  modo: "texto" | "vscode" = "texto",
  soloActivados = false,
): Promise<Expansion[]> {
  const lang = langFor(rel);
  if (!lang) throw new Error(`tipo de archivo sin soporte: ${rel}`);
  const { comments } = await parse(src, lang);
  const lib = paraLenguaje(biblioteca(root), lang.id);
  const lines = src.split(/\r?\n/);
  const tab = unidad(src);
  const out: Expansion[] = [];
  for (const c of comments) {
    const p = pedidoDe(c);
    if (!p) continue;
    // Sin línea: tus @snippet: y las sugerencias que activaste con [x]. Con línea: la que elegiste.
    if (linea !== undefined ? c.row + 1 !== linea : p.id !== null && !p.activo) continue;
    if (soloActivados && !(p.id !== null && p.activo)) continue;
    const llamada = parseLlamada(p.texto);
    if (!llamada) continue;
    const snip = lib.find((s) => s.nombre === llamada.nombre);
    if (!snip) {
      const parecidos = lib.filter((s) => s.nombre.includes(llamada.nombre) || llamada.nombre.includes(s.nombre)).map((s) => s.nombre);
      throw new Error(`no existe el snippet "${llamada.nombre}" para ${lang.id}. Disponibles: ${(parecidos.length ? parecidos : lib.map((s) => s.nombre)).join(", ")}`);
    }
    // Las líneas de continuación de la sugerencia (`@guia[id]   ...`) se van con ella.
    let hasta = c.row + 1;
    // Se van con la sugerencia todas sus líneas (continuaciones y "docs:") hasta el próximo ítem con tipo.
    if (p.id) {
      const mismo = new RegExp(`^\\s*\\S+\\s*@guia\\[${p.id.replace(/[.]/g, "\\.")}\\]`);
      const nuevoItem = new RegExp(`@guia\\[${p.id.replace(/[.]/g, "\\.")}\\] (?:pista|pieza|plano|pregunta|revision|ejemplo|nota|snippet)\\b`);
      while (hasta < lines.length && mismo.test(lines[hasta]!) && !nuevoItem.test(lines[hasta]!)) hasta++;
    }
    const indent = /^[ \t]*/.exec(lines[c.row]!)![0];
    const cuerpo = expandir(snip.body, llamada.args, modo, rel);
    const texto =
      modo === "vscode"
        ? cuerpo
        : cuerpo
            .split("\n")
            .map((l) => (l ? indent + l.replace(/^\t+/, (t) => tab.repeat(t.length)) : l))
            .join("\n");
    out.push({ desde: c.row + 1, hasta, indent, texto, snippet: snip });
  }
  return out;
}

/** Aplica las expansiones (modo texto) y devuelve el archivo nuevo. */
export function aplicarExpansion(src: string, exps: Expansion[]): string {
  const nl = eolOf(src);
  const lines = src.split(/\r?\n/);
  for (const e of [...exps].sort((a, b) => b.desde - a.desde)) lines.splice(e.desde - 1, e.hasta - e.desde + 1, ...e.texto.split("\n"));
  return lines.join(nl);
}
