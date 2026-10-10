import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./config.js";
import { escribirJson, leerJson } from "./almacen.js";
import { conCandadoSync } from "./ocupado.js";

/**
 * Correcciones del programador a lo que ComplementAIry entiende del proyecto: el resumen de un módulo,
 * el rol de un archivo en la estructura, o un hecho general ("esto no es una API, es una CLI").
 * MANDAN sobre lo generado: el panorama y el plano no las pisan al regenerar, y toda la IA las recibe.
 * Las propone el chat (o Claude Code); se aplican solo con tu clic o tu respuesta.
 */

export interface Correccion {
  id: string;
  tipo: "modulo" | "estructura" | "proyecto";
  /** modulo/estructura: el archivo al que se refiere. */
  archivo?: string;
  /** Lo que decía (para el historial); lo que debe decir. */
  antes?: string;
  despues: string;
  fecha: string;
  origen: string;
}

const archivoCorrecciones = (root: string) => path.join(dataDir(root), "correcciones.json");

export function cargarCorrecciones(root: string): Correccion[] {
  return leerJson<{ correcciones?: Correccion[] }>(archivoCorrecciones(root), () => ({})).correcciones ?? [];
}

function guardar(root: string, cs: Correccion[]): void {
  escribirJson(archivoCorrecciones(root), { version: 1, correcciones: cs });
}

/** Registra una corrección (la del mismo módulo/archivo reemplaza a la anterior) y la aplica ya. */
export function corregir(root: string, c: Omit<Correccion, "id" | "fecha">): Correccion {
  return conCandadoSync(archivoCorrecciones(root), () => {
    if (!c.despues.trim()) throw new Error("la corrección está vacía: escribe qué debe decir");
    if ((c.tipo === "modulo" || c.tipo === "estructura") && !c.archivo) throw new Error(`una corrección de ${c.tipo} necesita el archivo al que se refiere (--archivo)`);
    const cs = cargarCorrecciones(root).filter((x) => !(c.tipo !== "proyecto" && x.tipo === c.tipo && x.archivo === c.archivo));
    const nueva: Correccion = { ...c, despues: c.despues.trim(), id: `c${crypto.randomBytes(3).toString("hex")}`, fecha: new Date().toISOString() };
    cs.push(nueva);
    guardar(root, cs);
    // La estructura se corrige también en su archivo (el panel y el contexto la leen de ahí).
    if (c.tipo === "estructura") {
      const f = path.join(dataDir(root), "estructura.json");
      try {
        const est = JSON.parse(fs.readFileSync(f, "utf8")) as Record<string, unknown>;
        fs.writeFileSync(f, JSON.stringify(aplicarAEstructura(root, est), null, 2));
      } catch {
        /* todavía no hay estructura: se aplicará cuando se proponga */
      }
    }
    return nueva;
  });
}

export function quitarCorreccion(root: string, id: string): Correccion {
  return conCandadoSync(archivoCorrecciones(root), () => {
    const cs = cargarCorrecciones(root);
    const c = cs.find((x) => x.id === id);
    if (!c) throw new Error(`no existe la corrección ${id} (míralas con: cai memoria correcciones)`);
    guardar(root, cs.filter((x) => x.id !== id));
    return c;
  });
}

/** Resúmenes de módulos con tus correcciones encima (lo tuyo manda). */
export function aplicarAResumenes<T extends { resumen: string }>(root: string, resumenes: Record<string, T>): Record<string, T> {
  const out = { ...resumenes };
  for (const c of cargarCorrecciones(root).filter((x) => x.tipo === "modulo" && x.archivo)) {
    const previo = out[c.archivo!];
    out[c.archivo!] = { ...(previo ?? ({} as T)), resumen: `${c.despues} (✓ corregido por ti)` };
  }
  return out;
}

/** La estructura (estructura.json) con el rol de cada archivo que corregiste. */
export function aplicarAEstructura<T extends Record<string, unknown>>(root: string, est: T): T {
  const mods = (est.modulos ?? []) as { archivo: string; responsabilidad: string }[];
  for (const c of cargarCorrecciones(root).filter((x) => x.tipo === "estructura" && x.archivo)) {
    const m = mods.find((x) => x.archivo === c.archivo);
    if (m) m.responsabilidad = c.despues;
  }
  return est;
}

/** Para el contexto de la IA: lo que corregiste (manda sobre cualquier resumen). */
export function bloqueCorrecciones(root: string): string {
  const cs = cargarCorrecciones(root);
  if (!cs.length) return "";
  return `Correcciones del programador sobre el proyecto (MANDAN sobre cualquier resumen o suposición):\n${cs
    .map((c) => `- ${c.tipo === "proyecto" ? "" : `${c.tipo === "modulo" ? "módulo" : "rol en la estructura de"} ${c.archivo}: `}${c.despues}`)
    .join("\n")}`;
}
