import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDir, makeZoner } from "./config.js";
import { CRITERIO } from "./context.js";
import { contextoComun } from "./contexto.js";
import { ask } from "./llm.js";
import { agregarTareas } from "./siguiente.js";
import { iaOpts } from "./tutor.js";

/**
 * Ideas para el proyecto (panel → Proyecto → 💡 Ideas), a partir del panorama: funcionalidades nuevas
 * y mejoras de lo existente; "qué aprender" solo si lo activas (ideas.aprender, apagado por defecto).
 * Salen en la misma llamada del panorama (sin costo extra) o con "🔄 Más ideas". Las que descartas no
 * vuelven a proponerse; las que te gustan pasan a ser tareas con un clic.
 */

export type TipoIdea = "funcionalidad" | "mejora" | "aprender";

export interface Idea {
  id: string;
  tipo: TipoIdea;
  titulo: string;
  porque: string;
  archivos: string[];
  fecha: string;
  /** Pasó a ser tarea (id) o la descartaste. */
  tarea?: string;
  descartada?: boolean;
}

const archivo = (root: string) => path.join(dataDir(root), "ideas.json");

export function cargarIdeas(root: string): Idea[] {
  try {
    return (JSON.parse(fs.readFileSync(archivo(root), "utf8")) as { ideas: Idea[] }).ideas ?? [];
  } catch {
    return [];
  }
}

function guardar(root: string, ideas: Idea[]): void {
  fs.mkdirSync(path.dirname(archivo(root)), { recursive: true });
  const tmp = `${archivo(root)}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, ideas }, null, 2));
  fs.renameSync(tmp, archivo(root));
}

const norm = (t: string) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/** Los tipos que se piden (aprender solo si está activo). */
export function tiposIdeas(root: string): TipoIdea[] {
  return makeZoner(root).config.ideas?.aprender ? ["funcionalidad", "mejora", "aprender"] : ["funcionalidad", "mejora"];
}

/** Esquema para pedir ideas (lo usa el panorama y "Más ideas"). */
export const schemaIdeas = (tipos: TipoIdea[]) => ({
  type: "array",
  maxItems: 6,
  description: `Ideas para el proyecto: ${tipos.map((t) => ({ funcionalidad: '"funcionalidad" (algo nuevo que le sumaría valor según lo que busca)', mejora: '"mejora" (calidad, tests, rendimiento, simplificar, seguridad de lo que ya hay)', aprender: '"aprender" (un concepto o técnica que le serviría para lo que viene)' })[t]).join(", ")}. No repitas ideas descartadas ni tareas existentes.`,
  items: {
    type: "object",
    additionalProperties: false,
    required: ["tipo", "titulo", "porque", "archivos"],
    properties: { tipo: { type: "string", enum: tipos }, titulo: { type: "string" }, porque: { type: "string" }, archivos: { type: "array", items: { type: "string" } } },
  },
});

/** Lo que el prompt debe saber para no repetir: descartadas y las que ya están. */
export function contextoIdeas(root: string): string {
  const ideas = cargarIdeas(root);
  const desc = ideas.filter((i) => i.descartada).map((i) => i.titulo);
  const vivas = ideas.filter((i) => !i.descartada && !i.tarea).map((i) => i.titulo);
  return [desc.length ? `Ideas que el programador DESCARTÓ (no las vuelvas a proponer, ni parecidas):\n- ${desc.slice(-30).join("\n- ")}` : "", vivas.length ? `Ideas ya propuestas (no las repitas):\n- ${vivas.join("\n- ")}` : ""].filter(Boolean).join("\n\n");
}

/** Agrega ideas nuevas (sin repetir ni revivir las descartadas: filtro sin IA). Devuelve las agregadas. */
export function registrarIdeas(root: string, nuevas: Omit<Idea, "id" | "fecha">[]): Idea[] {
  const ideas = cargarIdeas(root);
  const tipos = new Set(tiposIdeas(root));
  const out: Idea[] = [];
  for (const n of nuevas) {
    if (!tipos.has(n.tipo) || !n.titulo.trim()) continue;
    if (ideas.some((i) => norm(i.titulo) === norm(n.titulo))) continue;
    const i: Idea = { ...n, titulo: n.titulo.trim(), id: `i${crypto.randomBytes(3).toString("hex")}`, fecha: new Date().toISOString() };
    ideas.push(i);
    out.push(i);
  }
  if (out.length) guardar(root, ideas);
  return out;
}

/** Tu clic: "No me interesa" (no vuelve a proponerse) o "➕ Tarea". */
export function descartarIdea(root: string, id: string): Idea {
  const ideas = cargarIdeas(root);
  const i = ideas.find((x) => x.id === id);
  if (!i) throw new Error(`no existe la idea ${id} (míralas con: cai ideas)`);
  i.descartada = true;
  guardar(root, ideas);
  return i;
}

export function ideaATarea(root: string, id: string): Idea {
  const ideas = cargarIdeas(root);
  const i = ideas.find((x) => x.id === id);
  if (!i) throw new Error(`no existe la idea ${id} (míralas con: cai ideas)`);
  agregarTareas(root, [{ titulo: i.titulo, detalle: i.porque, ...(i.archivos[0] ? { archivo: i.archivos[0] } : {}), origen: "panorama" }]);
  i.tarea = i.titulo;
  guardar(root, ideas);
  return i;
}

/** "🔄 Más ideas": una llamada (modelo mediano) sin rehacer el panorama. */
export async function masIdeas(root: string): Promise<{ ideas: Idea[]; costoUsd: number }> {
  const z = makeZoner(root);
  const tipos = tiposIdeas(root);
  const { data, costUsd } = await ask<{ ideas: Omit<Idea, "id" | "fecha">[] }>({
    kind: "ideas",
    system: `Propones ideas para el proyecto del programador: ${tipos.join(", ")}. Concretas, con su porqué y los archivos que tocarían. Lee el proyecto si hace falta (Read, Grep). Respeta sus objetivos, lo que está fuera de alcance y sus decisiones. Sin código. Español neutro con tuteo.\n\n${CRITERIO}`,
    cwd: root,
    schema: { type: "object", additionalProperties: false, required: ["ideas"], properties: { ideas: schemaIdeas(tipos) } },
    ...iaOpts(z.config, "mediano"),
    prompt: [contextoComun(root, ""), contextoIdeas(root)].filter(Boolean).join("\n\n"),
  });
  return { ideas: registrarIdeas(root, data.ideas ?? []), costoUsd: costUsd };
}
