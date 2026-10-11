import { parse, type Comment } from "./comments.js";
import type { LangSpec } from "./lang.js";

export interface Verdict {
  ok: boolean;
  reasons: string[];
}

/** Formato exacto de un comentario de la IA: `@guia[id] tipo: texto` o continuación `@guia[id]   texto`. */
const GUIA_FORMAT = /^@guia\[[\w.-]+\](?: (?:pista|pieza|pregunta|revision|ejemplo|plano|docs|nota|snippet \[ \]):(?:\s|$)| {2,}\S)/;

/**
 * Palabras que algunas herramientas interpretan como directivas aunque estén en medio de un
 * comentario (codificación de Python, noqa, pragmas, modelines, anotaciones de bundlers...).
 * Un comentario @guia que las contenga se rechaza; la CLI las neutraliza al escribir (sanitizeGuia).
 */
export const DIRECTIVES: RegExp[] = [
  /coding[:=]/i,
  /-\*-/,
  /\b(?:vim?|ex):/i,
  /@jsx/i,
  /@ts-/i,
  /\beslint[-\s]/i,
  /\btslint:/i,
  /\bjshint\b/i,
  /prettier-ignore/i,
  /\bistanbul\b/i,
  /\b[cv]8\s+ignore/i,
  /\bnoqa\b/i,
  /type:\s*ignore/i,
  /\b(?:pylint|pyright|mypy|ruff|isort|rubocop|yamllint|hadolint|shellcheck|nolint|deno-lint|biome-ignore)\b/i,
  /\bpragma\b/i,
  /frozen_string_literal/i,
  /\bgo:\w/i,
  /\+build\b/,
  /@(?:flow|license|preserve|refresh|format|prettier|vite-ignore|jest-environment|vitest-environment)\b/i,
  /__(?:PURE|NOINLINE|NO_SIDE_EFFECTS)__/,
  /source(?:Mapping)?URL/i,
  /webpack\w*/i,
  /\bfmt:\s*(?:off|on|skip)/i,
  /\b(?:syntax|escape|check)=/i,
  /#!/,
];

const WJ = "⁠"; // word joiner: invisible, rompe la coincidencia sin cambiar lo que se lee

/** Neutraliza directivas en texto que la CLI va a escribir como comentario @guia. */
export function sanitizeGuia(text: string): string {
  let out = text;
  for (const re of DIRECTIVES) {
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    out = out.replace(g, (m) => (m.length > 1 ? m[0] + WJ + m.slice(1) : m));
  }
  return out;
}

const preview = (s: string): string => (s.length > 80 ? s.slice(0, 77) + "..." : s);

type Placement = "lineas" | "final" | "invalida";

/** Un comentario @guia solo puede ocupar líneas completas o ir al final de una línea (sin saltos). */
function placement(src: string, c: Comment): { kind: Placement; from: number; to: number } {
  const lineStart = src.lastIndexOf("\n", c.start - 1) + 1;
  let lineEnd = src.indexOf("\n", c.end);
  if (lineEnd === -1) lineEnd = src.length;
  const before = src.slice(lineStart, c.start);
  const after = src.slice(c.end, lineEnd);
  if (before.trim() === "" && after.trim() === "") return { kind: "lineas", from: lineStart, to: Math.min(lineEnd + 1, src.length) };
  if (after.trim() === "" && !c.text.includes("\n")) {
    let s = c.start;
    while (s > lineStart && (src[s - 1] === " " || src[s - 1] === "\t")) s--;
    return { kind: "final", from: s, to: c.end };
  }
  return { kind: "invalida", from: c.start, to: c.end };
}

/** Texto sin los comentarios @guia bien ubicados. Nada más se normaliza. */
function stripGuia(src: string, comments: Comment[]): string {
  let out = src;
  for (const c of comments.filter((x) => x.kind === "guia").sort((a, b) => b.start - a.start)) {
    const p = placement(out, c);
    if (p.kind !== "invalida") out = out.slice(0, p.from) + out.slice(p.to);
  }
  return out;
}

function bag(comments: Comment[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of comments) m.set(c.text, (m.get(c.text) ?? 0) + 1);
  return m;
}

/**
 * Regla central de ComplementAIry, determinista: la IA solo puede agregar, cambiar o quitar comentarios
 * `@guia` que ocupen líneas completas (o el final de una línea). Todo lo demás —código, espacios,
 * líneas en blanco, comentarios del humano— tiene que quedar idéntico byte a byte.
 */
export async function verifyCommentOnly(before: string, after: string, lang: LangSpec): Promise<Verdict> {
  const reasons: string[] = [];
  const a = await parse(before, lang);
  const b = await parse(after, lang);

  // 1. Cada comentario @guia nuevo: formato, ubicación y contenido.
  const old = bag(a.comments.filter((c) => c.kind === "guia"));
  for (const c of b.comments) {
    if (c.kind !== "guia") continue;
    const n = old.get(c.text) ?? 0;
    if (n > 0) {
      old.set(c.text, n - 1);
      continue;
    }
    const p = placement(after, c);
    if (p.kind === "invalida") reasons.push(`un comentario @guia tiene que ocupar su propia línea o ir al final de una línea: ${JSON.stringify(preview(c.text))}`);
    if (!GUIA_FORMAT.test(c.content)) reasons.push(`formato inválido; usa "@guia[id] pista|pieza|pregunta|revision|ejemplo: texto": ${JSON.stringify(preview(c.content))}`);
    const directive = DIRECTIVES.find((re) => re.test(c.content));
    if (directive) reasons.push(`el comentario contiene algo que una herramienta podría interpretar como directiva (${directive.source}): ${JSON.stringify(preview(c.content))}`);
    if (/\\\s*$/.test(c.text)) reasons.push("un comentario no puede terminar en \\ (continuación de línea)");
    if (/@guia\[[^\]]*\]\s*snippet\s*\[[^ \]]/i.test(c.content)) reasons.push("activar un snippet ([x]) lo decide el humano; la IA solo lo sugiere apagado ([ ])");
  }

  // 2. Fuera de los @guia, todo idéntico.
  const codeA = stripGuia(before, a.comments);
  const codeB = stripGuia(after, b.comments);
  if (codeA !== codeB) {
    const othersA = bag(a.comments.filter((c) => c.kind !== "guia"));
    const othersB = bag(b.comments.filter((c) => c.kind !== "guia"));
    let humanChanged = false;
    for (const [k, v] of othersA) {
      if ((othersB.get(k) ?? 0) < v) {
        reasons.push(`no se pueden quitar ni modificar comentarios del humano: ${JSON.stringify(preview(k))}`);
        humanChanged = true;
      }
    }
    for (const [k, v] of othersB) {
      if ((othersA.get(k) ?? 0) < v) {
        reasons.push(`los comentarios nuevos deben empezar con @guia (directivas, doc-comments y otros quedan prohibidos): ${JSON.stringify(preview(k))}`);
        humanChanged = true;
      }
    }
    if (!humanChanged) {
      const la = codeA.split("\n");
      const lb = codeB.split("\n");
      let i = 0;
      while (i < la.length && i < lb.length && la[i] === lb[i]) i++;
      reasons.push(
        `cambió código o espacios, no solo comentarios @guia (primera diferencia: antes ${JSON.stringify(preview(la[i] ?? "<fin>"))}, después ${JSON.stringify(preview(lb[i] ?? "<fin>"))})`,
      );
    }
  }

  if (b.hasError && !a.hasError) reasons.push("el archivo resultante tiene errores de sintaxis que antes no tenía");
  return { ok: reasons.length === 0, reasons };
}
