import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDir, makeZoner } from "./config.js";
import { CRITERIO } from "./context.js";
import { contextoComun } from "./contexto.js";
import { corregir, type Correccion } from "./correcciones.js";
import { proponerDecisiones, SCHEMA_DECISIONES, type Decision, type Opcion } from "./decisiones.js";
import { actualizarBorrador, leerObjetivos } from "./entender.js";
import { leerIndice, lineaIndice } from "./indice.js";
import { ask } from "./llm.js";
import { conCandado } from "./ocupado.js";
import { aplicarCambioTarea, cargarTareas, type CambioTarea } from "./siguiente.js";
import { iaOpts } from "./llm.js";
import { escribirJson, leerJson } from "./almacen.js";
import { sinSoluciones } from "./guard.js";
import { modoEfectivo } from "./modos.js";

/**
 * Chat del proyecto (fuera de cualquier archivo), en VARIAS conversaciones (`.cai/chats/<id>.json`):
 * - "normal": preguntas generales ("¿por dónde sigo?", "voy a implementar X"). La IA lee el proyecto
 *   (solo lectura) y conoce estructura, panorama, índice, objetivos, correcciones y decisiones. Puede
 *   proponer decisiones (botones), cambios de tareas y correcciones de lo que entiende del proyecto:
 *   NADA se aplica sin tu clic (o tu respuesta en los botones de Claude Code).
 * - "entender": la etapa de entendimiento del proyecto (ver entender.ts): pregunta de a poco y arma un
 *   borrador de objetivos; cuando cree que ya entendió, lo dice, y tú confirmas o corriges.
 * Puedes elegir qué IA responde (chico / mediano / grande) por conversación. Nunca escribe tu código.
 */

export type Tamano = "chico" | "mediano" | "grande";

export interface CorreccionPropuesta {
  tipo: Correccion["tipo"];
  archivo: string;
  antes: string;
  despues: string;
}

export interface MensajeChat {
  /** Id estable (los botones "Aplicar" apuntan a él, aunque el historial se recorte). */
  id?: string;
  quien: "tu" | "ia";
  texto: string;
  fecha: string;
  decisiones?: string[];
  /** v0.9: tareas sugeridas (solo crear). Desde v0.10: `cambiosTareas`. */
  tareas?: { titulo: string; archivo: string; detalle: string }[];
  cambiosTareas?: (CambioTarea & { aplicado?: string })[];
  correcciones?: (CorreccionPropuesta & { aplicada?: string })[];
  /** Conversación "entender": preguntas con opciones para que respondas con un clic. */
  preguntas?: { pregunta: string; opciones: string[] }[];
  creeEntendido?: boolean;
  modelo?: string;
  costo?: number;
}

export interface Conversacion {
  version: 1;
  id: string;
  titulo: string;
  tipo: "normal" | "entender";
  modelo: Tamano;
  creada: string;
  actualizada: string;
  mensajes: MensajeChat[];
}

const dir = (root: string) => path.join(dataDir(root), "chats");
const archivo = (root: string, id: string) => path.join(dir(root), `${id.replace(/[^\w-]/g, "")}.json`);
const viejo = (root: string) => path.join(dataDir(root), "chat.json");
const esTamano = (t: unknown): t is Tamano => t === "chico" || t === "mediano" || t === "grande";

/** El chat de v0.9 (`chat.json`, una sola conversación) pasa a ser la primera conversación. */
function migrar(root: string): void {
  if (!fs.existsSync(viejo(root))) return;
  try {
    const ms = (JSON.parse(fs.readFileSync(viejo(root), "utf8")) as { mensajes?: MensajeChat[] }).mensajes ?? [];
    if (ms.length) {
      const c = nueva(root, "normal", "mediano", ms[0]!.fecha);
      c.mensajes = ms;
      c.titulo = tituloDe(ms);
      c.actualizada = ms[ms.length - 1]!.fecha;
      guardar(root, c);
    }
    fs.rmSync(viejo(root), { force: true });
  } catch {
    /* ilegible: se deja como está */
  }
}

const tituloDe = (ms: MensajeChat[]) => (ms.find((m) => m.quien === "tu")?.texto ?? "Conversación").replace(/\s+/g, " ").slice(0, 60);

function nueva(root: string, tipo: Conversacion["tipo"], modelo: Tamano, fecha = new Date().toISOString()): Conversacion {
  return { version: 1, id: `${fecha.slice(0, 10).replace(/-/g, "")}-${crypto.randomBytes(3).toString("hex")}`, titulo: tipo === "entender" ? "🎯 Entender el proyecto" : "Nueva conversación", tipo, modelo, creada: fecha, actualizada: fecha, mensajes: [] };
}

function guardar(root: string, c: Conversacion): void {
  escribirJson(archivo(root, c.id), { ...c, mensajes: c.mensajes.slice(-200) });
}

export function cargarConversacion(root: string, id: string): Conversacion {
  migrar(root);
  const c = leerJson<Conversacion>(archivo(root, id), () => {
    throw new Error(`no existe la conversación ${id} (míralas con: cai chat --lista)`);
  });
  // v0.9: las "tareas sugeridas" pasan a ser cambios de tareas (crear), con su botón Aplicar.
  for (const m of c.mensajes)
    if (m.tareas?.length) {
      m.cambiosTareas = [...(m.cambiosTareas ?? []), ...m.tareas.map((t) => ({ accion: "crear" as const, titulo: t.titulo, archivo: t.archivo, detalle: t.detalle }))];
      delete m.tareas;
    }
  return c;
}

/** Las conversaciones, la más reciente primero (sin sus mensajes). */
export function listarConversaciones(root: string): Omit<Conversacion, "mensajes">[] {
  migrar(root);
  if (!fs.existsSync(dir(root))) return [];
  return fs
    .readdirSync(dir(root))
    .filter((f) => f.endsWith(".json"))
    .flatMap((f) => {
      try {
        const { mensajes, ...c } = JSON.parse(fs.readFileSync(path.join(dir(root), f), "utf8")) as Conversacion;
        return [{ ...c, n: mensajes.length } as Omit<Conversacion, "mensajes">];
      } catch {
        return [];
      }
    })
    .sort((a, b) => b.actualizada.localeCompare(a.actualizada));
}

export function crearConversacion(root: string, o: { tipo?: Conversacion["tipo"]; modelo?: Tamano } = {}): Promise<Conversacion> {
  const z = makeZoner(root);
  const c = nueva(root, o.tipo ?? "normal", o.modelo ?? (esTamano(z.config.chat?.modelo) ? z.config.chat.modelo : "mediano"));
  return conCandado(archivo(root, c.id), async () => (guardar(root, c), c));
}

export function borrarConversacion(root: string, id: string): void {
  cargarConversacion(root, id);
  fs.rmSync(archivo(root, id), { force: true });
}

/** Cambia qué IA responde en esta conversación. */
export function elegirModelo(root: string, id: string, modelo: string): Promise<Conversacion> {
  if (!esTamano(modelo)) throw new Error(`modelo "${modelo}" desconocido: usa chico, mediano o grande`);
  return conCandado(archivo(root, id), async () => {
    const c = cargarConversacion(root, id);
    c.modelo = modelo;
    guardar(root, c);
    return c;
  });
}

/** Compatibilidad (v0.9): los mensajes de la conversación más reciente. */
export function cargarChat(root: string): MensajeChat[] {
  const ult = listarConversaciones(root)[0];
  return ult ? cargarConversacion(root, ult.id).mensajes : [];
}

const SYSTEM = `Eres el compañero del programador para su PROYECTO completo (no un archivo). Respondes preguntas generales: por dónde seguir, cómo encaja algo, qué falta, qué conviene decidir, cómo organizar. Puedes leer el proyecto (Read, Grep, Glob) para responder con datos reales: no supongas lo que puedes leer.
- Nunca escribes el código del programador ni la solución en código: explicas en palabras, con piezas (funciones/APIs) y pasos.
- Usa lo que ya se sabe (objetivos, estructura, panorama, índice de funciones con su estado, decisiones, correcciones): no pienses de cero ni contradigas sus decisiones o correcciones.
- Si algo depende de una decisión suya, proponla en "decisiones" (con opciones).
- Tareas: si te cuenta qué va a hacer o qué terminó ("voy a implementar X", "ya terminé Y", "eso ya no va"), propone YA, en esta respuesta, en "cambiosTareas" cómo quedarían sus tareas (crear, editar, hecha, reabrir; descartar solo si lo pide). Usa el id de la tarea existente cuando corresponda (si lo que dice encaja con una, edítala o márcala en vez de crear otra). No pidas permiso para proponerlas: él las aplica (o no) con un clic.
- Si su plan depende de una elección suya, ponla en "decisiones" (con opciones) en vez de preguntarla en el texto.
- Si te corrige algo de lo que entiendes del proyecto ("ese archivo no hace eso", "no es una API"), propone la corrección en "correcciones" (tipo modulo/estructura con su archivo, o proyecto) con lo que decía y lo que debe decir. La aplica él con un clic.
- Markdown breve; listas con un ítem por línea. Español neutro con tuteo.

${CRITERIO}`;

const SYSTEM_ENTENDER = `Estás en la etapa de ENTENDER el proyecto del programador antes de ayudarlo: qué busca, para quién, qué significa "terminado" (criterios verificables), restricciones y qué queda fuera de alcance.
- Pregunta de a poco: 1 o 2 preguntas por turno, con 2-4 opciones probables cuando se pueda (él puede responder con un clic o escribir otra cosa). No preguntes lo que puedes leer del proyecto (Read, Grep, Glob): léelo.
- En cada turno devuelve el BORRADOR completo de lo que entiendes hasta ahora (aunque esté incompleto) y las dudas que te quedan.
- Cuando no te queden dudas importantes, pon creoQueEntendi = true y en "texto" resume lo entendido en pocas líneas para que lo confirme o corrija. No lo digas antes de tiempo.
- Criterios de terminado: concretos y comprobables ("se puede importar un CSV de 10.000 filas en menos de 5 s"), no vagos ("que funcione bien").
- Español neutro con tuteo; breve.`;

const S = { type: "string" } as const;
const LISTA = { type: "array", items: S } as const;

export async function conversar(root: string, texto: string, o: { conversacion?: string; modelo?: string; tipo?: Conversacion["tipo"] } = {}): Promise<{ conversacion: string; mensaje: string; respuesta: MensajeChat; decisiones: Decision[]; costoUsd: number }> {
  const z = makeZoner(root);
  // La conversación: la indicada, o la más reciente del mismo tipo, o una nueva.
  const ultima = listarConversaciones(root).find((c) => c.tipo === (o.tipo ?? "normal"));
  let conv = o.conversacion ? cargarConversacion(root, o.conversacion) : ultima ? cargarConversacion(root, ultima.id) : await crearConversacion(root, { ...(o.tipo ? { tipo: o.tipo } : {}) });
  if (o.modelo) conv = await elegirModelo(root, conv.id, o.modelo);
  const historial = conv.mensajes;
  const nuevoId = () => `m${crypto.randomBytes(4).toString("hex")}`;
  const yo: MensajeChat = { id: nuevoId(), quien: "tu", texto: texto.trim(), fecha: new Date().toISOString() };
  const entender = conv.tipo === "entender";
  const idx = leerIndice(root);
  const funciones = Object.values(idx.archivos).flatMap((a) => a.funciones);
  const tareas = cargarTareas(root).filter((t) => !t.hecha && !t.archivada);
  const enVivo = path.join(dataDir(root), "cache", "en-vivo", "chat.txt");
  const objetivos = leerObjetivos(root);
  try {
    const { data, costUsd, modelo } = await ask<{
      texto: string;
      decisiones?: { pregunta: string; opciones: Opcion[]; recomendada: string }[];
      cambiosTareas?: CambioTarea[];
      correcciones?: CorreccionPropuesta[];
      preguntas?: { pregunta: string; opciones: string[] }[];
      borrador?: { resumen: string; objetivos: string[]; usuarios: string; criterios: string[]; restricciones: string[]; fueraDeAlcance: string[]; dudas: string[] };
      creoQueEntendi?: boolean;
    }>({
      kind: entender ? "entender" : "chat",
      system: entender ? SYSTEM_ENTENDER : SYSTEM,
      cwd: root,
      enVivo,
      schema: entender
        ? {
            type: "object",
            additionalProperties: false,
            required: ["texto", "preguntas", "borrador", "creoQueEntendi"],
            properties: {
              texto: { type: "string", description: "Lo que le dices (comentario breve y la(s) pregunta(s), o el resumen final si ya entendiste)." },
              preguntas: { type: "array", maxItems: 2, items: { type: "object", additionalProperties: false, required: ["pregunta", "opciones"], properties: { pregunta: S, opciones: { type: "array", maxItems: 4, items: S } } } },
              borrador: {
                type: "object",
                additionalProperties: false,
                required: ["resumen", "objetivos", "usuarios", "criterios", "restricciones", "fueraDeAlcance", "dudas"],
                properties: { resumen: S, objetivos: LISTA, usuarios: S, criterios: { ...LISTA, description: "Cuándo está terminado: criterios comprobables." }, restricciones: LISTA, fueraDeAlcance: LISTA, dudas: LISTA },
              },
              creoQueEntendi: { type: "boolean" },
            },
          }
        : {
            type: "object",
            additionalProperties: false,
            required: ["texto", "decisiones", "cambiosTareas", "correcciones"],
            properties: {
              texto: { type: "string", description: "La respuesta, en markdown breve." },
              decisiones: SCHEMA_DECISIONES,
              cambiosTareas: {
                type: "array",
                maxItems: 5,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["accion", "id", "titulo", "archivo", "detalle"],
                  properties: { accion: { type: "string", enum: ["crear", "editar", "hecha", "reabrir", "descartar"] }, id: { type: "string", description: "Id de la tarea existente (\"\" al crear)." }, titulo: S, archivo: S, detalle: S },
                },
              },
              correcciones: {
                type: "array",
                maxItems: 3,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["tipo", "archivo", "antes", "despues"],
                  properties: { tipo: { type: "string", enum: ["modulo", "estructura", "proyecto"] }, archivo: { type: "string", description: "El archivo (\"\" si es del proyecto)." }, antes: S, despues: S },
                },
              },
            },
          },
      ...iaOpts(z.config, conv.modelo),
      prompt: [
        contextoComun(root, ""),
        !entender && funciones.length ? `Índice de funciones del proyecto (🟢 lista · 🟡 casi · 🔴 falta · 📝 con nota · sin marca: sin nota):\n${funciones.slice(0, 120).map((f) => lineaIndice(f, true)).join("\n")}` : "",
        !entender && tareas.length ? `Tareas pendientes (id: título):\n${tareas.slice(0, 25).map((t) => `- ${t.id}: ${t.titulo}${t.archivo ? ` (${t.archivo})` : ""}`).join("\n")}` : "",
        entender ? `Borrador actual (${objetivos.estado}):\n${JSON.stringify({ resumen: objetivos.resumen, objetivos: objetivos.objetivos, usuarios: objetivos.usuarios, criterios: objetivos.criterios.map((c) => c.texto), restricciones: objetivos.restricciones, fueraDeAlcance: objetivos.fueraDeAlcance, dudas: objetivos.dudas ?? [] })}` : "",
        historial.length ? `Conversación (lo último):\n${historial.slice(-12).map((m) => `${m.quien === "ia" ? "TÚ (IA)" : "PROGRAMADOR"}: ${m.texto.slice(0, 1200)}`).join("\n")}` : "",
        `PROGRAMADOR: ${yo.texto}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    });
    const nuevas = entender ? [] : proponerDecisiones(root, data.decisiones ?? [], {}, "chat");
    if (entender && data.borrador) {
      const o2 = leerObjetivos(root);
      // Si ya estaban confirmados, la conversación no los cambia: hay que reabrirlos (tú).
      if (o2.estado !== "entendido" && o2.estado !== "terminado") actualizarBorrador(root, { ...data.borrador, creeEntendido: !!data.creoQueEntendi });
    }
    const respuesta: MensajeChat = {
      id: nuevoId(),
      quien: "ia",
      // Fuera del modo programar el chat explica en palabras: el código escrito se quita (sin IA). Los
      // comandos de terminal sí pasan: sugerirlos es parte de acompañar.
      texto: modoEfectivo(z.config, "").c.proponerSolucion ? data.texto : sinSoluciones(data.texto, { permitir: ["bash", "sh", "shell", "console", "zsh", "powershell"] }),
      fecha: new Date().toISOString(),
      ...(nuevas.length ? { decisiones: nuevas.map((d) => d.id) } : {}),
      ...(data.cambiosTareas?.length ? { cambiosTareas: data.cambiosTareas.map(({ id, ...c }) => ({ ...c, ...(id ? { id } : {}) })) } : {}),
      ...(data.correcciones?.length ? { correcciones: data.correcciones } : {}),
      ...(data.preguntas?.length ? { preguntas: data.preguntas } : {}),
      ...(entender ? { creeEntendido: !!data.creoQueEntendi } : {}),
      ...(modelo ? { modelo } : {}),
      costo: costUsd,
    };
    // Releyendo dentro del candado: dos mensajes a la vez (panel y Claude Code) no se pisan.
    await conCandado(archivo(root, conv.id), async () => {
      const c = cargarConversacion(root, conv.id);
      c.mensajes.push(yo, respuesta);
      if (c.titulo === "Nueva conversación") c.titulo = tituloDe(c.mensajes);
      c.actualizada = respuesta.fecha;
      guardar(root, c);
    });
    return { conversacion: conv.id, mensaje: respuesta.id!, respuesta, decisiones: nuevas, costoUsd: costUsd };
  } finally {
    fs.rmSync(enVivo, { force: true });
  }
}

/**
 * Aplicar (tu clic) un cambio de tareas o una corrección que propuso la IA en un mensaje; queda
 * marcado como aplicado en la conversación (el botón pasa a "✓ Aplicado").
 */
export function aplicarPropuesta(root: string, id: string, mensaje: string | number, tipo: "tarea" | "correccion", k: number): Promise<string> {
  return conCandado(archivo(root, id), async () => {
    const c = cargarConversacion(root, id);
    // Por su id estable; los mensajes de antes (sin id), por su posición.
    const m = c.mensajes.find((x) => x.id === String(mensaje)) ?? (/^\d+$/.test(String(mensaje)) ? c.mensajes.filter((x) => !x.id)[Number(mensaje)] ?? c.mensajes[Number(mensaje)] : undefined);
    if (!m || m.quien !== "ia") throw new Error(`el mensaje ${mensaje} de la conversación ${id} no es una respuesta de la IA`);
    let hecho: string;
    if (tipo === "tarea") {
      const x = m.cambiosTareas?.[k];
      if (!x) throw new Error(`ese mensaje no tiene el cambio de tarea ${k}`);
      if (x.aplicado) return `ya estaba aplicado: ${x.aplicado}`;
      hecho = aplicarCambioTarea(root, { accion: x.accion, ...(x.id ? { id: x.id } : {}), ...(x.titulo ? { titulo: x.titulo } : {}), ...(x.archivo ? { archivo: x.archivo } : {}), ...(x.detalle ? { detalle: x.detalle } : {}) });
      x.aplicado = hecho;
    } else {
      const x = m.correcciones?.[k];
      if (!x) throw new Error(`ese mensaje no tiene la corrección ${k}`);
      if (x.aplicada) return `ya estaba aplicada: ${x.aplicada}`;
      const r = corregir(root, { tipo: x.tipo, ...(x.archivo ? { archivo: x.archivo } : {}), ...(x.antes ? { antes: x.antes } : {}), despues: x.despues, origen: "chat (tu clic)" });
      hecho = `corrección ${r.id}${r.archivo ? ` (${r.archivo})` : ""}`;
      x.aplicada = hecho;
    }
    guardar(root, c);
    return hecho;
  });
}
