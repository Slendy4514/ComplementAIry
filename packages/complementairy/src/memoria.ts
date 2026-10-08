/**
 * Formato de .cai/conocimiento.md (la memoria del proyecto), sin dependencias: lo usa también el
 * hook que decide si un comando de cai corrido desde el chat puede conservar lo que escribió.
 */

export interface Memoria {
  respondidas: string[];
  abiertas: { p: string; r: string }[];
  notas: string;
}

/** Quita la respuesta sugerida del final de una pregunta: "¿DB? (sugerencia: SQLite (simple))" → "¿DB?". */
export const sinSugerencia = (p: string) => p.replace(/\s*\(sugerencia: .*\)\s*$/, "");
export const sugerenciaDe = (p: string) => /\s*\(sugerencia: (.*)\)\s*$/.exec(p)?.[1] ?? "";
/** Una sola línea: el formato "- P: … / R: …" de la memoria no admite saltos de línea ni títulos. */
export const unaLinea = (t: string) => t.replace(/\s*\n[\s#]*/g, " ").replace(/^#+\s*/, "").trim();

export function parseMemoria(txt: string): Memoria {
  const m: Memoria = { respondidas: [], abiertas: [], notas: "" };
  if (!txt) return m;
  const seccion = (t: string) => new RegExp(`^## ${t}\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, "m").exec(txt)?.[1] ?? "";
  m.notas = seccion("Notas tuyas").replace(/<!--[\s\S]*?-->/g, "").trim();
  for (const l of seccion("Lo que me contaste").split("\n")) if (/^- /.test(l)) m.respondidas.push(l.slice(2).trim());
  const abiertas = seccion("Preguntas abiertas");
  for (const mm of abiertas.matchAll(/^- P: (.+)\n(?:\s+R: ?(.*))?/gm)) m.abiertas.push({ p: mm[1]!.trim(), r: (mm[2] ?? "").trim() });
  return m;
}

/** Agrega preguntas nuevas sin repetir las abiertas ni las ya respondidas (como mucho 6 abiertas). */
export function agregarPreguntas(m: Memoria, preguntas: string[]): void {
  for (const p of preguntas) {
    const base = sinSugerencia(p);
    if (m.abiertas.some((a) => sinSugerencia(a.p) === base) || m.respondidas.some((r) => r.startsWith(`${base} →`))) continue;
    if (m.abiertas.length < 6) m.abiertas.push({ p, r: "" });
  }
}

