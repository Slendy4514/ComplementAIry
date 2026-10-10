import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./config.js";
import { contextBlock, projectContext } from "./context.js";
import { bloqueCorrecciones } from "./correcciones.js";
import { bloqueObjetivos } from "./entender.js";
import { vigentesPara } from "./decisiones.js";
import { leerIndice, lineaIndice, mapaArchivo, vecinas } from "./indice.js";

/**
 * Contexto común: lo que TODA la IA sabe antes de responder, para que nadie piense de cero.
 * - normal: proyecto, reglas, memoria, errores frecuentes, decisiones vigentes, estructura (y el rol
 *   de este archivo), panorama (estado y sugerencias de este archivo) y el índice: las funciones de
 *   este archivo con su estado y las vecinas de la función (a quién llama y quién la llama).
 * - corto (sugerencias rápidas, ~1 s): decisiones y funciones vecinas, nada más.
 */
export function contextoComun(root: string, rel: string, o: { funcion?: string | undefined; corto?: boolean } = {}): string {
  // Cada sección con su prioridad: si el total se pasa del tope, se recorta primero lo de prioridad
  // más baja (la memoria, el panorama), nunca el mapa del archivo ni las decisiones.
  const secciones: Seccion[] = [];
  const agregar = (texto: string, prioridad: number) => texto && secciones.push({ texto, prioridad });
  const idx = leerIndice(root);
  const v = vecinas(idx, rel, o.funcion);

  // Las otras funciones del archivo (con su propósito y si están por hacer): para reutilizarlas.
  agregar(mapaArchivo(root, idx, rel, o.funcion, o.corto ? 1500 : 2500), 5);
  if (!o.corto) {
    // Los objetivos del proyecto (confirmados, o el borrador marcado como tal) y lo que el programador
    // corrigió de lo que entendemos: mandan sobre todo lo demás.
    agregar(bloqueObjetivos(root), 4);
    agregar(bloqueCorrecciones(root), 4);
  }
  const decisiones = vigentesPara(root, rel, o.funcion);
  if (decisiones.length)
    agregar(`Decisiones del programador (respétalas; no las vuelvas a preguntar ni las contradigas):\n${decisiones.map((d) => `- ${d.pregunta} → ${d.eleccion}${!rel && d.alcance.archivo ? ` (en ${d.alcance.archivo}${d.alcance.funcion ? `, ${d.alcance.funcion}` : ""})` : ""}`).join("\n")}`, 5);
  const deOtros = v.llama.filter((f) => f.archivo !== rel);
  if (deOtros.length) agregar(`Funciones de otros archivos que ${o.funcion} usa (ya existen; no las reinventes):\n${deOtros.map((f) => lineaIndice(f, true)).join("\n")}`, 4);
  if (!o.corto && v.laLlaman.length) agregar(`Funciones que usan a ${o.funcion} (si cambia su contrato, las afecta):\n${v.laLlaman.map((f) => lineaIndice(f, f.archivo !== rel)).join("\n")}`, 3);

  if (!o.corto) {
    agregar(contextBlock(projectContext(root, rel)), 1);
    const est = leer<{ resumen: string; modulos: { archivo: string; responsabilidad: string; funciones: string[] }[]; orden: string[] }>(path.join(dataDir(root), "estructura.json"));
    if (est) {
      const m = est.modulos.find((x) => x.archivo === rel);
      agregar(`Estructura del proyecto (plan general): ${est.resumen}${m ? `\nEste archivo (${rel}) es para: ${m.responsabilidad}${m.funciones.length ? `. Funciones previstas: ${m.funciones.join("; ")}` : ""}` : ""}`, 2);
    }
    const pano = leer<{ sugerencias?: { estado: string; sugerencias: { titulo: string; porque: string; archivos: string[] }[] } }>(path.join(dataDir(root), "cache", "panorama.json"))?.sugerencias;
    if (pano) {
      const aqui = pano.sugerencias.filter((s) => s.archivos.some((a) => a === rel || rel.endsWith(a)));
      agregar(`Panorama del proyecto: ${pano.estado}${aqui.length ? `\nSugerencias del panorama para este archivo:\n${aqui.map((s) => `- ${s.titulo}: ${s.porque}`).join("\n")}` : ""}`, 2);
    }
  }
  return ajustarATope(secciones, TOPE);
}

const TOPE = 9000;

interface Seccion {
  texto: string;
  /** 1 = lo primero que se recorta. */
  prioridad: number;
}

/** Junta las secciones (en su orden) recortando primero las de menor prioridad hasta caber en `tope`. */
export function ajustarATope(secciones: Seccion[], tope: number): string {
  const total = () => secciones.reduce((n, s) => n + (s.texto ? s.texto.length + 2 : 0), 0);
  for (const p of [...new Set(secciones.map((s) => s.prioridad))].sort((a, b) => a - b))
    for (const s of secciones.filter((x) => x.prioridad === p)) {
      const sobra = total() - tope;
      if (sobra <= 0) break;
      s.texto = s.texto.length - sobra > 300 ? `${s.texto.slice(0, s.texto.length - sobra - 4)}\n(…)` : "";
    }
  return secciones
    .map((s) => s.texto)
    .filter(Boolean)
    .join("\n\n");
}

function leer<T>(f: string): T | undefined {
  try {
    return JSON.parse(fs.readFileSync(f, "utf8")) as T;
  } catch {
    return undefined;
  }
}
