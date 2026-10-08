import fs from "node:fs";
import path from "node:path";
import { dataDir, makeZoner } from "./config.js";
import { contextBlock, CRITERIO, projectContext } from "./context.js";
import { ask } from "./llm.js";
import { preguntasAbiertas } from "./panorama.js";
import { iaOpts } from "./tutor.js";

/**
 * Conversar sobre una pregunta abierta antes de responderla: "¿por qué me preguntas esto?",
 * "¿qué conviene?". La IA explica y recomienda, pero la respuesta la das tú (`cai memoria
 * responder`, bloqueado para la IA del chat). El hilo vive en .cai/cache/dialogos.json.
 */

export interface MensajeDialogo {
  quien: "tu" | "ia";
  texto: string;
  fecha: string;
}

const archivo = (root: string) => path.join(dataDir(root), "cache", "dialogos.json");

export function cargarDialogos(root: string): Record<string, MensajeDialogo[]> {
  try {
    return JSON.parse(fs.readFileSync(archivo(root), "utf8")) as Record<string, MensajeDialogo[]>;
  } catch {
    return {};
  }
}

function guardar(root: string, d: Record<string, MensajeDialogo[]>): void {
  fs.mkdirSync(path.dirname(archivo(root)), { recursive: true });
  fs.writeFileSync(archivo(root), JSON.stringify(d, null, 2));
}

/** Al responder la pregunta, su conversación ya no hace falta. */
export function olvidarDialogo(root: string, pregunta: string): void {
  const d = cargarDialogos(root);
  if (!(pregunta in d)) return;
  delete d[pregunta];
  guardar(root, d);
}

const SYSTEM = `Le hiciste una pregunta al programador sobre su proyecto y él quiere conversarla antes de responder.
- Explica por qué importa (qué cambia en tus sugerencias según la respuesta), con un ejemplo concreto si ayuda.
- Si hay opciones, da 2-3 con su pro y su contra, y di cuál recomiendas y por qué.
- Si necesitas ver el código para responder, léelo (Read/Grep); no le preguntes lo que puedes leer.
- No respondas la pregunta por él: la decisión es suya. Corto, español neutro con tuteo, sin código.

${CRITERIO}`;

export async function conversar(root: string, n: number, texto: string): Promise<{ pregunta: string; sugerencia: string; hilo: MensajeDialogo[]; costoUsd: number }> {
  const q = preguntasAbiertas(root).find((x) => x.n === n);
  if (!q) throw new Error(`no hay pregunta abierta número ${n}; míralas con: cai memoria`);
  const dialogos = cargarDialogos(root);
  const hilo = (dialogos[q.pregunta] ??= []);
  hilo.push({ quien: "tu", texto, fecha: new Date().toISOString() });
  const z = makeZoner(root);
  const { data, costUsd } = await ask<{ texto: string }>({
    kind: "memoria:conversar",
    system: SYSTEM,
    cwd: root,
    schema: { type: "object", additionalProperties: false, required: ["texto"], properties: { texto: { type: "string" } } },
    ...iaOpts(z.config, "chico"),
    prompt: [
      `La pregunta que le hiciste: ${q.pregunta}`,
      q.sugerencia ? `Tu sugerencia de respuesta: ${q.sugerencia}` : "",
      contextBlock(projectContext(root, "README.md")),
      `Conversación:\n${hilo.map((m) => `${m.quien === "ia" ? "TÚ (IA)" : "PROGRAMADOR"}: ${m.texto}`).join("\n")}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
  });
  hilo.push({ quien: "ia", texto: data.texto, fecha: new Date().toISOString() });
  guardar(root, dialogos);
  return { pregunta: q.pregunta, sugerencia: q.sugerencia, hilo, costoUsd: costUsd };
}
