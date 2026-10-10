import fs from "node:fs";
import path from "node:path";
import { dataDir, loadConfig } from "./config.js";
import { contextBlock, projectContext, CRITERIO } from "./context.js";
import { listFiles } from "./files.js";
import { makeZoner } from "./config.js";
import { ask } from "./llm.js";
import { loadPerfil, nivelDe } from "./profile.js";
import { sobreElCodigo } from "./memoria.js";
import { actualizarMemoria, agregarPreguntas, unaLinea } from "./panorama.js";
import { agregarTareas, cargarTareas, guardarTareas, rutasDe } from "./siguiente.js";
import { iaOpts } from "./tutor.js";
import { sanitizeGuia } from "./verify.js";
import { aplicarAEstructura } from "./correcciones.js";

/**
 * Plano del proyecto (arquitectura desde el inicio): una propuesta concreta de carpetas,
 * módulos, responsabilidades y orden de trabajo, en docs/ESTRUCTURA.md (markdown limpio que el humano
 * edita) y .cai/estructura.json (para el panel). Lo que falta crear queda como tareas.
 */

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["resumen", "carpetas", "modulos", "orden", "reglas", "preguntas"],
  properties: {
    resumen: { type: "string", description: "La arquitectura recomendada en 2-3 oraciones y por qué encaja con este proyecto." },
    carpetas: { type: "array", maxItems: 8, items: { type: "object", additionalProperties: false, required: ["ruta", "para_que"], properties: { ruta: { type: "string" }, para_que: { type: "string" } } } },
    modulos: {
      type: "array",
      maxItems: 10,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["archivo", "responsabilidad", "funciones"],
        properties: { archivo: { type: "string", description: "UNA ruta relativa con extensión (p. ej. src/dominio/cuota.ts), sin texto extra. Un módulo por archivo." }, responsabilidad: { type: "string" }, funciones: { type: "array", items: { type: "string" } } },
      },
    },
    orden: { type: "array", maxItems: 8, items: { type: "string" } },
    reglas: { type: "array", maxItems: 5, items: { type: "string" }, description: "Reglas de arquitectura que se podrían verificar automáticamente (p. ej. 'dominio no importa api')." },
    preguntas: {
      type: "array",
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["pregunta", "sugerencia"],
        properties: { pregunta: { type: "string", description: "Corta: una oración." }, sugerencia: { type: "string", description: "La respuesta que recomiendas, corta (con su porqué en pocas palabras)." } },
      },
    },
  },
};

const SYSTEM = `Eres el arquitecto de ComplementAIry. Propones una estructura CONCRETA para el proyecto (no un menú de opciones): carpetas, módulos, qué hace cada uno, qué funciones tendrá (nombres y responsabilidad en palabras, sin código), en qué orden construir y qué reglas de dependencias conviene verificar.
- Lee el proyecto con Read/Grep/Glob (estructura actual, package.json, código existente) y respeta lo que ya existe.
- Lo más simple que funcione para lo que describe el programador; explica el porqué de cada decisión en una frase.
- Preguntas: solo decisiones que de verdad dependen del programador. NUNCA preguntes qué hace o si ya existe algo en el código: léelo con Read/Grep.
- Español neutro con tuteo.

${CRITERIO}`;

type Plano = {
  resumen: string;
  carpetas: { ruta: string; para_que: string }[];
  modulos: { archivo: string; responsabilidad: string; funciones: string[] }[];
  orden: string[];
  reglas: string[];
  preguntas: { pregunta: string; sugerencia: string }[];
};

const limpio = (t: string) => sanitizeGuia(t.replace(/<!--|-->/g, "—")).replace(/\s*\n\s*/g, " ").trim();

/** Markdown limpio (sin comentarios @guia): para leerlo en vista previa y editarlo con tus decisiones. */
export function renderPlano(p: Plano, root?: string): string {
  const existe = (f: string) => (root && fs.existsSync(path.join(root, f)) ? "✓" : "○");
  return [
    "## Arquitectura",
    "",
    limpio(p.resumen),
    "",
    "## Carpetas",
    "",
    ...p.carpetas.map((c) => `- \`${c.ruta}\`: ${limpio(c.para_que)}`),
    "",
    "## Módulos",
    "",
    root ? "_✓ ya existe · ○ por crear (aparece como tarea en el panel)_\n" : "",
    ...p.modulos.flatMap((m) => [`- ${root ? `${existe(m.archivo)} ` : ""}\`${m.archivo}\`: ${limpio(m.responsabilidad)}`, ...m.funciones.map((f) => `  - ${limpio(f)}`)]),
    "",
    "## Por dónde empezar",
    "",
    ...p.orden.map((o, i) => `${i + 1}. ${limpio(o).replace(/^\d+[.)]\s*/, "")}`),
    ...(p.reglas.length ? ["", "## Reglas verificables", "", ...p.reglas.map((r) => `- ${limpio(r)}`), "", "_Se pueden verificar con dependency-cruiser / import-linter (pide \"!arquitectura\")._"] : []),
    ...(p.preguntas.length ? ["", "## Decisiones pendientes", "", "_También están en el panel → Preguntas para ti._", "", ...p.preguntas.map((q) => `- ${limpio(q.pregunta)}${q.sugerencia ? ` _(sugerencia: ${limpio(q.sugerencia)})_` : ""}`)] : []),
    "",
  ]
    .filter((l, i, arr) => !(l === "" && arr[i - 1] === ""))
    .join("\n");
}

export async function planoProyecto(root: string, descripcion?: string): Promise<{ file: string; costoUsd: number; tareas: number }> {
  const cfg = loadConfig(root);
  const z = makeZoner(root, cfg);
  const perfil = loadPerfil();
  const nivel = nivelDe(Math.max(...Object.values(perfil.temas).map((t) => t.puntaje), 0.3));
  const archivos = listFiles(z).slice(0, 200);
  const { data, costUsd } = await ask<Plano>({
    kind: "plano",
    system: SYSTEM,
    cwd: root,
    schema: SCHEMA,
    ...iaOpts(cfg, "grande"),
    prompt: [
      descripcion ? `Qué se quiere construir: ${descripcion}` : "",
      `Programador: ${nivel}.`,
      contextBlock(projectContext(root, "docs/ESTRUCTURA.md")),
      `Archivos actuales (${archivos.length}):\n${archivos.join("\n") || "(proyecto vacío)"}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
  });
  // La IA a veces escribe "a.js (y b.ts)" en vez de una ruta: se separa en rutas reales (sin IA).
  data.modulos = data.modulos.flatMap((m) => {
    const rutas = rutasDe(m.archivo);
    return rutas.map((archivo) => ({ ...m, archivo }));
  });
  data.modulos = data.modulos.filter((m, i, arr) => arr.findIndex((x) => x.archivo === m.archivo) === i);
  const file = path.join(root, "docs", "ESTRUCTURA.md");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fecha = new Date().toISOString().slice(0, 10);
  if (fs.existsSync(file)) {
    const cur = fs.readFileSync(file, "utf8");
    const n = (cur.match(/^#{1,2} Propuesta /gm)?.length ?? 0) + 2;
    fs.writeFileSync(file, `${cur.replace(/\s*$/, "\n")}\n# Propuesta ${n} (${fecha})\n\n${renderPlano(data, root)}`);
  } else {
    fs.writeFileSync(file, `# Estructura del proyecto\n\n<!-- Propuesta de ComplementAIry (${fecha}). Edítala con lo que decidas: es la referencia para guías, planos y revisiones. -->\n\n${renderPlano(data, root)}`);
  }
  // Para el panel: la estructura como datos, y lo que falta como tareas (se marcan solas al crear el archivo).
  fs.mkdirSync(dataDir(root), { recursive: true });
  // Lo que corregiste del rol de un archivo se mantiene al volver a proponer la estructura.
  fs.writeFileSync(path.join(dataDir(root), "estructura.json"), JSON.stringify(aplicarAEstructura(root, { version: 1, fecha, ...data }), null, 2));
  // En el orden de "Por dónde empezar" (el primer paso que nombra el archivo).
  const paso = (archivo: string) => {
    const base = path.basename(archivo).replace(/\.[^.]+$/, "");
    const re = new RegExp(`(?<![\\p{L}\\d_])${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\d_])`, "u");
    const i = data.orden.findIndex((o) => o.includes(archivo) || re.test(o));
    return i < 0 ? 99 : i;
  };
  // Una propuesta nueva reemplaza a la anterior: los "Crear X" pendientes que ya no están, se quitan.
  const propuestos = new Set(data.modulos.map((m) => m.archivo));
  guardarTareas(root, cargarTareas(root).filter((t) => t.origen !== "estructura" || t.hecha || propuestos.has(t.archivo ?? "")));
  const tareas = agregarTareas(
    root,
    [...data.modulos]
      .sort((a, b) => paso(a.archivo) - paso(b.archivo))
      .filter((m) => !fs.existsSync(path.join(root, m.archivo)))
      .map((m) => ({ titulo: `Crear ${m.archivo}`, detalle: limpio(m.responsabilidad), archivo: m.archivo, crear: true, origen: "estructura" as const })),
  );
  if (data.preguntas.length)
    actualizarMemoria(root, (m) => {
      agregarPreguntas(
        m,
        data.preguntas.filter((q) => !sobreElCodigo(q.pregunta, archivos)).map((q) => (q.sugerencia ? `${unaLinea(limpio(q.pregunta))} (sugerencia: ${unaLinea(limpio(q.sugerencia))})` : unaLinea(limpio(q.pregunta)))),
      );
    });
  return { file, costoUsd: costUsd, tareas };
}
