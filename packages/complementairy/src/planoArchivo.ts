import fs from "node:fs";
import { contextoComun } from "./contexto.js";
import path from "node:path";
import { biblioteca, paraLenguaje, parseLlamada } from "./biblioteca.js";
import { parse } from "./comments.js";
import { makeZoner } from "./config.js";
import { contextBlock, CRITERIO, projectContext } from "./context.js";
import { langFor } from "./lang.js";
import { ask } from "./llm.js";
import { medir } from "./metricas.js";
import { publicar, type Aporte } from "./salida.js";
import { agregarTareas } from "./siguiente.js";
import { iaOpts } from "./llm.js";
import { marcadores } from "./tutor.js";

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

const SCHEMA = {
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

const SYSTEM = `Propones el plano de UN archivo: qué funciones debería tener, qué hace cada una (en palabras: qué recibe, qué devuelve, qué casos cuida) y por cuál empezar. Sin código. Respeta docs/ESTRUCTURA.md y las funciones que ya existen (inclúyelas si siguen teniendo sentido). Español neutro con tuteo, conciso.

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
    system: SYSTEM,
    cwd: root,
    schema: SCHEMA,
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
