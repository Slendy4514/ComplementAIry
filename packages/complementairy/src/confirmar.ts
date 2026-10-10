import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./config.js";
import { corregir, type Correccion } from "./correcciones.js";
import { cargarDecisiones, decidir, retractar } from "./decisiones.js";
import { confirmarObjetivos, darPorTerminado, leerObjetivos } from "./entender.js";
import { cargarIdeas, descartarIdea } from "./ideas.js";
import { aplicarCambioTarea, cargarTareas } from "./siguiente.js";

/**
 * Lo que SOLO decides tú, desde el chat de Claude Code: Claude te pregunta con sus botones
 * (AskUserQuestion) y un hook registra TU respuesta. Verificado: en PreToolUse la llamada no trae
 * respuestas; en PostToolUse `tool_response.answers` = { "<pregunta>": "<tu elección o tu texto>" }.
 *
 * Encabezado (header, ≤ 12 caracteres) de cada pregunta:
 *   cai:d1a2b3   decidir esa decisión (tu respuesta = la opción, o tu texto)
 *   cai:-d1a2b3  retractarla          opciones exactas: "Retractar" / "Mantener"
 *   cai:-t12     descartar esa tarea  "Descartar" / "Mantener"
 *   cai:-i1a2b3  descartar esa idea   "Descartar" / "Mantener"
 *   cai:obj      confirmar objetivos  "Confirmar" / "Reabrir"   (la pregunta incluye el resumen completo)
 *   cai:fin      dar por terminado    "Dar por terminado" / "Seguir" (ídem)
 *   cai:p1a2b3   aplicar la corrección propuesta con `cai memoria proponer`: "Aplicar" / "No"
 * Seguridad (lo que viste es lo que se aplica): (1) si la llamada ya trae respuestas, se rechaza;
 * (2) una sola opción (sin multiSelect); (3) opciones exactas (nada de "Sí" que pueda significar lo
 * contrario según cómo se pregunte); (4) la pregunta incluye el texto COMPLETO de lo que se registra.
 */

/** PreToolUse: ¿la llamada trae respuestas ya puestas? (se rechaza). */
export function respuestasInventadas(toolInput: Record<string, unknown>): boolean {
  const a = toolInput.answers;
  return a !== undefined && a !== null && !(typeof a === "object" && !Object.keys(a as object).length);
}

const norm = (t: string) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
/** ¿La pregunta que viste incluye el texto COMPLETO de lo que se registra? */
const incluye = (pregunta: string, texto: string) => !!norm(texto) && norm(pregunta).includes(norm(texto));
/** La respuesta es EXACTAMENTE esa opción (sin "sí" sueltos: quien arma la pregunta no puede darle la vuelta). */
const es = (respuesta: string, opcion: string) => norm(respuesta.replace(/\s*\((recomendad[oa])\)\s*$/i, "")) === norm(opcion);
const sinRecomendado = (t: string) => t.replace(/\s*\((recomendad[oa])\)\s*$/i, "").trim();

/** Las opciones canónicas de cada encabezado (la primera es la que registra). */
const CANON: Record<string, [string, string]> = { "-d": ["Retractar", "Mantener"], "-t": ["Descartar", "Mantener"], "-i": ["Descartar", "Mantener"], obj: ["Confirmar", "Reabrir"], fin: ["Dar por terminado", "Seguir"], p: ["Aplicar", "No"] };
const tipoDe = (clave: string) => (clave === "obj" || clave === "fin" ? clave : /^-[dti]/.test(clave) ? clave.slice(0, 2) : /^d[0-9a-f]+$/.test(clave) ? "d" : /^p[0-9a-f]+$/.test(clave) ? "p" : "");

interface PreguntaCompleta {
  question?: string;
  header?: string;
  multiSelect?: boolean;
  options?: { label?: string }[];
}

/**
 * PreToolUse: una pregunta con encabezado cai: tiene que ser de una sola opción, con las opciones
 * canónicas (o las de la decisión) y con el texto COMPLETO de lo que se registra. Devuelve por qué no, o null.
 */
export function validarPreguntaCai(root: string, q: PreguntaCompleta): string | null {
  const clave = (q.header ?? "").slice(4).trim();
  const tipo = tipoDe(clave);
  if (!tipo) return `encabezado ${q.header} desconocido (usa cai:<id de decisión>, cai:-<id>, cai:obj, cai:fin o cai:p<id>)`;
  if (q.multiSelect) return "las preguntas cai: son de una sola opción (multiSelect: false)";
  const labels = (q.options ?? []).map((o) => sinRecomendado(o.label ?? ""));
  const pregunta = q.question ?? "";
  const mismas = (esperadas: string[]) => labels.length === esperadas.length && esperadas.every((e) => labels.some((l) => norm(l) === norm(e)));
  const id = clave.replace(/^-/, "");
  if (tipo === "d") {
    const d = cargarDecisiones(root).find((x) => x.id === id);
    if (!d) return `no existe la decisión ${id}`;
    if (!incluye(pregunta, d.pregunta)) return `la pregunta tiene que incluir el texto de la decisión: "${d.pregunta}"`;
    if (!mismas(d.opciones.map((o) => o.opcion))) return `las opciones tienen que ser exactamente las de la decisión: ${d.opciones.map((o) => `"${o.opcion}"`).join(", ")}`;
    return null;
  }
  if (!mismas(CANON[tipo]!)) return `las opciones tienen que ser exactamente "${CANON[tipo]![0]}" y "${CANON[tipo]![1]}"`;
  const texto =
    tipo === "-d" ? cargarDecisiones(root).find((x) => x.id === id)?.pregunta :
    tipo === "-t" ? cargarTareas(root).find((x) => x.id === id)?.titulo :
    tipo === "-i" ? cargarIdeas(root).find((x) => x.id === id)?.titulo :
    tipo === "p" ? cargarPropuestas(root).find((x) => x.id === id)?.despues :
    leerObjetivos(root).resumen;
  if (texto === undefined) return `no existe ${id}`;
  if (!incluye(pregunta, texto)) return `la pregunta tiene que incluir el texto completo de lo que se registra: "${texto}"`;
  return null;
}

// --- Correcciones propuestas por Claude Code (se aplican solo con tu respuesta) ---------------------

const archivoPropuestas = (root: string) => path.join(dataDir(root), "cache", "propuestas-correccion.json");
type Propuesta = Omit<Correccion, "id" | "fecha"> & { id: string; fecha: string };

function cargarPropuestas(root: string): Propuesta[] {
  try {
    return JSON.parse(fs.readFileSync(archivoPropuestas(root), "utf8")) as Propuesta[];
  } catch {
    return [];
  }
}

/** `cai memoria proponer`: deja la corrección pendiente; Claude te pregunta con el encabezado cai:<id>. */
export function proponerCorreccion(root: string, c: Omit<Correccion, "id" | "fecha" | "origen">): Propuesta {
  if (!c.despues.trim()) throw new Error("la corrección está vacía: di qué debe decir (--texto)");
  const p: Propuesta = { ...c, despues: c.despues.trim(), origen: "Claude Code (tu respuesta)", id: `p${crypto.randomBytes(3).toString("hex")}`, fecha: new Date().toISOString() };
  const ps = [...cargarPropuestas(root).slice(-20), p];
  fs.mkdirSync(path.dirname(archivoPropuestas(root)), { recursive: true });
  fs.writeFileSync(archivoPropuestas(root), JSON.stringify(ps, null, 2));
  return p;
}

// --- PostToolUse: registrar lo que respondiste ------------------------------------------------------

interface Pregunta {
  question?: string;
  header?: string;
}

/** Registra lo que respondiste en las preguntas con encabezado `cai:`. Devuelve qué se hizo (o por qué no). */
export function registrarRespuestas(root: string, toolInput: Record<string, unknown>, toolResponse: unknown): string[] {
  const preguntas = ((toolInput.questions ?? (toolResponse as { questions?: unknown })?.questions ?? []) as Pregunta[]).filter((q) => /^cai:/i.test(q.header ?? ""));
  const respuestas = ((toolResponse as { answers?: Record<string, string> })?.answers ?? {}) as Record<string, string>;
  const out: string[] = [];
  for (const q of preguntas) {
    const texto = q.question ?? "";
    const r = (respuestas[texto] ?? "").trim();
    const clave = (q.header ?? "").slice(4).trim();
    const invalida = validarPreguntaCai(root, q as PreguntaCompleta);
    if (invalida) {
      out.push(`${q.header}: no se registró (${invalida})`);
      continue;
    }
    if (!r) {
      out.push(`${q.header}: sin respuesta, no se registró nada`);
      continue;
    }
    try {
      out.push(registrarUna(root, clave, texto, r));
    } catch (e) {
      out.push(`${q.header}: no se registró (${e instanceof Error ? e.message : String(e)})`);
    }
  }
  return out;
}

function registrarUna(root: string, clave: string, pregunta: string, r: string): string {
  const tipo = tipoDe(clave);
  const id = clave.replace(/^-/, "");
  const si = (tipo && tipo !== "d" && es(r, CANON[tipo]![0])) || false;
  if (tipo === "d") {
    const d = cargarDecisiones(root).find((x) => x.id === id)!;
    // Una de sus opciones, o lo que escribiste tú ("Otra").
    const opcion = d.opciones.find((o) => es(r, o.opcion))?.opcion ?? sinRecomendado(r);
    decidir(root, d.id, opcion);
    return `${d.id}: decidiste "${opcion}"`;
  }
  if (!si) return `${clave}: elegiste "${r}", no se cambia nada`;
  if (tipo === "-d") {
    retractar(root, id);
    return `${id}: retractada por ti`;
  }
  if (tipo === "-t") return aplicarCambioTarea(root, { accion: "descartar", id });
  if (tipo === "-i") {
    descartarIdea(root, id);
    return `${id}: idea descartada`;
  }
  if (tipo === "obj") return `objetivos: ${confirmarObjetivos(root).estado}`;
  if (tipo === "fin") return `proyecto: ${darPorTerminado(root).estado}`;
  const p = cargarPropuestas(root).find((x) => x.id === id)!;
  const c = corregir(root, { tipo: p.tipo, ...(p.archivo ? { archivo: p.archivo } : {}), ...(p.antes ? { antes: p.antes } : {}), despues: p.despues, origen: p.origen });
  return `corrección ${c.id} aplicada${c.archivo ? ` (${c.archivo})` : ""}`;
}
