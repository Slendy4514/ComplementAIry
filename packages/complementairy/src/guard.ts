import { hijos, type SyntaxNode } from "./parser.js";
import type { Reply } from "./render.js";

/**
 * Controles deterministas sobre lo que responde la IA. No le preguntamos a la IA si
 * respetó las reglas: lo medimos.
 */

/** Líneas que parecen código (terminan en ; { }, tienen =>, asignaciones, llamadas encadenadas...). */
function codeLines(text: string): number {
  return text
    .split(/\n/)
    .filter((l) => /[;{}]\s*$|=>|^\s*(return|const|let|var|def|if|for|while|import|from)\b.*[=(:]|\w+\s*=\s*[\w"'(\[]|`[^`]*\(.*\)[^`]*`/.test(l))
    .length;
}

/**
 * Fragmentos de código en línea (`...`) que son más que una expresión suelta: varias sentencias,
 * bloques, funciones flecha o control de flujo. Una pieza como `Number.isInteger(x)` es válida;
 * `if (...) { throw ...; }` es una solución.
 */
export function inlineSolutions(text: string): string[] {
  return [...text.matchAll(/`([^`]+)`/g)]
    .map((m) => m[1]!)
    .filter((code) => {
      const marks =
        (code.match(/;/g)?.length ?? 0) +
        (code.match(/[{}]/g)?.length ?? 0) / 2 +
        (code.match(/=>/g)?.length ?? 0) +
        (code.match(/\b(return|throw|const|let|var|if|else|for|while|def|raise)\b/g)?.length ?? 0);
      return marks >= 2;
    });
}

const STOP = new Set(
  (
    "the and for with that this from return const let var function def class if else while true false null none " +
    "undefined new self this string number boolean int float str list dict map set array object error value values " +
    "result results data item items key keys len print console log math json type types async await import export " +
    "default public private static void main args true false"
  ).split(/\s+/),
);

/** Identificadores propios del archivo del usuario (nombres de variables, funciones, campos). */
export function fileIdentifiers(root: SyntaxNode | null, src: string): Set<string> {
  const out = new Set<string>();
  if (root) {
    const walk = (n: SyntaxNode) => {
      if (n.childCount === 0 && /identifier|name$/.test(n.type)) out.add(n.text);
      for (const c of hijos(n)) walk(c);
    };
    walk(root);
  } else {
    for (const m of src.matchAll(/[A-Za-z_][A-Za-z0-9_]{2,}/g)) out.add(m[0]);
  }
  return new Set([...out].filter((w) => w.length >= 3 && !STOP.has(w.toLowerCase())));
}

/** Qué fracción de los identificadores de un ejemplo vienen del código del usuario. */
export function overlap(example: string, userIds: Set<string>): { ratio: number; shared: string[] } {
  const ids = new Set([...example.matchAll(/[A-Za-z_][A-Za-z0-9_]{2,}/g)].map((m) => m[0]).filter((w) => !STOP.has(w.toLowerCase())));
  const shared = [...ids].filter((w) => userIds.has(w));
  return { ratio: ids.size ? shared.length / ids.size : 0, shared };
}

export interface GuardResult {
  ok: Reply[];
  rejected: { reply: Reply; why: string }[];
}

/**
 * - Niveles 1–2: nada de código (como mucho una expresión suelta).
 * - Nivel 3: pseudocódigo; se tolera algo más, pero no un bloque de código real.
 * - Ejemplos solo en nivel 4 y sin reutilizar los nombres del usuario (no copiable).
 */
export function guardReplies(replies: Reply[], level: number, userIds: Set<string>): GuardResult {
  const res: GuardResult = { ok: [], rejected: [] };
  for (const r of replies) {
    const fence = /```/.test(r.texto);
    const inline = inlineSolutions(r.texto);
    const n = codeLines(r.texto) + inline.length;
    if (r.tipo === "ejemplo") {
      if (level < 4) {
        res.rejected.push({ reply: r, why: `un ejemplo es nivel 4 y el permitido es ${level}` });
        continue;
      }
      const o = overlap(r.texto, userIds);
      if (o.shared.length >= 3 && o.ratio > 0.3) {
        res.rejected.push({ reply: r, why: `el ejemplo reutiliza nombres del código del usuario (${o.shared.join(", ")}): sería copiable` });
        continue;
      }
    } else if ((r.tipo === "plano" || r.tipo === "snippet") && (fence || inline.length > 0)) {
      res.rejected.push({ reply: r, why: `un ${r.tipo} describe la estructura en palabras, sin código` });
      continue;
    } else if (r.tipo === "plano" || r.tipo === "snippet") {
      // estructura en palabras: firmas y nombres permitidos
    } else if (level <= 2 && (fence || n > 1)) {
      res.rejected.push({ reply: r, why: `en nivel ${level} no va código (${n} líneas parecen código)` });
      continue;
    } else if (level === 3 && (fence || n > 3)) {
      res.rejected.push({ reply: r, why: "en nivel 3 va pseudocódigo en palabras, no código" });
      continue;
    }
    res.ok.push(r);
  }
  return res;
}
