import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Lectura y escritura de los archivos JSON de datos (.cai/ y ~/.cai/).
 *
 * - Escribir es atómico (temporal + rename): ni la extensión ni otro proceso leen un archivo a medias.
 * - Leer distingue "no existe" (se usa el valor por defecto) de "está dañado": un archivo dañado NO se
 *   trata como vacío, porque el siguiente guardado pisaría tus decisiones, tareas o notas. Se guarda una
 *   copia al lado y se lanza un error que dice qué pasó y qué hacer.
 */

export class DatosDanados extends Error {
  constructor(
    public readonly ruta: string,
    public readonly copia: string,
    detalle: string,
  ) {
    super(`${path.basename(ruta)} está dañado (${detalle}). Guardé una copia en ${copia}. Arréglalo a mano o bórralo para empezar de cero; mientras tanto no lo sobrescribo.`);
  }
}

/** Lee un JSON de datos. No existe → `porDefecto()`. Dañado → copia + `DatosDanados`. */
export function leerJson<T>(ruta: string, porDefecto: () => T): T {
  let texto: string;
  try {
    texto = fs.readFileSync(ruta, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return porDefecto();
    throw new Error(`no pude leer ${ruta}: ${(e as Error).message}`);
  }
  if (!texto.trim()) return porDefecto(); // vacío (p. ej. creado a mano): equivale a no tener datos
  try {
    return JSON.parse(texto) as T;
  } catch (e) {
    throw new DatosDanados(ruta, copiaDeDanado(ruta, texto), (e as Error).message);
  }
}

/**
 * Para cachés que se regeneran solas (índice, panorama, propuestas): dañado o ausente → `porDefecto()`.
 * No usar con datos que escribe o decide el programador.
 */
export function leerCache<T>(ruta: string, porDefecto: () => T): T {
  try {
    return JSON.parse(fs.readFileSync(ruta, "utf8")) as T;
  } catch {
    return porDefecto();
  }
}

/** Escribe JSON de forma atómica (crea la carpeta si falta). */
export function escribirJson(ruta: string, datos: unknown, o: { final?: string } = {}): void {
  escribirTexto(ruta, JSON.stringify(datos, null, 2) + (o.final ?? ""));
}

/** Escribe texto de forma atómica: temporal único en la misma carpeta y rename. */
export function escribirTexto(ruta: string, texto: string): void {
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  const tmp = `${ruta}.${process.pid}.${crypto.randomBytes(3).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(tmp, texto);
    fs.renameSync(tmp, ruta);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw new Error(`no pude guardar ${ruta}: ${(e as Error).message}`);
  }
}

/** La copia lleva una huella del contenido: leer muchas veces el mismo archivo dañado deja UNA copia. */
function copiaDeDanado(ruta: string, texto: string): string {
  const copia = `${ruta}.danado-${crypto.createHash("sha1").update(texto).digest("hex").slice(0, 8)}`;
  try {
    if (!fs.existsSync(copia)) fs.writeFileSync(copia, texto);
  } catch {
    /* sin permiso de escritura: el error igual dice qué archivo revisar */
  }
  return copia;
}
