import crypto from "node:crypto";
import path from "node:path";
import { dataDir } from "./config.js";
import { escribirJson, leerJson } from "./almacen.js";
import { conCandadoSync } from "./ocupado.js";

/**
 * Registro de decisiones: lo que la IA necesita que TÚ decidas ("¿un monto negativo es error o se
 * calcula igual?") aparece con botones. Al decidir, queda vigente y entra en el contexto de toda la
 * IA (no lo vuelve a preguntar ni lo contradice). Se puede retractar o cambiar cuando quieras: queda en
 * el historial. Decidir y retractar es solo humano (desde el chat de Claude Code se revierte).
 */

export interface Opcion {
  opcion: string;
  consecuencia: string;
}

export interface Decision {
  id: string;
  pregunta: string;
  opciones: Opcion[];
  recomendada?: string;
  alcance: { archivo?: string; funcion?: string };
  estado: "pendiente" | "vigente" | "retractada";
  /** La opción elegida (o lo que escribiste). */
  eleccion?: string;
  creada: string;
  decidida?: string;
  /** Si se cambió: la anterior (para el historial). */
  anterior?: { eleccion: string; fecha: string }[];
  origen: string;
  /** Tarea en la que surgió (sus decisiones pendientes bloquean la aprobación). */
  tarea?: string;
  /** Marco de decisión (matriz ponderada / valor esperado). Los números los pone el humano. */
  marco?: Marco;
  /** Cierre con tus palabras: por qué, qué te haría cambiar de opinión y cuándo revisarla. */
  porque?: string;
  cambiaria?: string;
  revisar?: string;
  /** ADR generado (docs/adr/…) si la decisión es de arquitectura. */
  adr?: string;
}

export interface Marco {
  tipo: "binaria" | "matriz" | "ev";
  criterios?: { nombre: string; peso: number }[];
  /** Tus puntajes (1..5) por opción y criterio. */
  puntajes?: Record<string, Record<string, number>>;
  /** Los que sugirió la IA (se muestran DESPUÉS de los tuyos y nunca se suman solos). */
  puntajesIa?: Record<string, Record<string, number>>;
  /** Notas por discrepancias de 2+ puntos con la IA. */
  notas?: Record<string, string>;
  escenarios?: { nombre: string; probabilidad: number }[];
  valores?: Record<string, Record<string, number>>;
  minimizar?: boolean;
  resultado?: Record<string, unknown>;
}

const archivo = (root: string) => path.join(dataDir(root), "decisiones.json");

export function cargarDecisiones(root: string): Decision[] {
  return leerJson<{ decisiones?: Decision[] }>(archivo(root), () => ({})).decisiones ?? [];
}

function guardar(root: string, ds: Decision[]): void {
  escribirJson(archivo(root), { version: 1, decisiones: ds });
}

/**
 * ¿El cambio en decisiones.json es solo PROPONER? (lo único que puede hacer un comando corrido por la
 * IA): las existentes quedan idénticas y lo nuevo llega pendiente, sin elección. Decidir o retractar
 * es del humano.
 */
export function decisionesHonestas(antes: Buffer | null, despues: Buffer | null): boolean {
  const leer = (b: Buffer | null): Decision[] | null => {
    if (!b) return [];
    try {
      const ds = (JSON.parse(b.toString("utf8")) as { decisiones?: Decision[] }).decisiones;
      return Array.isArray(ds) ? ds : null;
    } catch {
      return null;
    }
  };
  const a = leer(antes);
  const d = leer(despues);
  if (!a || !d || d.length < a.length) return false;
  if (a.some((x, i) => JSON.stringify(x) !== JSON.stringify(d[i]))) return false;
  return d.slice(a.length).every((x) => x.estado === "pendiente" && x.eleccion === undefined && x.decidida === undefined && x.anterior === undefined);
}

/** Pregunta normalizada (para no repetir la misma decisión con otras palabras). */
const norm = (t: string) =>
  t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .sort()
    .join(" ");

function parecida(a: string, b: string): boolean {
  const A = new Set(norm(a).split(" "));
  const B = new Set(norm(b).split(" "));
  const comunes = [...A].filter((x) => B.has(x)).length;
  return comunes / Math.max(1, Math.min(A.size, B.size)) >= 0.7;
}

/**
 * Agrega decisiones propuestas por la IA. No se agrega una que ya está pendiente o vigente (parecida):
 * lo decidido no se vuelve a preguntar. Devuelve las que quedaron nuevas.
 */
export function proponerDecisiones(root: string, nuevas: { pregunta: string; opciones: Opcion[]; recomendada?: string }[], alcance: Decision["alcance"], origen: string, tarea?: string): Decision[] {
  return conCandadoSync(archivo(root), () => {
    const ds = cargarDecisiones(root);
    const agregadas: Decision[] = [];
    for (const n of nuevas) {
      if (!n.pregunta.trim() || n.opciones.length < 2) continue;
      if (ds.some((d) => d.estado !== "retractada" && parecida(d.pregunta, n.pregunta))) continue;
      const d: Decision = {
        id: `d${crypto.randomBytes(3).toString("hex")}`,
        pregunta: n.pregunta.trim(),
        opciones: n.opciones.slice(0, 4),
        ...(n.recomendada ? { recomendada: n.recomendada } : {}),
        alcance,
        estado: "pendiente",
        creada: new Date().toISOString(),
        origen,
        ...(tarea ? { tarea } : {}),
      };
      ds.push(d);
      agregadas.push(d);
    }
    if (agregadas.length) guardar(root, ds);
    return agregadas;
  });
}

/** Modifica una decisión (marco, cierre). Solo humano: lo protege el hook (cai decidir es soloHumano). */
export function actualizarDecision(root: string, id: string, f: (d: Decision) => Decision): Decision {
  return conCandadoSync(archivo(root), () => {
    const ds = cargarDecisiones(root);
    const i = ds.findIndex((x) => x.id === id);
    if (i < 0) throw new Error(`no existe la decisión ${id} (míralas con: cai decisiones)`);
    ds[i] = f(ds[i]!);
    guardar(root, ds);
    return ds[i]!;
  });
}

export function decidir(root: string, id: string, eleccion: string): Decision {
  return conCandadoSync(archivo(root), () => {
    const ds = cargarDecisiones(root);
    const d = ds.find((x) => x.id === id);
    if (!d) throw new Error(`no existe la decisión ${id} (míralas con: cai decisiones)`);
    if (!eleccion.trim()) throw new Error("la elección no puede estar vacía");
    if (d.eleccion && d.estado === "vigente") (d.anterior ??= []).push({ eleccion: d.eleccion, fecha: d.decidida ?? d.creada });
    d.eleccion = eleccion.trim();
    d.estado = "vigente";
    d.decidida = new Date().toISOString();
    guardar(root, ds);
    return d;
  });
}

/** Retractar: deja de regir (sale del contexto de la IA) y queda en el historial; se puede volver a decidir. */
export function retractar(root: string, id: string): Decision {
  return conCandadoSync(archivo(root), () => {
    const ds = cargarDecisiones(root);
    const d = ds.find((x) => x.id === id);
    if (!d) throw new Error(`no existe la decisión ${id} (míralas con: cai decisiones)`);
    if (d.eleccion) (d.anterior ??= []).push({ eleccion: d.eleccion, fecha: d.decidida ?? d.creada });
    d.estado = "retractada";
    delete d.eleccion;
    guardar(root, ds);
    return d;
  });
}

/** Las que rigen para un archivo o función (las del proyecto rigen siempre). */
/** Las vigentes que aplican a ese archivo/función. Sin archivo (el proyecto entero, p. ej. el chat): todas. */
export function vigentesPara(root: string, rel?: string, funcion?: string): Decision[] {
  return cargarDecisiones(root).filter(
    (d) => d.estado === "vigente" && (!rel || !d.alcance.archivo || d.alcance.archivo === rel) && (!d.alcance.funcion || !funcion || d.alcance.funcion === funcion),
  );
}

/** Esquema para que la IA proponga decisiones (se agrega a sus respuestas). */
export const SCHEMA_DECISIONES = {
  type: "array",
  maxItems: 2,
  description:
    "SOLO si el comportamiento correcto depende de algo que debe decidir el programador (no de algo que puedas leer): la pregunta y 2-4 opciones con su consecuencia. Vacío si no hace falta. No repitas decisiones ya vigentes.",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["pregunta", "opciones", "recomendada"],
    properties: {
      pregunta: { type: "string" },
      opciones: { type: "array", minItems: 2, maxItems: 4, items: { type: "object", additionalProperties: false, required: ["opcion", "consecuencia"], properties: { opcion: { type: "string" }, consecuencia: { type: "string" } } } },
      recomendada: { type: "string", description: "La opción que recomiendas (texto exacto de una opción) o \"\"." },
    },
  },
};
