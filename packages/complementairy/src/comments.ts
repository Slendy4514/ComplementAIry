import type { LangSpec } from "./lang.js";
import { getParser, hijos, type SyntaxNode } from "./parser.js";

export type CommentKind = "guia" | "ia" | "yo" | "snippet" | "otro";

export interface Comment {
  /** Offsets en unidades UTF-16 (sirven directo con String.slice). */
  start: number;
  end: number;
  text: string;
  /** Texto sin los delimitadores (`//`, `#`, `/* *\/`, `<!-- -->`, `--`). */
  content: string;
  kind: CommentKind;
  /** Fila (0-based) donde empieza. */
  row: number;
}

export interface Parsed {
  comments: Comment[];
  /** El parser encontró errores de sintaxis (solo lenguajes con gramática). */
  hasError: boolean;
  root: SyntaxNode | null;
}

const OPENERS = ["<!--", "/*", "//", "--", "#", ";"];
const CLOSERS = ["-->", "*/"];

/** Quita exactamente un delimitador de apertura (y cierre). `/** x` queda como `* x`: así un doc-comment nunca pasa por @guia. */
export function commentContent(text: string): string {
  let s = text;
  const open = OPENERS.find((o) => s.startsWith(o));
  if (open) s = s.slice(open.length);
  const close = CLOSERS.find((c) => s.endsWith(c));
  if (close) s = s.slice(0, -close.length);
  return s.trim();
}

export function kindOf(content: string): CommentKind {
  if (content.startsWith("@guia")) return "guia";
  if (content.startsWith("@ia?")) return "ia";
  if (content.startsWith("@yo:")) return "yo";
  if (/^@snippet\b/i.test(content)) return "snippet";
  return "otro";
}

function mk(src: string, start: number, end: number, row: number): Comment {
  const text = src.slice(start, end);
  const content = commentContent(text);
  return { start, end, text, content, kind: kindOf(content), row };
}

export async function parse(src: string, lang: LangSpec): Promise<Parsed> {
  if (!lang.grammar) return { comments: scanComments(src, lang), hasError: false, root: null };
  const parser = await getParser(lang.grammar);
  const tree = parser.parse(src);
  if (!tree) throw new Error(`no pude analizar el archivo (${lang.id}): el analizador no devolvió un árbol`);
  const comments: Comment[] = [];
  const walk = (n: SyntaxNode): void => {
    if (n.type.includes("comment")) {
      // En algunas gramáticas (rust) el comentario tiene hijos; tomamos el nodo completo.
      comments.push(mk(src, n.startIndex, n.endIndex, n.startPosition.row));
      return;
    }
    for (const c of hijos(n)) walk(c);
  };
  walk(tree.rootNode);
  // Python/bash: los comentarios de bloque se cierran con salto de línea; normalizamos.
  for (const c of comments) {
    if (c.text.endsWith("\n")) {
      c.end -= 1;
      c.text = c.text.slice(0, -1);
    }
  }
  return { comments, hasError: tree.rootNode.hasError, root: tree.rootNode };
}

/**
 * Analizador simple para lenguajes sin gramática (Dockerfile, SQL, Markdown).
 * - Dockerfile: solo `#` al inicio de línea (en otro lugar es texto del comando).
 * - SQL: `--` y `/* *\/` fuera de comillas simples.
 * - Markdown: `<!-- -->`.
 */
export function scanComments(src: string, lang: LangSpec): Comment[] {
  const out: Comment[] = [];
  const lineAtStartOnly = lang.id === "dockerfile";
  const quotes = lang.id === "sql" ? "'\"" : "";
  let i = 0;
  let row = 0;
  let lineStart = true;
  let quote: string | null = null;
  const push = (a: number, b: number) => {
    out.push(mk(src, a, b, row));
    for (let k = a; k < b; k++) if (src.charCodeAt(k) === 10) row++;
  };
  /** Salta hasta el final de la línea que contiene `j` (sin consumir el \n). */
  const skipTo = (j: number) => {
    for (let k = i; k < j; k++) if (src.charCodeAt(k) === 10) row++;
    i = j;
  };
  while (i < src.length) {
    const ch = src[i]!;
    if (quote) {
      if (src.startsWith(quote, i)) {
        i += quote.length;
        quote = null;
      } else {
        if (ch === "\n") row++;
        i++;
      }
      continue;
    }
    if (ch === "\n") {
      lineStart = true;
      row++;
      i++;
      continue;
    }
    if (lineStart && (ch === " " || ch === "\t")) {
      i++;
      continue;
    }
    // Markdown: los bloques de código cercados (``` o ~~~) son contenido, no comentarios.
    if (lang.id === "markdown" && lineStart && /^(`{3,}|~{3,})/.test(src.slice(i, i + 3))) {
      const fence = /^(`{3,}|~{3,})/.exec(src.slice(i))![1]!;
      const close = src.indexOf("\n" + fence[0]!.repeat(3), i + fence.length);
      let j = close === -1 ? src.length : src.indexOf("\n", close + 1 + fence.length);
      if (j === -1) j = src.length;
      skipTo(j);
      lineStart = false;
      continue;
    }
    // Dockerfile: el cuerpo de un heredoc (RUN <<EOF ... EOF) es contenido.
    if (lang.id === "dockerfile" && lineStart) {
      let eol = src.indexOf("\n", i);
      if (eol === -1) eol = src.length;
      const m = /<<-?\s*["']?(\w+)["']?/.exec(src.slice(i, eol));
      if (m && !src.slice(i, eol).trimStart().startsWith("#")) {
        const re = new RegExp(`\\n[ \\t]*${m[1]}[ \\t]*(\\n|$)`, "g");
        re.lastIndex = eol;
        const end = re.exec(src);
        skipTo(end ? end.index + end[0].length - (end[0].endsWith("\n") ? 1 : 0) : src.length);
        lineStart = false;
        continue;
      }
    }
    // SQL: strings entre comillas y dollar-quoting de Postgres ($$ ... $$, $tag$ ... $tag$).
    if (lang.id === "sql" && ch === "$") {
      const m = /^\$(\w*)\$/.exec(src.slice(i, i + 64));
      if (m) {
        quote = m[0];
        i += m[0].length;
        lineStart = false;
        continue;
      }
    }
    if (quotes.includes(ch)) {
      quote = ch;
      i++;
      lineStart = false;
      continue;
    }
    if (lang.line && src.startsWith(lang.line, i) && (!lineAtStartOnly || lineStart)) {
      let j = src.indexOf("\n", i);
      if (j === -1) j = src.length;
      push(i, j);
      i = j;
      continue;
    }
    if (lang.block && src.startsWith(lang.block[0], i)) {
      const close = src.indexOf(lang.block[1], i + lang.block[0].length);
      const j = close === -1 ? src.length : close + lang.block[1].length;
      push(i, j);
      i = j;
      lineStart = false;
      continue;
    }
    lineStart = false;
    i++;
  }
  return out;
}

/**
 * El "código" de un archivo: el texto sin comentarios, sin espacios finales y sin líneas vacías.
 * Dos archivos con el mismo código solo difieren en comentarios y líneas en blanco.
 */
export function codeOnly(src: string, comments: Comment[]): string {
  let out = "";
  let last = 0;
  for (const c of [...comments].sort((a, b) => a.start - b.start)) {
    out += src.slice(last, c.start);
    last = c.end;
  }
  out += src.slice(last);
  return out
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0)
    .join("\n");
}
