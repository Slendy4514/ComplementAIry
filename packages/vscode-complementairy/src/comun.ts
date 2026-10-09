import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import * as vscode from "vscode";

/**
 * Lo que comparten los módulos de la extensión: llamar a la CLI `cai`, ubicar el proyecto y
 * leer las notas (.cai/notas/*.json). La extensión LEE los datos directo (rápido) y ESCRIBE
 * siempre a través de la CLI, que es donde están las reglas.
 */

export const output = vscode.window.createOutputChannel("ComplementAIry");

export function cli(): string {
  return vscode.workspace.getConfiguration("cai").get<string>("comando", "cai");
}

export function root(doc?: vscode.TextDocument): string | undefined {
  const folder = doc ? vscode.workspace.getWorkspaceFolder(doc.uri) : vscode.workspace.workspaceFolders?.[0];
  return folder?.uri.fsPath;
}

export const relDe = (cwd: string, fsPath: string) => path.relative(cwd, fsPath).split(path.sep).join("/");

const shq = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;

/** La CLI respondió que ya hay otro pedido en curso sobre ese archivo (código 3). */
export class OcupadoError extends Error {}

/**
 * Corre `cai ...`. Devuelve stdout. Si sale con 3 lanza OcupadoError; con otro código distinto de 0
 * (salvo los de `aceptar`, p. ej. el 1 de `check` = "alguna predicción no coincidió") lanza un error.
 */
export function correr(args: string[], cwd: string, o: { silencioso?: boolean; aceptar?: number[] } = {}): Promise<string> {
  if (!o.silencioso) output.appendLine(`$ ${cli()} ${args.join(" ")}`);
  return new Promise((resolve, reject) => {
    execFile("sh", ["-c", `${cli()} ${args.map(shq).join(" ")}`], { cwd, maxBuffer: 16 << 20, env: { ...process.env, CLAUDE_PROJECT_DIR: cwd } }, (err, stdout, stderr) => {
      if (!o.silencioso) {
        output.append(stdout.length > 4000 ? `${stdout.slice(0, 4000)}…\n` : stdout);
        if (stderr) output.append(stderr);
      }
      const code = err && typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : err ? 1 : 0;
      if (code === 3) {
        let msg = stderr.replace(/^cai:\s*/, "").trim();
        try {
          msg = (JSON.parse(stdout) as { mensaje?: string }).mensaje ?? msg;
        } catch {
          /* salida de texto */
        }
        return reject(new OcupadoError(msg || "la IA ya está trabajando en este archivo"));
      }
      if (err && !o.aceptar?.includes(code)) {
        const detalle = stderr.replace(/^cai:\s*/, "").trim() || stdout.trim().split("\n").slice(-3).join(" · ") || err.message;
        reject(new Error(detalle));
      } else resolve(stdout.trim());
    });
  });
}

export const dataDir = (cwd: string) => (fs.existsSync(path.join(cwd, ".aicode")) && !fs.existsSync(path.join(cwd, ".cai")) ? path.join(cwd, ".aicode") : path.join(cwd, ".cai"));

/** Vista efectiva: lo que diga .cai/config.json, si no el ajuste de VSCode, si no "notas". */
export function vista(cwd: string): "notas" | "comentarios" {
  try {
    const v = (JSON.parse(fs.readFileSync(path.join(dataDir(cwd), "config.json"), "utf8")) as { vista?: string }).vista;
    if (v === "notas" || v === "comentarios") return v;
  } catch {
    /* sin config */
  }
  const s = vscode.workspace.getConfiguration("cai").get<string>("vista", "proyecto");
  return s === "comentarios" ? "comentarios" : "notas";
}

/** Para que la CLI use la misma vista que el ajuste de VSCode cuando el proyecto no fija una. */
export function envVista(): void {
  const s = vscode.workspace.getConfiguration("cai").get<string>("vista", "proyecto");
  if (s === "notas" || s === "comentarios") process.env.CAI_VISTA = s;
  else delete process.env.CAI_VISTA;
}

/** Guardados que hace la propia extensión (antes de llamar a la CLI): no disparan el acompañante. */
const propios = new Set<string>();
export const guardadoPropio = (doc: vscode.TextDocument) => propios.has(doc.uri.toString());
export async function guardar(doc: vscode.TextDocument): Promise<void> {
  if (!doc.isDirty) return;
  const k = doc.uri.toString();
  propios.add(k);
  try {
    await doc.save();
  } finally {
    setTimeout(() => propios.delete(k), 500);
  }
}

// --- Notas -------------------------------------------------------------------------------

export interface Mensaje {
  quien: "tu" | "ia";
  texto: string;
  fecha: string;
  meta?: { kind?: string; modelo?: string; costo?: number };
}

export interface Nota {
  id: string;
  archivo: string;
  ancla: { linea: number; texto: string; funcion?: string };
  tipo: string;
  titulo: string;
  accion: string;
  hilo: Mensaje[];
  snippets: { llamada: string; despues: string; linea?: number; lugar?: "ubicado" | "sin ubicar" }[];
  bloqueante: boolean;
  estado: "abierta" | "resuelta";
  origen: string;
  prediccion?: { expresion: string; funcion: string };
  desanclada?: boolean;
  alcance?: "archivo";
  verificacion?: { estado: "lista" | "casi" | "falta"; resumen: string; fecha: string; hash: string; lineas?: string[] };
  modo?: string;
  dados?: string[];
  explicacion?: { texto: string; coincide: boolean; comentario: string };
  testsProbados?: { funcion: string; fecha: string; archivo?: string };
  ultimaPrueba?: { fecha: string; pasan: number; fallan: number; detalle: { descripcion: string; estado: string; obtenido?: string; esperado: string; llamada: string }[] };
  actualizada: string;
}

export const archivoNotas = (cwd: string, rel: string) => path.join(dataDir(cwd), "notas", rel.replace(/[\\/]/g, "__") + ".json");

/** Línea (0-based) que DEFINE la función de la clave "nombre" o "nombre#k". Igual que en la CLI (notas.ts). */
function lineaDeDefinicion(lineas: string[], clave: string): number {
  const nombre = clave.replace(/#\d+$/, "");
  const k = Number(/#(\d+)$/.exec(clave)?.[1] ?? 1);
  const esc = nombre.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const inicio = new RegExp(`^\\s*(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?(?:static\\s+)?(?:(?:function\\*?|def|fn|func|fun|const|let|var|private|public|protected|override|get|set)\\s+)*${esc}\\s*(?:[=:(<])`);
  const conPalabra = new RegExp(`\\b(?:function|def|fn|func|fun|const|let|var)\\s+\\*?\\s*${esc}\\b`);
  let vistas = 0;
  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i]!;
    if (!inicio.test(l)) continue;
    const sinComentario = l.replace(/\s*(\/\/|#).*$/, "").trimEnd();
    const define = conPalabra.test(l) || (/(\{|=>|:)$/.test(sinComentario) && !/;$/.test(sinComentario));
    if (define && ++vistas === k) return i;
  }
  return -1;
}

/** Clave de una función (símbolo de VSCode): su nombre, o "nombre#k" si se repite (igual que la CLI). */
export function claveDeSimbolo(funciones: vscode.DocumentSymbol[], s: vscode.DocumentSymbol): string {
  const nombre = (x: vscode.DocumentSymbol) => x.name.replace(/\(.*$/, "");
  const mismos = funciones.filter((x) => nombre(x) === nombre(s)).sort((a, b) => a.range.start.line - b.range.start.line);
  return mismos.length > 1 ? `${nombre(s)}#${mismos.indexOf(s) + 1}` : nombre(s);
}

/** Igual que en la CLI (notas.ts): misma línea, la función, o la línea más cercana con el mismo texto. */
export function reanclar(lineas: string[], n: Nota): Nota {
  if (n.alcance === "archivo") return { ...n, ancla: { ...n.ancla, linea: 1 }, desanclada: false };
  const objetivo = n.ancla.texto.trim();
  const i = n.ancla.linea - 1;
  if (objetivo && lineas[i]?.trim() === objetivo) return { ...n, desanclada: false };
  if (n.ancla.funcion) {
    const k = lineaDeDefinicion(lineas, n.ancla.funcion);
    if (k >= 0) return { ...n, ancla: { ...n.ancla, linea: k + 1, texto: lineas[k]!.trim() }, desanclada: false };
  }
  if (objetivo) {
    let mejor = -1;
    for (let k = 0; k < lineas.length; k++) if (lineas[k]!.trim() === objetivo && (mejor < 0 || Math.abs(k - i) < Math.abs(mejor - i))) mejor = k;
    if (mejor >= 0) return { ...n, ancla: { ...n.ancla, linea: mejor + 1 }, desanclada: false };
  }
  return { ...n, ancla: { ...n.ancla, linea: Math.min(Math.max(1, n.ancla.linea), Math.max(1, lineas.length)) }, desanclada: !!objetivo };
}

/**
 * Notas abiertas de un documento, re-ancladas contra el texto ACTUAL del editor (aunque no esté guardado).
 * `undefined` si el archivo de notas no se pudo leer (así no se borran los hilos por un error pasajero).
 */
export function notasDe(cwd: string, doc: vscode.TextDocument, incluirResueltas = false): Nota[] | undefined {
  const f = archivoNotas(cwd, relDe(cwd, doc.uri.fsPath));
  if (!fs.existsSync(f)) return [];
  try {
    const todas = (JSON.parse(fs.readFileSync(f, "utf8")) as { notas: Nota[] }).notas ?? [];
    const lineas = doc.getText().split(/\r?\n/);
    return todas.filter((n) => incluirResueltas || n.estado === "abierta").map((n) => (n.estado === "abierta" ? reanclar(lineas, n) : n));
  } catch {
    return undefined;
  }
}

/** Todas las notas abiertas del proyecto, sin re-anclar (para el panel). */
export function todasLasNotas(cwd: string): Nota[] {
  const d = path.join(dataDir(cwd), "notas");
  if (!fs.existsSync(d)) return [];
  const out: Nota[] = [];
  for (const f of fs.readdirSync(d).filter((x) => x.endsWith(".json"))) {
    try {
      out.push(...((JSON.parse(fs.readFileSync(path.join(d, f), "utf8")) as { notas: Nota[] }).notas ?? []).filter((n) => n.estado === "abierta"));
    } catch {
      /* archivo a medio escribir: se relee en el próximo cambio */
    }
  }
  return out;
}

// --- Qué está haciendo la IA (.cai/cache/ocupado/) ------------------------------------------

export interface Ocupacion {
  pid: number;
  tarea: string;
  archivo: string;
  linea?: number;
  desde: string;
}

function vivo(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function enCurso(cwd: string): Ocupacion[] {
  const d = path.join(dataDir(cwd), "cache", "ocupado");
  if (!fs.existsSync(d)) return [];
  const out: Ocupacion[] = [];
  for (const f of fs.readdirSync(d).filter((x) => x.endsWith(".json"))) {
    try {
      const o = JSON.parse(fs.readFileSync(path.join(d, f), "utf8")) as Ocupacion;
      if (vivo(o.pid) && Date.now() - Date.parse(o.desde) < 15 * 60_000) out.push(o);
    } catch {
      /* recién borrado */
    }
  }
  return out;
}

// --- Silenciar (para concentrarse) -----------------------------------------------------------

let silencioHasta = 0;
export const silenciado = () => Date.now() < silencioHasta;
export const minutosSilencio = () => Math.ceil((silencioHasta - Date.now()) / 60_000);
export function silenciar(min: number): void {
  silencioHasta = min > 0 ? Date.now() + min * 60_000 : 0;
}

export function mostrarError(e: unknown): void {
  if (e instanceof OcupadoError) vscode.window.showWarningMessage(`ComplementAIry: ${e.message}`);
  else vscode.window.showErrorMessage(`ComplementAIry: ${(e as Error).message}`, "Ver salida").then((v) => v && output.show());
}

// --- Configuración del proyecto (.cai/config.json) ---------------------------------------------

export interface ConfigProyecto {
  vista?: "notas" | "comentarios";
  modo?: string;
  modos?: { porCarpeta?: Record<string, string>; porArchivo?: Record<string, string>; porFuncion?: Record<string, string> };
  ayuda?: { porDefecto?: string };
  rapidas?: { activas?: boolean; esperaMs?: number; procesoAbierto?: boolean; soloConNota?: boolean; maxHora?: number };
  acompanar?: { nivel?: string; revisar?: boolean; verificar?: boolean; esperaAutoguardado?: number; maxLlamadasHora?: number };
  ia?: { modelos?: { chico?: string; mediano?: string; grande?: string } };
  tests?: { carpeta?: string; crearConIa?: boolean; alGuardar?: boolean };
  [k: string]: unknown;
}

/** Lo que está escrito en .cai/config.json (sin valores por defecto). Con `estricto`, un JSON inválido es un error (no {}). */
export function leerConfig(cwd: string, estricto = false): ConfigProyecto {
  const f = path.join(dataDir(cwd), "config.json");
  if (!fs.existsSync(f)) return {};
  try {
    return JSON.parse(fs.readFileSync(f, "utf8")) as ConfigProyecto;
  } catch (e) {
    if (estricto) throw new Error(`${path.relative(cwd, f)} no es un JSON válido (${(e as Error).message}); arréglalo antes de guardar la configuración para no perder lo que tiene`);
    return {};
  }
}

// --- Modos (igual que la CLI, modos.ts): función > archivo > carpeta > proyecto -------------------

export type Modo = "programar" | "aprender";
export const MODOS: Record<Modo, { etiqueta: string; icono: string; explicar: boolean; predecir: boolean; rapidas: boolean }> = {
  programar: { etiqueta: "programar", icono: "rocket", explicar: false, predecir: false, rapidas: true },
  aprender: { etiqueta: "aprender", icono: "mortar-board", explicar: true, predecir: true, rapidas: false },
};
const esModo = (m: unknown): m is Modo => typeof m === "string" && m in MODOS;

// Glob a RegExp: "**" + "/" = cero o más carpetas (como picomatch); "*" = dentro de una carpeta.
function glob(g: string): RegExp {
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

/** ¿La carpeta (prefijo "src/legacy/" o glob) incluye la ruta? y cuán específica es (igual que la CLI). */
function carpetaIncluye(clave: string, rel: string): number {
  if (/[*?]/.test(clave)) return glob(clave).test(rel) ? clave.replace(/[*?].*$/, "").length : -1;
  const pref = clave.endsWith("/") ? clave : `${clave}/`;
  return rel.startsWith(pref) ? pref.length : -1;
}

/** Función ("nombre" o "nombre#k") > archivo > carpeta (la más específica) > proyecto. Igual que la CLI (modos.ts). */
export function modoEfectivo(cfg: ConfigProyecto, rel: string, funcion?: string): { modo: Modo; origen: "funcion" | "archivo" | "carpeta" | "proyecto" } {
  const f = funcion ? cfg.modos?.porFuncion?.[`${rel}:${funcion}`] : undefined;
  if (esModo(f)) return { modo: f, origen: "funcion" };
  const a = cfg.modos?.porArchivo?.[rel];
  if (esModo(a)) return { modo: a, origen: "archivo" };
  const c = Object.entries(cfg.modos?.porCarpeta ?? {})
    .map(([g, m]) => ({ m, n: esModo(m) ? carpetaIncluye(g, rel) : -1 }))
    .filter((x) => x.n >= 0)
    .sort((x, y) => y.n - x.n)[0];
  if (c) return { modo: c.m as Modo, origen: "carpeta" };
  return { modo: esModo(cfg.modo) ? cfg.modo : "programar", origen: "proyecto" };
}
