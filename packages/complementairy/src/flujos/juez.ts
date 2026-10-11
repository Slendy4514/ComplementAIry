/**
 * El JUEZ de lo que escribes antes de que llegue a la IA que delega (manifiesto IV.1, IV.3, V.3):
 *
 *  1. Piso determinista (objetivo, no se puede engañar): vacío, "sí/dale" a secas, copia literal de la
 *     sugerencia, identificadores inexistentes. Lo que rechaza, queda rechazado.
 *  2. Decisor rápido (subjetivo): ¿es vago?, ¿es demasiado amplio para delegarlo?, ¿cuántos temas trae?,
 *     ¿la explicación explica el tramo? Escala por incertidumbre. Solo puede SUBIR la exigencia.
 *
 * Si el decisor te rechaza, puedes rebatirlo (`rebatir`): queda registrado en .cai/cache/rebates.jsonl y
 * alimenta `cai ia evaluar`.
 */
import fs from "node:fs";
import path from "node:path";
import { dataDir, type Config } from "../proyecto/config.js";
import { comoDato, decidir, type Decision } from "../ia/decisor.js";
import { chequearExplicacion, conContenido, esAmplio, esVago, pedidoEspecifico, respuestaValida, separarIngenuo, type ChequeoExplicacion } from "../nucleo/especificidad.js";

export interface Veredicto {
  ok: boolean;
  motivos: string[];
  /** Quién decidió lo subjetivo. */
  fuente: string;
  dudoso?: boolean;
  /** Para pedidos: cuántos temas distintos parece traer. */
  temas?: number;
}

const motivo = (cond: boolean, texto: string) => (cond ? [texto] : []);

/** ¿Un pedido (lo que le pides a la IA que haga) es concreto y de UN tema, o hay que separarlo/precisarlo? */
export async function juzgarPedido(c: Config, root: string, texto: string, conocidos: string[] = []): Promise<Veredicto> {
  const piso = pedidoEspecifico(texto, conocidos);
  // El piso solo cuenta lo objetivo: vacío, "eso / lo que dijiste", sin contenido. "Sin referencias" lo decide el decisor.
  const objetivo = piso && !/nombra algo concreto/.test(piso) ? piso : null;
  if (objetivo) return { ok: false, motivos: [objetivo], fuente: "reglas" };
  const d = await decidir(
    c,
    {
      estado: `Un programador escribió este pedido para que una IA de programación lo implemente.\n${comoDato("pedido", texto)}\nIdentificadores que existen en el proyecto: ${conocidos.slice(0, 60).join(", ") || "(ninguno)"}`,
      preguntas: {
        vago: { type: "noul", description: "true si NO dice concretamente qué cambiar, dónde o qué resultado se espera (\"mejora el buscador\", \"haz que funcione\")" },
        amplio: { type: "noul", description: "true si es demasiado grande para delegarlo de una vez (varias responsabilidades, un sistema entero, 'todo el resto')" },
        temas: { type: "score", min: 1, max: 6, description: "cuántas cosas DISTINTAS e independientes pide" },
      },
    },
    root,
    () => ({ vago: { valor: !!piso, confianza: 0.5 }, amplio: { valor: esAmplio(texto), confianza: 0.5 }, temas: { valor: Math.max(1, separarIngenuo(texto).length), confianza: 0.5 } }),
  );
  return veredictoPedido(d, texto);
}

function veredictoPedido(d: Decision, texto: string): Veredicto {
  const v = d.respuestas;
  const temas = Math.max(1, Math.round(Number(v.temas?.valor ?? 1)));
  const motivos = [
    ...motivo(v.vago?.valor === true, "es vago: di qué cambia, dónde (archivo, función, campo) y cómo sabrás que funciona"),
    ...motivo(v.amplio?.valor === true && temas <= 1, "es demasiado amplio para delegarlo de una vez: divídelo en partes que puedas revisar"),
    ...motivo(temas > 1, `trae ${temas} temas distintos: se separa en ${temas} tareas (\`cai pedir\` lo hace y no se olvida ninguno)`),
  ];
  if (esVago(texto) && !motivos.length) motivos.push("di QUÉ quieres con tus palabras, no «eso» ni «lo que dijiste»");
  return { ok: !motivos.length, motivos, fuente: d.fuente, dudoso: d.dudosa, temas };
}

/** Respuesta a una pregunta de la entrevista o a una sugerencia: ¿decide algo, con tus palabras? */
export async function juzgarRespuesta(c: Config, root: string, pregunta: string, respuesta: string, sugerencia = ""): Promise<Veredicto> {
  const piso = respuestaValida(respuesta, sugerencia);
  if (piso) return { ok: false, motivos: [piso], fuente: "reglas" };
  const d = await decidir(
    c,
    {
      estado: `Pregunta de una entrevista técnica: «${pregunta}»\nSugerencia que dio la IA: «${sugerencia || "(ninguna)"}»\nRespuesta del programador:\n${comoDato("respuesta", respuesta)}`,
      preguntas: {
        responde: { type: "noul", description: "true si la respuesta DECIDE algo concreto que contesta la pregunta (no solo aprueba sin decir qué)" },
      },
    },
    root,
    () => ({ responde: { valor: conContenido(respuesta).length >= 2, confianza: 0.5 } }),
  );
  const ok = d.respuestas.responde?.valor !== false;
  return { ok, motivos: ok ? [] : ["tu respuesta no dice qué decidiste para esta pregunta: escríbelo concreto (qué carpeta, qué opción, qué valor)"], fuente: d.fuente, dudoso: d.dudosa };
}

/** Explicación de un tramo (evidencia de nivel 2): piso determinista + ¿explica de verdad el código? */
export async function juzgarExplicacion(
  c: Config,
  root: string,
  codigo: string,
  explicacion: string,
  o: Parameters<typeof chequearExplicacion>[1],
): Promise<Veredicto & { piso: ChequeoExplicacion }> {
  const piso = chequearExplicacion(explicacion, o);
  if (!piso.ok) return { ok: false, motivos: piso.motivos, fuente: "reglas", piso };
  const d = await decidir(
    c,
    {
      estado: `Código:\n${comoDato("codigo", codigo.slice(0, 4000))}\nExplicación del programador:\n${comoDato("explicacion", explicacion)}`,
      preguntas: {
        explica: { type: "noul", description: "true si la explicación describe correctamente qué hace este código y por qué (no solo repite nombres)" },
        errores: { type: "noul", description: "true si la explicación afirma algo FALSO sobre el código" },
      },
    },
    root,
    () => ({ explica: { valor: true, confianza: 0.5 }, errores: { valor: false, confianza: 0.5 } }),
  );
  const motivos = [
    ...motivo(d.respuestas.explica?.valor === false, "tu explicación no describe lo que hace el código: vuelve a leerlo y explica qué hace y por qué"),
    ...motivo(d.respuestas.errores?.valor === true, "tu explicación dice algo que el código no hace: revísalo (prueba con una predicción si dudas)"),
  ];
  return { ok: !motivos.length, motivos, fuente: d.fuente, ...(d.dudosa ? { dudoso: true } : {}), piso };
}

// --- Rebatir al decisor ----------------------------------------------------------------------------------

export interface Rebate {
  fecha: string;
  que: "pedido" | "respuesta" | "explicacion";
  texto: string;
  motivos: string[];
  argumento: string;
  fuente: string;
}

const archivoRebates = (root: string) => path.join(dataDir(root), "cache", "rebates.jsonl");

/** Registra que no estás de acuerdo con el decisor (con tu argumento). Lo objetivo (reglas) no se rebate. */
export function rebatir(root: string, r: Omit<Rebate, "fecha">): Rebate {
  if (r.fuente === "reglas") throw new Error("eso lo rechazó una regla objetiva (vacío, «sí» a secas, copia): no se rebate, se corrige");
  if (conContenido(r.argumento).length < 4) throw new Error("explica por qué no estás de acuerdo (al menos una oración con contenido)");
  const reg: Rebate = { fecha: new Date().toISOString(), ...r };
  fs.mkdirSync(path.dirname(archivoRebates(root)), { recursive: true });
  fs.appendFileSync(archivoRebates(root), JSON.stringify(reg) + "\n");
  return reg;
}

export function leerRebates(root: string): Rebate[] {
  try {
    return fs.readFileSync(archivoRebates(root), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Rebate);
  } catch {
    return [];
  }
}
