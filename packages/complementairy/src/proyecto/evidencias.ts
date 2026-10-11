/**
 * EVIDENCIAS de comprensión (va al repo: .cai/evidencias/<id>.json). Cada una prueba que un humano entendió
 * ciertas líneas: su explicación, una predicción ejecutada, el mutante que detectó, los bordes que listó
 * antes de ver los de la IA, una reconstrucción. Guarda las huellas de las líneas: si el código cambia,
 * la evidencia deja de valer para esas líneas (la procedencia las ve como nuevas).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { escribirJson, leerJson } from "./almacen.js";
import { dataDir } from "./config.js";

export type TipoEvidencia = "explicacion" | "prediccion" | "mutante" | "bordes" | "reconstruccion" | "par" | "tarjeta" | "kata" | "visual";

/** Nivel que otorga cada tipo (si salió bien). */
export const NIVEL_DE: Record<TipoEvidencia, number> = { visual: 2, explicacion: 2, bordes: 2, tarjeta: 2, par: 2, prediccion: 3, mutante: 3, kata: 3, reconstruccion: 4 };

export interface Evidencia {
  version: 1;
  id: string;
  tipo: TipoEvidencia;
  archivo: string;
  funcion?: string;
  /** Huellas de las líneas que cubre. */
  huellas: string[];
  tarea?: string;
  persona: string;
  fecha: string;
  /** Lo que escribiste (explicación, bordes, predicción…). */
  texto: string;
  /** Lo que dio la ejecución o lo que dijo la IA después (para comparar). */
  resultado?: string;
  ok: boolean;
  /** Seguridad que declaraste antes (1..5), para la calibración (II.2). */
  seguridad?: number;
  /** Quién juzgó lo subjetivo (decisor) y si quedó dudoso. */
  juez?: string;
  /** Segundos que pasaste con el tramo antes de responder (señal de habituación). */
  segundos?: number;
}

const dir = (root: string) => path.join(dataDir(root), "evidencias");

export function guardarEvidencia(root: string, e: Omit<Evidencia, "version" | "id" | "fecha">): Evidencia {
  const ev: Evidencia = { version: 1, id: `e${Date.now().toString(36)}${crypto.randomBytes(2).toString("hex")}`, fecha: new Date().toISOString(), ...e };
  escribirJson(path.join(dir(root), `${ev.id}.json`), ev);
  return ev;
}

export function listarEvidencias(root: string, filtro: Partial<Pick<Evidencia, "archivo" | "tarea" | "persona" | "tipo">> = {}): Evidencia[] {
  if (!fs.existsSync(dir(root))) return [];
  return fs
    .readdirSync(dir(root))
    .filter((f) => f.endsWith(".json"))
    .map((f) => leerJson<Evidencia | null>(path.join(dir(root), f), () => null))
    .filter((e): e is Evidencia => !!e && Object.entries(filtro).every(([k, v]) => (e as unknown as Record<string, unknown>)[k] === v))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
}

/** Tus últimas explicaciones (para detectar plantillas repetidas). */
export const explicacionesPrevias = (root: string, persona: string, n = 20) =>
  listarEvidencias(root, { persona, tipo: "explicacion" })
    .slice(-n)
    .map((e) => e.texto);
