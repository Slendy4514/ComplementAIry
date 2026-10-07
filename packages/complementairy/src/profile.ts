import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Perfil del programador: cuánto domina cada tema (lenguaje, librería).
 * Vive en ~/.cai (es de la persona, no del proyecto). Es un JSON legible y editable;
 * cada cambio queda registrado en eventos.jsonl con su motivo. Nada opaco.
 */

export type Nivel = "aprendiz" | "intermedio" | "experto";

export interface Tema {
  puntaje: number;
  declarado?: Nivel;
  eventos: number;
  actualizado: string;
}

export interface Perfil {
  version: 1;
  temas: Record<string, Tema>;
}

const NIVEL_PUNTAJE: Record<Nivel, number> = { aprendiz: 0.2, intermedio: 0.55, experto: 0.85 };
/** Tema nunca visto: se asume aprendiz, que es el error seguro (más guía, no menos). */
export const PUNTAJE_DESCONOCIDO = 0.3;

export function home(): string {
  const env = process.env.CAI_HOME ?? process.env.AICODE_HOME;
  if (env) return env;
  // Perfil creado antes del cambio de nombre (~/.aicode): se sigue usando si no hay uno nuevo.
  const nueva = path.join(os.homedir(), ".cai");
  const vieja = path.join(os.homedir(), ".aicode");
  return !fs.existsSync(nueva) && fs.existsSync(vieja) ? vieja : nueva;
}
const file = () => path.join(home(), "perfil.json");

export function nivelDe(puntaje: number): Nivel {
  if (puntaje < 0.4) return "aprendiz";
  if (puntaje < 0.75) return "intermedio";
  return "experto";
}

export function loadPerfil(): Perfil {
  try {
    return JSON.parse(fs.readFileSync(file(), "utf8")) as Perfil;
  } catch {
    return { version: 1, temas: {} };
  }
}

function save(p: Perfil): void {
  fs.mkdirSync(home(), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(p, null, 2) + "\n");
}

export function puntaje(p: Perfil, tema: string): number {
  return p.temas[tema]?.puntaje ?? PUNTAJE_DESCONOCIDO;
}

export function declarar(tema: string, nivel: Nivel): void {
  const p = loadPerfil();
  p.temas[tema] = { puntaje: NIVEL_PUNTAJE[nivel], declarado: nivel, eventos: p.temas[tema]?.eventos ?? 0, actualizado: new Date().toISOString() };
  save(p);
  log({ tema, delta: 0, motivo: `declarado ${nivel}` });
}

/** Ajuste por evidencia observada. Deltas chicos: el perfil cambia de a poco y con motivo. */
export function registrar(tema: string, delta: number, motivo: string): void {
  const p = loadPerfil();
  const t = p.temas[tema] ?? { puntaje: PUNTAJE_DESCONOCIDO, eventos: 0, actualizado: "" };
  t.puntaje = Math.round(Math.min(1, Math.max(0, t.puntaje + delta)) * 1000) / 1000;
  t.eventos++;
  t.actualizado = new Date().toISOString();
  p.temas[tema] = t;
  save(p);
  log({ tema, delta, motivo });
}

function log(e: { tema: string; delta: number; motivo: string }): void {
  fs.mkdirSync(home(), { recursive: true });
  fs.appendFileSync(path.join(home(), "eventos.jsonl"), JSON.stringify({ fecha: new Date().toISOString(), ...e }) + "\n");
}

/** Temas de un archivo, deterministas: el lenguaje y las librerías externas que importa. */
export function temasDe(langId: string, src: string): string[] {
  const libs = new Set<string>();
  const add = (spec: string) => {
    if (!spec || spec.startsWith(".") || spec.startsWith("/")) return;
    const name = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]!;
    libs.add(name.replace(/^node:/, "node"));
  };
  if (["typescript", "tsx", "javascript", "vue"].includes(langId)) {
    for (const m of src.matchAll(/(?:from\s+|require\(\s*|import\s*\(\s*|import\s+)["']([^"']+)["']/g)) add(m[1]!);
  } else if (langId === "python") {
    for (const m of src.matchAll(/^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/gm)) add((m[1] ?? m[2] ?? "").split(".")[0]!);
  } else if (langId === "go") {
    for (const m of src.matchAll(/"([\w.-]+\.[\w.-]+\/[^"]+)"/g)) add(m[1]!);
  } else if (langId === "rust") {
    for (const m of src.matchAll(/^\s*use\s+(\w+)/gm)) if (!["std", "crate", "self", "super"].includes(m[1]!)) add(m[1]!);
  }
  return [langId, ...[...libs].sort()];
}
