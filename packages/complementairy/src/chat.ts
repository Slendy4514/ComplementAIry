import fs from "node:fs";
import path from "node:path";
import { dataDir, makeZoner } from "./config.js";
import { CRITERIO } from "./context.js";
import { contextoComun } from "./contexto.js";
import { proponerDecisiones, SCHEMA_DECISIONES, type Decision, type Opcion } from "./decisiones.js";
import { leerIndice, lineaIndice } from "./indice.js";
import { ask } from "./llm.js";
import { conCandado } from "./ocupado.js";
import { cargarTareas } from "./siguiente.js";
import { iaOpts } from "./tutor.js";

/**
 * Chat del proyecto (fuera de cualquier archivo): preguntas generales ("¿por dónde sigo?", "¿cómo
 * encaja X?", "¿qué falta para terminar?"). La IA conoce la estructura, el panorama, el índice de
 * funciones y tus decisiones, y puede LEER el proyecto (solo lectura). Puede proponer decisiones
 * (con botones) y tareas; nunca escribe tu código.
 */

export interface MensajeChat {
  quien: "tu" | "ia";
  texto: string;
  fecha: string;
  decisiones?: string[];
  tareas?: { titulo: string; archivo: string; detalle: string }[];
  costo?: number;
}

const archivo = (root: string) => path.join(dataDir(root), "chat.json");

export function cargarChat(root: string): MensajeChat[] {
  try {
    return (JSON.parse(fs.readFileSync(archivo(root), "utf8")) as { mensajes: MensajeChat[] }).mensajes ?? [];
  } catch {
    return [];
  }
}

function guardar(root: string, ms: MensajeChat[]): void {
  fs.mkdirSync(path.dirname(archivo(root)), { recursive: true });
  const tmp = `${archivo(root)}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, mensajes: ms.slice(-60) }, null, 2));
  fs.renameSync(tmp, archivo(root));
}

/** Agrega mensajes releyendo el historial dentro del candado (dos chats a la vez no se pisan). */
const agregar = (root: string, ms: MensajeChat[]) => conCandado(archivo(root), async () => guardar(root, [...cargarChat(root), ...ms]));

export function limpiarChat(root: string): Promise<void> {
  return conCandado(archivo(root), async () => guardar(root, []));
}

const SYSTEM = `Eres el compañero del programador para su PROYECTO completo (no un archivo). Respondes preguntas generales: por dónde seguir, cómo encaja algo, qué falta, qué conviene decidir, cómo organizar. Puedes leer el proyecto (Read, Grep, Glob) para responder con datos reales: no supongas lo que puedes leer.
- Nunca escribes el código del programador ni la solución en código: explicas en palabras, con piezas (funciones/APIs) y pasos.
- Usa lo que ya se sabe (estructura, panorama, índice de funciones con su estado, decisiones): no pienses de cero ni contradigas sus decisiones.
- Si algo depende de una decisión suya, proponla en "decisiones" (con opciones). Si sugieres trabajo concreto, propón hasta 3 "tareas" (título corto, archivo y detalle).
- Markdown breve; listas con un ítem por línea. Español neutro con tuteo.

${CRITERIO}`;

export async function conversar(root: string, texto: string): Promise<{ respuesta: MensajeChat; decisiones: Decision[]; costoUsd: number }> {
  const z = makeZoner(root);
  const historial = cargarChat(root);
  const yo: MensajeChat = { quien: "tu", texto: texto.trim(), fecha: new Date().toISOString() };
  const idx = leerIndice(root);
  const funciones = Object.values(idx.archivos).flatMap((a) => a.funciones);
  const tareas = cargarTareas(root).filter((t) => !t.hecha && !t.archivada);
  const enVivo = path.join(dataDir(root), "cache", "en-vivo", "chat.txt");
  try {
    const { data, costUsd } = await ask<{ texto: string; decisiones: { pregunta: string; opciones: Opcion[]; recomendada: string }[]; tareas: { titulo: string; archivo: string; detalle: string }[] }>({
      kind: "chat",
      system: SYSTEM,
      cwd: root,
      enVivo,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["texto", "decisiones", "tareas"],
        properties: {
          texto: { type: "string", description: "La respuesta, en markdown breve." },
          decisiones: SCHEMA_DECISIONES,
          tareas: {
            type: "array",
            maxItems: 3,
            items: { type: "object", additionalProperties: false, required: ["titulo", "archivo", "detalle"], properties: { titulo: { type: "string" }, archivo: { type: "string" }, detalle: { type: "string" } } },
          },
        },
      },
      ...iaOpts(z.config, "mediano"),
      prompt: [
        contextoComun(root, ""),
        funciones.length ? `Índice de funciones del proyecto (🟢 lista · 🟡 casi · 🔴 falta · 📝 con nota · sin marca: sin nota):\n${funciones.slice(0, 120).map((f) => lineaIndice(f, true)).join("\n")}` : "",
        tareas.length ? `Tareas pendientes:\n${tareas.slice(0, 15).map((t) => `- ${t.titulo}${t.archivo ? ` (${t.archivo})` : ""}`).join("\n")}` : "",
        historial.length ? `Conversación (lo último):\n${historial.slice(-10).map((m) => `${m.quien === "ia" ? "TÚ (IA)" : "PROGRAMADOR"}: ${m.texto.slice(0, 1200)}`).join("\n")}` : "",
        `PROGRAMADOR: ${yo.texto}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    });
    const nuevas = proponerDecisiones(root, data.decisiones ?? [], {}, "chat");
    const respuesta: MensajeChat = {
      quien: "ia",
      texto: data.texto,
      fecha: new Date().toISOString(),
      ...(nuevas.length ? { decisiones: nuevas.map((d) => d.id) } : {}),
      ...(data.tareas?.length ? { tareas: data.tareas } : {}),
      costo: costUsd,
    };
    await agregar(root, [yo, respuesta]);
    return { respuesta, decisiones: nuevas, costoUsd: costUsd };
  } finally {
    fs.rmSync(enVivo, { force: true });
  }
}
