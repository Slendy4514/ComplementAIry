import fs from "node:fs";
import path from "node:path";
import { dataDir, makeZoner } from "./config.js";
import { langFor } from "./lang.js";
import { ask, evitada } from "./llm.js";
import { cargarNotas } from "./notas.js";
import { claveFuncion, funcionEn, funcionesDe } from "./notasFuncion.js";
import { iaOpts } from "./tutor.js";
import { huella } from "./verificar.js";

/**
 * Sugerencia rápida: una pista de UNA línea donde estás escribiendo (la extensión la muestra en gris
 * al final de la línea; no se inserta nada). Solo dentro de una función con nota abierta.
 * Límites sin IA: caché por código + línea, una cada 20 s por función y 30 por hora.
 */

interface Cache {
  respuestas: Record<string, string>;
  ultima: Record<string, number>;
  llamadas: number[];
}

const MAX_HORA = 30;
const ENTRE_MS = 20_000;
const archivo = (root: string) => path.join(dataDir(root), "cache", "rapidas.json");

function cargar(root: string): Cache {
  try {
    return JSON.parse(fs.readFileSync(archivo(root), "utf8")) as Cache;
  } catch {
    return { respuestas: {}, ultima: {}, llamadas: [] };
  }
}

const SYSTEM = `Das UNA pista corta (máximo 80 caracteres) para el próximo paso, en la línea donde está escribiendo el programador. Sin código ni nombres de variables nuevas: una idea ("valida que dest no esté vacío antes de mover"). Si la línea ya va bien o no hay nada útil que decir, devuelve texto vacío. Español neutro con tuteo.`;

export async function rapida(root: string, rel: string, linea: number): Promise<{ texto: string; motivo?: string; costoUsd: number }> {
  const z = makeZoner(root);
  if (!z.config.rapidas.activas) return { texto: "", motivo: "desactivadas", costoUsd: 0 };
  const abs = path.join(root, rel);
  const src = fs.readFileSync(abs, "utf8");
  const funciones = await funcionesDe(src, langFor(rel));
  const f = funcionEn(funciones, linea);
  if (!f) return { texto: "", motivo: "fuera de una función", costoUsd: 0 };
  const nota = cargarNotas(root, rel, src).find((n) => n.estado === "abierta" && n.ancla.funcion === claveFuncion(funciones, f));
  if (!nota) return { texto: "", motivo: "la función no tiene nota", costoUsd: 0 };

  const lineas = src.split(/\r?\n/);
  const codigo = lineas.slice(f.linea - 1, f.linea - 1 + f.lineas);
  const clave = `${rel}:${f.nombre}:${huella(codigo.join("\n"))}:${linea - f.linea}`;
  const c = cargar(root);
  if (clave in c.respuestas) {
    evitada("rapida", "misma función y línea que antes (caché)");
    return { texto: c.respuestas[clave]!, motivo: "caché", costoUsd: 0 };
  }
  const ahora = Date.now();
  c.llamadas = c.llamadas.filter((t) => ahora - t < 3600_000);
  if (ahora - (c.ultima[`${rel}:${f.nombre}`] ?? 0) < ENTRE_MS) return { texto: "", motivo: "espera (una cada 20 s por función)", costoUsd: 0 };
  if (c.llamadas.length >= MAX_HORA) return { texto: "", motivo: "límite por hora", costoUsd: 0 };

  const { data, costUsd } = await ask<{ texto: string }>({
    kind: "rapida",
    system: SYSTEM,
    cwd: root,
    sinHerramientas: true,
    schema: { type: "object", additionalProperties: false, required: ["texto"], properties: { texto: { type: "string" } } },
    ...iaOpts(z.config, "chico"),
    effort: "low", // una línea: sin razonamiento largo (más rápido y barato)
    prompt: [
      nota.accion ? `Lo que su nota dice que haga: ${nota.accion}` : "",
      `Función ${f.nombre} (◀ = línea del cursor):`,
      codigo.map((l, i) => `${l}${f.linea + i === linea ? "   ◀" : ""}`).join("\n"),
    ]
      .filter(Boolean)
      .join("\n\n"),
  });
  const texto = (data.texto ?? "").replace(/\s+/g, " ").trim().slice(0, 100);
  c.respuestas[clave] = texto;
  c.ultima[`${rel}:${f.nombre}`] = ahora;
  c.llamadas.push(ahora);
  // La caché no crece sin fin: se quedan las últimas 300.
  const claves = Object.keys(c.respuestas);
  for (const k of claves.slice(0, Math.max(0, claves.length - 300))) delete c.respuestas[k];
  fs.mkdirSync(path.dirname(archivo(root)), { recursive: true });
  fs.writeFileSync(archivo(root), JSON.stringify(c));
  return { texto, costoUsd: costUsd };
}
