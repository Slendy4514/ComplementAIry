import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { dataDir, makeZoner } from "../proyecto/config.js";
import { cargarDecisiones } from "../proyecto/decisiones.js";
import { leerEvaluacion, leerObjetivos } from "../proyecto/entender.js";
import { leerIndice } from "../proyecto/indice.js";
import { deudaComprension, pendienteDiferida } from "./programar.js";
import { ask, leerUso } from "../ia/llm.js";
import { rutaTest } from "../proyecto/metricas.js";
import { todasLasNotas } from "../proyecto/notas.js";
import { iaOpts } from "../ia/llm.js";

/**
 * Para retomar y cerrar sin perder el hilo (casi todo sin IA):
 * - `hoy`: qué cambió desde tu última visita (funciones, tests que empezaron a fallar, decisiones
 *   pendientes) y si conviene hacer un commit.
 * - `deuda`: por archivo, lo que queda pendiente (notas, tests apagados, funciones sin tests, decisiones).
 * - `sesion`: resumen de lo hecho y un mensaje de commit SUGERIDO (lo editas y lo usas tú).
 */

const git = (root: string, args: string[]) => spawnSync("git", args, { cwd: root, encoding: "utf8" }).stdout ?? "";

/** Líneas cambiadas sin commit (para el aviso "conviene hacer un commit"). */
export function cambiosSinCommit(root: string): number {
  const modificadas = git(root, ["diff", "--numstat", "HEAD"])
    .split("\n")
    .map((l) => l.split("\t"))
    .reduce((n, [a, b]) => n + (Number(a) || 0) + (Number(b) || 0), 0);
  // Los archivos nuevos (sin agregar a git) también son cambios sin commit.
  return modificadas + archivosNuevos(root).slice(0, 300).reduce((n, f) => n + lineasDe(path.join(root, f)), 0);
}

/** Archivos nuevos que git todavía no sigue (sin los datos de ComplementAIry ni lo ignorado). */
export const archivosNuevos = (root: string) =>
  git(root, ["ls-files", "--others", "--exclude-standard"])
    .split("\n")
    .filter((f) => f && !/^\.(cai|aicode)\/|(^|\/)node_modules(\/|$)/.test(f));

function lineasDe(abs: string): number {
  try {
    const st = fs.statSync(abs);
    return st.size > 1_000_000 ? 0 : fs.readFileSync(abs, "utf8").split("\n").length;
  } catch {
    return 0;
  }
}

interface Visita {
  fecha: string;
  huellas: Record<string, string>;
  fallaban: string[];
}

const archivoVisita = (root: string) => path.join(dataDir(root), "cache", "ultima-visita.json");

export interface Hoy {
  desde?: string;
  cambiadas: string[];
  nuevas: string[];
  empezaronAFallar: string[];
  decisionesPendientes: number;
  lineasSinCommit: number;
  conviene: string[];
  /** Modo programar: una función insertada hace más de un día, para probarla de nuevo (tú). */
  diferida?: { archivo: string; funcion: string } | null;
  /** Objetivos: si la IA cree que se cumplen todos los criterios de terminado. */
  creeTerminado?: boolean;
}

export function hoy(root: string, marcar: boolean): Hoy {
  const idx = leerIndice(root);
  const todas = Object.values(idx.archivos).flatMap((a) => a.funciones);
  let previa: Visita | undefined;
  try {
    previa = JSON.parse(fs.readFileSync(archivoVisita(root), "utf8")) as Visita;
  } catch {
    previa = undefined;
  }
  const k = (f: { archivo: string; clave: string }) => `${f.archivo}:${f.clave}`;
  const fallan = todas.filter((f) => (f.tests?.fallan ?? 0) > 0).map(k);
  const out: Hoy = {
    ...(previa ? { desde: previa.fecha } : {}),
    cambiadas: previa ? todas.filter((f) => previa!.huellas[k(f)] && previa!.huellas[k(f)] !== f.huella).map(k) : [],
    nuevas: previa ? todas.filter((f) => !previa!.huellas[k(f)]).map(k) : [],
    empezaronAFallar: previa ? fallan.filter((x) => !previa!.fallaban.includes(x)) : fallan,
    decisionesPendientes: cargarDecisiones(root).filter((d) => d.estado === "pendiente").length,
    lineasSinCommit: cambiosSinCommit(root),
    conviene: [],
    diferida: pendienteDiferida(root),
    creeTerminado: leerObjetivos(root).estado === "entendido" && !!leerEvaluacion(root)?.creeTerminado,
  };
  if (out.lineasSinCommit > 300) out.conviene.push(`llevas ${out.lineasSinCommit} líneas sin commit: conviene hacer uno (pasos chicos)`);
  if (marcar) {
    fs.mkdirSync(path.dirname(archivoVisita(root)), { recursive: true });
    fs.writeFileSync(archivoVisita(root), JSON.stringify({ fecha: new Date().toISOString(), huellas: Object.fromEntries(todas.map((f) => [k(f), f.huella])), fallaban: fallan } satisfies Visita));
  }
  return out;
}

export interface DeudaArchivo {
  notasAbiertas: number;
  bloqueantes: number;
  testsApagados: number;
  sinTests: string[];
  /** Modo programar: funciones insertadas con porciones sin probar (deuda de comprensión). */
  sinEntender?: string[];
  decisionesPendientes: number;
}

/** Lo pendiente por archivo (sin IA): notas, tests apagados esperando decisión, funciones sin tests, decisiones. */
export function deuda(root: string): Record<string, DeudaArchivo> {
  const z = makeZoner(root);
  const idx = leerIndice(root);
  const notas = todasLasNotas(root).filter((n) => n.estado === "abierta");
  const decisiones = cargarDecisiones(root).filter((d) => d.estado === "pendiente");
  const comprension = deudaComprension(root);
  const out: Record<string, DeudaArchivo> = {};
  for (const [rel, a] of Object.entries(idx.archivos)) {
    if (!a.funciones.length) continue;
    const t = path.join(root, rutaTest(rel, z.config.tests.carpeta));
    const testTxt = fs.existsSync(t) ? fs.readFileSync(t, "utf8") : "";
    const d: DeudaArchivo = {
      notasAbiertas: notas.filter((n) => n.archivo === rel).length,
      bloqueantes: notas.filter((n) => n.archivo === rel && n.bloqueante).length,
      testsApagados: (testTxt.match(/snippet \[ \]:|test\.todo\(/g) ?? []).length,
      sinTests: a.funciones.filter((f) => f.exportada && !f.tests && !testTxt.includes(f.nombre)).map((f) => f.nombre),
      decisionesPendientes: decisiones.filter((x) => x.alcance.archivo === rel).length,
      sinEntender: comprension.filter((x) => x.archivo === rel).map((x) => x.funcion.replace(/#\d+$/, "")),
    };
    if (d.notasAbiertas || d.testsApagados || d.sinTests.length || d.decisionesPendientes || d.sinEntender!.length) out[rel] = d;
  }
  return out;
}

/** Resumen de la sesión (desde una fecha): lo medido sin IA + un resumen y un mensaje de commit sugerido. */
export async function resumenSesion(root: string, desde: string, sinIa = false): Promise<{ medido: string; resumen: string; commit: string; costoUsd: number }> {
  const proyecto = path.basename(root);
  const uso = leerUso(3).filter((u) => u.tipo === "llamada" && u.fecha >= desde && (!u.proyecto || u.proyecto === proyecto));
  const notas = todasLasNotas(root);
  const verificadas = notas.filter((n) => n.verificacion && n.verificacion.fecha >= desde);
  const decisiones = cargarDecisiones(root).filter((d) => (d.decidida ?? "") >= desde);
  const diff = git(root, ["diff", "--stat", "HEAD"]).trim().split("\n").slice(-12).join("\n");
  const nuevos = archivosNuevos(root);
  const medido = [
    `Desde ${desde.slice(0, 16).replace("T", " ")}:`,
    `- IA: ${uso.length} llamadas, US$${uso.reduce((a, u) => a + (u.costo ?? 0), 0).toFixed(2)}`,
    verificadas.length ? `- Verificadas: ${verificadas.map((n) => `${n.ancla.funcion?.replace(/#\d+$/, "") ?? n.titulo} ${{ lista: "🟢", casi: "🟡", falta: "🔴" }[n.verificacion!.estado]}`).join(", ")}` : "",
    decisiones.length ? `- Decisiones: ${decisiones.map((d) => `${d.pregunta} → ${d.eleccion ?? "(retractada)"}`).join("; ")}` : "",
    diff ? `- Cambios sin commit:\n${diff}` : nuevos.length ? "" : "- Sin cambios sin commit.",
    nuevos.length ? `- Archivos nuevos sin commit: ${nuevos.slice(0, 12).join(", ")}${nuevos.length > 12 ? ` y ${nuevos.length - 12} más` : ""}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  if (sinIa) return { medido, resumen: "", commit: "", costoUsd: 0 };
  const z = makeZoner(root);
  const { data, costUsd } = await ask<{ resumen: string; commit: string }>({
    kind: "sesion",
    system: "Resumes una sesión de programación a partir de datos medidos: qué se hizo, qué quedó listo y qué falta, en 3-5 viñetas cortas. Propones un mensaje de commit (título imperativo de ≤ 60 caracteres + 1-3 viñetas) que el programador editará. Sin inventar nada que no esté en los datos. Español neutro con tuteo.",
    cwd: root,
    sinHerramientas: true,
    schema: { type: "object", additionalProperties: false, required: ["resumen", "commit"], properties: { resumen: { type: "string" }, commit: { type: "string" } } },
    ...iaOpts(z.config, "chico"),
    prompt: medido,
  });
  return { medido, resumen: data.resumen, commit: data.commit, costoUsd: costUsd };
}
