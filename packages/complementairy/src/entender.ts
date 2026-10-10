import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./config.js";

/**
 * Etapa de entendimiento: qué busca el proyecto, para quién, qué es "terminado", restricciones y qué
 * queda fuera. La IA conversa (chat "🎯 Entender el proyecto") y va armando un BORRADOR; cuando cree
 * que ya entendió lo dice, y TÚ confirmas (o corriges/reabres). Confirmar, reabrir y dar por terminado
 * son tuyos: desde el chat de Claude Code se revierte (salvo con tu respuesta en sus botones).
 * Lo confirmado entra al contexto de toda la IA y sus criterios de "terminado" se revisan en el panorama.
 */

export type EstadoObjetivos = "sin empezar" | "entendiendo" | "entendido" | "reabierto" | "terminado";

export interface Criterio {
  id: string;
  texto: string;
}

export interface Objetivos {
  version: 1;
  estado: EstadoObjetivos;
  /** Resumen en una o dos oraciones (lo que la IA cree que buscas). */
  resumen: string;
  objetivos: string[];
  usuarios: string;
  /** Cuándo está terminado (lo que se revisa para decir "creo que terminó"). */
  criterios: Criterio[];
  restricciones: string[];
  fueraDeAlcance: string[];
  /** La IA cree que ya entendió (lo confirmas tú). */
  creeEntendido?: boolean;
  /** Lo que aún le falta saber (si no cree haber entendido). */
  dudas?: string[];
  confirmado?: string;
  terminado?: string;
  historial: { fecha: string; evento: string }[];
}

/** Lo que el panorama cree de cada criterio de "terminado" (aparte: no toca lo que confirmaste). */
export interface EvaluacionTerminado {
  fecha: string;
  criterios: { id: string; estado: "cumple" | "parcial" | "no"; evidencia: string }[];
  creeTerminado: boolean;
}

const archivo = (root: string) => path.join(dataDir(root), "objetivos.json");
const archivoEvaluacion = (root: string) => path.join(dataDir(root), "cache", "terminado.json");

export const VACIO: Objetivos = { version: 1, estado: "sin empezar", resumen: "", objetivos: [], usuarios: "", criterios: [], restricciones: [], fueraDeAlcance: [], historial: [] };

export function leerObjetivos(root: string): Objetivos {
  try {
    return { ...VACIO, ...(JSON.parse(fs.readFileSync(archivo(root), "utf8")) as Partial<Objetivos>) };
  } catch {
    return { ...VACIO, historial: [] };
  }
}

function guardar(root: string, o: Objetivos): void {
  fs.mkdirSync(path.dirname(archivo(root)), { recursive: true });
  const tmp = `${archivo(root)}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(o, null, 2));
  fs.renameSync(tmp, archivo(root));
  fs.writeFileSync(path.join(dataDir(root), "objetivos.md"), objetivosMd(o));
}

/** La versión legible (.cai/objetivos.md). */
export function objetivosMd(o: Objetivos): string {
  const lista = (xs: string[]) => (xs.length ? xs.map((x) => `- ${x}`).join("\n") : "(nada todavía)");
  const estado = { "sin empezar": "sin empezar", entendiendo: "entendiendo (borrador)", entendido: "✓ confirmado por ti", reabierto: "reabierto", terminado: "🏁 terminado (lo diste por terminado)" }[o.estado];
  return [
    "# Objetivos del proyecto",
    "",
    `<!-- Lo arma ComplementAIry conversando contigo (chat → 🎯 Entender el proyecto). Estado: ${estado}. Corrígelo desde el chat o con: cai entender reabrir. -->`,
    "",
    o.resumen || "(sin resumen)",
    "",
    "## Qué busca",
    lista(o.objetivos),
    "",
    "## Para quién",
    o.usuarios || "(sin definir)",
    "",
    "## Cuándo está terminado",
    lista(o.criterios.map((c) => c.texto)),
    "",
    "## Restricciones",
    lista(o.restricciones),
    "",
    "## Fuera de alcance",
    lista(o.fueraDeAlcance),
    "",
  ].join("\n");
}

/** El borrador que propone la IA en cada turno (no toca lo que ya confirmaste: si estaba confirmado, pasa a "reabierto"). */
export function actualizarBorrador(root: string, b: Partial<Pick<Objetivos, "resumen" | "objetivos" | "usuarios" | "restricciones" | "fueraDeAlcance" | "dudas">> & { criterios?: string[]; creeEntendido?: boolean }): Objetivos {
  const o = leerObjetivos(root);
  if (o.estado === "entendido" || o.estado === "terminado") throw new Error("los objetivos están confirmados: para cambiarlos, reábrelos primero (cai entender reabrir)");
  const criterios = (b.criterios ?? o.criterios.map((c) => c.texto)).map((texto, i) => ({ id: o.criterios.find((c) => c.texto === texto)?.id ?? `k${i + 1}${Date.now().toString(36).slice(-3)}`, texto }));
  const nuevo: Objetivos = {
    ...o,
    ...(b.resumen !== undefined ? { resumen: b.resumen } : {}),
    ...(b.objetivos ? { objetivos: b.objetivos } : {}),
    ...(b.usuarios !== undefined ? { usuarios: b.usuarios } : {}),
    ...(b.restricciones ? { restricciones: b.restricciones } : {}),
    ...(b.fueraDeAlcance ? { fueraDeAlcance: b.fueraDeAlcance } : {}),
    ...(b.dudas ? { dudas: b.dudas } : {}),
    criterios,
    creeEntendido: !!b.creeEntendido,
    estado: o.estado === "reabierto" ? "reabierto" : "entendiendo",
  };
  guardar(root, nuevo);
  return nuevo;
}

/** Tú: confirmas lo entendido (o, si ya estaba terminado, lo reabres). Solo humano. */
export function confirmarObjetivos(root: string): Objetivos {
  const o = leerObjetivos(root);
  if (!o.resumen && !o.objetivos.length) throw new Error("todavía no hay nada que confirmar: conversa primero (chat → 🎯 Entender el proyecto, o cai entender --texto \"…\")");
  const ahora = new Date().toISOString();
  const nuevo: Objetivos = { ...o, estado: "entendido", confirmado: ahora, creeEntendido: true, historial: [...o.historial, { fecha: ahora, evento: "confirmado" }] };
  guardar(root, nuevo);
  return nuevo;
}

export function reabrirObjetivos(root: string, motivo = ""): Objetivos {
  const o = leerObjetivos(root);
  const ahora = new Date().toISOString();
  const nuevo: Objetivos = { ...o, estado: "reabierto", creeEntendido: false, historial: [...o.historial, { fecha: ahora, evento: `reabierto${motivo ? `: ${motivo}` : ""}` }] };
  delete nuevo.terminado;
  guardar(root, nuevo);
  return nuevo;
}

/** Tú: das el proyecto por terminado (normalmente cuando el panorama cree que se cumplen los criterios). */
export function darPorTerminado(root: string): Objetivos {
  const o = leerObjetivos(root);
  if (o.estado !== "entendido") throw new Error(`para darlo por terminado, los objetivos tienen que estar confirmados (están: ${o.estado})`);
  const ahora = new Date().toISOString();
  const nuevo: Objetivos = { ...o, estado: "terminado", terminado: ahora, historial: [...o.historial, { fecha: ahora, evento: "terminado" }] };
  guardar(root, nuevo);
  return nuevo;
}

export function leerEvaluacion(root: string): EvaluacionTerminado | null {
  try {
    return JSON.parse(fs.readFileSync(archivoEvaluacion(root), "utf8")) as EvaluacionTerminado;
  } catch {
    return null;
  }
}

/** El panorama evalúa cada criterio (con evidencia); "creo que terminó" solo si TODOS se cumplen (determinista). */
export function guardarEvaluacion(root: string, criterios: EvaluacionTerminado["criterios"]): EvaluacionTerminado {
  const o = leerObjetivos(root);
  const validos = criterios.filter((c) => o.criterios.some((x) => x.id === c.id));
  const ev: EvaluacionTerminado = { fecha: new Date().toISOString(), criterios: validos, creeTerminado: o.criterios.length > 0 && o.criterios.every((c) => validos.find((v) => v.id === c.id)?.estado === "cumple") };
  fs.mkdirSync(path.dirname(archivoEvaluacion(root)), { recursive: true });
  fs.writeFileSync(archivoEvaluacion(root), JSON.stringify(ev, null, 2));
  return ev;
}

/** Para el contexto de toda la IA: los objetivos (confirmados, o el borrador marcado como tal). */
export function bloqueObjetivos(root: string): string {
  const o = leerObjetivos(root);
  if (o.estado === "sin empezar" || (!o.resumen && !o.objetivos.length)) return "";
  const tag = o.estado === "entendido" || o.estado === "terminado" ? "confirmados por el programador" : "BORRADOR, aún sin confirmar";
  return [
    `Objetivos del proyecto (${tag}): ${o.resumen}`,
    o.objetivos.length ? `Busca: ${o.objetivos.join("; ")}` : "",
    o.usuarios ? `Para: ${o.usuarios}` : "",
    o.criterios.length ? `Terminado cuando: ${o.criterios.map((c) => c.texto).join("; ")}` : "",
    o.restricciones.length ? `Restricciones: ${o.restricciones.join("; ")}` : "",
    o.fueraDeAlcance.length ? `Fuera de alcance (no lo propongas): ${o.fueraDeAlcance.join("; ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * ¿El cambio en objetivos.json lo pudo hacer un comando de la IA? Solo el borrador: si antes o
 * después está confirmado o terminado, tiene que quedar idéntico (confirmar, reabrir y terminar son tuyos).
 */
export function objetivosHonestos(antes: Buffer | null, despues: Buffer | null): boolean {
  const leer = (b: Buffer | null): Partial<Objetivos> | null => {
    if (!b) return {};
    try {
      return JSON.parse(b.toString("utf8")) as Partial<Objetivos>;
    } catch {
      return null;
    }
  };
  const a = leer(antes);
  const d = leer(despues);
  if (!a || !d) return false;
  const firme = (x: Partial<Objetivos>) => x.estado === "entendido" || x.estado === "terminado";
  if (firme(a) || firme(d)) return JSON.stringify(a) === JSON.stringify(d);
  // Un borrador no puede inventar confirmaciones ni borrar el historial.
  return !d.confirmado === !a.confirmado && !d.terminado && JSON.stringify(d.historial ?? []) === JSON.stringify(a.historial ?? []);
}
