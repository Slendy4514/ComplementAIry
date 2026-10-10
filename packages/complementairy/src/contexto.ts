import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./config.js";
import { contextBlock, projectContext } from "./context.js";
import { bloqueCorrecciones } from "./correcciones.js";
import { bloqueObjetivos } from "./entender.js";
import { vigentesPara } from "./decisiones.js";
import { leerIndice, lineaIndice, vecinas } from "./indice.js";

/**
 * Contexto común: lo que TODA la IA sabe antes de responder, para que nadie piense de cero.
 * - normal: proyecto, reglas, memoria, errores frecuentes, decisiones vigentes, estructura (y el rol
 *   de este archivo), panorama (estado y sugerencias de este archivo) y el índice: las funciones de
 *   este archivo con su estado y las vecinas de la función (a quién llama y quién la llama).
 * - corto (sugerencias rápidas, ~1 s): decisiones y funciones vecinas, nada más.
 */
export function contextoComun(root: string, rel: string, o: { funcion?: string | undefined; corto?: boolean } = {}): string {
  const partes: string[] = [];
  if (!o.corto) partes.push(contextBlock(projectContext(root, rel)));
  // Los objetivos del proyecto (confirmados, o el borrador marcado como tal) y lo que el programador
  // corrigió de lo que entendemos: mandan sobre todo lo demás.
  if (!o.corto) partes.push(bloqueObjetivos(root), bloqueCorrecciones(root));

  const decisiones = vigentesPara(root, rel, o.funcion);
  if (decisiones.length)
    partes.push(`Decisiones del programador (respétalas; no las vuelvas a preguntar ni las contradigas):\n${decisiones.map((d) => `- ${d.pregunta} → ${d.eleccion}${!rel && d.alcance.archivo ? ` (en ${d.alcance.archivo}${d.alcance.funcion ? `, ${d.alcance.funcion}` : ""})` : ""}`).join("\n")}`);

  if (!o.corto) {
    const est = leer<{ resumen: string; modulos: { archivo: string; responsabilidad: string; funciones: string[] }[]; orden: string[] }>(path.join(dataDir(root), "estructura.json"));
    if (est) {
      const m = est.modulos.find((x) => x.archivo === rel);
      partes.push(`Estructura del proyecto (plan general): ${est.resumen}${m ? `\nEste archivo (${rel}) es para: ${m.responsabilidad}${m.funciones.length ? `. Funciones previstas: ${m.funciones.join("; ")}` : ""}` : ""}`);
    }
    const pano = leer<{ sugerencias?: { estado: string; sugerencias: { titulo: string; porque: string; archivos: string[] }[] } }>(path.join(dataDir(root), "cache", "panorama.json"))?.sugerencias;
    if (pano) {
      const aqui = pano.sugerencias.filter((s) => s.archivos.some((a) => a === rel || rel.endsWith(a)));
      partes.push(`Panorama del proyecto: ${pano.estado}${aqui.length ? `\nSugerencias del panorama para este archivo:\n${aqui.map((s) => `- ${s.titulo}: ${s.porque}`).join("\n")}` : ""}`);
    }
  }

  const idx = leerIndice(root);
  const v = vecinas(idx, rel, o.funcion);
  if (!o.corto && v.delArchivo.length) partes.push(`Funciones de este archivo (estado: 🟢 lista · 🟡 casi · 🔴 falta · 📝 con nota):\n${v.delArchivo.map((f) => lineaIndice(f)).join("\n")}`);
  if (v.llama.length) partes.push(`Funciones que ${o.funcion} usa (ya existen; no las reinventes):\n${v.llama.map((f) => lineaIndice(f, f.archivo !== rel)).join("\n")}`);
  if (!o.corto && v.laLlaman.length) partes.push(`Funciones que usan a ${o.funcion} (si cambia su contrato, las afecta):\n${v.laLlaman.map((f) => lineaIndice(f, f.archivo !== rel)).join("\n")}`);

  const texto = partes.filter(Boolean).join("\n\n");
  return texto.length > 9000 ? `${texto.slice(0, 9000)}\n(…)` : texto;
}

function leer<T>(f: string): T | undefined {
  try {
    return JSON.parse(fs.readFileSync(f, "utf8")) as T;
  } catch {
    return undefined;
  }
}
