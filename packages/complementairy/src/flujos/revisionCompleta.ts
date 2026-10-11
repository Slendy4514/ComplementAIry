import fs from "node:fs";
import path from "node:path";
import { dataDir } from "../proyecto/config.js";
import { langFor } from "../nucleo/lang.js";
import { funcionesDe, claveFuncion } from "../proyecto/notasFuncion.js";
import { runReview } from "./review.js";
import { publicar } from "./salida.js";
import { recorrerCasos } from "./tests.js";
import { verificar, type Veredicto } from "./verificar.js";

/**
 * "Revisar archivo" completo: la revisión de siempre (verificaciones + revisores a ciegas), luego
 * "¿quedó lista?" de cada función (las que no cambiaron reutilizan su veredicto; la "otra mirada" usa
 * los planes ya calculados de cada función), los tests, y al final un VEREDICTO del archivo.
 */

export interface VeredictoArchivo {
  estado: "lista" | "casi" | "falta";
  listas: number;
  total: number;
  testsFallan: number;
  bloqueantes: number;
  fecha: string;
  funciones: { funcion: string; estado: string }[];
}

const archivoVeredictos = (root: string) => path.join(dataDir(root), "cache", "veredictos.json");

export function leerVeredictos(root: string): Record<string, VeredictoArchivo> {
  try {
    return JSON.parse(fs.readFileSync(archivoVeredictos(root), "utf8")) as Record<string, VeredictoArchivo>;
  } catch {
    return {};
  }
}

export async function revisarCompleto(root: string, rel: string, log: (s: string) => void = () => {}): Promise<{ veredicto: VeredictoArchivo; costoUsd: number }> {
  let costo = 0;
  const r = await runReview(root, rel, { log });
  costo += r.costoUsd;
  const lang = langFor(rel);
  const funciones = lang ? await funcionesDe(fs.readFileSync(path.join(root, rel), "utf8"), lang) : [];
  // Cada función cuenta: la que no se pudo verificar (ocupada, error de la IA) queda "sin verificar",
  // así el archivo no puede salir 🟢 por omisión.
  const veredictos: { funcion: string; estado: string }[] = [];
  // Una por una (cada una escribe su nota); las que no cambiaron reutilizan su veredicto, sin IA.
  for (const f of funciones) {
    const clave = claveFuncion(funciones, f);
    log(`cai: ¿quedó lista ${f.nombre}?`);
    const v = await verificar(root, rel, { funcion: clave, independienteSiCambio: true, log }).catch((e: unknown) => {
      log(`cai: no se pudo verificar ${f.nombre}: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    });
    if (v) costo += v.costoUsd;
    const vs = (v?.veredictos ?? []) as Veredicto[];
    veredictos.push(...(vs.length ? vs.map((x) => ({ funcion: x.funcion, estado: x.estado })) : [{ funcion: clave, estado: "sin verificar" }]));
  }
  const tests = await recorrerCasos(root, rel).catch(() => ({ funciones: [] }));
  const testsFallan = tests.funciones.reduce((a, t) => a + t.fallan, 0);
  const listas = veredictos.filter((v) => v.estado === "lista").length;
  const total = Math.max(funciones.length, veredictos.length);
  const estado: VeredictoArchivo["estado"] = veredictos.some((v) => v.estado === "falta") || testsFallan || r.bloqueantes ? "falta" : listas === total ? "lista" : "casi";
  const veredicto: VeredictoArchivo = {
    estado,
    listas,
    total,
    testsFallan,
    bloqueantes: r.bloqueantes,
    fecha: new Date().toISOString(),
    funciones: veredictos,
  };
  const todos = leerVeredictos(root);
  todos[rel] = veredicto;
  fs.mkdirSync(path.dirname(archivoVeredictos(root)), { recursive: true });
  fs.writeFileSync(archivoVeredictos(root), JSON.stringify(todos, null, 2));
  const icono = { lista: "🟢", casi: "🟡", falta: "🔴" }[estado];
  const texto = `${icono} Archivo ${{ lista: "listo", casi: "casi listo", falta: "con cosas por hacer" }[estado]}: ${listas} de ${veredicto.total} funciones listas${testsFallan ? ` · ${testsFallan} test(s) fallan` : ""}${r.bloqueantes ? ` · ${r.bloqueantes} hallazgo(s) bloqueante(s)` : ""}.\n${veredicto.funciones.map((f) => `- ${{ lista: "🟢", casi: "🟡", falta: "🔴" }[f.estado as "lista"] ?? "·"} ${f.funcion.replace(/#\d+$/, "")}`).join("\n")}`;
  await publicar(root, rel, [{ ancla: { linea: 1 }, alcance: "archivo", tipo: "revision", titulo: "Revisión completa", texto, accion: estado === "lista" ? "" : "Mira las funciones en 🔴/🟡 (cada una tiene su nota con qué falta)", origen: "revisar" }], { vista: "notas" });
  return { veredicto, costoUsd: costo };
}
