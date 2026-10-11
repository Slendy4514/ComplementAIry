import fs from "node:fs";
import path from "node:path";
import { dataDir, loadConfig } from "../proyecto/config.js";
import { contextBlock, projectContext, CRITERIO } from "../proyecto/contexto.js";
import { listFiles } from "../proyecto/files.js";
import { makeZoner } from "../proyecto/config.js";
import { ask } from "../ia/llm.js";
import { loadPerfil, nivelDe } from "../proyecto/profile.js";
import { sobreElCodigo } from "../nucleo/memoria.js";
import { actualizarMemoria, agregarPreguntas, unaLinea } from "./panorama.js";
import { agregarTareas, cargarTareas, guardarTareas, rutasDe, tareasFile } from "../proyecto/siguiente.js";
import { conCandadoSync } from "../proyecto/ocupado.js";
import { iaOpts } from "../ia/llm.js";
import { sanitizeGuia } from "../nucleo/soloComentarios.js";
import { aplicarAEstructura, bloqueCorrecciones } from "../proyecto/correcciones.js";
import { bloqueObjetivos } from "../proyecto/entender.js";
import { contextoComun } from "../proyecto/contexto.js";
import { biblioteca, paraLenguaje, parseLlamada } from "./biblioteca.js";
import { parse } from "../nucleo/comments.js";
import { langFor } from "../nucleo/lang.js";
import { medir } from "../proyecto/metricas.js";
import { publicar, type Aporte } from "./salida.js";
import { marcadores } from "./guia/tutor.js";

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
      // Los objetivos (y lo que queda fuera) que entendiste con el programador: la estructura los sigue.
      bloqueObjetivos(root),
      bloqueCorrecciones(root),
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
  conCandadoSync(tareasFile(root), () => guardarTareas(root, cargarTareas(root).filter((t) => t.origen !== "estructura" || t.hecha || propuestos.has(t.archivo ?? ""))));
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

/**
 * Plano de un archivo, estructurado: un resumen corto arriba, una nota junto a cada función que
 * ya existe y una TAREA por cada función por crear (se marca hecha sola cuando aparece en el código).
 * Así no hay un muro de texto al principio del archivo y "▶ Siguiente paso" sabe qué sigue.
 */

interface Funcion {
  nombre: string;
  que_hace: string;
  recibe: string;
  devuelve: string;
  cuida: string;
  snippet: string;
}

const SCHEMA_ARCHIVO = {
  type: "object",
  additionalProperties: false,
  required: ["resumen", "funciones", "orden"],
  properties: {
    resumen: { type: "string", description: "Para qué es este archivo, en 1-2 oraciones." },
    funciones: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["nombre", "que_hace", "recibe", "devuelve", "cuida", "snippet"],
        properties: {
          nombre: { type: "string" },
          que_hace: { type: "string", description: "Una oración." },
          recibe: { type: "string" },
          devuelve: { type: "string" },
          cuida: { type: "string", description: "Casos borde a cuidar, separados por ';'." },
          snippet: { type: "string", description: 'Snippet de la BIBLIOTECA útil para empezarla ("nombre clave=valor") o "".' },
        },
      },
    },
    orden: { type: "string", description: "Por cuál empezar y por qué, en una oración." },
  },
};

const SYSTEM_ARCHIVO = `Propones el plano de UN archivo: qué funciones debería tener, qué hace cada una (en palabras: qué recibe, qué devuelve, qué casos cuida) y por cuál empezar. Sin código. Respeta docs/ESTRUCTURA.md y las funciones que ya existen (inclúyelas si siguen teniendo sentido). Español neutro con tuteo, conciso.

${CRITERIO}`;

export async function planoArchivo(root: string, rel: string): Promise<{ costoUsd: number; notas: number; tareas: number }> {
  const abs = path.join(root, rel);
  const lang = langFor(rel);
  if (!lang) throw new Error(`tipo de archivo sin soporte: ${rel}`);
  const z = makeZoner(root);
  const src = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : "";
  const existentes = medir(src, await parse(src, lang)).funciones;
  const libreria = paraLenguaje(biblioteca(root), lang.id);
  const estructura = path.join(root, "docs", "ESTRUCTURA.md");
  const hermanos = fs.existsSync(path.dirname(abs)) ? fs.readdirSync(path.dirname(abs)).filter((f) => f !== path.basename(abs)).slice(0, 30) : [];
  const { data, costUsd } = await ask<{ resumen: string; funciones: Funcion[]; orden: string }>({
    kind: "plano-archivo",
    system: SYSTEM_ARCHIVO,
    cwd: root,
    schema: SCHEMA_ARCHIVO,
    ...iaOpts(z.config, "mediano"),
    prompt: [
      `Archivo: ${rel} (${lang.id}).`,
      contextoComun(root, rel),
      fs.existsSync(estructura) ? `docs/ESTRUCTURA.md:\n${fs.readFileSync(estructura, "utf8").slice(0, 6000)}` : "",
      `Archivos en la misma carpeta: ${hermanos.join(", ") || "(ninguno)"}`,
      libreria.length ? `BIBLIOTECA DE SNIPPETS:\n${libreria.map((s) => `- ${s.nombre}: ${s.descripcion}${marcadores(s).length ? ` (marcadores: ${marcadores(s).join(", ")})` : ""}`).join("\n")}` : "",
      existentes.length ? `Funciones que ya existen: ${existentes.map((f) => f.nombre).join(", ")}` : "",
      `Contenido actual:\n${src || "(vacío)"}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
  });

  const lineas = src.split(/\r?\n/);
  const validoSnippet = (t: string) => !!t && libreria.some((s) => s.nombre === parseLlamada(t)?.nombre);
  const aportes: Aporte[] = [];
  const lista = data.funciones.map((f, i) => `${i + 1}) \`${f.nombre}\`: ${f.que_hace}${existentes.some((e) => e.nombre === f.nombre) ? " ✓ ya existe" : ""}`).join("\n");
  aportes.push({
    ancla: { linea: 1, texto: (lineas[0] ?? "").trim() },
    tipo: "plano",
    titulo: "Plano del archivo",
    texto: `${data.resumen}\n${lista}\n${data.orden}`,
    accion: data.orden,
    origen: "plano",
    alcance: "archivo",
  });
  for (const f of data.funciones) {
    const e = existentes.find((x) => x.nombre === f.nombre);
    if (!e) continue; // las que faltan van como tareas (no como texto en el archivo)
    aportes.push({
      ancla: { linea: e.linea, texto: (lineas[e.linea - 1] ?? "").trim(), funcion: f.nombre },
      tipo: "plano",
      titulo: `${f.nombre}: ${f.que_hace}`.slice(0, 80),
      texto: `${f.que_hace}\n- Recibe: ${f.recibe}\n- Devuelve: ${f.devuelve}\n- Cuida: ${f.cuida}`,
      accion: `Completa ${f.nombre} cuidando: ${f.cuida.split(";")[0]}`,
      ...(validoSnippet(f.snippet) ? { snippets: [{ llamada: f.snippet, despues: (lineas[e.linea - 1] ?? "").trim() }] } : {}),
      origen: "plano",
    });
  }
  const tareas = agregarTareas(
    root,
    data.funciones
      .filter((f) => !existentes.some((e) => e.nombre === f.nombre))
      .map((f) => ({ titulo: `Crear ${f.nombre} en ${rel}: ${f.que_hace}`.slice(0, 120), archivo: rel, funcion: f.nombre, detalle: f.que_hace, origen: "plano" as const })),
  );
  // Cada parte va a la nota de SU función (o a la del archivo): sin notas duplicadas.
  const r = await publicar(root, rel, z.config.vista === "notas" ? aportes : aportes.slice(0, 1));
  return { costoUsd: costUsd, notas: r.notas.length || r.insertados, tareas };
}
