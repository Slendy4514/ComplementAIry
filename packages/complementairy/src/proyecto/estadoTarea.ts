/**
 * Estado de una tarea que se calcula de los archivos (sin IA): qué tocó y qué tramos de la IA esperan tu
 * evidencia. Lo usan el hook (cada edición) y los flujos.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import picomatch from "picomatch";
import type { Tarea } from "../nucleo/flujo.js";
import { cargarRegistro, pendiente, tramos } from "./procedencia.js";

const enAlcance = (t: Tarea, rel: string) => t.restricciones.alcance.length > 0 && picomatch(t.restricciones.alcance, { dot: true })(rel);

/** Tramos de la IA escritos en la tarea que todavía no tienen tu evidencia. */
export function sinEvidencia(root: string, t: Tarea) {
  return archivosTocados(root, t).flatMap((rel) => {
    const reg = cargarRegistro(root, rel);
    return reg ? tramos(reg).filter((x) => x.tarea === t.id && pendiente(x)) : [];
  });
}

export function archivosTocados(root: string, t: Tarea): string[] {
  const out = new Set(t.tocados);
  if (t.ejecutor === "humano" || !out.size) {
    try {
      const diff = execFileSync("git", ["diff", "--name-only", t.base ?? "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      for (const f of diff.split("\n").filter(Boolean)) if (!f.startsWith(".cai/") && (!t.restricciones.alcance.length || enAlcance(t, f))) out.add(f);
    } catch {
      /* sin git */
    }
  }
  return [...out].filter((f) => fs.existsSync(path.join(root, f)));
}

export function hayDiff(root: string, t: Tarea): boolean {
  return archivosTocados(root, t).length > 0;
}

