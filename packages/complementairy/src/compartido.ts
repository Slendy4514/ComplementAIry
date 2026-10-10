/**
 * Lógica que comparten la CLI y la extensión de VSCode. Sin dependencias ni imports: la extensión
 * copia este archivo al compilar (scripts/compartido.cjs), así las dos no se desalinean.
 *
 * Modos de trabajo: dos ejes.
 * - Quién escribe: tú ("manual") o la IA ("ia": construir juntos; escribe lo que ordenas, paso a paso; entra con tu clic).
 * - Cuánta ayuda: "sugerir" (directo, rápido) o "aprender" (más fricción: escalera, explicar, predecir).
 *
 * Cada combinación es un modo (para que la precedencia función > archivo > carpeta > proyecto siga
 * siendo un solo valor): sugerir = tú + sugerir · aprender = tú + aprender · programar = IA + sugerir ·
 * programar-aprender = IA + aprender.
 */

export type Modo = "sugerir" | "aprender" | "programar" | "programar-aprender";
export type Escribe = "manual" | "ia";
export type Ayuda = "sugerir" | "aprender";
export type Origen = "funcion" | "archivo" | "carpeta" | "proyecto";

export interface Comportamiento {
  escribe: Escribe;
  ayuda: Ayuda;
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
  /** La IA puede escribir código (construir juntos); entra solo con tu clic. */
  proponerSolucion: boolean;
  /** Construir juntos: antes de ver la propuesta de cada paso, dices cómo lo harías tú (decidir antes de ver). */
  decidirAntes: boolean;
  /** Construir juntos: cada paso se prueba (predices qué da con una entrada) antes del siguiente. */
  probarCadaPorcion: boolean;
  etiqueta: string;
  icono: string;
  descripcion: string;
}

const base = { escalera: false, snippetsSinIntento: true, rapidas: true, explicar: false, predecir: false, proponerSolucion: false, decidirAntes: false, probarCadaPorcion: false };

export const MODOS: Record<Modo, Comportamiento> = {
  sugerir: { ...base, escribe: "manual", ayuda: "sugerir", etiqueta: "sugerir", icono: "lightbulb", descripcion: "escribes tú; ayuda directa, snippets y sugerencias rápidas" },
  aprender: { ...base, escribe: "manual", ayuda: "aprender", escalera: true, snippetsSinIntento: false, rapidas: false, explicar: true, predecir: true, etiqueta: "aprender", icono: "mortar-board", descripcion: "escribes tú; ayuda gradual, predecir y explicar con tus palabras" },
  programar: { ...base, escribe: "ia", ayuda: "sugerir", proponerSolucion: true, etiqueta: "programar", icono: "rocket", descripcion: "la IA propone cada paso en palabras; tú das la orden con tus palabras y escribe solo eso; predices la función antes de insertarla" },
  "programar-aprender": {
    ...base,
    escribe: "ia",
    ayuda: "aprender",
    proponerSolucion: true,
    rapidas: false,
    explicar: true,
    predecir: true,
    decidirAntes: true,
    probarCadaPorcion: true,
    etiqueta: "programar · aprender",
    icono: "rocket",
    descripcion: "como programar, pero antes de ver cada propuesta dices cómo lo harías, y pruebas cada paso antes del siguiente",
  },
};

export const esModo = (m: unknown): m is Modo => typeof m === "string" && Object.prototype.hasOwnProperty.call(MODOS, m);

/** El modo que corresponde a los dos ejes. */
export const modoDe = (escribe: Escribe, ayuda: Ayuda): Modo => (escribe === "ia" ? (ayuda === "aprender" ? "programar-aprender" : "programar") : ayuda);

/** Glob a RegExp: "**" + "/" = cero o más carpetas; "*" = dentro de una carpeta; "?" = un carácter. */
export function globARegExp(g: string): RegExp {
  const re = g
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\//g, "\u0001")
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\u0001/g, "(?:.*/)?")
    .replace(/\u0000/g, ".*");
  return new RegExp(`^${re}$`);
}

/** ¿La carpeta (prefijo literal "src/legacy/" o glob "src/**") incluye la ruta? y cuán específica es (-1 = no). */
export function carpetaIncluye(clave: string, rel: string): number {
  if (/[*?]/.test(clave)) return globARegExp(clave).test(rel) ? clave.replace(/[*?].*$/, "").length : -1;
  const pref = clave.endsWith("/") ? clave : `${clave}/`;
  return rel.startsWith(pref) ? pref.length : -1;
}

/** Lo mínimo de la configuración que hace falta para saber el modo. */
export interface ConfigModos {
  modo?: string;
  modos?: { porFuncion?: Record<string, string>; porArchivo?: Record<string, string>; porCarpeta?: Record<string, string> };
}

/**
 * El modo que rige aquí y de dónde viene: función > archivo > carpeta (la MÁS específica) > proyecto.
 * `funcion` es la clave de la función ("nombre" o "nombre#k").
 */
export function modoEfectivo(cfg: ConfigModos, rel: string, funcion?: string): { modo: Modo; origen: Origen; c: Comportamiento } {
  const r = (modo: Modo, origen: Origen) => ({ modo, origen, c: MODOS[modo] });
  const porFuncion = funcion ? cfg.modos?.porFuncion?.[`${rel}:${funcion}`] : undefined;
  if (esModo(porFuncion)) return r(porFuncion, "funcion");
  const porArchivo = cfg.modos?.porArchivo?.[rel];
  if (esModo(porArchivo)) return r(porArchivo, "archivo");
  const carpeta = Object.entries(cfg.modos?.porCarpeta ?? {})
    .map(([g, m]) => ({ m, n: esModo(m) ? carpetaIncluye(g, rel) : -1 }))
    .filter((x) => x.n >= 0)
    .sort((a, b) => b.n - a.n)[0];
  if (carpeta) return r(carpeta.m as Modo, "carpeta");
  return r(esModo(cfg.modo) ? cfg.modo : "sugerir", "proyecto");
}

/**
 * Hasta v0.9 "programar" era la ayuda directa (hoy "sugerir"). Una configuración sin `modosVersion: 2`
 * se lee con "programar" → "sugerir": nadie pasa al modo programar sin elegirlo. Muta y devuelve `raw`.
 */
export function migrarModos<T extends object>(raw: T): T {
  const r = raw as Record<string, unknown>;
  if (r.modosVersion === 2) return raw;
  if (r.modo === "programar") r.modo = "sugerir";
  const modos = r.modos as Record<string, Record<string, string> | undefined> | undefined;
  for (const g of Object.values(modos ?? {})) for (const [k, v] of Object.entries(g ?? {})) if (v === "programar") g![k] = "sugerir";
  r.modosVersion = 2;
  return raw;
}
