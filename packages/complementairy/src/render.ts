import type { Comment } from "./comments.js";
import type { LangSpec } from "./lang.js";
import { sanitizeGuia, verifyCommentOnly } from "./verify.js";

/** Fin de línea del archivo (respeta CRLF). */
export const eolOf = (src: string): string => (/\r\n/.test(src) ? "\r\n" : "\n");

export interface Reply {
  tipo: string;
  texto: string;
  links?: string[];
  /** Snippet en una sola línea, sin la ayuda de "Marca [x]..." (p. ej. casos de test en serie). */
  breve?: boolean;
}

const WIDTH = 100;

/**
 * Listas en líneas separadas: "Pasos: 1) a 2) b" → "Pasos:\n1) a\n2) b". También "- " y "N. " después
 * de una pausa (":", ".", ";"). Sirve para comentarios y para notas (markdown).
 */
export function separarListas(t: string): string {
  return t
    .replace(/\s+(?=\d{1,2}\)\s)/g, "\n")
    .replace(/(?<=[:.;!?])\s+(?=(?:\d{1,2}\.|[-•])\s)/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\n+/)) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (line && line.length + 1 + word.length > width) {
        out.push(line);
        line = word;
      } else line = line ? `${line} ${word}` : word;
    }
    if (line) out.push(line);
  }
  return out.length ? out : [""];
}

/**
 * Convierte una respuesta en comentarios del lenguaje. Cada línea es un comentario
 * independiente que empieza con `@guia[id]`, así la regla "solo comentarios @guia" se cumple
 * línea por línea y `guia clean` puede borrarlos sin ambigüedad.
 */
export function renderReply(lang: LangSpec, indent: string, id: string, r: Reply): string[] {
  // Un snippet: la llamada va entera en la primera línea (es lo que se expande); la explicación, debajo.
  if (r.tipo === "snippet" && lang.line) {
    const [llamada, ...resto] = r.texto.split(/\s+—\s+|\s+--\s+/);
    const first = `${indent}${lang.line} @guia[${id}] snippet [ ]: ${sanitizeGuia(llamada!.replace(/\s+/g, " ").trim())}`;
    if (r.breve) return [first];
    const ayuda = `${resto.join(" — ")}${resto.length ? " " : ""}(Marca [x] para usarlo; puedes cambiar los valores o preguntar con @ia? debajo.)`;
    const extra = renderReply(lang, indent, id, { tipo: "x", texto: ayuda, links: r.links ?? [] }).map((l, i) => (i === 0 ? l.replace(`@guia[${id}] x:`, `@guia[${id}]  `) : l));
    return [first, ...extra];
  }
  const head = `@guia[${id}] ${r.tipo}:`;
  const body = wrap(sanitizeGuia(separarListas(r.texto).replace(/-->|\*\/|\\\s*$/g, "—")), WIDTH - indent.length - head.length).map((l) => l.replace(/\\$/, "\\ "));
  // Links: solo http(s) sin caracteres que puedan cerrar un comentario.
  const links = (r.links ?? []).filter((l) => /^https?:\/\/\S+$/.test(l) && !/\*\/|-->|\\$/.test(l)).map(sanitizeGuia);
  if (lang.line) {
    const lines = body.map((b, i) => `${indent}${lang.line} ${i === 0 ? head : `@guia[${id}]  `} ${b}`.trimEnd());
    for (const l of links) lines.push(`${indent}${lang.line} @guia[${id}] docs: ${l}`);
    return lines;
  }
  const [open, close] = lang.block!;
  const inner = [...body, ...links.map((l) => `docs: ${l}`)];
  if (inner.length === 1) return [`${indent}${open} ${head} ${inner[0]} ${close}`];
  return [`${indent}${open} ${head} ${inner[0]}`, ...inner.slice(1).map((l) => `${indent}  ${l}`), `${indent}${close}`];
}

/** Indentación de la línea donde está el comentario. */
export function indentAt(src: string, c: Comment): string {
  const lineStart = src.lastIndexOf("\n", c.start - 1) + 1;
  const m = /^[ \t]*/.exec(src.slice(lineStart));
  return m ? m[0] : "";
}

/** Inserta líneas debajo de la línea donde termina `after`. */
export function insertBelow(src: string, after: Comment, lines: string[]): string {
  const nl = eolOf(src);
  let eol = src.indexOf("\n", after.end);
  if (eol === -1) return src + nl + lines.join(nl) + nl;
  eol += 1;
  return src.slice(0, eol) + lines.join(nl) + nl + src.slice(eol);
}

/** Inserta comentarios encima de `line` (1-based) con su indentación; null si eso tocaría código. */
export async function insertAboveLine(src: string, lang: LangSpec, line: number, block: string[]): Promise<string | null> {
  const nl = eolOf(src);
  const lines = src.split(nl);
  if (line < 1 || line > lines.length) return null;
  const indent = /^[ \t]*/.exec(lines[line - 1]!)![0];
  const next = [...lines.slice(0, line - 1), ...block.map((b) => indent + b.trimStart()), ...lines.slice(line - 1)].join(nl);
  return (await verifyCommentOnly(src, next, lang)).ok ? next : null;
}
