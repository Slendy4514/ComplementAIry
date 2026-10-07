import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "./config.js";
import { contextBlock, projectContext } from "./context.js";
import { listFiles } from "./files.js";
import { makeZoner } from "./config.js";
import { ask } from "./llm.js";
import { loadPerfil, nivelDe } from "./profile.js";
import { iaOpts } from "./tutor.js";
import { sanitizeGuia } from "./verify.js";

/**
 * Plano del proyecto (arquitectura desde el inicio): una propuesta concreta de carpetas,
 * módulos, responsabilidades y orden de trabajo, como comentarios @guia en docs/ESTRUCTURA.md.
 * Las secciones las completa el humano; la IA recomienda y explica el porqué.
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
        properties: { archivo: { type: "string" }, responsabilidad: { type: "string" }, funciones: { type: "array", items: { type: "string" } } },
      },
    },
    orden: { type: "array", maxItems: 8, items: { type: "string" } },
    reglas: { type: "array", maxItems: 5, items: { type: "string" }, description: "Reglas de arquitectura que se podrían verificar automáticamente (p. ej. 'dominio no importa api')." },
    preguntas: { type: "array", maxItems: 4, items: { type: "string" } },
  },
};

const SYSTEM = `Eres el arquitecto de ComplementAIry. Propones una estructura CONCRETA para el proyecto (no un menú de opciones): carpetas, módulos, qué hace cada uno, qué funciones tendrá (nombres y responsabilidad en palabras, sin código), en qué orden construir y qué reglas de dependencias conviene verificar.
- Lee el proyecto con Read/Grep/Glob (estructura actual, package.json, código existente) y respeta lo que ya existe.
- Lo más simple que funcione para lo que describe el programador; explica el porqué de cada decisión en una frase.
- Preguntas: solo decisiones que de verdad dependen del programador.
- Español neutro con tuteo.`;

type Plano = {
  resumen: string;
  carpetas: { ruta: string; para_que: string }[];
  modulos: { archivo: string; responsabilidad: string; funciones: string[] }[];
  orden: string[];
  reglas: string[];
  preguntas: string[];
};

const g = (id: string, tipo: string, t: string) => `<!-- @guia[${id}] ${tipo}: ${sanitizeGuia(t.replace(/-->/g, "—"))} -->`;

export function renderPlano(p: Plano, id = "e1.1"): string {
  return [
    "## Arquitectura",
    "",
    g(id, "plano", p.resumen),
    "",
    "## Carpetas",
    "",
    ...p.carpetas.map((c) => g(id, "plano", `${c.ruta} → ${c.para_que}`)),
    "",
    "## Módulos",
    "",
    ...p.modulos.map((m) => g(id, "plano", `${m.archivo}: ${m.responsabilidad}${m.funciones.length ? ` Funciones: ${m.funciones.join("; ")}.` : ""}`)),
    "",
    "## Por dónde empezar",
    "",
    ...p.orden.map((o, i) => g(id, "plano", `${i + 1}. ${o}`)),
    ...(p.reglas.length ? ["", "## Reglas verificables", "", ...p.reglas.map((r) => g(id, "pieza", `${r} (se puede verificar con dependency-cruiser / import-linter; pide "!arquitectura" para guiarte)`))] : []),
    ...(p.preguntas.length ? ["", "## Decisiones pendientes", "", ...p.preguntas.map((q) => g(id, "pregunta", q))] : []),
    "",
  ].join("\n");
}

export async function planoProyecto(root: string, descripcion?: string): Promise<{ file: string; costoUsd: number }> {
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
    ...iaOpts(cfg),
    prompt: [
      descripcion ? `Qué se quiere construir: ${descripcion}` : "",
      `Programador: ${nivel}.`,
      contextBlock(projectContext(root, "docs/ESTRUCTURA.md")),
      `Archivos actuales (${archivos.length}):\n${archivos.join("\n") || "(proyecto vacío)"}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
  });
  const file = path.join(root, "docs", "ESTRUCTURA.md");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) {
    const cur = fs.readFileSync(file, "utf8");
    const n = (cur.match(/^## Propuesta /gm)?.length ?? 0) + 2;
    fs.writeFileSync(file, `${cur.replace(/\s*$/, "\n")}\n## Propuesta ${n} (${new Date().toISOString().slice(0, 10)})\n\n${renderPlano(data, `e${n}.1`)}`);
  } else {
    fs.writeFileSync(file, `# Estructura del proyecto\n\n<!-- Escribe debajo de cada sección lo que decidas. Los comentarios @guia son la propuesta; bórralos cuando ya no los necesites (cai guia clean). -->\n\n${renderPlano(data)}`);
  }
  return { file, costoUsd: costUsd };
}
