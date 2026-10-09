import fs from "node:fs";
import path from "node:path";
import { parse } from "./comments.js";
import { makeZoner } from "./config.js";
import { contextBlock, CRITERIO, projectContext } from "./context.js";
import { langFor } from "./lang.js";
import { ask } from "./llm.js";
import { rutaTest } from "./metricas.js";
import { coincide, ejecutar, exportedFunctions, validarExpresion } from "./predict.js";
import { renderReply } from "./render.js";
import { nextThreadId } from "./threads.js";
import { iaOpts } from "./tutor.js";
import { dataDir } from "./config.js";
import { verifyCommentOnly } from "./verify.js";
import { inlineSolutions } from "./guard.js";

/**
 * Tests como snippets que activás vos. La IA propone casos (qué probar y qué debería pasar);
 * el script valida cada llamada, calcula los imports y escribe todo APAGADO en la carpeta de tests.
 * El valor esperado lo decidís vos: si la IA duda, pregunta.
 */

interface Caso {
  /** Lo calcula el script al probar: el resultado real tiene decimales que no están en lo esperado (usar "aproximado"). */
  aprox?: boolean;
  tipo: "normal" | "error";
  descripcion: string;
  llamada: string;
  esperado: string;
  duda: string;
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["casos"],
  properties: {
    casos: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["tipo", "descripcion", "llamada", "esperado", "duda"],
        properties: {
          tipo: { type: "string", enum: ["normal", "error"] },
          descripcion: { type: "string", description: "Qué comportamiento prueba, en una frase corta (máximo 80 caracteres; es el nombre del test). Sin código." },
          llamada: { type: "string", description: "UNA llamada a una función exportada, con argumentos literales." },
          esperado: { type: "string", description: 'Valor esperado como literal del lenguaje; "?" si no estás seguro. En tipo error: un fragmento del mensaje o "".' },
          duda: { type: "string", description: "Si esperado es ?, la pregunta concreta para el programador; si no, vacío." },
        },
      },
    },
  },
};

const SYSTEM = `Propones casos de prueba para que el programador los revise y active. No escribes el test: solo el caso.
- Cubre lo importante: caso normal, bordes (vacío, cero, límites, negativos) y errores esperados.
- "esperado" es lo que la función DEBERÍA hacer según su propósito, NO lo que hace el código actual: si el código parece tener un bug, el caso correcto debe fallar.
- Si el comportamiento correcto depende de una decisión del programador (p. ej. ¿meses = 0 es error o 0?), pon esperado "?" y la pregunta en "duda".
- "llamada": una sola llamada a una función exportada del archivo, con argumentos literales.
- Nunca escribas la implementación ni cómo arreglar el código (ni en la descripción ni en la duda): solo qué debería pasar.

${CRITERIO}`;

const q = (v: string) => (v.includes('"') ? `'${v.replace(/'/g, "’")}'` : `"${v}"`);
const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40) || "caso";

export interface ResultadoTests {
  archivo: string;
  casos: number;
  preguntas: number;
  costoUsd: number;
  descartados: string[];
}

/** Por qué no se pueden probar las funciones de un archivo (o "" si se puede). */
export function noProbable(lang: string, src: string, funcion?: string): string {
  const exportadas = exportedFunctions(lang, src);
  if (!exportadas.size)
    return "el archivo no exporta funciones: para probarlas fuera de su programa, expórtalas (si es un script que corre dentro de otra app, como Obsidian, los casos quedan para probar a mano)";
  if (funcion && !exportadas.has(funcion)) return `${funcion} no es una función exportada (si es un método de una clase, exporta la clase o prueba a mano)`;
  return "";
}

/** Casos propuestos por la IA y validados sin IA (llamadas a funciones exportadas, literales). */
export async function generarCasos(root: string, rel: string, funcion?: string): Promise<{ casos: Caso[]; descartados: string[]; costoUsd: number }> {
  const abs = path.join(root, rel);
  const lang = langFor(rel);
  if (!lang) throw new Error(`tipo de archivo sin soporte: ${rel}`);
  const src = fs.readFileSync(abs, "utf8");
  const motivo = noProbable(lang.id, src, funcion);
  if (motivo) throw new Error(motivo);
  const exportadas = exportedFunctions(lang.id, src);
  const z = makeZoner(root);
  const testAbs = path.join(root, rutaTest(rel, z.config.tests.carpeta));
  const existente = fs.existsSync(testAbs) ? fs.readFileSync(testAbs, "utf8") : "";
  const { data, costUsd } = await ask<{ casos: Caso[] }>({
    kind: "tests",
    system: SYSTEM,
    cwd: root,
    schema: SCHEMA,
    ...iaOpts(z.config, "mediano"),
    prompt: [
      `Archivo: ${rel} (${lang.id}). Funciones exportadas: ${[...exportadas].join(", ")}.`,
      funcion ? `Propón casos SOLO para ${funcion}.` : "Propón casos para las funciones más importantes.",
      contextBlock(projectContext(root, rel)),
      existente ? `Tests que ya existen (no repitas casos):\n${existente.slice(0, 4000)}` : "",
      `Código:\n${src}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
  });

  // Validación determinista de cada caso.
  const descartados: string[] = [];
  const casos = data.casos.filter((c) => {
    const err = validarExpresion(c.llamada, exportadas);
    if (err) descartados.push(`${c.llamada}: ${err}`);
    return !err && (!funcion || c.llamada.trim().startsWith(funcion + "("));
  });
  return { casos, descartados, costoUsd: costUsd };
}

/** Dónde se guardan los últimos casos probados (para "Guardar como tests" sin volver a pedirlos). */
const archivoCasos = (root: string, rel: string, funcion?: string) => path.join(dataDir(root), "cache", "casos", `${encodeURIComponent(rel)}#${funcion ?? "_"}.json`);

export interface ResultadoCaso {
  descripcion: string;
  llamada: string;
  esperado: string;
  estado: "pasa" | "falla" | "decidir" | "no-ejecutable";
  obtenido?: string;
  duda?: string;
}

/**
 * Proponer casos y PROBARLOS ya: se ejecuta cada llamada contra tu código (sin escribir archivos de
 * tests) y se compara con lo esperado. Así ves al instante qué pasa y qué no.
 */
export async function probarCasos(root: string, rel: string, funcion?: string): Promise<{ resultados: ResultadoCaso[]; descartados: string[]; costoUsd: number }> {
  const lang = langFor(rel)!;
  const { casos, descartados, costoUsd } = await generarCasos(root, rel, funcion);
  const resultados: ResultadoCaso[] = casos.map((c) => ejecutarCaso(root, rel, lang.id, c));
  // Si el valor real tiene decimales que no están en lo esperado (1049.9999… vs 1050), el test será aproximado.
  casos.forEach((c, i) => {
    const o = resultados[i]?.obtenido;
    if (resultados[i]?.estado === "pasa" && o && /^-?\d+(\.\d+)?$/.test(c.esperado.trim()) && /^-?\d+\.\d+/.test(o) && o !== c.esperado.trim()) c.aprox = true;
  });
  fs.mkdirSync(path.dirname(archivoCasos(root, rel, funcion)), { recursive: true });
  fs.writeFileSync(archivoCasos(root, rel, funcion), JSON.stringify(casos));
  return { resultados, descartados, costoUsd };
}

export async function proponerTests(root: string, rel: string, funcion?: string, o: { usarProbados?: boolean; activos?: boolean } = {}): Promise<ResultadoTests> {
  const lang = langFor(rel);
  if (!lang) throw new Error(`tipo de archivo sin soporte: ${rel}`);
  const z = makeZoner(root);
  const testRel = rutaTest(rel, z.config.tests.carpeta);
  const testAbs = path.join(root, testRel);
  const existente = fs.existsSync(testAbs) ? fs.readFileSync(testAbs, "utf8") : "";
  // Los casos que ya probaste (sin pagar otra llamada), o casos nuevos.
  let casos: Caso[];
  let descartados: string[] = [];
  let costoUsd = 0;
  const guardados = archivoCasos(root, rel, funcion);
  if (o.usarProbados && fs.existsSync(guardados)) casos = JSON.parse(fs.readFileSync(guardados, "utf8")) as Caso[];
  else ({ casos, descartados, costoUsd } = await generarCasos(root, rel, funcion));
  if (!casos.length) return { archivo: testRel, casos: 0, preguntas: 0, costoUsd, descartados };

  const tlang = langFor(testRel)!;
  const parsed = await parse(existente, tlang);
  const id = `${nextThreadId(parsed.comments, new Set(), "x")}.1`;
  const usadas = [...new Set(casos.map((c) => /^([\w$]+)/.exec(c.llamada.trim())![1]!))];
  const exportadas = exportedFunctions(lang.id, fs.readFileSync(path.join(root, rel), "utf8"));
  void exportadas;
  const lineas: string[] = [];
  const add = (tipo: string, texto: string) => lineas.push(...renderReply(tlang, "", id, { tipo, texto, breve: true }));
  add(
    "nota",
    o.activos
      ? `Tests de ${funcion ?? "las funciones"} de ${rel} creados por ComplementAIry (con tu clic). Los que tienen pregunta quedan apagados: decide el valor esperado y márcalos [x].`
      : `Casos propuestos para ${funcion ?? "las funciones"} de ${rel}. Revisa cada uno, decide el valor esperado y marca [x] para convertirlo en test.`,
  );
  if (!existente.trim()) {
    // Imports calculados por el script, no por la IA.
    if (lang.id === "python") {
      add("snippet", `importar modulo=${rel.replace(/\.py$/, "").split("/").join(".")} nombres=${q(usadas.join(", "))} — importa lo que vas a probar`);
    } else {
      let ruta = path.relative(path.dirname(testRel), rel).split(path.sep).join("/").replace(/\.(m|c)?tsx?$/, ".$1js");
      if (!ruta.startsWith(".")) ruta = "./" + ruta;
      add("snippet", `vitest — imports de vitest`);
      add("snippet", `importar nombres=${q(usadas.join(", "))} ruta=${q(ruta)} — importa lo que vas a probar`);
    }
  }
  let preguntas = 0;
  /** Sin soluciones en código (control determinista) y corto: es el nombre del test. */
  const limpio = (t: string, max: number) => {
    let x = t.replace(/\s+/g, " ").trim();
    for (const code of inlineSolutions(x)) x = x.replace("`" + code + "`", "(…)");
    return x.length > max ? x.slice(0, x.lastIndexOf(" ", max - 1) > 20 ? x.lastIndexOf(" ", max - 1) : max - 1) + "…" : x;
  };
  for (const c of casos) {
    c.duda = limpio(c.duda, 400);
    const desc = limpio(c.descripcion.replace(/\s*\(.*\)\s*\.?$/, ""), 90).replace(/\.$/, "");
    const esperado = c.esperado.trim() || (c.tipo === "error" ? "" : "?");
    if (lang.id === "python") {
      add("snippet", c.tipo === "error" ? `test-error caso=${slug(desc)} llamada=${q(c.llamada)} — ${desc}` : `test caso=${slug(desc)} llamada=${q(c.llamada)} esperado=${q(esperado)} — ${desc}`);
    } else {
      // Números con decimales: toBeCloseTo (lo decide el script, no la IA).
      const dec = /^-?\d+\.(\d+)$/.exec(esperado)?.[1]?.length ?? (c.aprox ? 2 : undefined);
      add(
        "snippet",
        c.tipo === "error"
          ? `test-error descripcion=${q(desc)} llamada=${q(c.llamada)} mensaje=${q(esperado ? JSON.stringify(esperado) : "")}`
          : dec
            ? `test-aprox descripcion=${q(desc)} llamada=${q(c.llamada)} esperado=${q(esperado)} decimales=${dec}`
            : `test descripcion=${q(desc)} llamada=${q(c.llamada)} esperado=${q(esperado)}`,
      );
    }
    if (esperado === "?" || c.duda.trim()) {
      preguntas++;
      add("pregunta", c.duda.trim() || `¿Qué debería devolver ${c.llamada}? Pon el valor en "esperado" antes de activar el caso.`);
    }
  }
  const next = (existente && !existente.endsWith("\n") ? existente + "\n" : existente) + (existente.trim() ? "\n" : "") + lineas.join("\n") + "\n";
  const v = await verifyCommentOnly(existente, next, tlang);
  if (!v.ok) throw new Error(`no se escribió ${testRel}: ${v.reasons.join("; ")}`);
  // Con tu clic ("Guardar como tests"): los casos con valor esperado se convierten en tests de verdad
  // (con los snippets de la biblioteca); los que tienen pregunta quedan apagados hasta que decidas.
  const final = o.activos ? await activarCasos(root, testRel, next) : next;
  fs.mkdirSync(path.dirname(testAbs), { recursive: true });
  fs.writeFileSync(testAbs, final);
  return { archivo: testRel, casos: casos.length, preguntas, costoUsd, descartados };
}

/**
 * Expande las sugerencias de snippet del archivo de tests que NO tienen pregunta pendiente: es lo
 * mismo que marcar [x] y expandir, hecho por tu clic en "Guardar como tests" (desde el chat, el
 * resultado no es "solo comentarios" y se revierte).
 */
async function activarCasos(root: string, testRel: string, texto: string): Promise<string> {
  const { aplicarExpansion, planExpansion } = await import("./biblioteca.js");
  // Las sugerencias apagadas que no tienen una pregunta inmediatamente después se marcan [x].
  const lineas = texto.split("\n");
  for (let i = 0; i < lineas.length; i++) {
    if (!/@guia\[[^\]]+\] snippet \[ \]:/.test(lineas[i]!)) continue;
    const id = /@guia\[([^\]]+)\]/.exec(lineas[i]!)![1];
    let j = i + 1;
    while (j < lineas.length && lineas[j]!.includes(`@guia[${id}]`) && !/@guia\[[^\]]+\] (snippet|pregunta|nota)/.test(lineas[j]!)) j++;
    if (j < lineas.length && /@guia\[[^\]]+\] pregunta:/.test(lineas[j]!)) continue; // tiene una pregunta: decides tú
    lineas[i] = lineas[i]!.replace("snippet [ ]:", "snippet [x]:");
  }
  const marcado = lineas.join("\n");
  return aplicarExpansion(marcado, await planExpansion(root, testRel, marcado, undefined, "texto", true));
}

/** Corre los tests de ese archivo (el runner del proyecto) y devuelve qué falló. */
export async function correrTests(root: string, rel: string): Promise<{ archivo: string; ok: boolean; corrio: boolean; fallos: string[] }> {
  const z = makeZoner(root);
  const testRel = rutaTest(rel, z.config.tests.carpeta);
  if (!fs.existsSync(path.join(root, testRel))) return { archivo: testRel, ok: false, corrio: false, fallos: [`todavía no existe ${testRel} (usa "Guardar como tests")`] };
  const { runGate } = await import("./gate.js");
  const g = runGate(root, [testRel], { solo: ["tests"] });
  const corrida = g.corridas.find((c) => /test|vitest|pytest|jest/.test(c.tool));
  const fallos = g.diags.filter((d) => d.bloqueante).map((d) => d.msg);
  return { archivo: testRel, ok: !fallos.length && corrida?.estado !== "no instalada", corrio: !!corrida && corrida.estado !== "no instalada", fallos: corrida?.estado === "no instalada" ? [`no está instalado el runner de tests (${corrida.detalle ?? corrida.tool})`] : fallos };
}

/**
 * Vuelve a probar (sin IA) los casos guardados de las funciones de un archivo: lo que corre al guardar.
 * El resultado queda en la nota de cada función (`ultimaPrueba`), reemplazando al anterior.
 */
export async function recorrerCasos(root: string, rel: string): Promise<{ funciones: { funcion: string; pasan: number; fallan: number; detalle: ResultadoCaso[] }[] }> {
  const lang = langFor(rel);
  const dir = path.join(dataDir(root), "cache", "casos");
  if (!lang || !fs.existsSync(dir)) return { funciones: [] };
  const prefijo = `${encodeURIComponent(rel)}#`;
  const out: { funcion: string; pasan: number; fallan: number; detalle: ResultadoCaso[] }[] = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.startsWith(prefijo) && x.endsWith(".json"))) {
    const funcion = decodeURIComponent(f.slice(prefijo.length, -5));
    const casos = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as Caso[];
    const detalle = casos.map((c) => ejecutarCaso(root, rel, lang.id, c));
    out.push({ funcion, pasan: detalle.filter((d) => d.estado === "pasa").length, fallan: detalle.filter((d) => d.estado === "falla").length, detalle });
  }
  if (out.length) {
    const { cargarNotas, guardarNotas } = await import("./notas.js");
    const { conBloqueo } = await import("./ocupado.js");
    await conBloqueo(root, rel, "probando tests", async () => {
      const notas = cargarNotas(root, rel);
      for (const r of out) {
        const n = notas.find((x) => x.estado === "abierta" && x.ancla.funcion?.replace(/#\d+$/, "") === r.funcion) ?? notas.filter((x) => x.ancla.funcion?.replace(/#\d+$/, "") === r.funcion).pop();
        if (n) n.ultimaPrueba = { fecha: new Date().toISOString(), pasan: r.pasan, fallan: r.fallan, detalle: r.detalle.map((d) => ({ descripcion: d.descripcion, estado: d.estado, ...(d.obtenido ? { obtenido: d.obtenido } : {}), esperado: d.esperado, llamada: d.llamada })) };
      }
      guardarNotas(root, rel, notas);
    });
  }
  return { funciones: out };
}

function ejecutarCaso(root: string, rel: string, langId: string, c: Caso): ResultadoCaso {
  const base = { descripcion: c.descripcion, llamada: c.llamada, esperado: c.esperado };
  if (c.esperado.trim() === "?" || (!c.esperado.trim() && c.tipo !== "error")) return { ...base, estado: "decidir", duda: c.duda || `¿Qué debería devolver ${c.llamada}?` };
  const fn = /^([\w$]+)/.exec(c.llamada.trim())![1]!;
  const r = ejecutar(root, rel, langId, { expresion: c.llamada, funcion: fn });
  if (r.infra) return { ...base, estado: "no-ejecutable", obtenido: r.error ?? "" };
  const obtenido = r.ok ? JSON.stringify(r.valor) : `error: ${r.error ?? ""}`;
  const pasa = c.tipo === "error" ? !r.ok && (!c.esperado.trim() || (r.error ?? "").includes(c.esperado.replace(/^["']|["']$/g, ""))) : coincide(c.esperado, r);
  return { ...base, estado: pasa ? "pasa" : "falla", obtenido };
}
