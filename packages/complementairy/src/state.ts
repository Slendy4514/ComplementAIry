import fs from "node:fs";
import { dataDir } from "./config.js";
import path from "node:path";

/** Memoria de los hilos del proyecto (nivel alcanzado, región de código), en .cai/cache. */
export interface HiloState {
  file: string;
  pregunta: string;
  nivel: number;
  regionHash: string;
  temas: string[];
  actualizado: string;
}

export type Estado = Record<string, HiloState>;

const file = (root: string) => path.join(dataDir(root), "cache", "hilos.json");
const key = (rel: string, id: string) => `${rel}#${id}`;

export function loadEstado(root: string): Estado {
  try {
    return JSON.parse(fs.readFileSync(file(root), "utf8")) as Estado;
  } catch {
    return {};
  }
}

export function saveEstado(root: string, e: Estado): void {
  fs.mkdirSync(path.dirname(file(root)), { recursive: true });
  fs.writeFileSync(file(root), JSON.stringify(e, null, 2));
}

export function getHilo(e: Estado, rel: string, id: string): HiloState | undefined {
  return e[key(rel, id)];
}

export function setHilo(e: Estado, rel: string, id: string, h: HiloState): void {
  e[key(rel, id)] = h;
}

/** Hilos registrados para un archivo (id → estado). */
export function hilosDe(e: Estado, rel: string): [string, HiloState][] {
  return Object.entries(e)
    .filter(([k]) => k.startsWith(rel + "#"))
    .map(([k, v]) => [k.slice(rel.length + 1), v]);
}

export function deleteHilo(e: Estado, rel: string, id: string): void {
  delete e[key(rel, id)];
}
