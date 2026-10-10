import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeZoner, origenDe } from "./config.js";

/**
 * Repertorio personal: las funciones que TÚ escribiste o entendiste (🟢 listas; tuyas o insertadas
 * pasando el probador), guardadas en un repo git local FUERA de los proyectos (~/.complementairy/
 * repertorio, o CAI_REPERTORIO), con historial de versiones. Sirve para que en modo programar lo que
 * ya hiciste vaya en pasos más grandes y para proponerte "tu versión" adaptada (como diff).
 * Configuración por proyecto: repertorio.guardar (sí/no) y repertorio.usar ("siempre" | "preguntar" | "nunca").
 * Nunca se guarda lo heredado ni de terceros. En devcontainers, el feature lo monta en un volumen.
 */

export interface EntradaRepertorio {
  id: string;
  nombre: string;
  firma: string;
  lenguaje: string;
  resumen: string;
  codigo: string;
  proyecto: string;
  archivo: string;
  fecha: string;
  /** "tuya" (la escribiste) o "programar" (insertada desde una propuesta, pasando el probador). */
  origen: "tuya" | "programar";
  huella: string;
}

export const dirRepertorio = () => process.env.CAI_REPERTORIO || path.join(os.homedir(), ".complementairy", "repertorio");
const huella = (codigo: string) => crypto.createHash("sha256").update(codigo.replace(/\s+/g, " ").trim()).digest("hex").slice(0, 16);
const git = (args: string[]) => spawnSync("git", ["-C", dirRepertorio(), "-c", "user.name=ComplementAIry", "-c", "user.email=repertorio@complementairy.local", ...args], { encoding: "utf8" });

function asegurar(): void {
  const d = dirRepertorio();
  fs.mkdirSync(path.join(d, "funciones"), { recursive: true });
  if (!fs.existsSync(path.join(d, ".git"))) {
    git(["init", "-q"]);
    fs.writeFileSync(path.join(d, "README.md"), "# Repertorio personal de ComplementAIry\n\nFunciones que escribiste o entendiste, para reutilizarlas entre proyectos. Si quieres respaldarlo, agrégale tú un remoto (git remote add …).\n");
  }
}

export function cargarRepertorio(): EntradaRepertorio[] {
  const d = path.join(dirRepertorio(), "funciones");
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).flatMap((f) => {
    try {
      return f.endsWith(".json") ? [JSON.parse(fs.readFileSync(path.join(d, f), "utf8")) as EntradaRepertorio] : [];
    } catch {
      return [];
    }
  });
}

/** ¿Se guarda / se usa el repertorio en este proyecto? */
export function politica(root: string): { guardar: boolean; usar: "siempre" | "preguntar" | "nunca" } {
  const c = makeZoner(root).config.repertorio;
  return { guardar: c?.guardar !== false, usar: c?.usar ?? "preguntar" };
}

/**
 * Guarda (o actualiza: misma función del mismo proyecto → nueva versión en git) una función tuya.
 * Devuelve la entrada, o por qué no se guardó.
 */
export function guardarEnRepertorio(root: string, e: Omit<EntradaRepertorio, "id" | "fecha" | "huella" | "proyecto">): { entrada?: EntradaRepertorio; motivo?: string } {
  if (!politica(root).guardar) return { motivo: "este proyecto no guarda en el repertorio (repertorio.guardar)" };
  const o = origenDe(makeZoner(root).config, e.archivo);
  if (o === "heredado" || o === "terceros") return { motivo: `${e.archivo} es ${o}: no es tuyo` };
  asegurar();
  const proyecto = path.basename(root);
  const h = huella(e.codigo);
  const todas = cargarRepertorio();
  if (todas.some((x) => x.huella === h)) return { motivo: "ya está en el repertorio" };
  const previa = todas.find((x) => x.proyecto === proyecto && x.archivo === e.archivo && x.nombre === e.nombre);
  const entrada: EntradaRepertorio = { ...e, proyecto, huella: h, fecha: new Date().toISOString(), id: previa?.id ?? `${e.nombre.replace(/[^\w]/g, "").slice(0, 30)}-${crypto.randomBytes(3).toString("hex")}` };
  fs.writeFileSync(path.join(dirRepertorio(), "funciones", `${entrada.id}.json`), JSON.stringify(entrada, null, 2));
  git(["add", "-A"]);
  git(["commit", "-q", "-m", `${previa ? "Actualiza" : "Agrega"} ${e.nombre} (${proyecto}/${e.archivo})`]);
  return { entrada };
}

export function borrarDeRepertorio(id: string): EntradaRepertorio {
  const e = cargarRepertorio().find((x) => x.id === id);
  if (!e) throw new Error(`no existe ${id} en el repertorio (míralo con: cai repertorio)`);
  fs.rmSync(path.join(dirRepertorio(), "funciones", `${id}.json`), { force: true });
  git(["add", "-A"]);
  git(["commit", "-q", "-m", `Quita ${e.nombre} (${e.proyecto})`]);
  return e;
}

const palabras = (t: string) =>
  new Set(
    t
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2),
  );

/** Lo parecido del repertorio a algo (nombre, objetivo, paso), sin IA: por palabras en común. */
export function buscarEnRepertorio(root: string, consulta: string, lenguaje?: string, max = 3): EntradaRepertorio[] {
  if (politica(root).usar === "nunca") return [];
  const q = palabras(consulta);
  if (!q.size) return [];
  return cargarRepertorio()
    .filter((e) => !lenguaje || e.lenguaje === lenguaje || (["typescript", "javascript"].includes(e.lenguaje) && ["typescript", "javascript"].includes(lenguaje)))
    .map((e) => {
      const p = palabras(`${e.nombre} ${e.resumen}`);
      const comunes = [...q].filter((w) => p.has(w)).length;
      return { e, score: comunes / Math.max(2, Math.min(q.size, p.size)) };
    })
    .filter((x) => x.score >= 0.34)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((x) => x.e);
}

/** Para el prompt: lo que ya hiciste parecido (solo nombre, resumen y proyecto; el código, si se adapta). */
export function bloqueRepertorio(es: EntradaRepertorio[]): string {
  return es.length ? `Lo que el programador YA hizo antes (su repertorio; lo que ya domina puede ir en pasos más grandes):\n${es.map((e) => `- [${e.id}] ${e.firma} — ${e.resumen} (${e.proyecto}/${e.archivo})`).join("\n")}` : "";
}
