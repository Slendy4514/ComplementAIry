import fs from "node:fs";
import { contextoComun } from "../../proyecto/contexto.js";
import path from "node:path";
import { dataDir, makeZoner } from "../../proyecto/config.js";
import { langFor } from "../../nucleo/lang.js";
import { ask, evitada } from "../../ia/llm.js";
import { cargarNotas, type Nota } from "../../proyecto/notas.js";
import { claveFuncion, funcionEn, funcionesDe } from "../../proyecto/notasFuncion.js";
import { iaOpts } from "../../ia/llm.js";
import { huella } from "../verificar.js";
import { modoEfectivo } from "../../proyecto/modos.js";

/**
 * Guía mientras escribes: en la línea del cursor, UNA indicación corta de qué sigue (o qué está mal en
 * esa línea), siguiendo los pasos de la nota de la función si los hay. La extensión la muestra en gris
 * al final de la línea y la actualiza en cada pausa; no se inserta nada.
 * Límites sin IA: caché por código + línea, una cada 1,5 s por función y un tope por hora (configurable).
 */

interface Cache {
  respuestas: Record<string, string>;
  ultima: Record<string, number>;
  llamadas: number[];
}

// Con el proceso abierto (cai servir) cada una tarda ~1 s y cuesta ~US$0,002.
const ENTRE_MS = 1_500;
const archivo = (root: string) => path.join(dataDir(root), "cache", "rapidas.json");

function cargar(root: string): Cache {
  try {
    return JSON.parse(fs.readFileSync(archivo(root), "utf8")) as Cache;
  } catch {
    return { respuestas: {}, ultima: {}, llamadas: [] };
  }
}

const SYSTEM = `Acompañas al programador MIENTRAS escribe una función, línea por línea. Da UNA indicación corta (MÁXIMO 70 caracteres) para lo que toca AHORA donde está el cursor (◀):
- si la línea del cursor tiene un error o un caso sin cuidar, dilo ("ojo: si dest es '' esto falla");
- si va bien, di el próximo paso que FALTA en toda la función, siguiendo los pasos de su nota si los hay ("ahora busca el archivo en la bóveda");
- en una línea vacía, qué escribir ahí (en palabras).
Las líneas marcadas "(ya escrito)" están DESPUÉS del cursor y ya existen: NO sugieras nada que ya esté ahí. En "yaEscrito" pon el número de línea donde ya está lo que ibas a sugerir (0 si no está escrito en ninguna parte); si lo está, busca otra cosa que falte o devuelve texto vacío.
Si otra función del MAPA DEL ARCHIVO ya hace (o debería hacer) eso, dilo ("usa normalize para limpiar la ruta") en vez de pedir que se escriba aquí.
Nunca escribas código, expresiones ni la línea corregida (nada de "x === y"): solo la idea en palabras ("compara en vez de asignar"). Devuelve texto vacío solo si la función ya está completa. Español neutro con TUTEO ("valida", "usa", "revisa"), nunca voseo ("validá", "usá").`;

/**
 * `texto`: el contenido del editor (aunque no esté guardado); si no viene, se lee el disco.
 * `aPedido`: lo pediste tú (atajo): se saltea la espera entre sugerencias.
 */
export async function rapida(root: string, rel: string, linea: number, o: { texto?: string; aPedido?: boolean } = {}): Promise<{ texto: string; completo?: string; motivo?: string; costoUsd: number }> {
  const z = makeZoner(root);
  if (!z.config.rapidas.activas && !o.aPedido) return { texto: "", motivo: "desactivadas en la configuración", costoUsd: 0 };
  const abs = path.join(root, rel);
  const src = o.texto ?? fs.readFileSync(abs, "utf8");
  const funciones = await funcionesDe(src, langFor(rel));
  const f = funcionEn(funciones, linea);
  if (!f) return { texto: "", motivo: "el cursor no está dentro de una función", costoUsd: 0 };
  const nota = cargarNotas(root, rel, src).find((n) => n.estado === "abierta" && n.ancla.funcion === claveFuncion(funciones, f));
  if (!nota && z.config.rapidas.soloConNota) return { texto: "", motivo: `${f.nombre} no tiene nota (y la configuración pide guiar solo funciones con nota)`, costoUsd: 0 };
  // En modo aprender no hay sugerencias rápidas: primero lo piensas tú.
  if (!modoEfectivo(z.config, rel, claveFuncion(funciones, f)).c.rapidas) return { texto: "", motivo: "modo aprender (primero lo piensas tú)", costoUsd: 0 };

  const lineas = src.split(/\r?\n/);
  const codigo = lineas.slice(f.linea - 1, f.linea - 1 + f.lineas);
  // Misma función, mismo código y misma línea → misma guía (sin IA).
  const clave = `${rel}:${f.nombre}:${huella(codigo.join("\n"))}:${linea - f.linea}`;
  const c = cargar(root);
  if (clave in c.respuestas) {
    evitada("rapida", "misma función y línea que antes (caché)");
    return { texto: corta(c.respuestas[clave]!), completo: c.respuestas[clave]!, motivo: "caché", costoUsd: 0 };
  }
  const ahora = Date.now();
  c.llamadas = c.llamadas.filter((t) => ahora - t < 3600_000);
  if (!o.aPedido && ahora - (c.ultima[`${rel}:${f.nombre}`] ?? 0) < ENTRE_MS) return { texto: "", motivo: "espera (una cada 1,5 s por función)", costoUsd: 0 };
  if (c.llamadas.length >= z.config.rapidas.maxHora) return { texto: "", motivo: `tope de ${z.config.rapidas.maxHora} por hora (configurable)`, costoUsd: 0 };

  // Se registra ANTES de llamar: un segundo pedido mientras este está en curso respeta la espera.
  c.ultima[`${rel}:${f.nombre}`] = ahora;
  c.llamadas.push(ahora);
  fs.mkdirSync(path.dirname(archivo(root)), { recursive: true });
  fs.writeFileSync(archivo(root), JSON.stringify(c));
  const pedirGuia = (extra: string) =>
    ask<{ texto: string; yaEscrito?: number }>({
      kind: "rapida",
      ref: { archivo: rel, funcion: f.nombre },
      system: SYSTEM,
      cwd: root,
      sinHerramientas: true,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["texto", "yaEscrito"],
        properties: { texto: { type: "string" }, yaEscrito: { type: "integer", description: "Línea donde YA está escrito lo que sugieres (0 si no está)." } },
      },
      ...iaOpts(z.config, "chico"),
      effort: "low",
      sinRazonar: true, // una línea: sin razonamiento largo (más rápido y barato)
      prompt: [
        nota?.accion ? `Objetivo (de su nota): ${nota.accion}` : `Función ${f.nombre}: deduce el objetivo por el nombre y el código.`,
        // Los pasos que ya le dio la IA (pseudocódigo, plano…): la guía los sigue.
        pasosDeNota(nota) ? `Pasos que ya le diste:\n${pasosDeNota(nota)}` : "",
        contextoComun(root, rel, { funcion: claveFuncion(funciones, f), corto: true }),
        `Función ${f.nombre} (◀ = línea del cursor):`,
        // Numeradas; lo de después del cursor, marcado: la guía no debe adelantar lo que ya está escrito.
        codigo.map((l, i) => `${f.linea + i}: ${l}${f.linea + i === linea ? "   ◀" : f.linea + i > linea && l.trim() ? "   (ya escrito)" : ""}`).join("\n"),
        extra,
      ]
        .filter(Boolean)
        .join("\n\n"),
    });
  // Sin código en la guía (determinista): si trae expresiones o código, se pide de nuevo solo con palabras.
  const conCodigo = (t: string) => /`[^`]*[=(){};<>][^`]*`|[=!]==|=>|\b(return|const|let|var)\s+\w+\s*=/.test(t);
  let { data, costUsd } = await pedirGuia("");
  // Autoverificación (determinista sobre lo que contesta): si lo que sugiere ya está escrito en otra
  // línea de la función, se pide una vez lo que FALTA; si insiste, mejor nada que algo inútil.
  const yaEsta = (d: { texto: string; yaEscrito?: number }) => !!d.texto?.trim() && !!d.yaEscrito && d.yaEscrito !== linea && d.yaEscrito >= f.linea && d.yaEscrito < f.linea + f.lineas && !!lineas[d.yaEscrito - 1]?.trim();
  if (yaEsta(data)) {
    const otra = await pedirGuia(`Lo que ibas a sugerir ("${data.texto}") ya está escrito en la línea ${data.yaEscrito}. ¿Qué FALTA? Si no falta nada, texto vacío.`);
    costUsd += otra.costUsd;
    data = yaEsta(otra.data) ? { texto: "" } : otra.data;
  }
  let completo = (data.texto ?? "").replace(/\s+/g, " ").trim();
  let texto = corta(completo);
  // Se mira el texto COMPLETO (el hover y el panel lo muestran entero, no solo lo que cabe en la línea).
  if (conCodigo(completo)) {
    const otra = await pedirGuia(`Tu indicación anterior traía código ("${completo.slice(0, 200)}"). Dila SOLO con palabras, sin código ni expresiones.`);
    costUsd += otra.costUsd;
    completo = (otra.data.texto ?? "").replace(/\s+/g, " ").trim();
    texto = corta(completo);
    if (conCodigo(completo)) texto = completo = "";
  }
  c.respuestas[clave] = completo;
  // La caché no crece sin fin: se quedan las últimas 300.
  const claves = Object.keys(c.respuestas);
  for (const k of claves.slice(0, Math.max(0, claves.length - 300))) delete c.respuestas[k];
  fs.mkdirSync(path.dirname(archivo(root)), { recursive: true });
  fs.writeFileSync(archivo(root), JSON.stringify(c));
  // `texto` cabe en la línea (cortado en una palabra); `completo` es para el hover y el panel.
  return { texto, completo, costoUsd: costUsd };
}

/** Lo último que dijo la IA en la nota (pasos, pseudocódigo), recortado: el hilo de la guía. */
function pasosDeNota(n: Nota | undefined): string {
  const m = n ? [...n.hilo].reverse().find((x) => x.quien === "ia" && !/^\*\*(🟢|🟡|🔴)/.test(x.texto)) : undefined;
  return m ? m.texto.replace(/\*\*/g, "").slice(0, 900) : "";
}

/** Máximo ~90 caracteres, cortado en una palabra (nunca a mitad), con "…" si se recortó. */
export function corta(t: string, max = 90): string {
  if (t.length <= max) return t;
  const i = t.lastIndexOf(" ", max - 1);
  return `${t.slice(0, i > 40 ? i : max - 1).replace(/[,;:.]$/, "")}…`;
}
