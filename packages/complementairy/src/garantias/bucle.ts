/**
 * PULL THE PLUG (manifiesto V.7). Señales deterministas de que la IA entró en un bucle de degradación
 * ("prompt treadmill of hell"); al pasar el umbral la tarea queda DESCONECTADA y el hook deniega toda
 * escritura de la IA en ella. Checkpoints: cada Stop con tests en verde guarda refs/cai/cp/<tarea>/<n>
 * (sin tocar tu rama). `cai volver` (solo humano) deja el trabajo en cai/abandono-<id>, vuelve al último
 * punto verde y te pide un replanteo escrito por ti.
 *
 * Señales (cada una suma):
 *   mismo-fallo   el mismo test falla con la misma firma de error 3 veces seguidas
 *   oscilacion    el archivo vuelve a un contenido anterior (A → B → A)
 *   denegaciones  3 intentos seguidos que el hook tuvo que denegar
 *   sin-avance    el diff de la tarea crece 3 veces sin que pasen más tests
 *   contexto      la conversación se compactó o pasó el umbral de turnos
 *   disculpas     "tienes razón / probemos otro enfoque" 3 veces (solo suma; nunca basta sola)
 */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDir, loadConfig } from "../proyecto/config.js";
import { leerCache, escribirJson } from "../proyecto/almacen.js";
import { conCandadoSync } from "../proyecto/ocupado.js";
import { conContenido } from "../nucleo/especificidad.js";
import type { Tarea } from "../nucleo/flujo.js";
import { cargarTarea, conTarea } from "../proyecto/tareas.js";

export type Senal = "mismo-fallo" | "oscilacion" | "denegaciones" | "sin-avance" | "contexto" | "disculpas";

interface Historia {
  fallos: string[];
  hashes: Record<string, string[]>;
  denegacionesSeguidas: number;
  crecimientos: { lineas: number; verdes: number }[];
  disculpas: number;
  senales: Senal[];
}

const archivo = (root: string, id: string) => path.join(dataDir(root), "cache", "bucle", `${id}.json`);
const vacia = (): Historia => ({ fallos: [], hashes: {}, denegacionesSeguidas: 0, crecimientos: [], disculpas: 0, senales: [] });

function conHistoria(root: string, id: string, f: (h: Historia) => void): Historia {
  return conCandadoSync(archivo(root, id), () => {
    const h = leerCache<Historia>(archivo(root, id), vacia);
    f(h);
    escribirJson(archivo(root, id), h);
    return h;
  });
}

/** Firma normalizada de un error (sin números de línea, rutas temporales ni tiempos). */
export function firmaError(salida: string): string | null {
  const l = salida.split("\n").find((x) => /(Error|FAIL|✗|×|AssertionError|expected|Traceback|failed)/i.test(x));
  if (!l) return null;
  return l.replace(/\d+(\.\d+)?\s*m?s\b/g, "").replace(/:\d+:\d+/g, "").replace(/\/tmp\/[\w./-]+/g, "<tmp>").replace(/\s+/g, " ").trim().slice(0, 200);
}

const sumar = (h: Historia, s: Senal) => {
  if (!h.senales.includes(s) || s === "disculpas") h.senales.push(s);
};

/** Una corrida de tests de la IA (PostToolUse Bash). */
export function registrarPrueba(root: string, t: Tarea, salida: string, ok: boolean, verdes?: number): Senal[] {
  const h = conHistoria(root, t.id, (h) => {
    if (ok) {
      h.fallos = [];
      return;
    }
    const f = firmaError(salida);
    if (!f) return;
    h.fallos.push(f);
    if (h.fallos.length >= 3 && h.fallos.slice(-3).every((x) => x === f)) sumar(h, "mismo-fallo");
    if (verdes !== undefined) h.crecimientos.push({ lineas: -1, verdes });
  });
  return evaluar(root, t, h);
}

/** Una edición de la IA (PostToolUse Edit): oscilación y crecimiento del diff. */
export function registrarEdicion(root: string, t: Tarea, rel: string, contenido: string, lineasTarea: number): Senal[] {
  const hash = crypto.createHash("sha1").update(contenido).digest("hex").slice(0, 12);
  const h = conHistoria(root, t.id, (h) => {
    h.denegacionesSeguidas = 0;
    const prev = h.hashes[rel] ?? [];
    if (prev.slice(0, -1).includes(hash)) sumar(h, "oscilacion");
    h.hashes[rel] = [...prev, hash].slice(-12);
    const ult = h.crecimientos[h.crecimientos.length - 1];
    h.crecimientos.push({ lineas: lineasTarea, verdes: ult?.verdes ?? 0 });
    const u = h.crecimientos.filter((c) => c.lineas >= 0).slice(-4);
    if (u.length === 4 && u.every((c, i) => i === 0 || (c.lineas > u[i - 1]!.lineas && c.verdes <= u[i - 1]!.verdes)) && u[3]!.lineas > t.restricciones.presupuestoLineas * 3) sumar(h, "sin-avance");
  });
  return evaluar(root, t, h);
}

export function registrarDenegacion(root: string, t: Tarea): Senal[] {
  const h = conHistoria(root, t.id, (h) => {
    h.denegacionesSeguidas++;
    if (h.denegacionesSeguidas >= 3) sumar(h, "denegaciones");
  });
  return evaluar(root, t, h);
}

export function registrarContexto(root: string, t: Tarea, motivo: string): Senal[] {
  const h = conHistoria(root, t.id, (h) => sumar(h, "contexto"));
  void motivo;
  return evaluar(root, t, h);
}

const DISCULPA = /\b(tienes raz[oó]n|you'?re right|mis disculpas|i apologi[sz]e|probemos otro enfoque|let me try (a )?different|intentemos de nuevo|sorry)\b/i;
export function registrarRespuestaIa(root: string, t: Tarea, texto: string): Senal[] {
  if (!DISCULPA.test(texto)) return [];
  const h = conHistoria(root, t.id, (h) => {
    h.disculpas++;
    if (h.disculpas >= 3) sumar(h, "disculpas");
  });
  return evaluar(root, t, h);
}

/** Si el puntaje llega al umbral (las disculpas solas no bastan), la tarea se desconecta. */
function evaluar(root: string, t: Tarea, h: Historia): Senal[] {
  const umbral = loadConfig(root).flujo.umbralBucle;
  const fuertes = h.senales.filter((s) => s !== "disculpas");
  const puntaje = fuertes.length + (h.senales.includes("disculpas") && fuertes.length ? 1 : 0);
  conTarea(root, t.id, (x) => ({ ...x, bucle: { senales: h.senales, puntaje, actualizado: new Date().toISOString() } }));
  const desconectar = puntaje >= umbral || h.senales.includes("mismo-fallo") && h.senales.includes("oscilacion") || (fuertes.length >= 1 && h.fallos.length >= 5 && new Set(h.fallos.slice(-5)).size === 1);
  if (desconectar && t.estado === "ejecutando") {
    conTarea(root, t.id, (x) => ({ ...x, estado: "desconectada", actualizada: new Date().toISOString(), historial: [...x.historial, { de: x.estado, a: "desconectada", cuando: new Date().toISOString(), motivo: `bucle: ${h.senales.join(", ")}` }] }));
  }
  return h.senales;
}

export function senalesDe(root: string, id: string): Senal[] {
  return leerCache<Historia>(archivo(root, id), vacia).senales;
}

// --- Checkpoints y volver ------------------------------------------------------------------------------------

function git(root: string, args: string[], env: Record<string, string> = {}): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...env } }).trim();
}

/**
 * Guarda el estado actual del árbol (con los cambios sin commitear) como checkpoint de la tarea, sin tocar
 * tu rama ni tu índice: un commit "colgado" en refs/cai/cp/<tarea>/<n>.
 */
export function checkpoint(root: string, id: string, motivo: string, comoPuntoVerde = true): string | null {
  try {
    const idx = path.join(dataDir(root), "cache", `cp-index-${process.pid}`);
    const env = { GIT_INDEX_FILE: idx };
    fs.rmSync(idx, { force: true });
    try {
      git(root, ["read-tree", "HEAD"], env);
    } catch {
      /* repo sin commits */
    }
    git(root, ["add", "-A", "--", ".", ":(exclude).cai/cache"], env);
    const arbol = git(root, ["write-tree"], env);
    fs.rmSync(idx, { force: true });
    let padre: string[] = [];
    try {
      padre = ["-p", git(root, ["rev-parse", "HEAD"])];
    } catch {
      /* sin HEAD */
    }
    const commit = git(root, ["commit-tree", arbol, ...padre, "-m", `cai checkpoint ${id}: ${motivo}`]);
    if (comoPuntoVerde) {
      const n = conTarea(root, id, (t) => ({ ...t, checkpoints: [...t.checkpoints, commit] })).checkpoints.length;
      git(root, ["update-ref", `refs/cai/cp/${id}/${n}`, commit]);
    }
    return commit;
  } catch {
    return null;
  }
}

/**
 * `cai volver <tarea>` (solo humano): guarda el trabajo actual en la rama cai/abandono-<id>, restaura los
 * archivos de la tarea al último checkpoint verde (o a la base) y deja la tarea en "diseñada" con tu replanteo.
 */
export function volver(root: string, id: string, replanteo: string, o: { manual?: boolean } = {}): { rama: string; a: string; archivos: string[] } {
  if (conContenido(replanteo).length < 5) throw new Error("escribe tu replanteo: qué falló en el diseño o en el plan (al menos una oración con contenido). Es lo que evita repetir el bucle");
  const t = cargarTarea(root, id);
  const destino = t.checkpoints[t.checkpoints.length - 1] ?? t.base;
  if (!destino) throw new Error("no hay checkpoint ni base de git para volver");
  const abandono = checkpoint(root, id, "abandono", false);
  const rama = `cai/abandono-${id}-${Date.now().toString(36)}`;
  if (abandono) git(root, ["branch", rama, abandono]);
  const archivos = t.tocados.length ? t.tocados : git(root, ["diff", "--name-only", destino]).split("\n").filter(Boolean);
  for (const f of archivos) {
    try {
      git(root, ["checkout", destino, "--", f]);
    } catch {
      fs.rmSync(path.join(root, f), { force: true }); // no existía en el punto verde
    }
  }
  fs.rmSync(archivo(root, id), { force: true });
  conTarea(root, id, (x) => ({
    ...x,
    estado: o.manual ? "ejecutando" : "diseñada",
    ejecutor: o.manual ? "humano" : x.ejecutor,
    replanteo: replanteo.trim(),
    bucle: { senales: [], puntaje: 0, actualizado: new Date().toISOString() },
    actualizada: new Date().toISOString(),
    historial: [...x.historial, { de: x.estado, a: o.manual ? "ejecutando" : "diseñada", cuando: new Date().toISOString(), motivo: `volver: ${replanteo.trim()}` }],
    dialogo: [...x.dialogo, { quien: "tu" as const, fase: "replanteo", texto: replanteo.trim(), cuando: new Date().toISOString() }],
  }));
  return { rama: abandono ? rama : "(no se pudo guardar)", a: destino.slice(0, 8), archivos };
}

/** Desconectar a mano (cuando tú ves que da vueltas). */
export function desconectarAMano(root: string, id: string, motivo: string): Tarea {
  return conTarea(root, id, (x) => {
    if (!["ejecutando", "en-revision"].includes(x.estado)) throw new Error(`la tarea ${id} está ${x.estado}: solo se desconecta mientras la IA trabaja`);
    return { ...x, estado: "desconectada", actualizada: new Date().toISOString(), historial: [...x.historial, { de: x.estado, a: "desconectada", cuando: new Date().toISOString(), motivo: `a mano: ${motivo}` }] };
  });
}
