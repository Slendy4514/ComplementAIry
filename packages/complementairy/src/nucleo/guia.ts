import { codeOnly, parse, type Comment, type CommentKind } from "./comments.js";
import { langFor } from "./lang.js";
import { findThreads } from "./threads.js";

/** Comentarios de conversación humano↔IA presentes en un texto. */
export async function conversation(file: string, src: string, kinds: CommentKind[] = ["guia", "ia", "yo"]): Promise<Comment[]> {
  const lang = langFor(file);
  if (!lang) return [];
  const { comments } = await parse(src, lang);
  const out = comments.filter((c) => kinds.includes(c.kind));
  // Las líneas de continuación de un mensaje humano (@ia? / @yo: en varias líneas) son parte de la conversación.
  if (kinds.includes("ia")) {
    for (const t of findThreads(src, comments)) for (const c of t.comments) if (c.kind === "otro" && !out.includes(c)) out.push(c);
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * Quita comentarios del texto. Si el comentario ocupa líneas enteras, se van las líneas;
 * si está al final de una línea de código, se quita junto con el espacio que lo precede.
 */
export function removeComments(src: string, remove: Comment[]): string {
  let out = src;
  for (const c of [...remove].sort((a, b) => b.start - a.start)) {
    const lineStart = out.lastIndexOf("\n", c.start - 1) + 1;
    let lineEnd = out.indexOf("\n", c.end);
    if (lineEnd === -1) lineEnd = out.length;
    const before = out.slice(lineStart, c.start);
    const after = out.slice(c.end, lineEnd);
    if (before.trim() === "" && after.trim() === "") {
      out = out.slice(0, lineStart) + out.slice(Math.min(lineEnd + 1, out.length));
    } else {
      let s = c.start;
      while (s > lineStart && (out[s - 1] === " " || out[s - 1] === "\t")) s--;
      out = out.slice(0, s) + out.slice(c.end);
    }
  }
  return out;
}

export async function cleanText(file: string, src: string, kinds: CommentKind[]): Promise<{ text: string; removed: number }> {
  const lang = langFor(file);
  if (!lang) return { text: src, removed: 0 };
  const found = await conversation(file, src, kinds);
  if (!found.length) return { text: src, removed: 0 };
  const text = removeComments(src, found);
  // Comprobación de seguridad: limpiar nunca debe tocar código.
  const a = await parse(src, lang);
  const b = await parse(text, lang);
  if (codeOnly(src, a.comments) !== codeOnly(text, b.comments)) {
    throw new Error(`limpiar ${file} habría cambiado código; no se tocó el archivo`);
  }
  return { text, removed: found.length };
}
