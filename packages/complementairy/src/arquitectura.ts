import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "./config.js";
import { contextBlock, projectContext } from "./context.js";
import { ask } from "./llm.js";
import { loadPerfil, nivelDe } from "./profile.js";
import { iaOpts } from "./tutor.js";
import { sanitizeGuia } from "./verify.js";

/**
 * Arquitectura: el humano decide y escribe la decisión (ADR). La IA prepara las preguntas
 * y las opciones con sus pros y contras, como comentarios dentro del documento.
 */

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);

export interface AdrGuia {
  preguntas: string[];
  opciones: { nombre: string; pros: string[]; contras: string[]; cuando: string }[];
  lecturas: string[];
}

/** Crea docs/adr/NNNN-titulo.md con la estructura; las secciones las escribe el humano. */
export function nuevoAdr(root: string, titulo: string, guia?: AdrGuia): string {
  const dir = path.join(root, "docs", "adr");
  fs.mkdirSync(dir, { recursive: true });
  const nums = fs
    .readdirSync(dir)
    .map((f) => /^(\d{4})-/.exec(f)?.[1])
    .filter(Boolean)
    .map(Number);
  const n = String((nums.length ? Math.max(...nums) : 0) + 1).padStart(4, "0");
  const file = path.join(dir, `${n}-${slug(titulo)}.md`);
  const g = (t: string) => `<!-- @guia[a${Number(n)}.1] ${sanitizeGuia(t.replace(/-->/g, "—"))} -->`;
  const opciones = guia?.opciones.map(
    (o) => g(`pieza: Opción "${o.nombre}". A favor: ${o.pros.join("; ")}. En contra: ${o.contras.join("; ")}. Conviene cuando: ${o.cuando}`),
  );
  const body = [
    `# ${n}. ${titulo}`,
    "",
    `Fecha: ${new Date().toISOString().slice(0, 10)} · Estado: propuesta`,
    "",
    "## Contexto",
    "",
    ...(guia?.preguntas.map((q) => g(`pregunta: ${q}`)) ?? [g("pregunta: ¿Qué problema obliga a decidir esto ahora? ¿Qué restricciones hay?")]),
    "",
    "## Opciones consideradas",
    "",
    ...(opciones ?? [g("pista: Listá al menos dos opciones reales, incluida \"no hacer nada\".")]),
    "",
    "## Decisión",
    "",
    g("pista: Escribí qué elegiste y POR QUÉ, en tus palabras. Es lo que tu yo del futuro va a leer."),
    "",
    "## Consecuencias",
    "",
    g("pregunta: ¿Qué se vuelve más fácil y qué más difícil? ¿Qué regla verificable podés sacar de esto (p. ej. dependency-cruiser)?"),
    ...(guia?.lecturas.length ? ["", ...guia.lecturas.map((l) => g(`pieza: lectura recomendada: ${l}`))] : []),
    "",
  ].join("\n");
  fs.writeFileSync(file, body);

  // Índice
  const index = path.join(dir, "README.md");
  const line = `- [${n}. ${titulo}](${path.basename(file)}) — propuesta`;
  const cur = fs.existsSync(index) ? fs.readFileSync(index, "utf8") : "# Decisiones de arquitectura (ADR)\n\n";
  fs.writeFileSync(index, cur.replace(/\s*$/, "\n") + line + "\n");
  return file;
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["titulo", "preguntas", "opciones", "lecturas"],
  properties: {
    titulo: { type: "string", description: "Título corto de la decisión a tomar" },
    preguntas: { type: "array", maxItems: 5, items: { type: "string" } },
    opciones: {
      type: "array",
      minItems: 2,
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["nombre", "pros", "contras", "cuando"],
        properties: { nombre: { type: "string" }, pros: { type: "array", items: { type: "string" } }, contras: { type: "array", items: { type: "string" } }, cuando: { type: "string" } },
      },
    },
    lecturas: { type: "array", maxItems: 3, items: { type: "string" } },
  },
};

const SYSTEM = `Sos el guía de arquitectura de ComplementAIry. El programador toma las decisiones y las escribe; vos preparás el terreno.
- Leé el proyecto (Read/Grep/Glob): estructura, dependencias, docs/adr existentes.
- Devolvé: las preguntas que debería responderse antes de decidir (requisitos, restricciones, escala, equipo), 2 a 4 opciones reales con pros, contras y cuándo conviene cada una, y hasta 3 lecturas (links oficiales o clásicos que conozcas con certeza).
- No elijas por el programador. Si una opción es claramente mala para su contexto, decilo en sus contras.
- Adaptate a su nivel. Español neutro con tuteo.`;

export async function arquitectura(root: string, tema: string): Promise<{ file: string; costoUsd: number }> {
  const cfg = loadConfig(root);
  const perfil = loadPerfil();
  const nivel = nivelDe(Math.max(...Object.values(perfil.temas).map((t) => t.puntaje), 0.3));
  const { data, costUsd } = await ask<AdrGuia & { titulo: string }>({
    kind: "arquitectura",
    system: SYSTEM,
    cwd: root,
    schema: SCHEMA,
    ...iaOpts(cfg),
    prompt: [`Tema a decidir: ${tema}`, `Programador: ${nivel}.`, contextBlock(projectContext(root, "docs/adr/x.md"))].filter(Boolean).join("\n\n"),
  });
  return { file: nuevoAdr(root, data.titulo || tema, data), costoUsd: costUsd };
}
