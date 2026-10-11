import { leerMemoria } from "../nucleo/memoria.js";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { codeOnly, parse } from "../nucleo/comments.js";
import { dataDir, makeZoner, origenDe } from "../proyecto/config.js";
import { contextBlock, CRITERIO, loadPatrones, projectContext } from "../proyecto/contexto.js";
import { listFiles } from "../proyecto/files.js";
import { langFor } from "../nucleo/lang.js";
import { ask, evitada, leerUso } from "../ia/llm.js";
import { funcionesSinTests, medir, violaciones, type Violacion } from "../proyecto/metricas.js";
import { loadPerfil, nivelDe } from "../proyecto/profile.js";
import { findThreads } from "../nucleo/threads.js";
import { agregarPreguntas, parseMemoria, sinSugerencia, sobreElCodigo, sugerenciaDe, unaLinea, type Memoria } from "../nucleo/memoria.js";
import { agregarTareas, cargarTareas, guardarTareas, rutasDe, tareasFile } from "../proyecto/siguiente.js";
import { conCandadoSync } from "../proyecto/ocupado.js";
import type { Nota } from "../proyecto/notas.js";
import { iaOpts } from "../ia/llm.js";
import { aplicarAResumenes, bloqueCorrecciones } from "../proyecto/correcciones.js";
import { bloqueObjetivos, guardarEvaluacion, leerObjetivos, type Criterio, type EvaluacionTerminado } from "../proyecto/entender.js";
import { contextoIdeas, registrarIdeas, schemaIdeas, tiposIdeas, type Idea, type TipoIdea } from "./ideas.js";
import { sinSoluciones } from "../nucleo/guard.js";

/**
 * Panorama del proyecto completo y memoria del proyecto (.cai/conocimiento.md).
 * - Lo medible se calcula sin IA (prácticas, preguntas abiertas, snippets sin activar, funciones sin tests).
 * - La IA resume SOLO los archivos que cambiaron (modelo rápido) y, si algo cambió, sugiere a nivel
 *   proyecto y pregunta lo que le falta saber. Tus respuestas quedan en la memoria y se usan en todo.
 */

const NO_CODIGO = new Set(["markdown", "yaml", "toml", "html", "css", "sql", "dockerfile"]);
const h = (s: string) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 12);

interface Archivo {
  rel: string;
  hash: string;
  codigo: string;
  lineas: number;
  funciones: number;
  exportadas: string[];
  nombres: string[];
  violaciones: Violacion[];
  pendientes: number;
  sinActivar: number;
}

interface Sugerencias {
  estado: string;
  sugerencias: { titulo: string; porque: string; plano: string; archivos: string[] }[];
  alternativas: { sobre: string; propuesta: string; porque: string }[];
  riesgos: string[];
  /** Texto suelto en cachés de versiones anteriores. */
  preguntas: (string | { pregunta: string; sugerencia: string })[];
  ideas?: Omit<Idea, "id" | "fecha">[];
  criterios?: EvaluacionTerminado["criterios"];
}

const RESUMEN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["resumenes"],
  properties: { resumenes: { type: "array", items: { type: "object", additionalProperties: false, required: ["archivo", "resumen"], properties: { archivo: { type: "string" }, resumen: { type: "string" } } } } },
};

// Ideas (funcionalidades/mejoras) y, si hay objetivos confirmados, la revisión de cada criterio de
// "terminado": en la misma llamada (sin costo extra).
const panoramaSchema = (tipos: TipoIdea[], criterios: Criterio[]) => ({
  type: "object",
  additionalProperties: false,
  required: ["estado", "sugerencias", "alternativas", "riesgos", "preguntas", "ideas", ...(criterios.length ? ["criterios"] : [])],
  properties: {
    ideas: schemaIdeas(tipos),
    ...(criterios.length
      ? {
          criterios: {
            type: "array",
            description: `Para CADA criterio de terminado (por su id: ${criterios.map((c) => c.id).join(", ")}): ¿se cumple hoy? Con evidencia concreta (funciones, tests, archivos).`,
            items: { type: "object", additionalProperties: false, required: ["id", "estado", "evidencia"], properties: { id: { type: "string" }, estado: { type: "string", enum: ["cumple", "parcial", "no"] }, evidencia: { type: "string" } } },
          },
        }
      : {}),
    estado: { type: "string", description: "Cómo está el proyecto, en 2-3 oraciones." },
    sugerencias: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["titulo", "porque", "plano", "archivos"],
        properties: { titulo: { type: "string" }, porque: { type: "string" }, plano: { type: "string", description: "Cómo hacerlo, en palabras (sin código)." }, archivos: { type: "array", items: { type: "string" } } },
      },
    },
    alternativas: {
      type: "array",
      maxItems: 3,
      items: { type: "object", additionalProperties: false, required: ["sobre", "propuesta", "porque"], properties: { sobre: { type: "string" }, propuesta: { type: "string" }, porque: { type: "string" } } },
    },
    riesgos: { type: "array", maxItems: 4, items: { type: "string" } },
    preguntas: {
      type: "array",
      maxItems: 4,
      description: "Lo que necesitas saber del programador para aconsejar mejor (no repitas preguntas ya respondidas).",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["pregunta", "sugerencia"],
        properties: { pregunta: { type: "string", description: "Corta: una oración." }, sugerencia: { type: "string", description: "La respuesta que recomiendas, corta; \"\" si no hay una razonable." } },
      },
    },
  },
});

const SISTEMA = `Eres el compañero de ComplementAIry mirando el proyecto COMPLETO (no un archivo). Con los resúmenes de cada módulo, las mediciones y lo que el programador escribió:
- Describe el estado del proyecto en pocas frases.
- Sugiere mejoras de diseño a nivel proyecto: responsabilidades mezcladas, módulos que conviene separar o unir, dependencias raras, duplicación entre archivos, lo que falta (tests, validación, manejo de errores). Cada sugerencia con su porqué y un plano en palabras. Sin código.
- Propón alternativas reales cuando el enfoque actual no sea el mejor.
- Señala riesgos.
- Preguntas: solo intenciones, preferencias, decisiones o contexto del negocio que NO están en el código. NUNCA preguntes qué hace, si ya hace algo o si existe algo en el código: eso lo lees tú (o lo ves en los resúmenes y funciones). Cada pregunta, corta y con la respuesta que sugieres.
- Español neutro con tuteo, concreto.

${CRITERIO}`;

// --- Memoria del proyecto (.cai/conocimiento.md) -----------------------------------

export { agregarPreguntas, parseMemoria, sinSugerencia, unaLinea, type Memoria };

export { leerMemoria };

function escribirMemoria(file: string, resumenes: Record<string, { hash: string; resumen: string }>, m: Memoria): void {
  const mods = Object.entries(resumenes)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([f, r]) => `- \`${f}\`: ${r.resumen}`);
  const txt = [
    "# Lo que ComplementAIry sabe de este proyecto",
    "",
    "<!-- Lo actualiza `cai panorama`. Responde las preguntas abiertas escribiendo después de \"R:\"; en el próximo panorama pasan a \"Lo que me contaste\". Todo esto se usa como contexto en cada guía y revisión. -->",
    "",
    "## Módulos",
    "",
    ...(mods.length ? mods : ["(todavía no hay resúmenes)"]),
    "",
    "## Lo que me contaste",
    "",
    ...(m.respondidas.length ? m.respondidas.map((r) => `- ${r}`) : ["(nada todavía)"]),
    "",
    "## Preguntas abiertas",
    "",
    ...(m.abiertas.length ? m.abiertas.flatMap((a) => [`- P: ${a.p}`, `  R: ${a.r}`]) : ["(ninguna)"]),
    "",
    "## Notas tuyas",
    "",
    m.notas || "<!-- Lo que quieras que sepa siempre (convenciones, contexto del negocio...). -->",
    "",
  ].join("\n");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, txt);
}

// --- Panorama ------------------------------------------------------------------------

export interface ResultadoPanorama {
  archivo: string;
  costoUsd: number;
  resumen: string[];
}

export async function panorama(root: string, o: { sinIa?: boolean; log?: (s: string) => void } = {}): Promise<ResultadoPanorama> {
  const log = o.log ?? (() => {});
  const z = makeZoner(root);
  const dir = dataDir(root);
  const cache = path.join(dir, "cache", "panorama.json");
  const prev = (() => {
    try {
      return JSON.parse(fs.readFileSync(cache, "utf8")) as { resumenes: Record<string, { hash: string; resumen: string }>; entrada?: string; sugerencias?: Sugerencias };
    } catch {
      return { resumenes: {} as Record<string, { hash: string; resumen: string }> };
    }
  })();
  let costo = 0;

  // 1. Lo medible, sin IA.
  const carpetaTests = z.config.tests.carpeta;
  const archivos: Archivo[] = [];
  for (const rel of listFiles(z)) {
    const lang = langFor(rel);
    if (!lang || NO_CODIGO.has(lang.id) || (carpetaTests && rel.startsWith(carpetaTests + "/")) || /(\.test\.|\.spec\.|(^|\/)test_)/.test(rel)) continue;
    if (origenDe(z.config, rel) === "terceros") continue;
    let src: string;
    try {
      src = fs.readFileSync(path.join(root, rel), "utf8");
    } catch {
      continue;
    }
    if (src.length > 400_000) continue;
    let parsed: Awaited<ReturnType<typeof parse>>;
    try {
      parsed = await parse(src, lang);
    } catch (e) {
      // Un archivo que el analizador no puede leer no tumba el panorama: se salta y se avisa.
      o.log?.(`  ! no pude analizar ${rel} (${e instanceof Error ? e.message : String(e)}); lo salto`);
      continue;
    }
    const met = medir(src, parsed);
    archivos.push({
      rel,
      hash: h(codeOnly(src, parsed.comments)),
      codigo: src,
      lineas: met.lineas,
      funciones: met.funciones.length,
      exportadas: met.funciones.filter((f) => f.exportada).map((f) => f.nombre),
      nombres: met.funciones.map((f) => f.nombre),
      violaciones: violaciones(met, z.config.practicas),
      pendientes: findThreads(src, parsed.comments).filter((t) => t.pending).length,
      sinActivar: (src.match(/@guia\[[^\]]+\] snippet \[ \]:/g) ?? []).length,
    });
  }
  const sinTests = funcionesSinTests(z, [...new Set(archivos.flatMap((a) => a.exportadas))]);
  const totalCodigo = archivos.reduce((n, a) => n + a.codigo.length, 0);
  const testsExistentes = listFiles(z).filter((f) => (carpetaTests && f.startsWith(carpetaTests + "/")) || /(\.test\.|\.spec\.|(^|\/)test_)/.test(f));
  const dependencias = (() => {
    try {
      const pj = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { dependencies?: object; devDependencies?: object };
      return [...Object.keys(pj.dependencies ?? {}), ...Object.keys(pj.devDependencies ?? {}).map((d) => `${d} (dev)`)].join(", ");
    } catch {
      return "";
    }
  })();

  // 2. Memoria: resumir SOLO lo que cambió (modelo rápido), olvidar lo borrado.
  const resumenes: Record<string, { hash: string; resumen: string }> = {};
  for (const a of archivos) if (prev.resumenes[a.rel]?.hash === a.hash) resumenes[a.rel] = prev.resumenes[a.rel]!;
  const cambiados = archivos.filter((a) => !resumenes[a.rel]);
  if (!o.sinIa && cambiados.length) {
    log(`cai: resumiendo ${cambiados.length} archivo(s) que cambiaron (de ${archivos.length})`);
    let lote: Archivo[] = [];
    let tam = 0;
    const lotes: Archivo[][] = [];
    for (const a of cambiados) {
      if (tam + a.codigo.length > 40_000 && lote.length) {
        lotes.push(lote);
        lote = [];
        tam = 0;
      }
      lote.push(a);
      tam += Math.min(a.codigo.length, 20_000);
    }
    if (lote.length) lotes.push(lote);
    for (const l of lotes) {
      const { data, costUsd } = await ask<{ resumenes: { archivo: string; resumen: string }[] }>({
        kind: "panorama:resumen",
        system: "Resumes archivos de código para la memoria de un proyecto: para cada uno, 1-2 oraciones con qué hace y de qué depende. Español neutro.",
        cwd: root,
        schema: RESUMEN_SCHEMA,
        sinHerramientas: true,
        ...iaOpts(z.config, "chico"),
        prompt: l.map((a) => `=== ${a.rel}\n${a.codigo.slice(0, 20_000)}`).join("\n\n"),
      });
      costo += costUsd;
      for (const r of data.resumenes ?? []) {
        const a = l.find((x) => x.rel === r.archivo);
        if (a) resumenes[a.rel] = { hash: a.hash, resumen: r.resumen.replace(/\s+/g, " ").trim() };
      }
      // Lo que la IA no resumió igual queda registrado con su huella: no se reenvía en cada panorama.
      for (const a of l) resumenes[a.rel] ??= { hash: a.hash, resumen: "(sin resumen)" };
    }
  } else if (!cambiados.length && archivos.length) evitada("panorama:resumen", "ningún archivo cambió");

  const memFile = path.join(dir, "conocimiento.md");
  const mem = leerMemoria(memFile);
  const nuevas: string[] = [];
  // Preguntas respondidas → "Lo que me contaste".
  for (const a of mem.abiertas.filter((x) => x.r)) mem.respondidas.push(`${sinSugerencia(a.p)} → ${unaLinea(a.r)}`);
  mem.abiertas = mem.abiertas.filter((x) => !x.r);

  // 3. Sugerencias a nivel proyecto: solo si cambió algo de lo que las alimenta.
  const ctx = projectContext(root, "README.md");
  const medibles = archivos.flatMap((a) => a.violaciones.map((v) => `${a.rel}: ${v.detalle}`));
  // Objetivos confirmados: sus criterios de "terminado" se revisan en esta misma llamada.
  const objetivos = leerObjetivos(root);
  const criteriosObjetivos = objetivos.estado === "entendido" || objetivos.estado === "terminado" ? objetivos.criterios : [];
  const entrada = h(JSON.stringify([resumenes, medibles, sinTests, ctx.proyecto, ctx.reglas, mem.respondidas, mem.notas, testsExistentes, dependencias, bloqueObjetivos(root), criteriosObjetivos, bloqueCorrecciones(root), contextoIdeas(root), tiposIdeas(root)]));
  let sug = prev.sugerencias;
  if (!o.sinIa && archivos.length && (entrada !== prev.entrada || !sug)) {
    log("cai: analizando el proyecto completo");
    const { data, costUsd } = await ask<Sugerencias>({
      kind: "panorama",
      system: SISTEMA,
      cwd: root,
      schema: panoramaSchema(tiposIdeas(root), criteriosObjetivos),
      sinHerramientas: true,
      ...iaOpts(z.config, "grande"),
      prompt: [
        `Programador: ${nivelDe(Math.max(...Object.values(loadPerfil().temas).map((t) => t.puntaje), 0.3))}.`,
        contextBlock({ ...ctx, conocimiento: "" }),
        mem.notas ? `Notas del programador:\n${mem.notas}` : "",
        mem.respondidas.length ? `Lo que el programador ya respondió:\n- ${mem.respondidas.join("\n- ")}` : "",
        mem.abiertas.length ? `Preguntas que ya le hiciste y aún no responde (NO las repitas ni reformules):\n- ${mem.abiertas.map((a) => a.p).join("\n- ")}` : "",
        bloqueObjetivos(root),
        criteriosObjetivos.length ? `Criterios de terminado a revisar (id: criterio):\n${criteriosObjetivos.map((c) => `- ${c.id}: ${c.texto}`).join("\n")}` : "",
        bloqueCorrecciones(root),
        contextoIdeas(root),
        `Módulos (${archivos.length}):\n${archivos.map((a) => `- ${a.rel}${origenDe(z.config, a.rel) === "heredado" ? " [HEREDADO: no lo escribió el programador]" : ""} (${a.lineas} líneas): ${aplicarAResumenes(root, resumenes)[a.rel]?.resumen ?? "(sin resumen)"}${a.nombres.length ? ` Funciones: ${a.nombres.slice(0, 25).join(", ")}.` : ""}`).join("\n")}`,
        // Proyecto chico: el código real (más preciso que los resúmenes). Grande: solo resúmenes.
        totalCodigo <= 30_000 ? `Código completo:\n${archivos.map((a) => `=== ${a.rel}\n${a.codigo}`).join("\n\n")}` : "",
        `Tests: carpeta configurada "${carpetaTests || "(junto al código)"}"; archivos de test existentes: ${testsExistentes.length ? testsExistentes.join(", ") : "ninguno"}.`,
        dependencias ? `Dependencias instaladas (package.json): ${dependencias}` : "",
        medibles.length ? `Prácticas que no se cumplen (medido):\n- ${medibles.join("\n- ")}` : "",
        sinTests.length ? `Funciones exportadas sin tests: ${sinTests.join(", ")}` : "",
        fs.existsSync(path.join(root, "docs", "ESTRUCTURA.md")) ? `docs/ESTRUCTURA.md:\n${fs.readFileSync(path.join(root, "docs", "ESTRUCTURA.md"), "utf8").slice(0, 5000)}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    });
    costo += costUsd;
    // El panorama orienta en palabras: lo que llegue como código escrito se quita (sin IA).
    for (const s of data.sugerencias) Object.assign(s, { porque: sinSoluciones(s.porque), plano: sinSoluciones(s.plano) });
    for (const a of data.alternativas) Object.assign(a, { propuesta: sinSoluciones(a.propuesta), porque: sinSoluciones(a.porque) });
    sug = data;
    registrarIdeas(root, data.ideas ?? []);
    if (criteriosObjetivos.length && data.criterios) guardarEvaluacion(root, data.criterios);
    // Cada sugerencia, una tarea con el archivo a tocar. Las del panorama anterior que sigan
    // pendientes se reemplazan (la IA reformula los títulos: si no, se acumularían).
    conCandadoSync(tareasFile(root), () => guardarTareas(root, cargarTareas(root).filter((t) => t.origen !== "panorama" || t.hecha || t.descartada)));
    agregarTareas(
      root,
      data.sugerencias.map((s) => ({ titulo: unaLinea(s.titulo), detalle: unaLinea(`${s.porque} Cómo: ${s.plano}`), ...(rutasDe(s.archivos.join(", "))[0] ? { archivo: rutasDe(s.archivos.join(", "))[0]! } : {}), origen: "panorama" as const })),
    );
    for (const q of data.preguntas) {
      const pregunta = unaLinea(typeof q === "string" ? q : q.pregunta);
      const s = typeof q === "string" ? "" : unaLinea(q.sugerencia);
      // Lo que se puede ver en el código no se pregunta (filtro sin IA).
      if (sobreElCodigo(pregunta, [...archivos.map((a) => a.rel), ...archivos.flatMap((a) => a.nombres)])) continue;
      nuevas.push(s ? `${pregunta} (sugerencia: ${s})` : pregunta);
    }
  } else if (sug) evitada("panorama", "sin cambios desde el último panorama");

  // La memoria se vuelve a leer ahora (la llamada a la IA tarda): si respondiste algo en el panel
  // mientras tanto, no se pisa.
  const memFinal = leerMemoria(memFile);
  for (const a of memFinal.abiertas.filter((x) => x.r)) memFinal.respondidas.push(`${sinSugerencia(a.p)} → ${unaLinea(a.r)}`);
  memFinal.abiertas = memFinal.abiertas.filter((x) => !x.r);
  agregarPreguntas(memFinal, nuevas);
  escribirMemoria(memFile, aplicarAResumenes(root, resumenes), memFinal); // tus correcciones mandan (la caché guarda lo generado)
  fs.mkdirSync(path.dirname(cache), { recursive: true });
  fs.writeFileSync(cache, JSON.stringify({ resumenes, entrada, sugerencias: sug }, null, 2));

  // 4. Informe.
  const uso = leerUso(7).filter((u) => u.tipo === "llamada");
  const pat = Object.entries(loadPatrones()).sort((a, b) => b[1].veces - a[1].veces).slice(0, 5);
  const lineas: string[] = [
    "# Panorama del proyecto",
    "",
    `_Generado por \`cai panorama\` el ${new Date().toISOString().slice(0, 16).replace("T", " ")}._`,
    "",
  ];
  if (sug) {
    lineas.push("## Estado", "", sug.estado, "");
    if (sug.sugerencias.length) lineas.push("## Sugerencias", "", "_Cada una está también en tus tareas (panel → Tareas)._", "", ...sug.sugerencias.flatMap((s, i) => [`### ${i + 1}. ${s.titulo}`, "", `**Por qué:** ${s.porque}`, "", `**Cómo:** ${s.plano}`, ...(s.archivos.length ? ["", `Archivos: ${s.archivos.map((a) => `\`${a}\``).join(", ")}`] : []), ""]));
    if (sug.alternativas.length) lineas.push("## Otras formas de hacerlo", "", ...sug.alternativas.map((a) => `- **${a.sobre}:** ${a.propuesta} _(${a.porque})_`), "");
    if (sug.riesgos.length) lineas.push("## Riesgos", "", ...sug.riesgos.map((r) => `- ${r}`), "");
  }
  if (memFinal.abiertas.length) lineas.push("## Preguntas para ti", "", `Respóndelas en el panel de VSCode (Proyecto → Preguntas para ti), con \`cai memoria responder <n> "..."\` o en \`${path.relative(root, memFile)}\` (después de "R:"). Se usan en todas las sugerencias.`, "", ...memFinal.abiertas.map((a) => `- ${a.p}`), "");
  lineas.push("## Mediciones (sin IA)", "");
  lineas.push(`- ${archivos.length} archivos de código, ${archivos.reduce((n, a) => n + a.funciones, 0)} funciones.`);
  if (medibles.length) lineas.push(`- Prácticas que no se cumplen (umbrales en \`.cai/config.json\` → \`practicas\`):`, ...medibles.map((m) => `  - ${m}`));
  if (sinTests.length) lineas.push(`- Funciones exportadas sin tests: ${sinTests.map((f) => `\`${f}\``).join(", ")} (pídelos con \`@ia? !tests\` o \`cai tests <archivo> <función>\`).`);
  const pend = archivos.filter((a) => a.pendientes);
  if (pend.length) lineas.push(`- Preguntas \`@ia?\` sin responder: ${pend.map((a) => `${a.rel} (${a.pendientes})`).join(", ")}.`);
  const sinAct = archivos.filter((a) => a.sinActivar);
  if (sinAct.length) lineas.push(`- Snippets sugeridos sin activar: ${sinAct.map((a) => `${a.rel} (${a.sinActivar})`).join(", ")}.`);
  if (pat.length) lineas.push(`- Tus errores más frecuentes: ${pat.map(([k, v]) => `${k} (${v.veces})`).join(", ")}.`);
  // Comprensión medida (sin IA): funciones que explicaste con tus palabras o cuyo resultado predijiste bien.
  const notasProy = todasLasNotasConResueltas(root);
  const explicadas = new Set(notasProy.filter((n) => n.explicacion?.coincide).map((n) => `${n.archivo}:${n.ancla.funcion}`));
  const predichas = new Set(notasProy.filter((n) => n.prediccion && n.estado === "resuelta").map((n) => `${n.archivo}:${n.prediccion!.funcion}`));
  const totalFn = archivos.reduce((n, a) => n + a.funciones, 0);
  if (explicadas.size || predichas.size) lineas.push(`- Comprensión: ${new Set([...explicadas, ...predichas]).size} de ${totalFn} funciones explicadas con tus palabras o predichas (modo aprender).`);
  if (uso.length) lineas.push(`- IA en los últimos 7 días: ${uso.length} llamadas, US$${uso.reduce((n, u) => n + (u.costo ?? 0), 0).toFixed(2)} (detalle: \`cai uso\`).`);
  lineas.push("");
  const out = path.join(dir, "panorama.md");
  fs.writeFileSync(out, lineas.join("\n"));

  const resumen = [
    sug ? `Estado: ${sug.estado}` : "",
    sug?.sugerencias.length ? `${sug.sugerencias.length} sugerencia(s) de diseño` : "",
    medibles.length ? `${medibles.length} práctica(s) sin cumplir` : "",
    sinTests.length ? `${sinTests.length} función(es) sin tests` : "",
    memFinal.abiertas.length ? `${memFinal.abiertas.length} pregunta(s) para ti en ${path.relative(root, memFile)}` : "",
  ].filter(Boolean);
  return { archivo: out, costoUsd: costo, resumen };
}

/** Modifica la memoria del proyecto conservando los resúmenes de módulos ya calculados. */
export function actualizarMemoria(root: string, f: (m: Memoria) => void): void {
  const dir = dataDir(root);
  const memFile = path.join(dir, "conocimiento.md");
  let resumenes: Record<string, { hash: string; resumen: string }> = {};
  try {
    resumenes = (JSON.parse(fs.readFileSync(path.join(dir, "cache", "panorama.json"), "utf8")) as { resumenes: typeof resumenes }).resumenes ?? {};
  } catch {
    /* sin panorama todavía */
  }
  const m = leerMemoria(memFile);
  f(m);
  escribirMemoria(memFile, aplicarAResumenes(root, resumenes), m);
}


/** Preguntas abiertas numeradas, con la respuesta sugerida aparte (para el panel y `cai memoria`). */
export function preguntasAbiertas(root: string): { n: number; pregunta: string; sugerencia: string }[] {
  return leerMemoria(path.join(dataDir(root), "conocimiento.md")).abiertas.map((a, i) => ({
    n: i + 1,
    pregunta: sinSugerencia(a.p),
    sugerencia: sugerenciaDe(a.p),
  }));
}

/** Tu respuesta pasa al instante a "Lo que me contaste" (sin esperar al próximo panorama). */
export function responderPregunta(root: string, n: number, respuesta: string): string {
  let p = "";
  actualizarMemoria(root, (m) => {
    const a = m.abiertas[n - 1];
    if (!a) throw new Error(`no hay pregunta abierta número ${n} (hay ${m.abiertas.length}); míralas con: cai memoria`);
    p = sinSugerencia(a.p);
    m.respondidas.push(`${p} → ${unaLinea(respuesta)}`);
    m.abiertas.splice(n - 1, 1);
  });
  return p;
}

/** ¿Cuántos archivos de código cambiaron desde el último panorama? (sin IA: fechas de modificación) */
export function estadoPanorama(root: string): { existe: boolean; fecha?: string; cambiados: string[] } {
  const cache = path.join(dataDir(root), "cache", "panorama.json");
  if (!fs.existsSync(cache)) return { existe: false, cambiados: [] };
  const t = fs.statSync(cache).mtimeMs;
  const z = makeZoner(root);
  const cambiados = listFiles(z).filter((rel) => {
    const lang = langFor(rel);
    if (!lang || NO_CODIGO.has(lang.id) || /^\.(cai|aicode)\//.test(rel)) return false;
    try {
      return fs.statSync(path.join(root, rel)).mtimeMs > t;
    } catch {
      return false;
    }
  });
  return { existe: true, fecha: new Date(t).toISOString(), cambiados };
}

/** Todas las notas del proyecto, abiertas y cerradas (para medir comprensión). */
function todasLasNotasConResueltas(root: string): Nota[] {
  const d = path.join(dataDir(root), "notas");
  if (!fs.existsSync(d)) return [];
  const out: Nota[] = [];
  for (const f of fs.readdirSync(d).filter((x) => x.endsWith(".json")))
    try {
      out.push(...((JSON.parse(fs.readFileSync(path.join(d, f), "utf8")) as { notas: Nota[] }).notas ?? []));
    } catch {
      /* dañado: se ignora */
    }
  return out;
}
