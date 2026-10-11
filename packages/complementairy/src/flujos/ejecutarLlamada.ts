/**
 * Ejecutar una llamada literal contra un archivo del proyecto (predicciones, repaso, tarjetas, criterios):
 * si la función está exportada, se importa; si no (o el archivo no exporta), se carga tal cual en el
 * entorno aislado (sandbox), sin modificar el archivo. Siempre sin IA.
 */
import fs from "node:fs";
import path from "node:path";
import { langFor } from "../nucleo/lang.js";
import { ejecutar, exportedFunctions, type Ejecucion } from "./predict.js";
import { analizarScript } from "./sandbox.js";

export const raizDeLlamada = (expresion: string) => /^(?:new\s+)?([A-Za-z_$][\w$]*)/.exec(expresion.trim())?.[1] ?? "";

export async function ejecutarLlamada(root: string, rel: string, expresion: string): Promise<Ejecucion> {
  const lang = langFor(rel);
  if (!lang) return { ok: false, infra: true, error: `no sé ejecutar ${rel}` };
  const raiz = raizDeLlamada(expresion);
  const src = fs.readFileSync(path.join(root, rel), "utf8");
  if (exportedFunctions(lang.id, src).has(raiz) || lang.id === "python") return ejecutar(root, rel, lang.id, { funcion: raiz, expresion: expresion.trim() });
  if (!["javascript", "typescript", "tsx"].includes(lang.id)) return { ok: false, infra: true, error: `${raiz} no está exportada` };
  const a = await analizarScript(src, lang);
  return ejecutar(root, rel, lang.id, { funcion: raiz, expresion: expresion.trim() }, { aislado: a });
}

/** "f(1, 2) → 3", "f(1) devuelve 3", "f(1) = 3": la llamada y lo esperado (o null si no es una llamada). */
export function partirCriterio(c: string): { llamada: string; esperado: string } | null {
  const m = /^\s*`?([A-Za-z_$][\w$.]*\s*\([^`]*?\))`?\s*(?:→|->|=>|===?|devuelve|da|retorna|returns?)\s*`?(.+?)`?\s*$/.exec(c);
  return m ? { llamada: m[1]!.trim(), esperado: m[2]!.trim() } : null;
}
