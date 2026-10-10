import fs from "node:fs";
import path from "node:path";
import { parse } from "./comments.js";
import { dataDir, makeZoner } from "./config.js";
import { CRITERIO } from "./context.js";
import { contextoComun } from "./contexto.js";
import { langFor, type LangSpec } from "./lang.js";
import { sonLiterales } from "./literales.js";
import { ask } from "./llm.js";
import { cargarNotas, guardarNotas, mensaje, type Nota } from "./notas.js";
import { claveFuncion, funcionesDe, funcionPorClave, notaPara } from "./notasFuncion.js";
import { conBloqueo, conCandado } from "./ocupado.js";
import { hijos, type SyntaxNode } from "./parser.js";
import { coincide, ejecutar, exportedFunctions, validarExpresion, type Ejecucion } from "./predict.js";
import { bloqueRepertorio, buscarEnRepertorio, cargarRepertorio } from "./repertorio.js";
import { ubicarSnippet } from "./responder.js";
import { analizarScript } from "./sandbox.js";
import { agregarTareas } from "./siguiente.js";
import { iaOpts } from "./tutor.js";

/**
 * Modo programar: la IA escribe código, en porciones manejables, y tú no te pierdes. Nada entra a tu
 * archivo sin tu clic (lo inserta la extensión); aquí solo se PROPONE y se PRUEBA (en una copia).
 *
 * 1. Plan de pasos (3 a 5, por idea, no por líneas), que editas tú. Más de 5 → dos funciones: la
 *    auxiliar se crea como tarea y se trabaja en su propia nota.
 * 2a. Tú diriges: dices en palabras cómo hacer un paso; la IA escribe SOLO eso (si a tu paso le falta
 *    algo, lo dice en vez de completarlo en silencio).
 * 2b. Como un PR: defines los casos (el resultado esperado lo pones tú, con al menos un borde); la IA
 *    propone la función en porciones (una por paso), ya probada contra tus casos; para avanzar, pruebas
 *    cada porción en el probador con TU entrada (que tiene que pasar por esa porción: marcas en la copia,
 *    sin IA) y lo que esperas, comparado ejecutando.
 * 3. Repertorio: lo que ya hiciste va en pasos más grandes, y se puede proponer tu versión adaptada (diff).
 */

// --- Propuestas (en preparación: nunca en tu archivo) -------------------------------------------------

export interface Prueba {
  entrada: string;
  espero: string;
  obtenido: string;
  toca: boolean;
  acierto: boolean;
  fecha: string;
  explicacion?: string;
}

export interface Porcion {
  /** Líneas (1-based, inclusivas) dentro de `codigo`. */
  desde: number;
  hasta: number;
  paso: number;
  porque: string;
  pruebas: Prueba[];
  aprobada: boolean;
}

export interface Propuesta {
  tipo: "dirigido" | "pr" | "adaptada";
  archivo: string;
  funcion: string;
  fecha: string;
  modelo?: string;
  costo: number;
  /** dirigido: el paso y lo que dijiste. */
  paso?: number;
  instruccion?: string;
  /** El código propuesto: dirigido = las líneas del paso; pr/adaptada = la función completa. */
  codigo: string;
  /** dirigido: después de qué línea de tu función va (como los snippets). */
  despues?: string;
  linea?: number;
  /** dirigido: lo que tu paso no dice (no se completa en silencio). */
  falta?: string;
  explicacion?: string;
  porciones?: Porcion[];
  /** pr: resultado contra tus casos antes de mostrarse. */
  contrato?: { llamada: string; esperado: string; obtenido: string; pasa: boolean }[];
  /** adaptada: tu versión original (para el diff) y qué cambia. */
  original?: { id: string; codigo: string; proyecto: string };
  cambios?: { que: string; porque: string }[];
}

const dirPropuestas = (root: string) => path.join(dataDir(root), "cache", "propuestas");
const archivoPropuesta = (root: string, rel: string, fn: string) => path.join(dirPropuestas(root), `${encodeURIComponent(rel)}#${encodeURIComponent(fn)}.json`);

export function leerPropuesta(root: string, rel: string, fn: string): Propuesta | null {
  try {
    return JSON.parse(fs.readFileSync(archivoPropuesta(root, rel, fn), "utf8")) as Propuesta;
  } catch {
    return null;
  }
}

function guardarPropuesta(root: string, p: Propuesta): void {
  fs.mkdirSync(dirPropuestas(root), { recursive: true });
  const f = archivoPropuesta(root, p.archivo, p.funcion);
  fs.writeFileSync(`${f}.${process.pid}.tmp`, JSON.stringify(p, null, 2));
  fs.renameSync(`${f}.${process.pid}.tmp`, f);
}

/** ¿Lo que dio la ejecución es lo que esperabas? "error: <parte del mensaje>" exige ESE error; un valor, ese valor. */
export function cumple(esperado: string, r: Ejecucion): boolean {
  if (r.infra) return false;
  if (/^\s*error\b/i.test(esperado)) {
    const frag = esperado.replace(/^\s*error:?\s*/i, "").trim().toLowerCase();
    return !r.ok && (!frag || (r.error ?? "").toLowerCase().includes(frag));
  }
  return r.ok && coincide(esperado, r);
}

export function descartarPropuesta(root: string, rel: string, fn: string): void {
  fs.rmSync(archivoPropuesta(root, rel, fn), { force: true });
}

// --- Contexto común de la función --------------------------------------------------------------------

async function cargar(root: string, rel: string, clave: string) {
  const lang = langFor(rel);
  if (!lang) throw new Error(`tipo de archivo sin soporte: ${rel}`);
  const abs = path.join(root, rel);
  const src = fs.readFileSync(abs, "utf8");
  const funciones = await funcionesDe(src, lang);
  const f = funcionPorClave(funciones, clave);
  if (!f) throw new Error(`no encuentro la función "${clave}" en ${rel}: escribe primero su firma (el modo programar trabaja sobre funciones que ya existen)`);
  const lineas = src.split(/\r?\n/);
  const codigo = lineas.slice(f.linea - 1, f.linea - 1 + f.lineas).join("\n");
  const nota = cargarNotas(root, rel, src).find((n) => n.ancla.funcion === claveFuncion(funciones, f) && n.estado === "abierta") ?? cargarNotas(root, rel, src).filter((n) => n.ancla.funcion === claveFuncion(funciones, f)).pop();
  return { lang, abs, src, funciones, f, lineas, codigo, nota, clave: claveFuncion(funciones, f) };
}

/** Actualiza la nota de la función (con el archivo tomado). */
function conNota<T>(root: string, rel: string, clave: string, fn: (n: Nota) => T): Promise<T> {
  return conBloqueo(root, rel, "modo programar", async () => {
    const src = fs.readFileSync(path.join(root, rel), "utf8");
    const funciones = await funcionesDe(src, langFor(rel));
    const f = funcionPorClave(funciones, clave);
    const notas = cargarNotas(root, rel, src);
    const n = notaPara(notas, rel, funciones, src, { linea: f?.linea ?? 1, funcion: clave, tipo: "nota", origen: "programar" });
    const r = fn(n);
    n.actualizada = new Date().toISOString();
    guardarNotas(root, rel, notas);
    return r;
  });
}

const objetivoDe = (n?: Nota) => (n?.objetivo ? `Objetivo de la función${n.objetivo.confirmado ? " (confirmado)" : " (borrador)"}: ${n.objetivo.texto}${n.objetivo.criterios.length ? `\nCriterios: ${n.objetivo.criterios.join("; ")}` : ""}` : n?.accion ? `Lo que pedía su nota: ${n.accion}` : "");

// --- 1. Plan de pasos ---------------------------------------------------------------------------------

const SYSTEM_PLAN = `Propones el PLAN de una función en 3 a 5 pasos, por IDEA (validar entradas, caso especial, cálculo principal, armar el resultado…), no por líneas: cada paso es una idea completa que se pueda escribir de una vez.
- Si hacen falta más de 5 pasos, la función hace demasiado: propone separar una función auxiliar ("separar") y en el plan pon el paso como "usar <auxiliar>". La auxiliar se trabajará aparte, en su propia nota.
- Si el programador ya hizo algo parecido (su repertorio), ese paso puede ser más grande: indica el id en "repertorio".
- En palabras, sin código. Español neutro con tuteo.

${CRITERIO}`;

export async function planFuncion(root: string, rel: string, clave: string): Promise<{ plan: NonNullable<Nota["plan"]>; tarea?: string; costoUsd: number }> {
  const c = await cargar(root, rel, clave);
  const z = makeZoner(root);
  const rep = buscarEnRepertorio(root, `${c.f.nombre} ${c.nota?.objetivo?.texto ?? c.nota?.accion ?? ""}`, c.lang.id);
  const { data, costUsd } = await ask<{ pasos: { texto: string; repertorio: string }[]; separar: { nombre: string; proposito: string } }>({
    kind: "programar:plan",
    ref: { archivo: rel, funcion: c.f.nombre },
    system: SYSTEM_PLAN,
    cwd: root,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["pasos", "separar"],
      properties: {
        pasos: { type: "array", minItems: 1, maxItems: 5, items: { type: "object", additionalProperties: false, required: ["texto", "repertorio"], properties: { texto: { type: "string" }, repertorio: { type: "string", description: 'Id del repertorio si ya lo hizo antes; "" si no.' } } } },
        separar: { type: "object", additionalProperties: false, required: ["nombre", "proposito"], properties: { nombre: { type: "string", description: '"" si no hace falta separar.' }, proposito: { type: "string" } } },
      },
    },
    ...iaOpts(z.config, "mediano"),
    prompt: [contextoComun(root, rel, { funcion: c.clave }), objetivoDe(c.nota), bloqueRepertorio(rep), `Función (${c.lang.id}) ${c.f.nombre}, como está hoy:\n${c.codigo}`].filter(Boolean).join("\n\n"),
  });
  const validos = new Set(rep.map((e) => e.id));
  const plan: NonNullable<Nota["plan"]> = {
    pasos: data.pasos.slice(0, 5).map((p) => ({ texto: p.texto.trim(), ...(validos.has(p.repertorio) ? { repertorio: p.repertorio } : {}) })),
    separar: data.separar?.nombre?.trim() ? { nombre: data.separar.nombre.trim(), proposito: data.separar.proposito.trim() } : null,
    fecha: new Date().toISOString(),
  };
  // La auxiliar se trabaja aparte: queda como tarea (con su propia nota cuando escribas su firma).
  let tarea: string | undefined;
  if (plan.separar) {
    agregarTareas(root, [{ titulo: `Crear la auxiliar ${plan.separar.nombre}`, archivo: rel, funcion: plan.separar.nombre, crear: true, detalle: `${plan.separar.proposito} (la usa ${c.f.nombre}; trabájala en su propia nota)`, origen: "manual" }]);
    tarea = plan.separar.nombre;
  }
  await conNota(root, rel, c.clave, (n) => {
    n.plan = plan;
    n.hilo.push(mensaje("ia", `**🧭 Plan de ${c.f.nombre}** (edítalo si quieres)\n${plan.pasos.map((p, i) => `${i + 1}. ${p.texto}${p.repertorio ? " _(ya lo hiciste antes)_" : ""}`).join("\n")}${plan.separar ? `\n\nSepara \`${plan.separar.nombre}\`: ${plan.separar.proposito} (quedó como tarea; se trabaja en su propia nota).` : ""}`, { kind: "programar" }));
  });
  return { plan, ...(tarea ? { tarea } : {}), costoUsd: costUsd };
}

/** Tú editas el plan (máximo 5 pasos: si son más, son dos funciones). */
export async function editarPlan(root: string, rel: string, clave: string, pasos: string[]): Promise<NonNullable<Nota["plan"]>> {
  const limpios = pasos.map((p) => p.trim()).filter(Boolean);
  if (!limpios.length) throw new Error("el plan necesita al menos un paso");
  if (limpios.length > 5) throw new Error(`son ${limpios.length} pasos: con más de 5, la función hace demasiado. Separa una auxiliar (y trabájala en su propia nota)`);
  return conNota(root, rel, clave, (n) => {
    const previo = n.plan?.pasos ?? [];
    n.plan = { pasos: limpios.map((texto) => ({ texto, ...(previo.find((p) => p.texto === texto)?.hecho ? { hecho: true } : {}) })), separar: n.plan?.separar ?? null, fecha: new Date().toISOString() };
    return n.plan;
  });
}

// --- 2a. Tú diriges, la IA escribe ---------------------------------------------------------------------

const SYSTEM_DIRIGIDO = `El programador dirige y tú escribes: te dice en palabras CÓMO hacer un paso de su función y tú escribes SOLO ese paso, como lo dijo.
- No agregues lo que no dijo (validaciones, casos, optimizaciones). Si a su paso le falta algo importante, NO lo completes: dilo en "falta" ("tu paso no dice qué hacer si meses es 0") y escribe solo lo que sí dijo.
- Respeta su estilo, nombres y reglas. Código mínimo y claro, que encaje en su función donde va (indentado como el resto).
- "despues_de": copia EXACTA de la línea de su función DESPUÉS de la cual va el código.
- "explicacion": en una o dos oraciones, qué hace lo que escribiste (para que lo lea antes de insertarlo).
Español neutro con tuteo.`;

export async function pasoDirigido(root: string, rel: string, clave: string, paso: number, instruccion: string): Promise<Propuesta> {
  if (!instruccion.trim()) throw new Error("escribe en palabras cómo hacer el paso: la IA escribe solo lo que dices");
  const c = await cargar(root, rel, clave);
  const z = makeZoner(root);
  const plan = c.nota?.plan;
  const rep = buscarEnRepertorio(root, `${instruccion} ${plan?.pasos[paso - 1]?.texto ?? ""}`, c.lang.id);
  const { data, costUsd, modelo } = await ask<{ codigo: string; despues_de: string; falta: string; explicacion: string }>({
    kind: "programar:paso",
    ref: { archivo: rel, funcion: c.f.nombre },
    system: SYSTEM_DIRIGIDO,
    cwd: root,
    sinHerramientas: true,
    schema: { type: "object", additionalProperties: false, required: ["codigo", "despues_de", "falta", "explicacion"], properties: { codigo: { type: "string" }, despues_de: { type: "string" }, falta: { type: "string" }, explicacion: { type: "string" } } },
    ...iaOpts(z.config, "mediano"),
    prompt: [
      contextoComun(root, rel, { funcion: c.clave, corto: true }),
      objetivoDe(c.nota),
      plan ? `Plan:\n${plan.pasos.map((p, i) => `${i + 1}. ${p.texto}${p.hecho ? " (hecho)" : ""}`).join("\n")}` : "",
      bloqueRepertorio(rep),
      `Función (${c.lang.id}) como está hoy (numerada):\n${c.codigo.split("\n").map((l, i) => `${c.f.linea + i}| ${l}`).join("\n")}`,
      `${plan?.pasos[paso - 1] ? `Paso ${paso}: ${plan.pasos[paso - 1]!.texto}\n` : ""}Cómo lo quiere el programador: ${instruccion.trim()}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
  });
  const codigo = data.codigo.replace(/^```\w*\n?|\n?```$/g, "").replace(/\s+$/, "");
  if (!codigo.trim()) throw new Error(data.falta ? `no escribí nada: ${data.falta}` : "la IA no propuso código para ese paso: dilo con otras palabras");
  // Un paso es una idea: si sale enorme, es más de un paso (determinista).
  if (codigo.split("\n").length > 30) throw new Error(`ese paso salió de ${codigo.split("\n").length} líneas: es más de una idea. Divídelo en el plan`);
  const u = ubicarSnippet(c.lineas, c.f, data.despues_de.trim());
  const p: Propuesta = {
    tipo: "dirigido",
    archivo: rel,
    funcion: c.clave,
    fecha: new Date().toISOString(),
    ...(modelo ? { modelo } : {}),
    costo: costUsd,
    paso,
    instruccion: instruccion.trim(),
    codigo,
    despues: u.despues,
    ...(u.linea ? { linea: u.linea } : {}),
    ...(data.falta.trim() ? { falta: data.falta.trim().replace(/^tu paso no dice:?\s*/i, "") } : {}),
    explicacion: data.explicacion.trim(),
  };
  guardarPropuesta(root, p);
  // Se registra como propuesta (no como un mensaje tuyo: el comando lo puede correr también Claude Code).
  await conNota(root, rel, c.clave, (n) => n.hilo.push(mensaje("ia", `**🧭 Propuesta para el paso ${paso}** («${instruccion.trim()}»)${p.falta ? ` · ⚠ tu paso no dice: ${p.falta}` : ""}`, { kind: "programar" })));
  return p;
}

// --- 2b. Como un pull request, por porciones -----------------------------------------------------------

/** ¿Es un caso borde? (sin IA): vacío, cero, negativo, null/NaN/Infinity, muy grande, o un error esperado. */
export function esBorde(llamada: string, esperado: string): boolean {
  const args = llamada.slice(llamada.indexOf("(") + 1, llamada.lastIndexOf(")"));
  return /^\s*error\b/i.test(esperado) || /(^|[(,\[\s])(0|0\.0|-\d[\d.]*|""|''|\[\s*\]|\{\s*\}|null|None|undefined|NaN|-?Infinity|\d{7,})\s*(?=[,)\]]|$)/.test(args);
}

/** Valida tus casos (determinista): ≥ 2, literales, de esta función y al menos uno borde. */
export function validarContrato(casos: { llamada: string; esperado: string }[], nombre: string, langId: string): string | null {
  if (casos.length < 2) return "define al menos 2 casos (entrada → resultado esperado)";
  for (const c of casos) {
    const e = validarExpresion(c.llamada, new Set([nombre]), langId);
    if (e) return `${c.llamada}: ${e}`;
    if (!/^\s*error\b/i.test(c.esperado) && !sonLiterales(c.esperado)) return `${c.llamada}: el esperado "${c.esperado}" tiene que ser un valor (número, texto entre comillas, true/false, lista…) o "error: <parte del mensaje>"`;
  }
  if (!casos.some((c) => esBorde(c.llamada, c.esperado))) return "falta al menos un caso borde (vacío, 0, negativo, null/NaN, muy grande, o uno que deba dar error)";
  return null;
}

export async function definirContrato(root: string, rel: string, clave: string, casos: { llamada: string; esperado: string }[]): Promise<void> {
  const c = await cargar(root, rel, clave);
  const err = validarContrato(casos, c.f.nombre, c.lang.id);
  if (err) throw new Error(err);
  await conNota(root, rel, c.clave, (n) => {
    n.contrato = casos.map((x) => ({ llamada: x.llamada.trim(), esperado: x.esperado.trim() }));
  });
}

/** El archivo con la función reemplazada por `codigo` (opcionalmente con marcas en unas líneas). */
async function copiaConFuncion(c: Awaited<ReturnType<typeof cargar>>, codigo: string, marcarLineas?: { desde: number; hasta: number }): Promise<{ texto: string; marcas: { id: number; rama: boolean }[] }> {
  let cod = codigo;
  let marcas: { id: number; rama: boolean }[] = [];
  if (marcarLineas) ({ codigo: cod, marcas } = await marcar(codigo, c.lang, marcarLineas.desde, marcarLineas.hasta));
  const texto = [...c.lineas.slice(0, c.f.linea - 1), cod, ...c.lineas.slice(c.f.linea - 1 + c.f.lineas)].join("\n");
  return { texto, marcas };
}

const RAMA = /^(if_statement|else_clause|elif_clause|switch_case|switch_default|case_clause|for_statement|for_in_statement|while_statement|do_statement|catch_clause|except_clause|try_statement|conditional_expression|ternary_expression|match_statement)$/;
// Solo sentencias dentro de un bloque con llaves/indentación: una marca tras un `else` sin llaves cambiaría qué cubre.
const BLOQUE = /^(statement_block|block|program|module|switch_body|switch_case|switch_default)$/;

/**
 * Marcas en la copia (no en tu archivo): antes de cada sentencia de esas líneas, una marca que la
 * ejecución reporta. `rama`: la sentencia está dentro de una condición/bucle de la porción (una
 * entrada tiene que recorrer esa parte, no solo pasar por el costado).
 */
async function marcar(codigo: string, lang: LangSpec, desde: number, hasta: number): Promise<{ codigo: string; marcas: { id: number; rama: boolean }[] }> {
  const { root } = await parse(codigo, lang);
  if (!root) return { codigo, marcas: [] };
  const py = lang.id === "python";
  const puntos: { at: number; fin: number; linea: number; indent: string; rama: boolean }[] = [];
  const walk = (n: SyntaxNode) => {
    const l = n.startPosition.row + 1;
    const lineaTexto = codigo.split("\n")[l - 1] ?? "";
    // Solo sentencias que empiezan su propia línea (en Python, otra cosa rompería la indentación o el else).
    const empiezaLinea = lineaTexto.slice(0, n.startPosition.column).trim() === "";
    const esSentencia = /(_statement|_declaration|lexical_declaration)$/.test(n.type) && !!n.parent && BLOQUE.test(n.parent.type) && !/^(function_declaration|class_declaration|function_definition|class_definition|import_statement|export_statement)$/.test(n.type);
    // JS: una sentencia sin llaves bajo un if/else/for/while también se marca (envuelta en llaves).
    const cuerpoSinLlaves = !py && /(_statement|_declaration)$/.test(n.type) && !!n.parent && /^(if_statement|else_clause|for_statement|for_in_statement|while_statement|do_statement)$/.test(n.parent.type) && n.parent.childForFieldName("condition")?.id !== n.id;
    if ((esSentencia && (!py || empiezaLinea) || cuerpoSinLlaves) && l >= desde && l <= hasta) {
      let rama = false;
      for (let a: SyntaxNode | null = n.parent; a; a = a.parent) {
        if (a.startPosition.row + 1 < desde) break;
        if (RAMA.test(a.type)) rama = true;
      }
      if (cuerpoSinLlaves) rama = true;
      puntos.push({ at: n.startIndex, fin: cuerpoSinLlaves ? n.endIndex : -1, linea: l, indent: lineaTexto.match(/^\s*/)![0], rama });
    }
    for (const h of hijos(n)) walk(h);
  };
  walk(root);
  let out = codigo;
  const marcas = puntos.map((p, i) => ({ id: i + 1, rama: p.rama }));
  // Todas las inserciones (marca y, si hace falta, la llave que cierra), de atrás hacia adelante:
  // así los índices de lo anterior no cambian aunque haya marcas anidadas.
  const inserciones: { i: number; t: string }[] = [];
  puntos.forEach((p, k) => {
    const id = k + 1;
    if (py) {
      const ini = codigo.lastIndexOf("\n", p.at - 1) + 1;
      inserciones.push({ i: ini, t: `${p.indent}__import__("builtins").__dict__.setdefault("_cai_hits", set()).add(${id})\n` });
    } else {
      // El ";" inicial evita que, en código sin punto y coma, la marca se lea como una llamada de la línea anterior.
      const marca = `;(globalThis.__caiHits ??= new Set()).add(${id}); `;
      inserciones.push({ i: p.at, t: p.fin >= 0 ? `{ ${marca}` : marca });
      if (p.fin >= 0) inserciones.push({ i: p.fin, t: " }" });
    }
  });
  for (const x of inserciones.sort((a, b) => b.i - a.i)) out = `${out.slice(0, x.i)}${x.t}${out.slice(x.i)}`;
  return { codigo: out, marcas };
}

/** Escribe la copia junto al original (para que sus imports relativos funcionen) y la ejecuta; siempre la borra. */
async function ejecutarCopia(root: string, rel: string, c: Awaited<ReturnType<typeof cargar>>, texto: string, expresion: string): Promise<Ejecucion> {
  const dir = path.dirname(rel);
  const base = path.basename(rel);
  // Nombre importable también en Python (sin puntos ni guiones al inicio).
  const copiaRel = path.join(dir, `_cai_propuesta_${process.pid}_${base}`).split(path.sep).join("/");
  const abs = path.join(root, copiaRel);
  fs.writeFileSync(abs, texto);
  try {
    const exportadas = exportedFunctions(c.lang.id, texto);
    const a = c.lang.id === "javascript" && !exportadas.has(c.f.nombre) ? await analizarScript(texto, c.lang) : undefined;
    return ejecutar(root, copiaRel, c.lang.id, { expresion, funcion: c.f.nombre }, a && !a.esModulo ? { aislado: a } : {});
  } finally {
    fs.rmSync(abs, { force: true });
  }
}

const SYSTEM_PR = `Escribes la función completa del programador, como un pull request para que la revise por PORCIONES: una porción por paso de su plan (lo que ya hizo antes, según su repertorio, puede ir en una porción más grande).
- Tiene que cumplir sus casos (entrada → esperado): son su contrato. Respeta su firma, estilo y reglas.
- "codigo": la función COMPLETA desde la firma (misma firma). "porciones": rangos de líneas (1-based, dentro de "codigo") que cubren el cuerpo, en orden, sin solaparse; cada una con su "porque" (por qué así, en una o dos oraciones).
- Código claro y mínimo. Español neutro con tuteo en los textos.

${CRITERIO}`;

export async function propuestaPR(root: string, rel: string, clave: string, o: { desde?: string } = {}): Promise<Propuesta> {
  const c = await cargar(root, rel, clave);
  const z = makeZoner(root);
  const contrato = c.nota?.contrato ?? [];
  const err = validarContrato(contrato, c.f.nombre, c.lang.id);
  if (err) throw new Error(`antes de pedir la propuesta, define qué debe hacer: ${err}`);
  const plan = c.nota?.plan;
  const original = o.desde ? cargarRepertorio().find((e) => e.id === o.desde) : undefined;
  if (o.desde && !original) throw new Error(`no existe ${o.desde} en tu repertorio (míralo con: cai repertorio)`);
  const rep = original ? [original] : buscarEnRepertorio(root, `${c.f.nombre} ${plan?.pasos.map((p) => p.texto).join(" ") ?? ""}`, c.lang.id);
  let intento = "";
  let costo = 0;
  let ultima: Propuesta | undefined;
  for (let k = 0; k < 3; k++) {
    const { data, costUsd, modelo } = await ask<{ codigo: string; porciones: { desde: number; hasta: number; paso: number; porque: string }[]; cambios: { que: string; porque: string }[] }>({
      kind: original ? "programar:adaptar" : "programar:pr",
      ref: { archivo: rel, funcion: c.f.nombre },
      system: original ? `${SYSTEM_PR}\n\nAdaptas una función que el programador YA escribió en otro proyecto (su versión original): cambia solo lo necesario para este caso y explica cada cambio en "cambios".` : SYSTEM_PR,
      cwd: root,
      sinHerramientas: true,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["codigo", "porciones", "cambios"],
        properties: {
          codigo: { type: "string" },
          porciones: { type: "array", minItems: 1, maxItems: 6, items: { type: "object", additionalProperties: false, required: ["desde", "hasta", "paso", "porque"], properties: { desde: { type: "integer" }, hasta: { type: "integer" }, paso: { type: "integer" }, porque: { type: "string" } } } },
          cambios: { type: "array", description: original ? "Qué cambiaste respecto de su versión original y por qué." : "Vacío.", items: { type: "object", additionalProperties: false, required: ["que", "porque"], properties: { que: { type: "string" }, porque: { type: "string" } } } },
        },
      },
      ...iaOpts(z.config, "mediano"),
      prompt: [
        contextoComun(root, rel, { funcion: c.clave }),
        objetivoDe(c.nota),
        plan ? `Plan (una porción por paso):\n${plan.pasos.map((p, i) => `${i + 1}. ${p.texto}`).join("\n")}` : "",
        `Sus casos (contrato):\n${contrato.map((x) => `- ${x.llamada} → ${x.esperado}`).join("\n")}`,
        original ? `Su versión original (${original.proyecto}/${original.archivo}):\n${original.codigo}` : bloqueRepertorio(rep),
        `Función (${c.lang.id}) como está hoy:\n${c.codigo}`,
        intento,
      ]
        .filter(Boolean)
        .join("\n\n"),
    });
    costo += costUsd;
    const codigo = data.codigo.replace(/^```\w*\n?|\n?```$/g, "").replace(/\s+$/, "");
    const n = codigo.split("\n").length;
    // Porciones válidas (determinista): dentro del código, en orden, sin solaparse.
    const porciones = [...data.porciones].sort((a, b) => a.desde - b.desde).filter((p, i, xs) => p.desde >= 1 && p.hasta <= n && p.desde <= p.hasta && (i === 0 || p.desde > xs[i - 1]!.hasta));
    // Antes de mostrártela, contra TUS casos (en una copia).
    const { texto } = await copiaConFuncion(c, codigo);
    const resultados = [];
    for (const x of contrato) {
      const r = await ejecutarCopia(root, rel, c, texto, x.llamada);
      // No se pudo ejecutar (no es culpa de la propuesta): se dice y no se vuelve a pagar a la IA.
      if (r.infra) throw new Error(`no se pudo ejecutar la propuesta para probarla contra tus casos: ${r.error ?? "sin detalle"}`);
      resultados.push({ llamada: x.llamada, esperado: x.esperado, obtenido: r.ok ? JSON.stringify(r.valor) : `error: ${r.error ?? ""}`, pasa: cumple(x.esperado, r) });
    }
    ultima = {
      tipo: original ? "adaptada" : "pr",
      archivo: rel,
      funcion: c.clave,
      fecha: new Date().toISOString(),
      ...(modelo ? { modelo } : {}),
      costo,
      codigo,
      porciones: (porciones.length ? porciones : [{ desde: 2, hasta: Math.max(2, n - 1), paso: 1, porque: "" }]).map((p) => ({ ...p, porque: p.porque.trim(), pruebas: [], aprobada: false })),
      contrato: resultados,
      ...(original ? { original: { id: original.id, codigo: original.codigo, proyecto: original.proyecto }, cambios: data.cambios } : {}),
    };
    if (resultados.every((r) => r.pasa)) break;
    intento = `Tu propuesta anterior NO cumple estos casos:\n${resultados.filter((r) => !r.pasa).map((r) => `- ${r.llamada}: esperado ${r.esperado}, obtuvo ${r.obtenido}`).join("\n")}\nCorrígela.`;
  }
  guardarPropuesta(root, ultima!);
  return ultima!;
}

const SYSTEM_DIFERENCIA = `El programador predijo qué devolvería su función con una entrada y NO coincidió. Explica en 1-2 oraciones, sin código, qué parte del código produce el resultado real (para que entienda la diferencia). Español neutro con tuteo.`;

/**
 * El probador: TU entrada y lo que esperas, para la porción k. Pasa si la entrada recorre esa porción
 * (marcas en la copia, sin IA) y lo que esperabas coincide con lo que da al ejecutarla.
 */
export async function probarPorcion(root: string, rel: string, clave: string, k: number, entrada: string, espero: string): Promise<{ prueba: Prueba; porcion: Porcion; aprobadas: number; total: number }> {
  const c = await cargar(root, rel, clave);
  const p = leerPropuesta(root, rel, c.clave);
  if (!p?.porciones) throw new Error("no hay una propuesta por porciones para esta función (pídela con 📦 Como un PR)");
  const por = p.porciones[k];
  if (!por) throw new Error(`no existe la porción ${k + 1}`);
  if (makeZoner(root).config.programar.prediccionObligatoria && p.porciones.slice(0, k).some((x) => !x.aprobada)) throw new Error("prueba primero las porciones anteriores (una a la vez)");
  const e = validarExpresion(entrada, new Set([c.f.nombre]), c.lang.id);
  if (e) throw new Error(`la entrada tiene que ser una llamada a ${c.f.nombre}(…) con valores: ${e}`);
  if (!espero.trim()) throw new Error("escribe qué esperas ANTES de ejecutar");
  const { texto, marcas } = await copiaConFuncion(c, p.codigo, { desde: por.desde, hasta: por.hasta });
  const r = await ejecutarCopia(root, rel, c, texto, entrada);
  if (r.infra) throw new Error(`no se pudo ejecutar la copia: ${r.error ?? "sin detalle"}`);
  const requeridas = marcas.some((m) => m.rama) ? marcas.filter((m) => m.rama) : marcas;
  const toca = !requeridas.length || requeridas.some((m) => (r.marcas ?? []).includes(m.id));
  const acierto = toca && cumple(espero, r);
  const prueba: Prueba = { entrada, espero, obtenido: r.ok ? JSON.stringify(r.valor) : `error: ${r.error ?? ""}`, toca, acierto, fecha: new Date().toISOString() };
  if (toca && !acierto) {
    // Que entiendas la diferencia (no es un juez: el resultado ya lo dio la ejecución).
    try {
      const z = makeZoner(root);
      const lineas = p.codigo.split("\n");
      const { data } = await ask<{ texto: string }>({
        kind: "programar:diferencia",
        system: SYSTEM_DIFERENCIA,
        cwd: root,
        sinHerramientas: true,
        schema: { type: "object", additionalProperties: false, required: ["texto"], properties: { texto: { type: "string" } } },
        ...iaOpts(z.config, "chico"),
        sinRazonar: true,
        prompt: `Código:\n${lineas.map((l, i) => `${i + 1}| ${l}`).join("\n")}\n\nPorción ${k + 1} (líneas ${por.desde}-${por.hasta}).\nEntrada: ${entrada}\nEsperaba: ${espero}\nObtuvo: ${prueba.obtenido}`,
      });
      prueba.explicacion = data.texto.trim();
    } catch {
      /* sin explicación: igual ve el resultado real */
    }
  }
  // Se relee antes de guardar: si mientras tanto cambió la propuesta (otra propuesta), esta prueba ya no vale.
  return conCandado(archivoPropuesta(root, rel, c.clave), async () => {
    const actual = leerPropuesta(root, rel, c.clave);
    if (!actual?.porciones || actual.fecha !== p.fecha) throw new Error("la propuesta cambió mientras probabas: vuelve a mirarla");
    const pa = actual.porciones[k]!;
    pa.pruebas.push(prueba);
    if (prueba.toca && prueba.acierto) pa.aprobada = true;
    guardarPropuesta(root, actual);
    return { prueba, porcion: pa, aprobadas: actual.porciones.filter((x) => x.aprobada).length, total: actual.porciones.length };
  });
}

/**
 * La extensión insertó la propuesta (tu clic): queda registrado en la nota (cómo se probó), el paso del
 * plan se marca hecho, y lo no probado queda como deuda de comprensión.
 */
export async function registrarInsercion(root: string, rel: string, clave: string): Promise<NonNullable<Nota["programada"]>> {
  const p = leerPropuesta(root, rel, clave);
  if (!p) throw new Error("no hay una propuesta para esta función");
  const obligatoria = makeZoner(root).config.programar.prediccionObligatoria;
  if (p.porciones && obligatoria && p.porciones.some((x) => !x.aprobada)) throw new Error("faltan porciones por probar (la prueba es obligatoria en este proyecto: programar.prediccionObligatoria)");
  const pruebas = (p.porciones ?? []).flatMap((x) => x.pruebas);
  const reg: NonNullable<Nota["programada"]> = {
    fecha: new Date().toISOString(),
    tipo: p.tipo,
    porciones: p.porciones?.length ?? 1,
    pruebas: pruebas.length,
    aciertosPrimera: (p.porciones ?? []).filter((x) => x.pruebas.find((y) => y.toca)?.acierto).length,
    sinProbar: (p.porciones ?? []).filter((x) => !x.aprobada).length,
  };
  await conNota(root, rel, p.funcion, (n) => {
    n.programada = reg;
    if (p.tipo === "dirigido" && p.paso && n.plan?.pasos[p.paso - 1]) n.plan.pasos[p.paso - 1]!.hecho = true;
    if (p.tipo !== "dirigido" && n.plan) for (const x of n.plan.pasos) x.hecho = true;
    const detalle = p.tipo === "dirigido" ? `paso ${p.paso} dirigido por ti` : `${reg.porciones} porción(es), ${reg.pruebas} prueba(s) (${reg.aciertosPrimera} acertadas a la primera)${reg.sinProbar ? ` · ⚠ ${reg.sinProbar} sin probar (deuda de comprensión)` : ""}`;
    n.hilo.push(mensaje("ia", `**🧭 Insertado por ti** desde una propuesta${p.tipo === "adaptada" ? ` (tu versión de ${p.original?.proyecto})` : ""}: ${detalle}.`, { kind: "programar" }));
  });
  descartarPropuesta(root, rel, p.funcion);
  return reg;
}

/** Deuda de comprensión: lo insertado sin probar (si la prueba no era obligatoria). */
export function deudaComprension(root: string): { archivo: string; funcion: string; sinProbar: number }[] {
  const dir = path.join(dataDir(root), "notas");
  if (!fs.existsSync(dir)) return [];
  const out: { archivo: string; funcion: string; sinProbar: number }[] = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json")))
    try {
      for (const n of (JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as { notas: Nota[] }).notas ?? [])
        if (n.programada?.sinProbar && n.ancla.funcion) out.push({ archivo: n.archivo, funcion: n.ancla.funcion, sinProbar: n.programada.sinProbar });
    } catch {
      /* nota ilegible */
    }
  return out;
}

/**
 * Prueba diferida (al día siguiente): sobre la función ya insertada, con TU entrada y lo que esperas,
 * comparado ejecutando tu archivo real. Si aciertas, salda la deuda de comprensión de esa función.
 */
export async function probarDiferida(root: string, rel: string, clave: string, entrada: string, espero: string): Promise<{ acierto: boolean; obtenido: string }> {
  const c = await cargar(root, rel, clave);
  const e = validarExpresion(entrada, new Set([c.f.nombre]), c.lang.id);
  if (e) throw new Error(`la entrada tiene que ser una llamada a ${c.f.nombre}(…) con valores: ${e}`);
  const r = await ejecutarCopia(root, rel, c, c.src, entrada);
  if (r.infra) throw new Error(`no se pudo ejecutar: ${r.error ?? "sin detalle"}`);
  const acierto = cumple(espero, r);
  const obtenido = r.ok ? JSON.stringify(r.valor) : `error: ${r.error ?? ""}`;
  await conNota(root, rel, c.clave, (n) => {
    if (n.programada) {
      (n.programada as NonNullable<Nota["programada"]> & { diferida?: { fecha: string; acierto: boolean } }).diferida = { fecha: new Date().toISOString(), acierto };
      if (acierto) n.programada.sinProbar = 0;
    }
    n.hilo.push(mensaje("ia", `**🎯 Prueba diferida** · ${entrada} → esperabas ${espero}, da ${obtenido}: ${acierto ? "✓ coincide" : "✗ no coincide (mira por qué antes de seguir)"}`, { kind: "predecir" }));
  });
  return { acierto, obtenido };
}

/** Para `cai hoy`: una función insertada hace más de un día, sin prueba diferida todavía. */
export function pendienteDiferida(root: string): { archivo: string; funcion: string } | null {
  const dir = path.join(dataDir(root), "notas");
  if (!fs.existsSync(dir)) return null;
  const limite = Date.now() - 20 * 3600_000;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json")))
    try {
      for (const n of (JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as { notas: (Nota & { programada?: { diferida?: unknown } })[] }).notas ?? [])
        if (n.programada && !n.programada.diferida && Date.parse(n.programada.fecha) < limite && n.ancla.funcion) return { archivo: n.archivo, funcion: n.ancla.funcion };
    } catch {
      /* nota ilegible */
    }
  return null;
}

/** Medición: ¿sirve? (pruebas acertadas a la primera, deuda, funciones que luego modificaste tú). */
export function medicion(root: string): { funciones: number; pruebas: number; aciertosPrimera: number; porciones: number; sinProbar: number; diferidasAcertadas: number; diferidas: number } {
  const dir = path.join(dataDir(root), "notas");
  const m = { funciones: 0, pruebas: 0, aciertosPrimera: 0, porciones: 0, sinProbar: 0, diferidasAcertadas: 0, diferidas: 0 };
  if (!fs.existsSync(dir)) return m;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json")))
    try {
      for (const n of (JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as { notas: (Nota & { programada?: { diferida?: { acierto: boolean } } })[] }).notas ?? []) {
        const p = n.programada;
        if (!p) continue;
        m.funciones++;
        m.pruebas += p.pruebas;
        m.aciertosPrimera += p.aciertosPrimera;
        m.porciones += p.porciones;
        m.sinProbar += p.sinProbar;
        if (p.diferida) {
          m.diferidas++;
          if (p.diferida.acierto) m.diferidasAcertadas++;
        }
      }
    } catch {
      /* nota ilegible */
    }
  return m;
}
