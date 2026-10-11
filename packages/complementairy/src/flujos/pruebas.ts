/**
 * Pruebas y validación de rendimiento (manifiesto V.5 y II.2) sobre el código de una tarea:
 * los detectores (carreras, debounce, rate limiting, caché, n², estructuras, seguridad) corren SIN IA y
 * cada hallazgo bloquea el cierre hasta que lo resuelvas: un test tuyo, "no aplica porque…" (queda como
 * decisión), tu predicción de escalabilidad medida ejecutando, o tu explicación de la estructura.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { listFiles } from "../proyecto/files.js";
import { langFor } from "../nucleo/lang.js";
import { makeZoner } from "../proyecto/config.js";
import { decidir, proponerDecisiones } from "../proyecto/decisiones.js";
import { conContenido, respuestaValida } from "../nucleo/especificidad.js";
import { detectar, QUE_PIDE, type Hallazgo } from "../nucleo/detectores.js";
import type { HallazgoTarea, Tarea } from "../nucleo/flujo.js";
import { ejecutar } from "./predict.js";
import { cargarRegistro } from "../proyecto/procedencia.js";
import { conTarea } from "../proyecto/tareas.js";
import { registrarCalibracion } from "../proyecto/expediente.js";

/** Líneas (1-based) que escribió esta tarea en un archivo: de la IA en la tarea, o cambiadas vs. la base de git. */
export function lineasDeTarea(root: string, t: Tarea, rel: string): Set<number> {
  const out = new Set<number>();
  const reg = cargarRegistro(root, rel);
  reg?.lineas.forEach((l, i) => l.t === t.id && out.add(i + 1));
  if (t.ejecutor === "humano" || !out.size) {
    try {
      const diff = execFileSync("git", ["diff", "-U0", t.base ?? "HEAD", "--", rel], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      for (const m of diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
        const ini = Number(m[1]);
        const n = m[2] === undefined ? 1 : Number(m[2]);
        for (let k = 0; k < n; k++) out.add(ini + k);
      }
    } catch {
      /* sin git */
    }
  }
  return out;
}

/** Corre los detectores sobre lo que tocó la tarea y actualiza su lista (conserva lo ya resuelto). */
export async function revisarHallazgos(root: string, t: Tarea): Promise<HallazgoTarea[]> {
  const nuevos: HallazgoTarea[] = [];
  for (const rel of t.tocados) {
    const abs = path.join(root, rel);
    const lang = langFor(rel);
    if (!lang || !fs.existsSync(abs)) continue;
    const propias = lineasDeTarea(root, t, rel);
    const hs: Hallazgo[] = await detectar(fs.readFileSync(abs, "utf8"), lang);
    for (const h of hs) if (propias.has(h.linea)) nuevos.push({ clave: `${rel}:${h.clave}`, tipo: h.tipo, archivo: rel, linea: h.linea, texto: `${h.texto} → pide: ${QUE_PIDE[h.tipo]}` });
  }
  const previos = new Map((t.hallazgos ?? []).map((h) => [h.clave, h]));
  const lista = nuevos.map((h) => (previos.get(h.clave)?.resuelto ? { ...h, resuelto: previos.get(h.clave)!.resuelto! } : h));
  conTarea(root, t.id, (x) => ({ ...x, hallazgos: lista }));
  return lista;
}

export const pendientesDe = (hs: HallazgoTarea[]) => hs.filter((h) => !h.resuelto);

/**
 * Resolver un hallazgo. `test`: se comprueba que exista un test que nombre la función o el archivo;
 * `no-aplica`: tu razón (con contenido) queda como decisión vigente, visible y retractable.
 */
export function resolverHallazgo(root: string, tareaId: string, clave: string, como: NonNullable<HallazgoTarea["resuelto"]>["como"], nota: string): HallazgoTarea {
  let hecho: HallazgoTarea | undefined;
  conTarea(root, tareaId, (t) => {
    const h = (t.hallazgos ?? []).find((x) => x.clave === clave || x.clave.endsWith(clave));
    if (!h) throw new Error(`la tarea ${tareaId} no tiene el hallazgo ${clave} (\`cai pruebas ${tareaId}\` los lista)`);
    const malo = respuestaValida(nota);
    if (malo) throw new Error(malo);
    if (como === "no-aplica" || como === "explicacion" || como === "decision") {
      if (conContenido(nota).length < 4) throw new Error("explica por qué con una oración con contenido (es lo que queda como decisión)");
      const [d] = proponerDecisiones(root, [{ pregunta: `¿${h.texto.split(" → ")[0]} (${h.archivo}:${h.linea})?`, opciones: [{ opcion: "No aplica", consecuencia: nota }, { opcion: "Hay que cuidarlo", consecuencia: QUE_PIDE[h.tipo as keyof typeof QUE_PIDE] ?? "" }] }], { archivo: h.archivo }, `pruebas ${tareaId}`, tareaId);
      if (d) decidir(root, d.id, `No aplica: ${nota}`);
    }
    if (como === "test" && !hayTestQueNombra(root, h.archivo, nota)) throw new Error(`no encontré un test que nombre ${path.basename(h.archivo, path.extname(h.archivo))} o lo que dijiste (${nota}). Escríbelo y vuelve a intentar`);
    hecho = { ...h, resuelto: { como, nota, cuando: new Date().toISOString() } };
    return { ...t, hallazgos: (t.hallazgos ?? []).map((x) => (x === h ? hecho! : x)) };
  });
  return hecho!;
}

function hayTestQueNombra(root: string, rel: string, nota: string): boolean {
  const z = makeZoner(root);
  const base = path.basename(rel, path.extname(rel));
  const nombres = [base, ...nota.split(/[^\w$]+/).filter((w) => w.length > 3)];
  return listFiles(z).some((f) => /(\.|_)(test|spec)\.\w+$|^tests?\//.test(f) && nombres.some((n) => fs.readFileSync(path.join(root, f), "utf8").includes(n)));
}

// --- Escalabilidad medida (II.2: ilusión de competencia) ---------------------------------------------------

export interface Escalar {
  tiempos: { n: number; ms: number }[];
  /** Exponente medido (1 ≈ lineal, 2 ≈ cuadrático). */
  exponente: number;
  /** Cuánto crece el tiempo si los datos se multiplican por 10 (medido). */
  factor10: number;
  tuPrediccion: number;
  acierto: boolean;
}

/**
 * Mide cómo crece el tiempo de `funcion` con la entrada: repites un ejemplo literal (lista o texto) n veces.
 * Antes de ver el resultado predices el factor para 10× datos; se mide y se compara (dentro de ×3 = acierto).
 */
export function medirEscalabilidad(root: string, rel: string, funcion: string, ejemplo: string, predigoFactor10: number, base = 200): Escalar {
  const lang = langFor(rel);
  if (!lang) throw new Error(`no sé ejecutar ${rel}`);
  const t = ejemplo.trim();
  const repetir = (k: number) => {
    if (/^\[[\s\S]*\]$/.test(t)) return `[${Array.from({ length: k }, () => t.slice(1, -1)).join(",")}]`;
    if (/^(["'`]).*\1$/s.test(t)) return `${t[0]}${t.slice(1, -1).repeat(k)}${t[0]}`;
    throw new Error("el ejemplo debe ser una lista literal ([…]) o un texto entre comillas: se repite para agrandar la entrada");
  };
  const medir = (k: number) => {
    const ini = process.hrtime.bigint();
    const r = ejecutar(root, rel, lang.id, { funcion, expresion: `${funcion}(${repetir(k)})` });
    const ms = Number(process.hrtime.bigint() - ini) / 1e6;
    if (!r.ok && r.infra) throw new Error(r.error ?? "no se pudo ejecutar");
    return ms;
  };
  const cero = Math.min(medir(1), medir(1));
  const tiempos = [base, base * 4, base * 16].map((n) => ({ n, ms: Math.max(0.01, medir(n) - cero) }));
  const exponente = Math.max(0, Math.log(tiempos[2]!.ms / tiempos[1]!.ms) / Math.log(4));
  const factor10 = Math.round(Math.pow(10, exponente) * 10) / 10;
  const acierto = predigoFactor10 > 0 && Math.max(predigoFactor10, factor10) / Math.min(predigoFactor10, factor10) <= 3;
  registrarCalibracion({ seguridad: 3, acierto, dominio: "escalabilidad", proyecto: root });
  return { tiempos, exponente: Math.round(exponente * 100) / 100, factor10, tuPrediccion: predigoFactor10, acierto };
}
