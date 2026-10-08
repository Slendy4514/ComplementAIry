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
}

export interface Nota {
  id: string;
  archivo: string;
  ancla: { linea: number; texto: string; funcion?: string };
  tipo: string;
  titulo: string;
  accion: string;
  hilo: Mensaje[];
  snippets: { llamada: string; despues: string }[];
  bloqueante: boolean;
  estado: "abierta" | "resuelta";
  origen: string;
  prediccion?: { expresion: string; funcion: string };
  desanclada?: boolean;
  alcance?: "archivo";
  actualizada: string;
}

export const archivoNotas = (cwd: string, rel: string) => path.join(dataDir(cwd), "notas", rel.replace(/[\\/]/g, "__") + ".json");

/** Igual que en la CLI (notas.ts): misma línea, la más cercana con el mismo texto, o la función. */
export function reanclar(lineas: string[], n: Nota): Nota {
  if (n.alcance === "archivo") return { ...n, ancla: { ...n.ancla, linea: 1 }, desanclada: false };
  const objetivo = n.ancla.texto.trim();
  const i = n.ancla.linea - 1;
  if (objetivo && lineas[i]?.trim() === objetivo) return { ...n, desanclada: false };
  if (objetivo) {
    let mejor = -1;
    for (let k = 0; k < lineas.length; k++) if (lineas[k]!.trim() === objetivo && (mejor < 0 || Math.abs(k - i) < Math.abs(mejor - i))) mejor = k;
    if (mejor >= 0) return { ...n, ancla: { ...n.ancla, linea: mejor + 1 }, desanclada: false };
  }
  if (n.ancla.funcion) {
    const re = new RegExp(`\\b${n.ancla.funcion.replace(/[$]/g, "\\$")}\\b\\s*(=\\s*(async\\s*)?\\(|\\(|:)`);
    const k = lineas.findIndex((l) => re.test(l));
    if (k >= 0) return { ...n, ancla: { ...n.ancla, linea: k + 1, texto: lineas[k]!.trim() }, desanclada: false };
  }
  return { ...n, ancla: { ...n.ancla, linea: Math.min(Math.max(1, n.ancla.linea), Math.max(1, lineas.length)) }, desanclada: !!objetivo };
}

/**
 * Notas abiertas de un documento, re-ancladas contra el texto ACTUAL del editor (aunque no esté guardado).
 * `undefined` si el archivo de notas no se pudo leer (así no se borran los hilos por un error pasajero).
 */
export function notasDe(cwd: string, doc: vscode.TextDocument): Nota[] | undefined {
  const f = archivoNotas(cwd, relDe(cwd, doc.uri.fsPath));
  if (!fs.existsSync(f)) return [];
  try {
    const todas = (JSON.parse(fs.readFileSync(f, "utf8")) as { notas: Nota[] }).notas ?? [];
    const lineas = doc.getText().split(/\r?\n/);
    return todas.filter((n) => n.estado === "abierta").map((n) => reanclar(lineas, n));
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
