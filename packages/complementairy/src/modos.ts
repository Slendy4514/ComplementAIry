import picomatch from "picomatch";
import type { Config } from "./config.js";

/**
 * Modos de trabajo: cambian CÓMO se da la ayuda nueva, nunca lo que ya existe (notas, tareas,
 * estructura, panorama y memoria quedan igual). Se eligen por proyecto, carpeta, archivo o función;
 * gana el más específico. Para sumar un modo: agrégalo a MODOS con su comportamiento.
 * En sugerir y aprender la IA nunca escribe tu código; en programar propone código (por pasos que
 * diriges tú o como un PR por porciones) que entra a tu archivo SOLO con tu clic.
 */

export type Modo = "sugerir" | "aprender" | "programar";

export interface Comportamiento {
  /** Ayuda gradual (pista → piezas → pseudo → ejemplo) en vez de directa. */
  escalera: boolean;
  /** Sugerir snippets antes de que lo intentes tú. */
  snippetsSinIntento: boolean;
  /** Sugerencias rápidas (texto gris mientras escribes). */
  rapidas: boolean;
  /** "¿Quedó lista?" ofrece explicar la función con tus palabras (y la compara con el código). */
  explicar: boolean;
  /** Ofrecer predecir qué devuelve antes de mostrar (predicciones que se comprueban ejecutando). */
  predecir: boolean;
  /** La IA puede escribir código (por pasos que diriges tú o como un PR por porciones); entra solo con tu clic. */
  proponerSolucion: boolean;
  etiqueta: string;
  icono: string;
}

export const MODOS: Record<Modo, Comportamiento> = {
  sugerir: { escalera: false, snippetsSinIntento: true, rapidas: true, explicar: false, predecir: false, proponerSolucion: false, etiqueta: "sugerir", icono: "lightbulb" },
  aprender: { escalera: true, snippetsSinIntento: false, rapidas: false, explicar: true, predecir: true, proponerSolucion: false, etiqueta: "aprender", icono: "mortar-board" },
  programar: { escalera: false, snippetsSinIntento: true, rapidas: true, explicar: false, predecir: false, proponerSolucion: true, etiqueta: "programar", icono: "rocket" },
};

export const esModo = (m: unknown): m is Modo => typeof m === "string" && m in MODOS;

export type Origen = "funcion" | "archivo" | "carpeta" | "proyecto";

/** ¿La carpeta (prefijo literal "src/legacy/" o glob "src/**") incluye la ruta? y cuán específica es. */
function carpetaIncluye(clave: string, rel: string): number {
  if (/[*?]/.test(clave)) return picomatch(clave, { dot: true })(rel) ? clave.replace(/[*?].*$/, "").length : -1;
  const pref = clave.endsWith("/") ? clave : `${clave}/`;
  return rel.startsWith(pref) ? pref.length : -1;
}

/**
 * El modo que rige aquí y de dónde viene: función > archivo > carpeta (la MÁS específica) > proyecto.
 * `funcion` es la clave de la función ("nombre" o "nombre#k").
 */
export function modoEfectivo(cfg: Config, rel: string, funcion?: string): { modo: Modo; origen: Origen; c: Comportamiento } {
  const r = (modo: Modo, origen: Origen) => ({ modo, origen, c: MODOS[modo] });
  const porFuncion = funcion ? cfg.modos.porFuncion[`${rel}:${funcion}`] : undefined;
  if (esModo(porFuncion)) return r(porFuncion, "funcion");
  const porArchivo = cfg.modos.porArchivo[rel];
  if (esModo(porArchivo)) return r(porArchivo, "archivo");
  const carpeta = Object.entries(cfg.modos.porCarpeta)
    .map(([g, m]) => ({ m, n: esModo(m) ? carpetaIncluye(g, rel) : -1 }))
    .filter((x) => x.n >= 0)
    .sort((a, b) => b.n - a.n)[0];
  if (carpeta) return r(carpeta.m as Modo, "carpeta");
  return r(esModo(cfg.modo) ? cfg.modo : "sugerir", "proyecto");
}

/**
 * Hasta v0.9 "programar" era la ayuda directa (hoy "sugerir"). Una configuración sin `modosVersion: 2`
 * se lee con "programar" → "sugerir": nadie pasa al nuevo modo programar sin elegirlo. Muta y devuelve `raw`.
 */
export function migrarModos<T extends Record<string, unknown>>(raw: T): T {
  if (raw.modosVersion === 2) return raw;
  const r = raw as Record<string, unknown>;
  if (r.modo === "programar") r.modo = "sugerir";
  const modos = r.modos as Record<string, Record<string, string>> | undefined;
  for (const g of Object.values(modos ?? {})) for (const [k, v] of Object.entries(g ?? {})) if (v === "programar") g[k] = "sugerir";
  r.modosVersion = 2;
  return raw;
}
