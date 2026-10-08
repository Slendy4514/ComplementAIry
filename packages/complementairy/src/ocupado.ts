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

export type Resultado = { ok: true; liberar: () => void } | { ok: false; por: Ocupacion };

/** Toma el archivo (o "proyecto") para una tarea. Si ya hay otra en curso, devuelve quién lo tiene. */
export function ocupar(root: string, archivo: string, tarea: string, linea?: number): Resultado {
  const d = dir(root);
  fs.mkdirSync(d, { recursive: true });
  const f = path.join(d, `${clave(archivo)}.json`);
  const actual = leer(f);
  if (actual && actual.pid !== process.pid) return { ok: false, por: actual };
  const o: Ocupacion = { pid: process.pid, tarea, archivo, ...(linea ? { linea } : {}), desde: new Date().toISOString() };
  try {
    // "wx": si otro proceso lo creó en el mismo instante, gana el primero.
    if (!actual) fs.writeFileSync(f, JSON.stringify(o), { flag: "wx" });
  } catch {
    const otro = leer(f);
    if (otro) return { ok: false, por: otro };
    fs.writeFileSync(f, JSON.stringify(o));
  }
  let liberado = false;
  const liberar = () => {
    if (liberado) return;
    liberado = true;
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
