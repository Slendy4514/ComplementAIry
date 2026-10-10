import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./config.js";

/**
 * "La IA está pensando": un bloqueo por archivo (.cai/cache/ocupado/). Evita dos pedidos a la vez
 * sobre el mismo archivo y le permite a la extensión mostrar qué está haciendo la IA, aunque el
 * pedido venga del chat de Claude Code. Los bloqueos de procesos muertos se limpian solos.
 */

export interface Ocupacion {
  pid: number;
  tarea: string;
  archivo: string;
  linea?: number;
  desde: string;
}

const dir = (root: string) => path.join(dataDir(root), "cache", "ocupado");
const clave = (archivo: string) => crypto.createHash("sha1").update(archivo).digest("hex").slice(0, 12);

function vivo(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

function leer(f: string): Ocupacion | null {
  try {
    const o = JSON.parse(fs.readFileSync(f, "utf8")) as Ocupacion;
    const viejo = Date.now() - Date.parse(o.desde) > 15 * 60_000;
    if (!vivo(o.pid) || viejo) {
      fs.rmSync(f, { force: true });
      return null;
    }
    return o;
  } catch {
    return null;
  }
}

/**
 * Crea `f` con su contenido completo, solo si no existe: se escribe en un temporal y se enlaza (el
 * enlace falla si `f` ya existe). Así nadie puede leer el archivo a medio escribir.
 */
function crearCompleto(f: string, contenido: string): boolean {
  const tmp = `${f}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, contenido);
  try {
    fs.linkSync(tmp, f);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return false;
    // Sistema de archivos sin enlaces duros: creación exclusiva normal.
    try {
      fs.writeFileSync(f, contenido, { flag: "wx" });
      return true;
    } catch {
      return false;
    }
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

const dormir = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Lee el registro de otro proceso; si no se puede leer y es reciente, espera un poco (máx. ~0,5 s). */
function leerEsperando(f: string): Ocupacion | null {
  for (let i = 0; i < 25; i++) {
    const otro = leer(f);
    if (otro) return otro;
    try {
      if (Date.now() - fs.statSync(f).mtimeMs > 2000) return null; // dañado y viejo
    } catch {
      return null; // ya no existe (era de un proceso que murió)
    }
    dormir(20);
  }
  return null;
}

export type Resultado = { ok: true; liberar: () => void } | { ok: false; por: Ocupacion };

/** Cuántas veces este proceso tomó cada archivo (reentrante): se suelta recién al llegar a cero. */
const tomas = new Map<string, number>();

/** Toma el archivo (o "proyecto") para una tarea. Si ya hay otra en curso, devuelve quién lo tiene. */
export function ocupar(root: string, archivo: string, tarea: string, linea?: number): Resultado {
  const d = dir(root);
  fs.mkdirSync(d, { recursive: true });
  const f = path.join(d, `${clave(archivo)}.json`);
  const actual = leer(f);
  if (actual && actual.pid !== process.pid) return { ok: false, por: actual };
  if (actual && (tomas.get(f) ?? 0) > 0) {
    // Ya lo tiene este proceso (p. ej. el acompañante llama a "verificar"): no se suelta al terminar lo de adentro.
    tomas.set(f, tomas.get(f)! + 1);
    let hecho = false;
    return {
      ok: true,
      liberar: () => {
        if (hecho) return;
        hecho = true;
        tomas.set(f, Math.max(0, (tomas.get(f) ?? 1) - 1));
      },
    };
  }
  const o: Ocupacion = { pid: process.pid, tarea, archivo, ...(linea ? { linea } : {}), desde: new Date().toISOString() };
  if (!actual && !crearCompleto(f, JSON.stringify(o))) {
    // Otro proceso lo creó en el mismo instante: gana el primero.
    const otro = leerEsperando(f);
    if (otro) return { ok: false, por: otro };
    fs.writeFileSync(f, JSON.stringify(o)); // era de un proceso muerto o estaba dañado hace rato
  }
  tomas.set(f, 1);
  let liberado = false;
  const liberar = () => {
    if (liberado) return;
    liberado = true;
    process.removeListener("exit", liberar);
    tomas.delete(f);
    const yo = leer(f);
    if (yo?.pid === process.pid) fs.rmSync(f, { force: true });
  };
  process.once("exit", liberar);
  return { ok: true, liberar };
}

/** Pedido en espera para cuando termine la tarea actual (como mucho uno por archivo). */
export function dejarPendiente(root: string, archivo: string): void {
  fs.mkdirSync(dir(root), { recursive: true });
  fs.writeFileSync(path.join(dir(root), `${clave(archivo)}.pendiente`), new Date().toISOString());
}

export function tomarPendiente(root: string, archivo: string): boolean {
  const f = path.join(dir(root), `${clave(archivo)}.pendiente`);
  if (!fs.existsSync(f)) return false;
  fs.rmSync(f, { force: true });
  return true;
}

/** Lo que la IA está haciendo ahora en el proyecto. */
export function enCurso(root: string): Ocupacion[] {
  const d = dir(root);
  if (!fs.existsSync(d)) return [];
  return fs
    .readdirSync(d)
    .filter((f) => f.endsWith(".json"))
    .map((f) => leer(path.join(d, f)))
    .filter((o): o is Ocupacion => !!o);
}

/**
 * Como `ocupar`, pero si lo tiene el acompañante (que corre solo al guardar, también con el
 * autoguardado) espera a que termine: un pedido tuyo no se rechaza por un guardado.
 * Si lo tiene otro pedido explícito, se rechaza enseguida.
 */
export async function ocuparEsperando(root: string, archivo: string, tarea: string, linea?: number, maxMs = 120_000): Promise<Resultado> {
  const hasta = Date.now() + maxMs;
  for (;;) {
    const r = ocupar(root, archivo, tarea, linea);
    if (r.ok || !r.por.tarea.startsWith("acompañ") || Date.now() > hasta) return r;
    await new Promise((res) => setTimeout(res, 400));
  }
}

/** Ejecuta `fn` con el archivo tomado; si está ocupado, lanza un error claro. */
export async function conBloqueo<T>(root: string, archivo: string, tarea: string, fn: () => Promise<T>, linea?: number): Promise<T> {
  const r = await ocuparEsperando(root, archivo, tarea, linea);
  if (!r.ok) throw new OcupadoError(r.por);
  try {
    return await fn();
  } finally {
    r.liberar();
  }
}

export class OcupadoError extends Error {
  constructor(public por: Ocupacion) {
    super(`ya estoy ${por.tarea} en ${por.archivo} (desde hace ${Math.round((Date.now() - Date.parse(por.desde)) / 1000)} s); espera a que termine`);
  }
}

const colas = new Map<string, Promise<unknown>>();

/** Rutas que este proceso tiene tomadas con `conCandadoSync` (reentrante: no se espera a sí mismo). */
const tomadosSync = new Map<string, number>();

/**
 * Candado síncrono para leer-modificar-escribir un archivo de datos pequeño (decisiones, tareas,
 * ideas, correcciones): mismo `.lock` que `conCandado`, con espera activa corta. Es reentrante dentro
 * del proceso. Si no se consigue en `maxMs`, lanza un error explicativo.
 */
export function conCandadoSync<T>(ruta: string, fn: () => T, maxMs = 5000): T {
  const lock = `${ruta}.lock`;
  const ya = tomadosSync.get(lock) ?? 0;
  if (ya > 0) {
    tomadosSync.set(lock, ya + 1);
    try {
      return fn();
    } finally {
      tomadosSync.set(lock, (tomadosSync.get(lock) ?? 1) - 1);
    }
  }
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  const hasta = Date.now() + maxMs;
  while (!crearCompleto(lock, String(process.pid))) {
    if (candadoAbandonado(lock)) {
      fs.rmSync(lock, { force: true });
      continue;
    }
    if (Date.now() > hasta) throw new Error(`otro proceso de ComplementAIry está guardando ${path.basename(ruta)} hace más de ${Math.round(maxMs / 1000)} s; vuelve a intentarlo (si no hay ninguno corriendo, borra ${lock})`);
    dormir(15);
  }
  tomadosSync.set(lock, 1);
  try {
    return fn();
  } finally {
    tomadosSync.delete(lock);
    fs.rmSync(lock, { force: true });
  }
}

/**
 * Un `.lock` quedó abandonado si el proceso que lo tomó ya no existe (el archivo guarda su pid). Uno
 * sin pid legible (de una versión anterior) o de más de 10 min se considera abandonado también.
 */
function candadoAbandonado(lock: string): boolean {
  try {
    const edad = Date.now() - fs.statSync(lock).mtimeMs;
    const pid = Number(fs.readFileSync(lock, "utf8").trim());
    if (Number.isInteger(pid) && pid > 0) return !vivo(pid) || edad > 10 * 60_000;
    return edad > 2000;
  } catch {
    return false; // ya no existe: se reintenta
  }
}

/**
 * Candado para un archivo de DATOS compartido (índice, chat): lee-modifica-escribe sin pisarse. En
 * el mismo proceso, en fila; entre procesos, con un archivo `.lock` exclusivo (si quedó de un proceso
 * que murió, se descarta enseguida: guarda el pid de su dueño). Si no se consigue en `maxMs`, lanza un error explicativo.
 */
export function conCandado<T>(ruta: string, fn: () => Promise<T>, maxMs = 15_000): Promise<T> {
  const previa = colas.get(ruta) ?? Promise.resolve();
  const p = previa.then(async () => {
    const lock = `${ruta}.lock`;
    fs.mkdirSync(path.dirname(lock), { recursive: true });
    const hasta = Date.now() + maxMs;
    for (;;) {
      if (crearCompleto(lock, String(process.pid))) break;
      if (candadoAbandonado(lock)) fs.rmSync(lock, { force: true });
      if (Date.now() > hasta) throw new Error(`otro proceso de ComplementAIry está usando ${path.basename(ruta)} hace más de ${Math.round(maxMs / 1000)} s; vuelve a intentarlo (si no hay ninguno corriendo, borra ${lock})`);
      await new Promise((res) => setTimeout(res, 100));
    }
    try {
      return await fn();
    } finally {
      fs.rmSync(lock, { force: true });
    }
  });
  colas.set(ruta, p.catch(() => undefined));
  return p;
}
