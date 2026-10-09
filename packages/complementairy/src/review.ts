import { cegar } from "./verificar.js";
import fs from "node:fs";
import path from "node:path";
import { parse } from "./comments.js";
import { dataDir, loadConfig, makeZoner, notaOrigen, origenDe } from "./config.js";
import { contextBlock, projectContext, registrarPatron, CRITERIO } from "./context.js";
import { runGate, type Corrida, type Diag } from "./gate.js";
import { langFor, type LangSpec } from "./lang.js";
import { ask, evitada } from "./llm.js";
import { loadPerfil, nivelDe, puntaje, registrar } from "./profile.js";
import { eolOf, renderReply } from "./render.js";
import { nextThreadId, regionesTop } from "./threads.js";
import { publicar, type Edicion } from "./salida.js";
import { guardarDiagnosticos } from "./siguiente.js";
import { iaOpts } from "./tutor.js";
import { verifyCommentOnly } from "./verify.js";

/**
 * Revisión al terminar: primero los sensores deterministas (que sí bloquean), después
 * revisores de IA enfocados, cada uno en su propia llamada (que solo comentan).
 */

const ETIQUETAS = ["issue", "suggestion", "question", "praise", "nitpick"] as const;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["hallazgos"],
  properties: {
    hallazgos: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["codigo", "etiqueta", "bloqueante", "categoria", "texto", "links"],
        properties: {
          codigo: { type: "string", description: "Copia EXACTA de la línea de código a la que se refiere (sin el número)." },
          etiqueta: { type: "string", enum: [...ETIQUETAS] },
          bloqueante: { type: "boolean" },
          categoria: { type: "string", description: "Etiqueta corta y estable en kebab-case, p. ej. validacion-entrada, nombres, division-por-cero" },
          texto: { type: "string" },
          links: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
};

export interface Reviewer {
  id: string;
  foco: string;
  /** Solo corre si se cumple (p. ej. hay reglas escritas, hay ADRs). */
  aplica?: (root: string, reglas: string) => boolean;
}

export const REVIEWERS: Reviewer[] = [
  { id: "bugs", foco: "errores de lógica y casos borde: valores vacíos, cero, negativos, null/undefined, límites, manejo de errores, condiciones de carrera" },
  { id: "seguridad", foco: "seguridad: validación de entradas, inyección (SQL, shell, HTML), secretos en el código, permisos, datos sensibles en logs" },
  { id: "simplicidad", foco: "legibilidad y simplicidad: nombres, duplicación, complejidad innecesaria, funciones demasiado largas, código muerto" },
  { id: "tests", foco: "tests: buscá con Glob/Grep si existen tests de este archivo. Si existen, qué casos importantes faltan; si no, qué comportamientos y propiedades conviene testear primero" },
  { id: "convenciones", foco: "cumplimiento de las reglas de estilo escritas por el programador (citá la regla que no se cumple)", aplica: (_r, reglas) => reglas.trim().length > 0 },
  {
    id: "arquitectura",
    foco: "coherencia con las decisiones de arquitectura del proyecto: leé docs/adr/*.md y docs/ARCHITECTURE.md y señalá desviaciones",
    aplica: (root) => fs.existsSync(path.join(root, "docs", "adr")) || fs.existsSync(path.join(root, "docs", "ARCHITECTURE.md")),
  },
];

const SYSTEM = `Sos un revisor de código de ComplementAIry. El programador escribió este código y aprende de tu revisión. No escribís su código.
- Revisá SOLO tu foco. Máximo 5 hallazgos, solo los que valgan la pena; si no hay nada importante, devolvé una lista vacía (o un único "praise" si algo está especialmente bien).
- Cada hallazgo apunta a una línea: copiá en "codigo" el texto exacto de esa línea.
- Etiquetas de Conventional Comments: issue (problema real), suggestion (mejora), question (algo para que piense), nitpick (menor), praise (algo bien hecho). "bloqueante" solo si el problema puede causar un error real.
- Adaptate al nivel del programador: aprendiz = explicá el porqué y preferí preguntas que lo lleven a descubrirlo; intermedio = directo; experto = mínimo y técnico.
- No des la solución en código: describí el problema y la pista o la pieza (con link a documentación oficial si estás seguro de la URL).
- Ignorá las preguntas abiertas del programador (comentarios @ia?): las responde el tutor, no la revisión.
- Ignorá los comentarios @guia existentes.
- Español neutro con tuteo (tú), 1 a 3 oraciones por hallazgo. No cites números de línea.

${CRITERIO}`;

const CONSOLIDAR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["mantener"],
  properties: { mantener: { type: "array", items: { type: "integer" }, maxItems: 8 } },
};

const CONSOLIDAR_SYSTEM = `Recibís hallazgos de varios revisores de código sobre el mismo archivo. Muchos se repiten.
Devolvé los índices a mantener, ordenados por importancia (bloqueantes primero), con estas reglas:
- Si varios hallazgos dicen lo mismo (aunque con otras palabras), quedate solo con el más claro.
- Máximo 8. Priorizá: problemas reales > preguntas que hagan pensar > sugerencias > detalles menores. Como mucho un "praise".
- No inventes índices.`;

/** Elimina duplicados entre revisores (la IA elige; la regla de subconjunto y el tope se verifican acá). */
async function consolidar(root: string, findings: Finding[], costo: (n: number) => void): Promise<Finding[]> {
  if (findings.length <= 1) return findings;
  try {
    const { data, costUsd } = await ask<{ mantener: number[] }>({
      kind: "revisar:consolidar",
      system: CONSOLIDAR_SYSTEM,
      cwd: root,
      schema: CONSOLIDAR_SCHEMA,
      sinHerramientas: true,
      ...iaOpts(loadConfig(root), "chico"),
      prompt: findings.map((f, i) => `[${i}] (línea ${f.line}, ${f.fuente}, ${f.etiqueta}${f.bloqueante ? ", bloqueante" : ""}) ${f.texto}`).join("\n"),
    });
    costo(costUsd);
    const keep = [...new Set(data.mantener)].filter((i) => Number.isInteger(i) && i >= 0 && i < findings.length).slice(0, 8);
    return keep.length ? keep.map((i) => findings[i]!) : findings.slice(0, 8);
  } catch {
    return findings.slice(0, 8);
  }
}

interface Finding {
  line: number;
  etiqueta: string;
  bloqueante: boolean;
  texto: string;
  links: string[];
  fuente: string;
}

export interface ReviewResult {
  insertados: number;
  omitidos: string[];
  corridas: Corrida[];
  bloqueantes: number;
  costoUsd: number;
  ediciones?: Edicion[];
}

function findLine(lines: string[], codigo: string): number {
  const want = codigo.trim();
  if (!want) return -1;
  const i = lines.findIndex((l) => l.trim() === want);
  if (i >= 0) return i + 1;
  const j = lines.findIndex((l) => l.trim().length > 3 && (l.includes(want) || want.includes(l.trim())));
  return j >= 0 ? j + 1 : -1;
}

/** Inserta comentarios encima de una línea, verificando que solo se agreguen comentarios. */
async function insertAbove(src: string, lang: LangSpec, line: number, block: string[]): Promise<string | null> {
  const nl = eolOf(src);
  const lines = src.split(nl);
  if (line < 1 || line > lines.length) return null;
  const indent = /^[ \t]*/.exec(lines[line - 1]!)![0];
  const next = [...lines.slice(0, line - 1), ...block.map((b) => indent + b.trimStart()), ...lines.slice(line - 1)].join(nl);
  const v = await verifyCommentOnly(src, next, lang);
  return v.ok ? next : null;
}

export interface ReviewOptions {
  sinIa?: boolean;
  /** Revisar todo aunque no haya cambiado desde la última revisión. */
  todo?: boolean;
  /** Modo comentarios desde VSCode: devolver las inserciones en vez de escribir el archivo. */
  ediciones?: boolean;
  solo?: string[];
  log?: (s: string) => void;
  /** "Otra mirada": plan SIN ver el código y comparación (con el botón; no al guardar). */
  otraMirada?: boolean;
}

export async function runReview(root: string, rel: string, o: ReviewOptions = {}): Promise<ReviewResult> {
  const log = o.log ?? (() => {});
  const abs = path.join(root, rel);
  const lang = langFor(rel);
  if (!lang) throw new Error(`tipo de archivo sin soporte: ${rel}`);
  const z = makeZoner(root);
  const res: ReviewResult = { insertados: 0, omitidos: [], corridas: [], bloqueantes: 0, costoUsd: 0 };
  const origen = origenDe(z.config, rel);
  const propio = origen === "propio";

  // 1. Sensores deterministas.
  log(`cai: verificaciones deterministas de ${rel}...`);
  const gate = runGate(root, [rel]);
  res.corridas = gate.corridas;
  for (const d of gate.diags.filter((x) => x.file !== rel)) res.omitidos.push(`${d.file}:${d.line} [${d.tool}] ${d.msg}`);
  const findings: Finding[] = gate.diags.filter((d) => d.file === rel).map((d: Diag) => ({
    line: d.line,
    etiqueta: "issue",
    bloqueante: d.bloqueante,
    texto: `[${d.tool}${d.code ? ` ${d.code}` : ""}] ${d.msg}`,
    links: [],
    fuente: d.tool,
  }));
  if (propio) for (const d of gate.diags) registrarPatron(`${d.tool}/${d.code ?? "general"}`, d.msg);

  // 2. Revisores de IA, en paralelo, uno por foco.
  const src0 = fs.readFileSync(abs, "utf8");
  // Solo se le manda a la IA lo que cambió desde la última revisión (ahorro de tokens).
  const regiones = regionesTop(src0, await parse(src0, lang));
  const cacheFile = path.join(dataDir(root), "cache", "revisiones.json");
  const cache = (() => {
    try {
      return JSON.parse(fs.readFileSync(cacheFile, "utf8")) as Record<string, Record<string, string>>;
    } catch {
      return {};
    }
  })();
  const previas = o.todo || o.otraMirada ? undefined : cache[rel];
  const cambiadas = previas ? regiones.filter((r) => previas[r.key] !== r.hash) : regiones;
  let sinIa = o.sinIa;
  if (!sinIa && previas && !cambiadas.length) {
    sinIa = true;
    res.omitidos.push("sin cambios desde la última revisión: no se llamó a la IA (usa --todo para revisar igual)");
    evitada("revisar", "sin cambios");
  }
  if (!sinIa) {
    const ctx = projectContext(root, rel);
    const nivel = nivelDe(puntaje(loadPerfil(), lang.id));
    const reviewers = REVIEWERS.filter((r) => (!o.solo || o.solo.includes(r.id)) && (!r.aplica || r.aplica(root, ctx.reglas)));
    // A ciegas: los comentarios que "aprueban" ("esto está bien", "no tocar") no llegan al revisor.
    const lineasArchivo = src0.split("\n").map(cegar);
    const numerar = (a: number, b: number) =>
      lineasArchivo
        .slice(a - 1, b)
        .map((l, i) => `${String(a + i).padStart(4)}| ${l}`)
        .join("\n");
    const parcial = previas && cambiadas.length < regiones.length;
    const numbered = parcial
      ? `Revisa SOLO estas partes, que cambiaron desde la última revisión:\n${cambiadas.map((r) => numerar(r.desde, r.hasta)).join("\n...\n")}\n\nResto del archivo (sin cambios; solo las firmas, como contexto):\n${regiones
          .filter((r) => !cambiadas.includes(r))
          .map((r) => `- ${r.key}`)
          .join("\n")}`
      : numerar(1, lineasArchivo.length);
    if (parcial) evitada("revisar", `${regiones.length - cambiadas.length} de ${regiones.length} partes sin cambios no se enviaron`);
    const lines0 = src0.split("\n");
    log(`cai: ${reviewers.length} revisores en paralelo (${reviewers.map((r) => r.id).join(", ")})`);
    const results = await Promise.all(
      reviewers.map(async (r) => {
        try {
          const { data, costUsd } = await ask<{ hallazgos: { codigo: string; etiqueta: string; bloqueante: boolean; categoria: string; texto: string; links: string[] }[] }>({
            kind: `revisar:${r.id}`,
            ref: { archivo: rel },
            system: SYSTEM,
            cwd: root,
            schema: SCHEMA,
            ...iaOpts(z.config, "mediano"),
            prompt: [
              `Foco de esta revisión: ${r.foco}.`,
              notaOrigen(origen),
              `Archivo: ${rel} (${lang.id})${z.isCritical(abs) ? " — ZONA CRÍTICA" : ""}. Programador: ${nivel} en ${lang.id}.`,
              contextBlock(ctx),
              gate.diags.length ? `Ya detectado por herramientas (no lo repitas):\n${gate.diags.map((d) => `- línea ${d.line}: ${d.msg}`).join("\n")}` : "",
              `Código:\n${numbered}`,
            ]
              .filter(Boolean)
              .join("\n\n"),
          });
          res.costoUsd += costUsd;
          return data.hallazgos.map((h) => {
            if (propio) registrarPatron(`${r.id}/${h.categoria}`, h.texto);
            return { line: findLine(lines0, h.codigo), etiqueta: h.etiqueta, bloqueante: h.bloqueante, texto: h.texto, links: h.links, fuente: r.id };
          });
        } catch (e) {
          res.omitidos.push(`revisor ${r.id}: ${e instanceof Error ? e.message : String(e)}`);
          return [];
        }
      }),
    );
    const ai: Finding[] = [];
    for (const list of results) {
      for (const f of list) {
        if (f.line < 0) res.omitidos.push(`[${f.fuente}] no se encontró la línea: ${f.texto.slice(0, 60)}`);
        else if (!findings.some((g) => g.line === f.line)) ai.push(f);
      }
    }
    findings.push(...(await consolidar(root, ai, (n) => (res.costoUsd += n))));

    // "Otra mirada" (contra el sesgo de lo ya hecho): la IA piensa el archivo SIN ver el código y después
    // compara; solo quedan las diferencias que importan, ancladas a una línea real.
    if (o.otraMirada) {
      try {
        const firmas = regiones.map((r) => `- ${r.key}`).join("\n");
        const plan = await ask<{ plan: string }>({
          kind: "revisar:plan-ciego",
          system: `Sin ver el código, propones cómo organizarías un archivo: responsabilidades, funciones y casos borde que cuidar. Sin código. Español neutro.\n\n${CRITERIO}`,
          cwd: root,
          sinHerramientas: true,
          schema: { type: "object", additionalProperties: false, required: ["plan"], properties: { plan: { type: "string" } } },
          ...iaOpts(z.config, "chico"),
          effort: "low",
          prompt: [`Archivo: ${rel} (${lang.id}). Solo ves sus firmas:\n${firmas}`, contextBlock(ctx)].join("\n\n"),
        });
        res.costoUsd += plan.costUsd;
        const comp = await ask<{ diferencias: { codigo: string; texto: string }[] }>({
          kind: "revisar:otra-mirada",
          system: `Comparas un plan hecho SIN ver el código con el código real. Señala SOLO diferencias que importen (un caso borde no cubierto, una responsabilidad mal ubicada, un enfoque claramente mejor) y por qué; en "codigo" copia la línea exacta a la que se refiere. Si coinciden, lista vacía. Nunca escribas la corrección en código. Español neutro.\n\n${CRITERIO}`,
          cwd: root,
          sinHerramientas: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["diferencias"],
            properties: { diferencias: { type: "array", maxItems: 4, items: { type: "object", additionalProperties: false, required: ["codigo", "texto"], properties: { codigo: { type: "string" }, texto: { type: "string" } } } } },
          },
          ...iaOpts(z.config, "mediano"),
          prompt: [`Plan (sin ver el código):\n${plan.data.plan}`, `Código:\n${numerar(1, lineasArchivo.length)}`].join("\n\n"),
        });
        res.costoUsd += comp.costUsd;
        for (const d of comp.data.diferencias) {
          const line = findLine(lines0, d.codigo);
          if (line > 0) findings.push({ line, etiqueta: "suggestion", bloqueante: false, texto: `🔀 Otra mirada (pensada sin ver tu código): ${d.texto}`, links: [], fuente: "otra-mirada" });
        }
      } catch (e) {
        res.omitidos.push(`otra mirada: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  // Para "▶ Siguiente paso": lo que falló en las verificaciones queda registrado (sin IA).
  guardarDiagnosticos(root, rel, gate.diags.filter((d) => d.bloqueante).map((d) => ({ linea: d.line, msg: `[${d.tool}] ${d.msg}`, archivo: d.file })));
  res.bloqueantes = findings.filter((f) => f.bloqueante).length;
  const guardarCache = () => {
    if (sinIa) return;
    cache[rel] = Object.fromEntries(regiones.map((r) => [r.key, r.hash]));
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2));
  };

  // 4. Perfil: la revisión es evidencia de cuánto domina el tema.
  function terminarPerfil(): void {
    const issues = findings.filter((f) => f.etiqueta === "issue").length;
    if (!propio) return; // código heredado o de terceros: no cuenta en tu perfil
    if (issues) registrar(lang!.id, -0.01 * Math.min(issues, 5), `revisión: ${issues} problema(s) en ${rel}`);
    else if (src0.split("\n").length > 15) registrar(lang!.id, 0.02, `revisión sin problemas en ${rel}`);
  }

  // 3a. Vista notas (o ediciones para el editor): cada hallazgo, una nota en su línea. El archivo no se toca.
  const vista = loadConfig(root).vista;
  if (vista === "notas" || o.ediciones) {
    const lineas0 = src0.split(/\r?\n/);
    const sal = await publicar(
      root,
      rel,
      findings.map((f) => ({
        ancla: { linea: f.line, texto: (lineas0[f.line - 1] ?? "").trim() },
        tipo: "revision",
        titulo: `${f.etiqueta}${f.bloqueante ? " (bloqueante)" : ""}: ${f.texto.split(/[.:\n]/)[0]!.slice(0, 60)}`,
        texto: `${f.etiqueta}${f.bloqueante ? " (blocking)" : ""}: ${f.texto}`,
        links: f.links,
        bloqueante: f.bloqueante,
        origen: f.fuente.includes(":") || f.fuente === "reglas" ? "verificacion" : "revisar",
      })),
      { vista: o.ediciones ? "comentarios" : "notas", ediciones: !!o.ediciones },
    );
    res.insertados = vista === "notas" && !o.ediciones ? (sal.notas.length ? findings.length : 0) : sal.ediciones.length;
    res.ediciones = sal.ediciones;
    guardarCache();
    terminarPerfil();
    return res;
  }

  // 3b. Comentarios en el archivo (terminal / otros editores), de abajo hacia arriba, verificando cada inserción.
  let src = fs.readFileSync(abs, "utf8");
  if (src !== src0) {
    res.omitidos.push("el archivo cambió durante la revisión; volvé a correrla para comentarios precisos");
    return res;
  }
  const parsed = await parse(src, lang);
  const id = nextThreadId(parsed.comments, new Set(), "r");
  const byLine = new Map<number, Finding[]>();
  for (const f of findings) byLine.set(f.line, [...(byLine.get(f.line) ?? []), f]);
  let k = 0;
  const orden = [...byLine.keys()].sort((a, b) => b - a);
  for (const line of orden) {
    const block = byLine.get(line)!.flatMap((f) =>
      renderReply(lang, "", `${id}.${++k}`, { tipo: "revision", texto: `${f.etiqueta}${f.bloqueante ? " (blocking)" : ""}: ${f.texto}`, links: f.links }),
    );
    const next = await insertAbove(src, lang, line, block);
    if (next) {
      src = next;
      res.insertados += byLine.get(line)!.length;
    } else res.omitidos.push(`no se pudo comentar la línea ${line} sin tocar código (¿dentro de un string?)`);
  }
  guardarCache();
  if (res.insertados) fs.writeFileSync(abs, src);
  terminarPerfil();
  return res;
}
