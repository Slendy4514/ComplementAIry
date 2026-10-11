/**
 * `cai migrar`: de ComplementAIry v0.11 a v1. Por defecto SIMULA (no escribe nada) y muestra el reporte.
 * Con `--aplicar`: respalda .cai/ en .cai.v0-<fecha>/, convierte, reinstala hooks e instrucciones y clasifica
 * la procedencia con git (`adoptar`). Idempotente: si ya está en v1, no hace nada.
 *
 *   zonas.criticas            → también zonas.rojas (ahora la IA NUNCA escribe ahí; se avisa)
 *   modos, modo, vista, ideas.aprender, chat, rapidas automáticas → se descartan (quién escribe es de la TAREA;
 *                               nada aparece mientras tecleas, II.3)
 *   tareas.json (v0.11)       → tareas v1 en borrador (las no hechas ni descartadas)
 *   ideas.json                → tareas v1 en borrador (las no descartadas ni convertidas)
 *   Nota.programada           → procedencia: esas funciones son de la IA (nivel 3 si se probaron todas, si no 0)
 */
import fs from "node:fs";
import path from "node:path";
import { dataDir, loadConfig } from "../proyecto/config.js";
import { leerIndice } from "../proyecto/indice.js";
import { todasLasNotas } from "../proyecto/notas.js";
import { init } from "../cli/init.js";
import { crearTarea, listarTareas } from "../proyecto/tareas.js";
import { asentar, cargarRegistro, registrarRevision } from "../proyecto/procedencia.js";
import { adoptar } from "./informe.js";

export interface ReporteMigracion {
  yaMigrado: boolean;
  acciones: string[];
  descartado: string[];
  avisos: string[];
}

interface Raw {
  version?: number;
  zonas?: { criticas?: string[]; rojas?: string[] };
  modo?: string;
  modos?: unknown;
  vista?: string;
  rapidas?: { activas?: boolean };
  ideas?: unknown;
  chat?: unknown;
  [k: string]: unknown;
}

export function migrar(root: string, aplicar = false): ReporteMigracion {
  const dir = dataDir(root);
  const archivoConfig = path.join(dir, "config.json");
  const r: ReporteMigracion = { yaMigrado: false, acciones: [], descartado: [], avisos: [] };
  if (!fs.existsSync(dir)) {
    r.acciones.push("no hay .cai/: es un proyecto nuevo → `cai init`");
    return r;
  }
  const raw = (fs.existsSync(archivoConfig) ? JSON.parse(fs.readFileSync(archivoConfig, "utf8")) : {}) as Raw;
  if (raw.version === 1) {
    r.yaMigrado = true;
    r.acciones.push("ya está en v1: nada que migrar");
    return r;
  }
  const fecha = new Date().toISOString().slice(0, 10);
  const respaldo = path.join(root, `.cai.v0-${fecha}`);
  r.acciones.push(`respaldo de .cai/ en ${path.basename(respaldo)}/`);
  // Config.
  const nuevo: Raw = { ...raw, version: 1 };
  const criticas = raw.zonas?.criticas ?? [];
  if (criticas.length) {
    nuevo.zonas = { ...raw.zonas, rojas: [...new Set([...(raw.zonas?.rojas ?? []), ...criticas])] };
    r.avisos.push(`zonas.criticas (${criticas.join(", ")}) pasan también a zonas.rojas: desde v1 la IA NUNCA escribe código ahí (ni en una tarea)`);
  }
  for (const k of ["modo", "modos", "modosVersion", "vista", "chat", "ideas"] as const)
    if (k in raw) {
      r.descartado.push(`${k}: ${JSON.stringify(raw[k]).slice(0, 80)}`);
      delete nuevo[k];
    }
  nuevo.rapidas = { ...(raw.rapidas ?? {}), activas: false };
  if (raw.rapidas?.activas !== false) r.avisos.push("las sugerencias automáticas mientras escribes quedan apagadas (II.3: interrupción del flujo); siguen disponibles a pedido (Ctrl+Alt+Espacio)");
  r.acciones.push("config.json → version 1");
  // Tareas e ideas viejas → tareas v1 en borrador.
  type TareaVieja = { id: string; titulo: string; hecha: boolean; descartada?: boolean; archivada?: boolean; detalle?: string };
  type IdeaVieja = { id: string; titulo: string; porque: string; descartada?: boolean; tarea?: string };
  const leer = <T>(f: string, d: T): T => {
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as T;
    } catch {
      return d;
    }
  };
  const tareasViejas = leer<{ tareas?: TareaVieja[] } | TareaVieja[]>("tareas.json", []);
  const listaT = (Array.isArray(tareasViejas) ? tareasViejas : (tareasViejas.tareas ?? [])).filter((t) => !t.hecha && !t.descartada && !t.archivada);
  const ideas = leer<{ ideas?: IdeaVieja[] } | IdeaVieja[]>("ideas.json", []);
  const listaI = (Array.isArray(ideas) ? ideas : (ideas.ideas ?? [])).filter((i) => !i.descartada && !i.tarea);
  const yaMigradas = new Set(listarTareas(root).map((t) => t.titulo));
  const aCrear = [...listaT.map((t) => t.titulo), ...listaI.map((i) => i.titulo)].filter((t) => !yaMigradas.has(t));
  if (aCrear.length) r.acciones.push(`${aCrear.length} tarea(s)/idea(s) pendientes → tareas v1 en borrador`);
  // Código del modo programar → procedencia de la IA.
  const programadas = todasLasNotas(root).filter((n) => (n as { programada?: { sinProbar: number } }).programada);
  if (programadas.length) r.acciones.push(`${programadas.length} función(es) escritas con el modo programar → procedencia "ia" (nivel 3 si se probaron)`);
  r.acciones.push("hooks de Claude Code (SessionStart, UserPromptSubmit, Stop, Edit/Write), git hooks, merge driver y CLAUDE.md v1", "procedencia de todo el código con git blame (`cai adoptar`)");
  if (!aplicar) return r;

  fs.cpSync(dir, respaldo, { recursive: true, filter: (s) => !s.includes(`${path.sep}cache${path.sep}`) });
  fs.writeFileSync(archivoConfig, JSON.stringify(nuevo, null, 2) + "\n");
  for (const titulo of aCrear) crearTarea(root, { titulo, intencion: "producir" });
  const idx = leerIndice(root);
  for (const n of programadas) {
    const abs = path.join(root, n.archivo);
    if (!fs.existsSync(abs)) continue;
    const f = idx.archivos[n.archivo]?.funciones.find((x) => x.nombre === n.ancla.funcion);
    if (!f) continue;
    const contenido = fs.readFileSync(abs, "utf8");
    if (!cargarRegistro(root, n.archivo)) asentar(root, n.archivo, contenido, { origen: "humano" });
    const reg = cargarRegistro(root, n.archivo)!;
    const idxs = Array.from({ length: f.lineas }, (_, i) => f.linea - 1 + i);
    for (const i of idxs) if (reg.lineas[i]) reg.lineas[i] = { ...reg.lineas[i]!, o: "ia", n: 0, a: "modo-programar-v0" };
    fs.writeFileSync(path.join(dir, "procedencia", `${n.archivo.replace(/\//g, "__")}.json`), JSON.stringify(reg, null, 2));
    const p = (n as { programada?: { sinProbar: number; prediccion?: { acierto: boolean } } }).programada!;
    if (p.sinProbar === 0) registrarRevision(root, n.archivo, contenido, idxs, 3, "migrado-v0-probado");
  }
  init(root);
  const a = adoptar(root);
  r.acciones.push(`adoptar: ${a.archivos} archivo(s) clasificados`);
  void loadConfig;
  return r;
}
