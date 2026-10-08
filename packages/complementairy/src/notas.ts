import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./config.js";

/**
 * Notas: lo que dice la IA, guardado aparte del código (.cai/notas/<archivo>.json).
 * La extensión las muestra como hilos de VSCode en la línea exacta; el archivo no se toca.
 * Se re-anclan solas (sin IA) por el texto de la línea y el nombre de la función.
 */

export interface Mensaje {
  quien: "tu" | "ia";
  texto: string;
  fecha: string;
}

export interface Snippet {
  /** "nombre clave=valor ..." (se valida contra la biblioteca antes de guardarse). */
  llamada: string;
  /** Texto de la línea DESPUÉS de la cual va el snippet (dentro de la función). Vacío = después del ancla. */
  despues: string;
}

export interface Nota {
  id: string;
  archivo: string;
  ancla: { linea: number; texto: string; funcion?: string };
  tipo: string;
  titulo: string;
  accion: string;
  hilo: Mensaje[];
  snippets: Snippet[];
  bloqueante: boolean;
  estado: "abierta" | "resuelta";
  origen: string;
  /** Para no duplicar: de dónde salió (p. ej. el texto de un @ia? del archivo). */
  fuente?: string;
  /** Predicción "¿qué devuelve...?" que se comprueba ejecutando el código. */
  prediccion?: { expresion: string; funcion: string };
  desanclada?: boolean;
  /** Escalón de ayuda alcanzado en esta nota (para "!mas" / "no entiendo"). */
  nivel?: number;
  /** Mensajes humanos ya respondidos que vinieron de un @ia? del archivo. */
  turnos?: number;
  creada: string;
  actualizada: string;
}

const archivoNotas = (root: string, rel: string) => path.join(dataDir(root), "notas", rel.replace(/[\\/]/g, "__") + ".json");

/** Busca el ancla en el texto actual: misma línea, o la más cercana con el mismo texto, o la función. */
export function reanclar(src: string, n: Nota): Nota {
  const lineas = src.split(/\r?\n/);
  const objetivo = n.ancla.texto.trim();
  const i = n.ancla.linea - 1;
  if (objetivo && lineas[i]?.trim() === objetivo) return { ...n, desanclada: false };
  if (objetivo) {
    let mejor = -1;
    for (let k = 0; k < lineas.length; k++) if (lineas[k]!.trim() === objetivo && (mejor < 0 || Math.abs(k - i) < Math.abs(mejor - i))) mejor = k;
    if (mejor >= 0) return { ...n, ancla: { ...n.ancla, linea: mejor + 1 }, desanclada: false };
  }
  if (n.ancla.funcion) {
    const re = new RegExp(`\\b${n.ancla.funcion.replace(/[$]/g, "\\$")}\\b\\s*(=\\s*(async\\s*)?\\(|\\(|:)`);
    const k = lineas.findIndex((l) => re.test(l));
    if (k >= 0) return { ...n, ancla: { ...n.ancla, linea: k + 1, texto: lineas[k]!.trim() }, desanclada: false };
  }
  // Sin lugar: queda visible como "desanclada", nunca se pierde.
  return { ...n, ancla: { ...n.ancla, linea: Math.min(Math.max(1, n.ancla.linea), Math.max(1, lineas.length)) }, desanclada: !!objetivo };
}

export function cargarNotas(root: string, rel: string, src?: string): Nota[] {
  let notas: Nota[] = [];
  try {
    notas = (JSON.parse(fs.readFileSync(archivoNotas(root, rel), "utf8")) as { notas: Nota[] }).notas ?? [];
  } catch {
    return [];
  }
  const texto = src ?? (fs.existsSync(path.join(root, rel)) ? fs.readFileSync(path.join(root, rel), "utf8") : "");
  return notas.map((n) => (n.estado === "abierta" ? reanclar(texto, n) : n));
}

export function guardarNotas(root: string, rel: string, notas: Nota[]): void {
  const f = archivoNotas(root, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  // Las resueltas más viejas se archivan (el panel no crece sin fin): se guardan las últimas 30.
  const resueltas = notas.filter((n) => n.estado === "resuelta").slice(-30);
  const abiertas = notas.filter((n) => n.estado === "abierta");
  // Atómico (temporal + rename): la extensión nunca lee un archivo a medio escribir.
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, archivo: rel, notas: [...abiertas, ...resueltas] }, null, 2));
  fs.renameSync(tmp, f);
}

export function nuevaNota(notas: Nota[], parcial: Omit<Nota, "id" | "creada" | "actualizada" | "estado" | "hilo" | "snippets" | "bloqueante" | "accion"> & Partial<Nota>): Nota {
  const max = Math.max(0, ...notas.map((n) => Number(/^n(\d+)$/.exec(n.id)?.[1] ?? 0)));
  const ahora = new Date().toISOString();
  const n: Nota = { accion: "", hilo: [], snippets: [], bloqueante: false, estado: "abierta", creada: ahora, actualizada: ahora, ...parcial, id: `n${max + 1}` };
  notas.push(n);
  return n;
}

export function mensaje(quien: Mensaje["quien"], texto: string): Mensaje {
  return { quien, texto, fecha: new Date().toISOString() };
}

/** Todas las notas del proyecto (para el panel y `cai siguiente`). */
export function todasLasNotas(root: string): Nota[] {
  const dir = path.join(dataDir(root), "notas");
  if (!fs.existsSync(dir)) return [];
  const out: Nota[] = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as { archivo: string };
      out.push(...cargarNotas(root, d.archivo));
    } catch {
      /* archivo de notas dañado: se ignora */
    }
  }
  return out;
}
