import fs from "node:fs";
import path from "node:path";
import { parse } from "./comments.js";
import { makeZoner } from "./config.js";
import { contextBlock, CRITERIO, projectContext } from "./context.js";
import { langFor } from "./lang.js";
import { ask } from "./llm.js";
import { rutaTest } from "./metricas.js";
import { exportedFunctions, validarExpresion } from "./predict.js";
import { renderReply } from "./render.js";
import { nextThreadId } from "./threads.js";
import { iaOpts } from "./tutor.js";
import { verifyCommentOnly } from "./verify.js";
import { inlineSolutions } from "./guard.js";

/**
 * Tests como snippets que activás vos. La IA propone casos (qué probar y qué debería pasar);
 * el script valida cada llamada, calcula los imports y escribe todo APAGADO en la carpeta de tests.
 * El valor esperado lo decidís vos: si la IA duda, pregunta.
 */

interface Caso {
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

export async function proponerTests(root: string, rel: string, funcion?: string): Promise<ResultadoTests> {
  const abs = path.join(root, rel);
  const lang = langFor(rel);
  if (!lang) throw new Error(`tipo de archivo sin soporte: ${rel}`);
  const src = fs.readFileSync(abs, "utf8");
  const exportadas = exportedFunctions(lang.id, src);
  if (!exportadas.size) throw new Error("el archivo no exporta funciones para testear");
  if (funcion && !exportadas.has(funcion)) throw new Error(`${funcion} no es una función exportada de ${rel}`);
  const z = makeZoner(root);
  const testRel = rutaTest(rel, z.config.tests.carpeta);
  const testAbs = path.join(root, testRel);
  const existente = fs.existsSync(testAbs) ? fs.readFileSync(testAbs, "utf8") : "";

  const { data, costUsd } = await ask<{ casos: Caso[] }>({
    kind: "tests",
    system: SYSTEM,
    cwd: root,
    schema: SCHEMA,
    ...iaOpts(z.config),
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
  if (!casos.length) return { archivo: testRel, casos: 0, preguntas: 0, costoUsd: costUsd, descartados };

  const tlang = langFor(testRel)!;
  const parsed = await parse(existente, tlang);
  const id = `${nextThreadId(parsed.comments, new Set(), "x")}.1`;
  const usadas = [...new Set(casos.map((c) => /^([\w$]+)/.exec(c.llamada.trim())![1]!))];
  const lineas: string[] = [];
  const add = (tipo: string, texto: string) => lineas.push(...renderReply(tlang, "", id, { tipo, texto, breve: true }));
  add("nota", `Casos propuestos para ${funcion ?? "las funciones"} de ${rel}. Revisa cada uno, decide el valor esperado y marca [x] para convertirlo en test.`);
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
      const dec = /^-?\d+\.(\d+)$/.exec(esperado)?.[1]?.length;
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
  fs.mkdirSync(path.dirname(testAbs), { recursive: true });
  fs.writeFileSync(testAbs, next);
  return { archivo: testRel, casos: casos.length, preguntas, costoUsd: costUsd, descartados };
}
