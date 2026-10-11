/**
 * Almacén de TAREAS (v1), PEDIDOS y FOCO DEL DÍA. Todo en .cai/ (va al repo):
 *
 *   .cai/tareas/<id>/tarea.json      la tarea (ver nucleo/flujo.ts)
 *   .cai/tareas/<id>/adjuntos/       capturas (IV.4)
 *   .cai/pedidos/<id>.json           lo que pediste, literal, y en qué tareas se separó (nada se olvida)
 *   .cai/sesiones/<fecha>.json       qué buscas hoy y cómo terminó el día
 */
import fs from "node:fs";
import path from "node:path";
import { escribirJson, leerJson } from "./almacen.js";
import { dataDir } from "./config.js";
import { conCandadoSync } from "./ocupado.js";
import { CLAVES_COMUNES, preguntasEntrevista, RESTRICCIONES_VACIAS, transicionar, type Estado, type Tarea, type TipoTarea, type Intencion, type Ejecutor } from "../nucleo/flujo.js";

const dirTareas = (root: string) => path.join(dataDir(root), "tareas");
const archivoTarea = (root: string, id: string) => path.join(dirTareas(root), id, "tarea.json");
export const dirAdjuntos = (root: string, id: string) => path.join(dirTareas(root), id, "adjuntos");

export function listarTareas(root: string): Tarea[] {
  const d = dirTareas(root);
  if (!fs.existsSync(d)) return [];
  return fs
    .readdirSync(d)
    .filter((x) => fs.existsSync(archivoTarea(root, x)))
    .map((x) => leerJson<Tarea>(archivoTarea(root, x), () => null as unknown as Tarea))
    .filter(Boolean)
    .sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
}

export function cargarTarea(root: string, id: string): Tarea {
  const t = leerJson<Tarea | null>(archivoTarea(root, id), () => null);
  if (!t) throw new Error(`no existe la tarea ${id} (\`cai tarea\` las lista)`);
  return t;
}

export function guardarTarea(root: string, t: Tarea): Tarea {
  const n = { ...t, actualizada: new Date().toISOString() };
  escribirJson(archivoTarea(root, t.id), n);
  return n;
}

/** Modifica una tarea con candado (dos procesos no se pisan). */
export function conTarea(root: string, id: string, f: (t: Tarea) => Tarea): Tarea {
  return conCandadoSync(path.join(dirTareas(root), id), () => guardarTarea(root, f(cargarTarea(root, id))));
}

function nuevoId(root: string): string {
  const ids = fs.existsSync(dirTareas(root)) ? fs.readdirSync(dirTareas(root)).map((x) => Number(/^t(\d+)$/.exec(x)?.[1] ?? 0)) : [];
  return `t${Math.max(0, ...ids) + 1}`;
}

export interface NuevaTarea {
  titulo: string;
  tipo?: TipoTarea;
  intencion?: Intencion;
  ejecutor?: Ejecutor;
  pedido?: { id: string; fragmento: string };
  objetivo?: string;
  presupuestoLineas?: number;
  /** Respuestas comunes del pedido (se copian a la entrevista, marcadas `comun`). */
  comunes?: Record<string, string>;
}

export function crearTarea(root: string, n: NuevaTarea): Tarea {
  return conCandadoSync(dirTareas(root), () => {
    const ahora = new Date().toISOString();
    const tipo = n.tipo ?? "funcionalidad";
    const t: Tarea = {
      version: 1,
      id: nuevoId(root),
      titulo: n.titulo.trim(),
      tipo,
      intencion: n.intencion ?? "producir",
      ejecutor: n.ejecutor ?? (n.intencion === "aprender" ? "humano" : "agente"),
      estado: "borrador",
      creada: ahora,
      actualizada: ahora,
      ...(n.pedido ? { pedido: n.pedido } : {}),
      ...(n.objetivo ? { objetivo: n.objetivo } : {}),
      entrevista: preguntasEntrevista(tipo).map((p) => (n.comunes?.[p.clave] ? { ...p, respuesta: n.comunes[p.clave], cuando: ahora, comun: true } : p)),
      restricciones: { ...RESTRICCIONES_VACIAS, presupuestoLineas: n.presupuestoLineas ?? RESTRICCIONES_VACIAS.presupuestoLineas },
      adjuntos: [],
      dialogo: [],
      historial: [],
      checkpoints: [],
      tocados: [],
    };
    if (!t.titulo) throw new Error("la tarea necesita un título (qué quieres lograr)");
    escribirJson(archivoTarea(root, t.id), t);
    return t;
  });
}

export function moverTarea(root: string, id: string, a: Estado, motivo?: string): Tarea {
  return conTarea(root, id, (t) => transicionar(t, a, motivo));
}

/** La tarea en ejecución que corresponde a una sesión de Claude Code (o la única ejecutando sin sesión). */
export function tareaEjecutando(root: string, sesion?: string): Tarea | undefined {
  const ej = listarTareas(root).filter((t) => t.estado === "ejecutando");
  return ej.find((t) => sesion && t.sesion === sesion) ?? (ej.length === 1 && !ej[0]!.sesion ? ej[0] : ej.find((t) => !t.sesion && !sesion));
}

/** La tarea ligada a una sesión (cualquier estado activo). */
export function tareaDeSesion(root: string, sesion: string): Tarea | undefined {
  return listarTareas(root).find((t) => t.sesion === sesion && !["cerrada", "descartada"].includes(t.estado));
}

export const activas = (ts: Tarea[]) => ts.filter((t) => !["cerrada", "descartada"].includes(t.estado));

// --- Pedidos: lo que pediste, literal, y su destino ---------------------------------------------------

export interface Tema {
  /** Fragmento EXACTO del texto original. */
  fragmento: string;
  tipo: TipoTarea;
  tarea?: string;
  /** "descartado porque…" (con tus palabras). */
  descartado?: string;
}

export interface Pedido {
  version: 1;
  id: string;
  texto: string;
  creado: string;
  temas: Tema[];
  /** Restricciones comunes respondidas una vez para todos los temas. */
  comunes: Record<string, string>;
  /** Orden en que decidiste hacerlos (ids de tarea). */
  orden: string[];
  /** Pares de tareas que comparten archivos y cómo decidiste resolverlo. */
  choques: { tareas: [string, string]; decision?: "orden" | "paralelo" }[];
}

const dirPedidos = (root: string) => path.join(dataDir(root), "pedidos");

export function listarPedidos(root: string): Pedido[] {
  if (!fs.existsSync(dirPedidos(root))) return [];
  return fs
    .readdirSync(dirPedidos(root))
    .filter((f) => f.endsWith(".json"))
    .map((f) => leerJson<Pedido>(path.join(dirPedidos(root), f), () => null as unknown as Pedido))
    .filter(Boolean)
    .sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
}

export function cargarPedido(root: string, id: string): Pedido {
  const p = leerJson<Pedido | null>(path.join(dirPedidos(root), `${id}.json`), () => null);
  if (!p) throw new Error(`no existe el pedido ${id}`);
  return p;
}

export function guardarPedido(root: string, p: Pedido): void {
  escribirJson(path.join(dirPedidos(root), `${p.id}.json`), p);
}

export function crearPedido(root: string, texto: string, temas: Tema[]): Pedido {
  return conCandadoSync(dirPedidos(root), () => {
    const ids = listarPedidos(root).map((p) => Number(p.id.slice(1)));
    const p: Pedido = { version: 1, id: `p${Math.max(0, ...ids) + 1}`, texto, creado: new Date().toISOString(), temas, comunes: {}, orden: [], choques: [] };
    guardarPedido(root, p);
    return p;
  });
}

/** Temas sin destino (ni tarea ni descarte): el pedido no se puede cerrar. */
export const temasSinDestino = (p: Pedido) => p.temas.filter((t) => !t.tarea && !t.descartado);

/** Estado de cada tema para mostrar: "«exportar a PDF» → t11 ✔ cerrada". */
export function rastroPedido(root: string, p: Pedido): string[] {
  const ts = new Map(listarTareas(root).map((t) => [t.id, t]));
  const icono: Record<string, string> = { cerrada: "✔", descartada: "✖", borrador: "○", desconectada: "⛔" };
  return p.temas.map((tm) => {
    if (tm.descartado) return `«${tm.fragmento}» → descartado (${tm.descartado})`;
    const t = tm.tarea ? ts.get(tm.tarea) : undefined;
    if (!t) return `«${tm.fragmento}» → sin tarea todavía`;
    const dias = Math.floor((Date.now() - Date.parse(t.actualizada)) / 86400_000);
    return `«${tm.fragmento}» → ${t.id} ${icono[t.estado] ?? "⏳"} ${t.estado}${t.estado === "borrador" && dias >= 2 ? ` (sin empezar hace ${dias} días)` : ""}`;
  });
}

/** Las claves que se preguntan una vez por pedido. */
export const comunesDe = (tipos: TipoTarea[]) => CLAVES_COMUNES.filter((k) => tipos.some((t) => preguntasEntrevista(t).some((p) => p.clave === k)));

// --- Foco del día ----------------------------------------------------------------------------------------

export interface Sesion {
  version: 1;
  fecha: string;
  foco: string;
  tareas: string[];
  inicio: string;
  cierre?: { cuando: string; hechas: string[]; pendientes: string[]; aparecieron: string[] };
}

const dirSesiones = (root: string) => path.join(dataDir(root), "sesiones");
export const hoyIso = () => new Date().toISOString().slice(0, 10);

export function sesionDeHoy(root: string): Sesion | null {
  return leerJson<Sesion | null>(path.join(dirSesiones(root), `${hoyIso()}.json`), () => null);
}

export function fijarFoco(root: string, foco: string, tareas: string[] = []): Sesion {
  const prev = sesionDeHoy(root);
  const s: Sesion = { version: 1, fecha: hoyIso(), foco: foco.trim(), tareas, inicio: prev?.inicio ?? new Date().toISOString(), ...(prev?.cierre ? { cierre: prev.cierre } : {}) };
  escribirJson(path.join(dirSesiones(root), `${s.fecha}.json`), s);
  return s;
}

export function cerrarSesionDelDia(root: string): Sesion {
  const s = sesionDeHoy(root);
  if (!s) throw new Error("hoy no fijaste un foco (`cai hoy --foco \"…\"`)");
  const ts = listarTareas(root);
  const desde = Date.parse(s.inicio);
  const hechas = ts.filter((t) => t.estado === "cerrada" && Date.parse(t.actualizada) >= desde).map((t) => t.id);
  const pendientes = s.tareas.filter((id) => !hechas.includes(id));
  const aparecieron = ts.filter((t) => Date.parse(t.creada) >= desde && !s.tareas.includes(t.id)).map((t) => t.id);
  const n: Sesion = { ...s, cierre: { cuando: new Date().toISOString(), hechas, pendientes, aparecieron } };
  escribirJson(path.join(dirSesiones(root), `${s.fecha}.json`), n);
  return n;
}
