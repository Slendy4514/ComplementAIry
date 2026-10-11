import path from "node:path";
import { dataDir } from "./config.js";
import { escribirJson, leerJson } from "./almacen.js";
import { conCandadoSync } from "./ocupado.js";

/** Almacén de ideas (sin IA): lo usa el hook al registrar tus respuestas, que no puede cargar la IA. */

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

export const archivo = (root: string) => path.join(dataDir(root), "ideas.json");

export function cargarIdeas(root: string): Idea[] {
  return leerJson<{ ideas?: Idea[] }>(archivo(root), () => ({})).ideas ?? [];
}

export function guardar(root: string, ideas: Idea[]): void {
  escribirJson(archivo(root), { version: 1, ideas });
}


/** Tu clic: "No me interesa" (no vuelve a proponerse) o "➕ Tarea". */
export function descartarIdea(root: string, id: string): Idea {
  return conCandadoSync(archivo(root), () => {
    const ideas = cargarIdeas(root);
    const i = ideas.find((x) => x.id === id);
    if (!i) throw new Error(`no existe la idea ${id} (míralas con: cai ideas)`);
    i.descartada = true;
    guardar(root, ideas);
    return i;
  });
}
