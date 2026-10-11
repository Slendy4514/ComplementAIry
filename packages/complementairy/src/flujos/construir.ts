import { copiado, ordenValida, palabras, pedidoValido } from "../nucleo/especificidad.js";
import { makeZoner } from "../proyecto/config.js";
import { contextoComun } from "../proyecto/contexto.js";
import { proponerDecisiones } from "../proyecto/decisiones.js";
import { sinSoluciones } from "../nucleo/guard.js";
import { esPorHacer } from "../proyecto/indice.js";
import { sonLiterales } from "../nucleo/literales.js";
import { ask, iaOpts } from "../ia/llm.js";
import { modoEfectivo } from "../proyecto/modos.js";
import { mensaje } from "../proyecto/notas.js";
import { conCandado } from "../proyecto/ocupado.js";
import { validarExpresion } from "./predict.js";
import { CRITERIO, ESTILO, REUTILIZAR } from "../nucleo/prompts.js";
import { generarCasos } from "./tests.js";
import { agregarTareas } from "../proyecto/siguiente.js";
import { actualizarIndice } from "../proyecto/indice.js";
import {
  archivoPropuesta,
  cargar,
  conNota,
  copiaConFuncion,
  cumple,
  ejecutarCopia,
  esBorde,
  guardarPropuesta,
  leerPropuesta,
  objetivoDe,
  planFuncion,
  SYSTEM_DIFERENCIA,
  type CasoConstruir,
  type Oferta,
  type Porcion,
  type Propuesta,
} from "./programar.js";

/**
 * Construir juntos (modo programar): la idea primero, tu orden después, el código al final.
 *
 * Por cada paso del plan:
 * 1. La IA ofrece en PALABRAS cómo lo haría ("puedo hacerlo así…", y hasta 2 alternativas). Sin código.
 *    En programar · aprender, antes dices cómo lo harías tú y la IA comenta tu idea.
 * 2. Para que se escriba, das una ORDEN con tus palabras ("haz que…"). Sin IA se rechaza lo vago ("eso",
 *    "lo que dijiste", "la segunda", "dale"), lo que pide más de un paso ("y lo demás", "toda la función")
 *    y lo copiado de la propuesta: decides tú qué se escribe.
 * 3. La IA escribe SOLO eso: las líneas de ese paso, que van al final de lo ya escrito (lo anterior no se
 *    puede tocar). Si a tu orden le falta algo, lo dice en vez de completarlo.
 * 4. Pruebas con una entrada que recorre esas líneas (obligatorio en aprender) y sigues.
 * Al final, casos según la intención, tu predicción y la inserción (tu clic). Un caso que falla se arregla
 * con otra orden tuya (ajuste); uno que no tiene sentido se marca y lo decides tú.
 */

// --- La función por partes: cabecera (firma), cuerpo (los pasos) y cierre --------------------------

interface Base {
  cabecera: string[];
  cierre: string[];
  /** Indentación del cuerpo. */
  sangria: string;
}

/** Separa la firma, el cuerpo y el cierre de una función (sin IA). */
export function partesDeFuncion(codigo: string, langId: string): Base & { cuerpo: string[] } {
  const lineas = codigo.split("\n");
  const sangriaDe = (l: string) => l.match(/^\s*/)![0];
  if (langId === "python") {
    const i = lineas.findIndex((l) => /:\s*(#.*)?$/.test(l));
    if (i < 0) throw new Error("no encuentro dónde empieza el cuerpo de la función (la línea que termina en «:»)");
    const cuerpo = lineas.slice(i + 1);
    const primera = cuerpo.find((l) => l.trim());
    return { cabecera: lineas.slice(0, i + 1), cuerpo, cierre: [], sangria: primera ? sangriaDe(primera) : `${sangriaDe(lineas[0]!)}    ` };
  }
  const i = lineas.findIndex((l) => l.includes("{"));
  if (i < 0) throw new Error("la función necesita llaves { } para armarla por pasos (una flecha con expresión no tiene cuerpo)");
  const linea = lineas[i]!;
  const pos = linea.lastIndexOf("{");
  const base = `${sangriaDe(lineas[0]!)}  `;
  // Todo en una línea: "normalize(path) {}" o "f() { return 1; }".
  if (i === lineas.length - 1) {
    const cierreAt = linea.lastIndexOf("}");
    const dentro = cierreAt > pos ? linea.slice(pos + 1, cierreAt).trim() : "";
    return { cabecera: [linea.slice(0, pos + 1).trimEnd()], cuerpo: dentro ? [`${base}${dentro}`] : [], cierre: [`${sangriaDe(lineas[0]!)}${cierreAt > pos ? linea.slice(cierreAt) : "}"}`], sangria: base };
  }
  const ultima = lineas.length - 1;
  const cierre = lineas[ultima]!.trim().startsWith("}") ? [lineas[ultima]!] : [];
  const cuerpo = lineas.slice(i + 1, cierre.length ? ultima : undefined);
  const primera = cuerpo.find((l) => l.trim());
  return { cabecera: lineas.slice(0, i + 1), cuerpo, cierre, sangria: primera ? sangriaDe(primera) : base };
}

/** Re-indenta un bloque con la sangría del cuerpo (conserva la sangría relativa entre sus líneas). */
function reindentar(codigo: string, sangria: string): string[] {
  const lineas = codigo.replace(/^```\w*\n?|\n?```$/g, "").replace(/\s+$/, "").split("\n");
  const min = Math.min(...lineas.filter((l) => l.trim()).map((l) => l.match(/^\s*/)![0].length));
  return lineas.map((l) => (l.trim() ? `${sangria}${l.slice(Number.isFinite(min) ? min : 0)}` : ""));
}

/** Arma la función (cabecera + las líneas de cada porción + cierre) y calcula dónde queda cada porción. */
function armar(base: Base, porciones: Porcion[]): string {
  const lineas = [...base.cabecera];
  for (const p of porciones) {
    const cod = (p.codigo ?? "").split("\n");
    p.desde = lineas.length + 1;
    lineas.push(...cod);
    p.hasta = lineas.length;
  }
  lineas.push(...base.cierre);
  return lineas.join("\n");
}

// --- Tu orden: concreta, de un paso y con tus palabras (sin IA) --------------------------------------

export { ordenValida } from "../nucleo/especificidad.js";

// --- Trampas con los casos (sin IA) --------------------------------------------------------------------

/** Literales "no triviales" de una llamada o valor (textos de 3+ letras, números que no son 0/1/-1). */
function literalesDe(t: string): string[] {
  const out: string[] = [];
  for (const m of t.matchAll(/(["'])((?:\\.|(?!\1).){3,})\1/g)) out.push(m[0]);
  for (const m of t.matchAll(/(?<![\w.])-?\d+(?:\.\d+)?(?![\w.])/g)) if (!["0", "1", "-1"].includes(m[0])) out.push(m[0]);
  return out;
}

/**
 * Trampa típica, sin IA: el código compara contra el valor exacto de un caso o devuelve el esperado
 * literal en una rama dedicada. No cuenta si ese valor está en el objetivo, el comentario o el plan.
 */
export function trampas(codigo: string, casos: { llamada: string; esperado: string }[], consigna: string): string[] {
  const cuerpo = codigo.split("\n").slice(1).join("\n");
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const out: string[] = [];
  for (const c of casos) {
    const args = c.llamada.slice(c.llamada.indexOf("(") + 1, c.llamada.lastIndexOf(")"));
    for (const lit of literalesDe(args))
      if (!consigna.includes(lit) && new RegExp(`(===?|!==?|\\bis\\b|case)\\s*${esc(lit)}`).test(cuerpo)) out.push(`compara contra ${lit}, un valor exacto de tu caso ${c.llamada}`);
    if (!/^\s*error\b/i.test(c.esperado))
      for (const lit of literalesDe(c.esperado)) if (!consigna.includes(lit) && new RegExp(`return\\s+${esc(lit)}\\s*;?\\s*$`, "m").test(cuerpo)) out.push(`devuelve ${lit} tal cual, el resultado de tu caso ${c.llamada}`);
  }
  return [...new Set(out)];
}

// --- La propuesta en preparación -----------------------------------------------------------------------

type Cargado = Awaited<ReturnType<typeof cargar>>;
type Construir = Propuesta & { porciones: Porcion[]; construir: NonNullable<Propuesta["construir"]> & { base: Base } };

const ayudaDe = (root: string, rel: string, clave: string) => modoEfectivo(makeZoner(root).config, rel, clave).c;

function leerConstruir(root: string, rel: string, clave: string): Construir | null {
  const p = leerPropuesta(root, rel, clave);
  return p?.tipo === "construir" && p.porciones && p.construir?.base ? (p as Construir) : null;
}

function propuestaConstruir(root: string, rel: string, clave: string): Construir {
  const p = leerConstruir(root, rel, clave);
  if (!p) throw new Error("no hay una propuesta para construir esta función: empieza en el panel Nota (🧭 Construir juntos) o con: cai programar construir");
  return p;
}

/** Guarda un cambio sobre la propuesta, si sigue siendo la misma que se leyó. */
function conPropuesta<T>(root: string, rel: string, clave: string, fecha: string, fn: (p: Construir) => T): Promise<T> {
  return conCandado(archivoPropuesta(root, rel, clave), async () => {
    const p = propuestaConstruir(root, rel, clave);
    if (p.fecha !== fecha) throw new Error("la propuesta cambió mientras tanto: vuelve a mirarla");
    const r = fn(p);
    p.fecha = new Date().toISOString();
    guardarPropuesta(root, p);
    return r;
  });
}

/** El paso del plan que toca (1-based), o 0 si ya están todos. */
function pasoPendiente(p: Construir, total: number): number {
  const hechos = new Set(p.porciones.filter((x) => !x.tipo).map((x) => x.paso));
  for (let i = 1; i <= total; i++) if (!hechos.has(i)) return i;
  return 0;
}

/** Empieza la propuesta: la firma de tu función y, si ya tenía código tuyo, ese código como punto de partida. */
function nuevaPropuesta(c: Cargado, rel: string, ayuda: "sugerir" | "aprender", pasos: number): Construir {
  const { cuerpo, ...base } = partesDeFuncion(c.codigo, c.lang.id);
  const vacia = esPorHacer(c.codigo, c.lang.id) || !cuerpo.some((l) => l.trim());
  const porciones: Porcion[] = vacia ? [] : [{ desde: 0, hasta: 0, paso: 0, tipo: "ya-estaba", codigo: cuerpo.join("\n"), porque: "lo que ya tenías escrito", pruebas: [], aprobada: true, incluida: true }];
  const p = { tipo: "construir", archivo: rel, funcion: c.clave, fecha: new Date().toISOString(), costo: 0, codigo: "", porciones, construir: { ayuda, base, pasosPlan: pasos } } as Construir;
  p.codigo = armar(base, porciones);
  return p;
}

const planTexto = (c: Cargado, p?: Construir) =>
  c.nota?.plan ? `Plan:\n${c.nota.plan.pasos.map((x, i) => `${i + 1}. ${x.texto}${p?.porciones.some((y) => y.paso === i + 1 && !y.tipo) ? " (hecho)" : ""}`).join("\n")}` : "";

const ultimoPaso = (p: Construir) => [...p.porciones].reverse().find((x) => !x.tipo || x.tipo === "ajuste");

// --- 1. La IA ofrece cómo hacer los pasos (en palabras) y revisa lo que ya tenías ------------------

/** ¿El texto trae expresiones de código entre comillas invertidas (operadores, flechas, asignaciones)? Sin IA. */
export function conExpresiones(texto: string): boolean {
  return [...texto.matchAll(/`([^`]+)`/g)].some((m) => /(===?|!==?|<=|>=|&&|\|\||=>|\+\+|\s=\s|\)\s*[.{])/.test(m[1]!));
}

const SYSTEM_OFERTA = `Propones CÓMO hacer pasos de la función del programador, en palabras, para que él decida. Todavía NO escribes código: él te dará la orden de cada paso.
- Para cada paso pedido, en "ofertas": "idea" = cómo lo harías, en 1 a 3 oraciones concretas (qué se revisa, qué se usa, qué se devuelve); puedes nombrar funciones o APIs (piezas), pero sin código ni expresiones. "alternativas" = 0 a 2 formas DISTINTAS (otro enfoque, no un retoque), con cuándo conviene. "sobreTuIdea" = si el programador dijo cómo lo haría, en UNA oración si sirve y qué cuidar (sin imponer la tuya); "" si no.
- Cada paso, solo lo suyo: lo de los otros pasos va en su propia oferta.
- "previo": si te muestran código que el programador YA TENÍA, revísalo sin anclarte a él (contra el objetivo y el comentario): hasta 3 sugerencias o preguntas concretas en palabras (un caso sin cuidar, algo que conviene en otra función, un enfoque claramente mejor), cada una con su porqué. Vacío si está bien o si no hay código previo.
${ESTILO}

${REUTILIZAR}

${CRITERIO}`;

/** Los pasos del plan que faltan (1-based), en orden. */
function pasosPendientes(p: Construir, total: number): number[] {
  const hechos = new Set(p.porciones.filter((x) => !x.tipo).map((x) => x.paso));
  return Array.from({ length: total }, (_, i) => i + 1).filter((i) => !hechos.has(i));
}

const ofertaDe = (p: Construir, paso: number) => p.construir.ofertas?.find((x) => x.paso === paso);

/**
 * Lo que la IA ofrece para los pasos que faltan (todos a la vez; en aprender, solo el siguiente y después
 * de tu idea), u `otra` forma para un paso. Si no hay propuesta, la empieza (y si no hay plan, primero el
 * plan); si tu función ya tenía código, la IA lo revisa en la misma llamada (sugerencias que tú decides).
 */
export async function ofrecer(root: string, rel: string, clave: string, o: { otra?: number; ideaTuya?: string } = {}): Promise<Construir> {
  let c = await cargar(root, rel, clave);
  const comp = ayudaDe(root, rel, c.clave);
  if (!comp.proponerSolucion) throw new Error(`${c.f.nombre} no está en modo programar: cámbialo en el panel Nota (¿Quién escribe? → La IA) o con: cai modo programar --funcion ${rel}:${c.f.nombre}`);
  if (!c.nota?.plan) {
    await planFuncion(root, rel, c.clave);
    c = await cargar(root, rel, clave);
  }
  const pasos = c.nota!.plan!.pasos;
  let p = leerConstruir(root, rel, c.clave);
  if (!p) {
    p = nuevaPropuesta(c, rel, comp.ayuda, pasos.length);
    guardarPropuesta(root, p);
  }
  const pendientes = pasosPendientes(p, pasos.length);
  if (!pendientes.length) throw new Error("ya están todos los pasos del plan: sigue con los casos (🧪)");
  const ultima = ultimoPaso(p);
  if (comp.probarCadaPorcion && ultima && !ultima.aprobada) throw new Error("antes del paso siguiente, prueba el anterior: predice qué da con la entrada sugerida (▶ Probar)");
  // En aprender, de a uno (cada paso se prueba antes del siguiente) y con tu idea antes de ver la propuesta.
  const objetivo = o.otra ? [o.otra] : comp.decidirAntes ? [pendientes[0]!] : pendientes;
  if (o.otra && !pendientes.includes(o.otra)) throw new Error(`el paso ${o.otra} ya está escrito (o no existe): para cambiarlo, rehazlo con tu orden`);
  const ideaTuya = o.ideaTuya ?? (objetivo.length === 1 ? ofertaDe(p, objetivo[0]!)?.ideaTuya : undefined);
  if (comp.decidirAntes && !ideaTuya) throw new Error("primero di cómo harías este paso tú (antes de ver la propuesta)");
  const previo = p.porciones.find((x) => x.tipo === "ya-estaba");
  const revisarPrevio = !!previo && !p.construir.previo;
  const anteriores = o.otra ? [ofertaDe(p, o.otra)?.idea, ...(ofertaDe(p, o.otra)?.alternativas ?? [])].filter(Boolean) : [];
  const z = makeZoner(root);
  const pedir = (extra: string) =>
    ask<{ ofertas: { paso: number; idea: string; alternativas: string[]; sobreTuIdea: string }[]; previo: { texto: string; porque: string }[] }>({
      kind: o.otra ? "programar:otra" : "programar:oferta",
      ref: { archivo: rel, funcion: c.f.nombre },
      system: SYSTEM_OFERTA,
      cwd: root,
      sinHerramientas: true,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["ofertas", "previo"],
        properties: {
          ofertas: { type: "array", items: { type: "object", additionalProperties: false, required: ["paso", "idea", "alternativas", "sobreTuIdea"], properties: { paso: { type: "integer" }, idea: { type: "string" }, alternativas: { type: "array", maxItems: 2, items: { type: "string" } }, sobreTuIdea: { type: "string" } } } },
          previo: { type: "array", maxItems: 3, items: { type: "object", additionalProperties: false, required: ["texto", "porque"], properties: { texto: { type: "string" }, porque: { type: "string" } } } },
        },
      },
      ...iaOpts(z.config, "mediano"),
      prompt: [
        contextoComun(root, rel, { funcion: c.clave }),
        objetivoDe(c.nota),
        c.comentario ? `Comentario de la función (su especificación: respétalo):\n${c.comentario}` : "",
        planTexto(c, p),
        revisarPrevio ? `Código que el programador YA TENÍA en la función (revísalo en "previo"):\n${previo!.codigo}` : "",
        `Lo que ya está escrito:\n${p!.codigo}`,
        `Pasos para los que propones (uno por oferta): ${objetivo.map((k) => `${k}. ${pasos[k - 1]!.texto}`).join(" · ")}`,
        ideaTuya ? `Cómo lo haría el programador: ${ideaTuya}` : "",
        anteriores.length ? `Ya ofreciste esto para el paso ${o.otra} (propón OTRA forma, distinta):\n${anteriores.map((x) => `- ${x}`).join("\n")}` : "",
        extra,
      ]
        .filter(Boolean)
        .join("\n\n"),
    });
  let { data, costUsd } = await pedir("");
  // En palabras de verdad: si trae expresiones de código, se pide otra vez (una) sin ellas (lo decide un control sin IA).
  if (conExpresiones(data.ofertas.flatMap((x) => [x.idea, ...x.alternativas]).join(" "))) {
    const otra = await pedir("Tu propuesta anterior traía expresiones de código (comparaciones, llamadas armadas). Dila SOLO con palabras: el programador la va a decidir y la escribirá en su orden.");
    data = otra.data;
    costUsd += otra.costUsd;
  }
  const vacio = (t: string) => (/^["“”'`\s]*$/.test(t) ? "" : t.trim());
  const nuevas: Oferta[] = data.ofertas
    .filter((x) => objetivo.includes(x.paso))
    .map((x) => ({
      paso: x.paso,
      idea: sinSoluciones(x.idea.trim()),
      alternativas: x.alternativas.map((a) => sinSoluciones(a.trim())).filter(Boolean),
      ...(ideaTuya && objetivo.length === 1 ? { ideaTuya } : {}),
      // Solo si de verdad dijiste tu idea (si no, la IA a veces comenta el plan como si fuera tuyo).
      ...(ideaTuya && objetivo.length === 1 && vacio(x.sobreTuIdea) ? { sobreTuIdea: sinSoluciones(vacio(x.sobreTuIdea)) } : {}),
      fecha: new Date().toISOString(),
    }));
  if (!nuevas.length) throw new Error("la IA no propuso nada para esos pasos: vuelve a pedirlo");
  return conPropuesta(root, rel, c.clave, p.fecha, (q) => {
    const otras = (q.construir.ofertas ?? []).filter((x) => !nuevas.some((n) => n.paso === x.paso));
    q.construir.ofertas = [...otras, ...nuevas].sort((a, b) => a.paso - b.paso);
    delete q.construir.escritos;
    if (revisarPrevio) q.construir.previo = data.previo.map((x) => ({ texto: sinSoluciones(x.texto.trim()), porque: sinSoluciones(x.porque.trim()), estado: "pendiente" as const }));
    q.construir.pasosPlan = pasos.length;
    q.costo += costUsd;
    return q;
  });
}

/** Programar · aprender: ANTES de ver la propuesta dices cómo harías el paso; luego la IA ofrece (y comenta tu idea). */
export async function ideaPaso(root: string, rel: string, clave: string, texto: string): Promise<Construir> {
  if (palabras(texto).length < 3) throw new Error("di en una oración cómo harías este paso (aunque no estés seguro): así comparas con lo que propone la IA");
  return ofrecer(root, rel, clave, { ideaTuya: texto.trim() });
}

/** Una sugerencia sobre tu código previo: "Dejarlo así" (la cambias con tu orden en `ordenar(… { sugerencia })`). */
export async function dejarSugerencia(root: string, rel: string, clave: string, i: number): Promise<Construir> {
  const c = await cargar(root, rel, clave);
  const p = propuestaConstruir(root, rel, c.clave);
  if (!p.construir.previo?.[i]) throw new Error(`no existe la sugerencia ${i + 1} sobre tu código previo`);
  return conPropuesta(root, rel, c.clave, p.fecha, (q) => {
    q.construir.previo![i]!.estado = "dejado";
    return q;
  });
}

// --- 2. Tus órdenes → la IA escribe SOLO eso (y una IA chica lo verifica) ---------------------------

const SYSTEM_ORDEN = `El programador te da ÓRDENES para uno o más pasos SEGUIDOS de su función. Para cada paso escribes SOLO lo que dice su orden, como lo dice.
- No agregues NADA que la orden no diga (ni validaciones, casos, optimizaciones, comentarios, ni un detalle "útil" en un mensaje): si crees que falta, va en "falta".
- "pasos": uno por orden, en el mismo orden. "codigo": SOLO las líneas NUEVAS de ese paso; cada paso va después del anterior, al FINAL de lo ya escrito (no repitas ni cambies lo anterior), con la indentación del cuerpo.
- "fuera": "" salvo que una orden PIDA algo de otros pasos (entonces escribe solo lo de su paso y di qué quedó fuera). Que falten los otros pasos es normal: no lo digas.
- "entrada": una llamada a la función con valores literales que pase por las líneas de ese paso (para que el programador prediga qué da).
- "explicacion": una oración de qué hace lo que escribiste.
Código claro y mínimo, con sus nombres y su estilo. ${ESTILO}`;

const SYSTEM_AJUSTE = `El programador te da una ORDEN para ajustar su función. Cambias SOLO lo que dice la orden; todo lo demás queda IGUAL, línea por línea.
- No agregues nada que la orden no diga. Si a la orden le falta algo importante, NO lo completes: dilo en "falta".
- Nunca compares contra los valores exactos de un caso para que pase (eso no es una solución).
- "cuerpo": el cuerpo COMPLETO de la función ya ajustado (sin la firma ni la llave de cierre).
- "entrada": una llamada con valores literales que pase por lo que cambiaste. "explicacion": una oración de qué cambiaste.
${ESTILO}`;

const SYSTEM_FIEL = `Comparas la ORDEN que dio un programador para un paso con el código que se escribió para ese paso. NO juzgas si el código es bueno ni si la función está completa: solo si ese paso hace lo que dice la orden. Te muestran también lo que ya estaba escrito antes (contexto: lo que ya hace no cuenta como falta).
- "agregado": SOLO comportamientos que la orden no pidió: otra validación, otro caso especial, otro efecto o resultado. NO cuentan: la forma normal de hacer lo pedido, el texto exacto de un mensaje, los nombres, ni lo que la orden pide aunque sea con otras palabras ("que diga qué llegó" incluye mostrar el valor).
- "falta": SOLO lo que la orden pide claramente y el código no hace, contando lo que ya hace el código anterior.
- Ante la duda, no lo pongas. Cada punto, una frase corta. ${ESTILO}`;

/**
 * Verificador chico (Haiku), a ciegas: solo la orden y el código (sin las explicaciones de la IA que lo
 * escribió). No bloquea: avisa (Quitarlo / Dejarlo). Si no responde, el paso queda sin verificación.
 */
async function verificarFiel(root: string, rel: string, nombre: string, orden: string, codigo: string, antes: string): Promise<Porcion["verificacion"] | undefined> {
  try {
    const { data } = await ask<{ agregado: string[]; falta: string[] }>({
      kind: "programar:fiel",
      ref: { archivo: rel, funcion: nombre },
      system: SYSTEM_FIEL,
      cwd: root,
      sinHerramientas: true,
      sinRazonar: true,
      schema: { type: "object", additionalProperties: false, required: ["agregado", "falta"], properties: { agregado: { type: "array", maxItems: 4, items: { type: "string" } }, falta: { type: "array", maxItems: 4, items: { type: "string" } } } },
      ...iaOpts(makeZoner(root).config, "chico"),
      prompt: `${antes.trim() ? `Lo que ya estaba escrito antes de este paso:\n${antes}\n\n` : ""}Orden del programador para este paso: ${orden}\n\nCódigo escrito para esa orden:\n${codigo}`,
    });
    return { agregado: data.agregado.map((x) => x.trim()).filter(Boolean), falta: data.falta.map((x) => x.trim()).filter(Boolean) };
  } catch {
    return undefined;
  }
}

/** ¿La entrada recorre esas líneas? (marcas en una copia, sin IA). No se guarda el resultado: lo predices tú. */
async function recorre(root: string, rel: string, c: Cargado, codigo: string, por: { desde: number; hasta: number }, entrada: string, fallas: string[], cualquiera = false): Promise<boolean> {
  if (validarExpresion(entrada, new Set([c.f.nombre]), c.lang.id)) return false;
  const { texto, marcas } = await copiaConFuncion(c, codigo, { desde: por.desde, hasta: por.hasta });
  const r = await ejecutarCopia(root, rel, c, texto, entrada);
  if (r.infra) {
    fallas.push(r.error ?? "sin detalle");
    return false;
  }
  // Un paso: la entrada tiene que entrar en sus condiciones. Una función entera (pedido): basta con pasar por ella.
  const requeridas = !cualquiera && marcas.some((m) => m.rama) ? marcas.filter((m) => m.rama) : marcas;
  return !requeridas.length || requeridas.some((m) => (r.marcas ?? []).includes(m.id));
}

/** A qué línea vieja corresponde cada línea nueva (por contenido; subsecuencia común más larga). */
function emparejar(viejo: string[], nuevo: string[]): (number | null)[] {
  const a = viejo.map((l) => l.trim());
  const b = nuevo.map((l) => l.trim());
  const m = Array.from({ length: a.length + 1 }, () => Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) m[i]![j] = a[i] === b[j] ? m[i + 1]![j + 1]! + 1 : Math.max(m[i + 1]![j]!, m[i]![j + 1]!);
  const out: (number | null)[] = Array(b.length).fill(null);
  for (let i = 0, j = 0; i < a.length && j < b.length; )
    if (a[i] === b[j]) out[j++] = i++;
    else if (m[i + 1]![j]! >= m[i]![j + 1]!) i++;
    else j++;
  return out;
}

/** Reparte el cuerpo ajustado: cada línea igual sigue en su porción; lo nuevo o cambiado, en la porción del ajuste. */
function repartirAjuste(anteriores: Porcion[], nuevo: string[], orden: string): Porcion[] {
  const viejas = anteriores.flatMap((x, i) => (x.codigo ?? "").split("\n").map((l) => ({ l, i })));
  const par = emparejar(
    viejas.map((x) => x.l),
    nuevo,
  );
  const grupos: { de: number; lineas: string[] }[] = []; // de = índice de la porción vieja, o -1 = ajuste
  nuevo.forEach((l, j) => {
    const de = par[j] !== null ? viejas[par[j]!]!.i : -1;
    const ult = grupos[grupos.length - 1];
    if (ult && ult.de === de) ult.lineas.push(l);
    else grupos.push({ de, lineas: [l] });
  });
  return grupos.map((g) =>
    g.de >= 0
      ? { ...anteriores[g.de]!, codigo: g.lineas.join("\n") }
      : { desde: 0, hasta: 0, paso: 0, tipo: "ajuste" as const, codigo: g.lineas.join("\n"), porque: "", orden, pruebas: [], aprobada: false, incluida: true },
  );
}

/** Lo que se hace al final de toda escritura: armar, comprobar entradas, verificar (IA chica), trampas y guardar. */
async function terminarEscritura(
  root: string,
  rel: string,
  c: Cargado,
  p: Construir,
  porciones: Porcion[],
  nuevas: Porcion[],
  datos: Map<Porcion, { entrada: string; falta: string; explicacion: string }>,
  costo: number,
  cambios: (q: Construir) => void,
): Promise<Construir> {
  const codigo = armar(p.construir.base, porciones);
  const fallas: string[] = [];
  for (const x of nuevas) {
    const d = datos.get(x);
    if (d?.entrada && (await recorre(root, rel, c, codigo, x, d.entrada, fallas, p.construir.forma === "pedido"))) x.entrada = d.entrada;
    if (d?.falta) x.falta = d.falta;
    if (d?.explicacion) x.explicacion = d.explicacion;
    // A ciegas: solo tu orden y el código de ese paso.
    if (x.orden) {
      const antes = porciones.slice(0, porciones.indexOf(x)).map((y) => y.codigo ?? "").join("\n");
      const v = await verificarFiel(root, rel, c.f.nombre, x.orden, x.codigo ?? "", antes);
      if (v) x.verificacion = v;
      else delete x.verificacion;
    }
  }
  const pasos = c.nota?.plan?.pasos ?? [];
  const casos = (p.construir.casos ?? []).filter((x) => !x.raro && x.esperado !== "?");
  const t = trampas(codigo, casos, `${objetivoDe(c.nota)} ${c.comentario} ${pasos.map((x) => x.texto).join(" ")}`);
  return conPropuesta(root, rel, c.clave, p.fecha, (q) => {
    q.porciones = porciones;
    q.codigo = codigo;
    q.costo += costo;
    cambios(q);
    if (t.length) q.construir.trampas = t;
    else delete q.construir.trampas;
    // Cambió el borrador: los casos se vuelven a probar y la predicción se hace de nuevo.
    if (q.construir.casos) q.construir.casos = q.construir.casos.map((x) => ({ ...x, obtenido: undefined, pasa: undefined }) as CasoConstruir);
    if (q.construir.prediccion) q.construir.prediccion = { llamada: q.construir.prediccion.llamada };
    if (fallas.length) q.explicacion = `No pude ejecutar tu archivo para comprobar la entrada sugerida (${fallas[0]!.slice(0, 160)}): en JS/TS con import/export hace falta tsx en el proyecto (cai doctor --instalar).`;
    else delete q.explicacion;
    return q;
  });
}

/**
 * Tus órdenes para uno o más pasos SEGUIDOS (desde el primero que falta; uno vacío = lo ves después).
 * La IA escribe solo lo de cada orden, en una sola llamada; luego la IA chica verifica cada paso.
 */
export async function ordenarPasos(root: string, rel: string, clave: string, ordenes: { paso: number; texto: string }[]): Promise<Construir> {
  const c = await cargar(root, rel, clave);
  const p = propuestaConstruir(root, rel, c.clave);
  const pasos = c.nota?.plan?.pasos ?? [];
  const lista = ordenes.filter((x) => x.texto.trim()).sort((a, b) => a.paso - b.paso);
  if (!lista.length) throw new Error("escribe tu orden de al menos un paso");
  const pendientes = pasosPendientes(p, pasos.length);
  // De corrido: desde el primero que falta, sin saltarse ninguno (los demás quedan para después).
  lista.forEach((x, i) => {
    if (x.paso !== pendientes[i]) throw new Error(pendientes[i] ? `de corrido: falta tu orden del paso ${pendientes[i]} (puedes dejar en blanco los de después, no los de antes)` : `el paso ${x.paso} ya está escrito`);
    const of = ofertaDe(p, x.paso);
    if (!of) throw new Error(`primero mira lo que propone la IA para el paso ${x.paso} (💬), y luego da tu orden`);
    const err = ordenValida(x.texto, [of.idea, ...of.alternativas]);
    if (err) throw new Error(lista.length > 1 ? `paso ${x.paso}: ${err}` : err);
  });
  if (ayudaDe(root, rel, c.clave).probarCadaPorcion && lista.length > 1) throw new Error("en programar · aprender, de a un paso (cada uno se prueba antes del siguiente)");
  // Lo nuevo va al final: si lo escrito ya termina en return/throw, quedaría sin ejecutarse (sin IA).
  const ultimaLinea = [...p.porciones].reverse().flatMap((x) => (x.codigo ?? "").split("\n").reverse()).find((l) => l.trim());
  if (ultimaLinea && /^\s*(return|throw|raise)\b/.test(ultimaLinea))
    throw new Error(
      p.porciones[p.porciones.length - 1]?.tipo === "ya-estaba"
        ? "lo que ya tenías termina con un return: lo nuevo quedaría después y no se ejecutaría. Decide primero qué hacer con ese código (🔎 cambiarlo con tu orden, o 🗑 reemplazarlo con los pasos)"
        : "lo escrito ya termina con un return o un error: lo nuevo no se ejecutaría. Rehaz o deshaz el último paso",
    );
  const z = makeZoner(root);
  const { data, costUsd } = await ask<{ pasos: { paso: number; codigo: string; falta: string; fuera: string; entrada: string; explicacion: string }[] }>({
    kind: "programar:orden",
    ref: { archivo: rel, funcion: c.f.nombre },
    system: SYSTEM_ORDEN,
    cwd: root,
    sinHerramientas: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["pasos"],
      properties: { pasos: { type: "array", items: { type: "object", additionalProperties: false, required: ["paso", "codigo", "falta", "fuera", "entrada", "explicacion"], properties: { paso: { type: "integer" }, codigo: { type: "string" }, falta: { type: "string" }, fuera: { type: "string" }, entrada: { type: "string" }, explicacion: { type: "string" } } } } },
    },
    ...iaOpts(z.config, "mediano"),
    prompt: [
      contextoComun(root, rel, { funcion: c.clave, corto: true }),
      objetivoDe(c.nota),
      c.comentario ? `Comentario de la función (su especificación):\n${c.comentario}` : "",
      planTexto(c, p),
      `Lo que ya está escrito (no lo cambies; lo nuevo va al final del cuerpo, antes del cierre):\n${p.codigo}`,
      `Órdenes del programador:\n${lista.map((x) => `Paso ${x.paso} (${pasos[x.paso - 1]?.texto ?? ""}): ${x.texto.trim()}`).join("\n")}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
  });
  const porciones = p.porciones.map((x) => ({ ...x }));
  const nuevas: Porcion[] = [];
  const datos = new Map<Porcion, { entrada: string; falta: string; explicacion: string }>();
  for (const x of lista) {
    const d = data.pasos.find((y) => y.paso === x.paso);
    const lineas = d ? reindentar(d.codigo, p.construir.base.sangria) : [];
    if (!lineas.some((l) => l.trim())) throw new Error(`paso ${x.paso}: no escribí nada${d && (d.falta.trim() || d.fuera.trim()) ? ` (${[d.falta.trim(), d.fuera.trim()].filter(Boolean).join(" · ")})` : ""}: dilo de otra forma`);
    // Un paso es una idea: si sale enorme, es más de un paso (sin IA).
    if (lineas.length > 30) throw new Error(`el paso ${x.paso} salió de ${lineas.length} líneas: es más de una idea. Pide una parte, o divide el paso en el plan`);
    const of = ofertaDe(p, x.paso)!;
    const nueva: Porcion = { desde: 0, hasta: 0, paso: x.paso, codigo: lineas.join("\n"), porque: of.idea, orden: x.texto.trim(), oferta: of, ...(of.ideaTuya ? { idea: of.ideaTuya } : {}), pruebas: [], aprobada: false, incluida: true };
    porciones.push(nueva);
    nuevas.push(nueva);
    datos.set(nueva, { entrada: d!.entrada.trim(), falta: [d!.falta.trim(), d!.fuera.trim() ? `quedó fuera (otro paso): ${d!.fuera.trim()}` : ""].filter(Boolean).join(" · "), explicacion: d!.explicacion.trim() });
  }
  const q = await terminarEscritura(root, rel, c, p, porciones, nuevas, datos, costUsd, (q) => {
    q.construir.ofertas = (q.construir.ofertas ?? []).filter((o) => !lista.some((x) => x.paso === o.paso));
    q.construir.escritos = lista.map((x) => x.paso);
  });
  await conNota(root, rel, c.clave, (n) => n.hilo.push(mensaje("tu", lista.map((x) => `🧭 Paso ${x.paso}: «${x.texto.trim()}»`).join("\n"), { kind: "programar" })));
  return q;
}

/**
 * Tu orden: para el paso que toca (atajo de `ordenarPasos`), para REHACER el último paso ("no es lo que
 * dije"), o un AJUSTE de la función (cuando están todos los pasos, para que cumpla un caso, o sobre tu
 * código previo por una sugerencia de la IA: `sugerencia`).
 */
export async function ordenar(root: string, rel: string, clave: string, texto: string, o: { rehacer?: boolean; ajuste?: boolean; sugerencia?: number } = {}): Promise<Construir> {
  const c = await cargar(root, rel, clave);
  const p = propuestaConstruir(root, rel, c.clave);
  const pasos = c.nota?.plan?.pasos ?? [];
  const rehecha = o.rehacer ? ultimoPaso(p) : undefined;
  if (o.rehacer && !rehecha) throw new Error("todavía no hay un paso escrito para rehacer");
  const pendientes = pasosPendientes(p, pasos.length);
  const ajuste = o.ajuste || o.sugerencia !== undefined || (rehecha ? rehecha.tipo === "ajuste" : !pendientes.length);
  if (!ajuste && !rehecha) return ordenarPasos(root, rel, clave, [{ paso: pendientes[0]!, texto }]);
  if (o.sugerencia !== undefined && !p.construir.previo?.[o.sugerencia]) throw new Error(`no existe la sugerencia ${o.sugerencia + 1} sobre tu código previo`);
  const oferta = rehecha?.oferta;
  const err = ordenValida(texto, oferta ? [oferta.idea, ...oferta.alternativas] : o.sugerencia !== undefined ? [p.construir.previo![o.sugerencia]!.texto] : []);
  if (err) throw new Error(err);
  const base = p.construir.base;
  const anteriores = p.porciones.filter((x) => x !== rehecha).map((x) => ({ ...x }));
  const borrador = armar(base, anteriores.map((x) => ({ ...x })));
  const casos = (p.construir.casos ?? []).filter((x) => !x.raro && x.esperado !== "?");
  const comunes = [contextoComun(root, rel, { funcion: c.clave, corto: true }), objetivoDe(c.nota), c.comentario ? `Comentario de la función (su especificación):\n${c.comentario}` : "", planTexto(c, p)];
  const z = makeZoner(root);
  let porciones: Porcion[];
  let nuevas: Porcion[];
  const datos = new Map<Porcion, { entrada: string; falta: string; explicacion: string }>();
  let costo: number;
  if (ajuste && !rehecha) {
    const sug = o.sugerencia !== undefined ? p.construir.previo![o.sugerencia]! : undefined;
    const { data, costUsd } = await ask<{ cuerpo: string; falta: string; entrada: string; explicacion: string }>({
      kind: "programar:ajuste",
      ref: { archivo: rel, funcion: c.f.nombre },
      system: SYSTEM_AJUSTE,
      cwd: root,
      sinHerramientas: true,
      schema: { type: "object", additionalProperties: false, required: ["cuerpo", "falta", "entrada", "explicacion"], properties: { cuerpo: { type: "string" }, falta: { type: "string" }, entrada: { type: "string" }, explicacion: { type: "string" } } },
      ...iaOpts(z.config, "mediano"),
      prompt: [
        ...comunes,
        casos.length ? `Casos:\n${casos.map((x) => `- ${x.llamada} → ${x.esperado}${x.pasa === false ? ` (hoy da ${x.obtenido ?? "?"})` : ""}`).join("\n")}` : "",
        sug ? `Sugerencia sobre su código previo que el programador decidió atender: ${sug.texto}` : "",
        `Función como está:\n${borrador}`,
        `Orden del programador: ${texto.trim()}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    });
    costo = costUsd;
    const cuerpo = data.cuerpo.trim() ? reindentar(data.cuerpo, base.sangria) : [];
    porciones = repartirAjuste(anteriores, cuerpo, texto.trim());
    nuevas = porciones.filter((x) => x.tipo === "ajuste");
    // Un ajuste que solo quita líneas también vale; lo que no vale es que no cambie nada.
    if (cuerpo.join("\n") === anteriores.map((x) => x.codigo ?? "").join("\n")) throw new Error(data.falta.trim() ? `no cambié nada: ${data.falta.trim()}` : "la IA no cambió nada con esa orden: dila de otra forma");
    for (const x of nuevas) datos.set(x, { entrada: data.entrada.trim(), falta: data.falta.trim(), explicacion: data.explicacion.trim() });
  } else {
    // Rehacer el último paso con tu nueva orden (lo anterior no se toca).
    const { data, costUsd } = await ask<{ pasos: { paso: number; codigo: string; falta: string; fuera: string; entrada: string; explicacion: string }[] }>({
      kind: "programar:orden",
      ref: { archivo: rel, funcion: c.f.nombre },
      system: SYSTEM_ORDEN,
      cwd: root,
      sinHerramientas: true,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["pasos"],
        properties: { pasos: { type: "array", items: { type: "object", additionalProperties: false, required: ["paso", "codigo", "falta", "fuera", "entrada", "explicacion"], properties: { paso: { type: "integer" }, codigo: { type: "string" }, falta: { type: "string" }, fuera: { type: "string" }, entrada: { type: "string" }, explicacion: { type: "string" } } } } },
      },
      ...iaOpts(z.config, "mediano"),
      prompt: [...comunes, `Lo que ya está escrito (no lo cambies; lo nuevo va al final del cuerpo, antes del cierre):\n${borrador}`, `Órdenes del programador:\nPaso ${rehecha!.paso} (${pasos[rehecha!.paso - 1]?.texto ?? ""}): ${texto.trim()}`].join("\n\n"),
    });
    costo = costUsd;
    const d = data.pasos[0];
    const lineas = d ? reindentar(d.codigo, base.sangria) : [];
    if (!lineas.some((l) => l.trim())) throw new Error(d && (d.falta.trim() || d.fuera.trim()) ? `no escribí nada: ${[d.falta.trim(), d.fuera.trim()].filter(Boolean).join(" · ")}` : "la IA no escribió nada con esa orden: dila de otra forma");
    if (lineas.length > 30) throw new Error(`eso salió de ${lineas.length} líneas: es más de un paso. Pide una parte, o divide el paso en el plan`);
    const nueva: Porcion = { desde: 0, hasta: 0, paso: rehecha!.paso, codigo: lineas.join("\n"), porque: oferta?.idea ?? rehecha!.porque, orden: texto.trim(), ...(oferta ? { oferta } : {}), ...(rehecha!.idea ? { idea: rehecha!.idea } : {}), pruebas: [], aprobada: false, incluida: true };
    porciones = [...anteriores, nueva];
    nuevas = [nueva];
    datos.set(nueva, { entrada: d!.entrada.trim(), falta: [d!.falta.trim(), d!.fuera.trim() ? `quedó fuera (otro paso): ${d!.fuera.trim()}` : ""].filter(Boolean).join(" · "), explicacion: d!.explicacion.trim() });
  }
  const q = await terminarEscritura(root, rel, c, p, porciones, nuevas, datos, costo, (q) => {
    if (o.sugerencia !== undefined && q.construir.previo?.[o.sugerencia]) q.construir.previo[o.sugerencia]!.estado = "aplicado";
    q.construir.escritos = [ajuste ? 0 : rehecha!.paso];
  });
  await conNota(root, rel, c.clave, (n) => n.hilo.push(mensaje("tu", `🧭 ${ajuste ? "Ajuste" : `Paso ${rehecha!.paso} (rehecho)`}: «${texto.trim()}»`, { kind: "programar" })));
  return q;
}

/** El verificador chico avisó que un paso agregó algo que tu orden no pedía: quitarlo (solo eso) o dejarlo. */
export async function resolverAgregado(root: string, rel: string, clave: string, k: number, accion: "quitar" | "dejar"): Promise<Construir> {
  const c = await cargar(root, rel, clave);
  const p = propuestaConstruir(root, rel, c.clave);
  const x = p.porciones[k];
  if (!x?.verificacion?.agregado.length) throw new Error("ese paso no tiene nada agregado que resolver");
  if (accion === "dejar")
    return conPropuesta(root, rel, c.clave, p.fecha, (q) => {
      q.porciones[k]!.verificacion = { ...q.porciones[k]!.verificacion!, dejado: true };
      return q;
    });
  // Quitar SOLO lo agregado (sigue siendo tu orden: se acerca a lo que dijiste, no agrega nada).
  const z = makeZoner(root);
  const { data, costUsd } = await ask<{ codigo: string }>({
    kind: "programar:quitar",
    ref: { archivo: rel, funcion: c.f.nombre },
    system: `Quitas de unas líneas de código SOLO lo que se indica (cosas que la orden del programador no pidió), sin cambiar nada más. Devuelves las líneas resultantes en "codigo", con la misma indentación. ${ESTILO}`,
    cwd: root,
    sinHerramientas: true,
    schema: { type: "object", additionalProperties: false, required: ["codigo"], properties: { codigo: { type: "string" } } },
    ...iaOpts(z.config, "mediano"),
    prompt: `Orden del programador: ${x.orden ?? ""}\n\nLíneas:\n${x.codigo ?? ""}\n\nQuita esto (no lo pidió):\n${x.verificacion.agregado.map((a) => `- ${a}`).join("\n")}`,
  });
  const lineas = reindentar(data.codigo, p.construir.base.sangria);
  if (!lineas.some((l) => l.trim())) throw new Error("al quitarlo no quedó nada: rehaz el paso con tu orden");
  const porciones = p.porciones.map((y) => ({ ...y }));
  const nueva = { ...porciones[k]!, codigo: lineas.join("\n"), pruebas: [], aprobada: false };
  porciones[k] = nueva;
  return terminarEscritura(root, rel, c, p, porciones, [nueva], new Map([[nueva, { entrada: x.entrada ?? "", falta: x.falta ?? "", explicacion: x.explicacion ?? "" }]]), costUsd, (q) => {
    q.construir.escritos = [x.tipo ? 0 : x.paso];
  });
}

/**
 * Reemplazar tu código previo con los pasos: sale del borrador (en tu archivo sigue igual hasta que
 * insertes). Sin IA.
 */
export async function quitarPrevio(root: string, rel: string, clave: string): Promise<Construir> {
  const c = await cargar(root, rel, clave);
  const p = propuestaConstruir(root, rel, c.clave);
  if (!p.porciones.some((x) => x.tipo === "ya-estaba")) throw new Error("el borrador no tiene código previo tuyo");
  return conPropuesta(root, rel, c.clave, p.fecha, (q) => {
    q.porciones = q.porciones.filter((x) => x.tipo !== "ya-estaba");
    q.codigo = armar(q.construir.base, q.porciones);
    for (const x of q.construir.previo ?? []) if (x.estado === "pendiente") x.estado = "aplicado";
    return q;
  });
}

/** Quita el último paso escrito (su propuesta en palabras vuelve a quedar a la vista). */
export async function deshacer(root: string, rel: string, clave: string): Promise<Construir> {
  const c = await cargar(root, rel, clave);
  const p = propuestaConstruir(root, rel, c.clave);
  const ultima = ultimoPaso(p);
  if (!ultima) throw new Error("no hay pasos escritos para deshacer");
  const i = p.porciones.lastIndexOf(ultima);
  return conPropuesta(root, rel, c.clave, p.fecha, (q) => {
    const [quitada] = q.porciones.splice(i, 1);
    q.codigo = armar(q.construir.base, q.porciones);
    if (quitada?.oferta && !quitada.tipo) q.construir.ofertas = [...(q.construir.ofertas ?? []).filter((x) => x.paso !== quitada.oferta!.paso), quitada.oferta].sort((a, b) => a.paso - b.paso);
    delete q.construir.escritos;
    if (q.construir.casos) q.construir.casos = q.construir.casos.map((x) => ({ ...x, obtenido: undefined, pasa: undefined }) as CasoConstruir);
    if (q.construir.prediccion) q.construir.prediccion = { llamada: q.construir.prediccion.llamada };
    return q;
  });
}

// --- Por pedidos (modo programar): la función entera con lo que pides; si es mucho, separarla -----------

export { pedidoValido } from "../nucleo/especificidad.js";

const SYSTEM_PEDIDO = (max: number) => `El programador te pide, con sus palabras, qué debe hacer su función (o un cambio en ella). Escribes SOLO lo que pide, como lo pide.
- "cuerpo": el cuerpo COMPLETO de la función (sin la firma ni la llave de cierre), con la indentación del cuerpo. Lo que ya estaba y el pedido no toca queda IGUAL, línea por línea.
- No agregues NADA que el pedido no diga (validaciones, casos, mensajes extra): si crees que falta algo importante, NO lo completes: dilo en "falta".
- Si lo pedido es demasiado para UNA función (varias responsabilidades distintas, o saldría de más de ~${max} líneas), NO la escribas: deja "cuerpo" vacío, en "separar" propone 2 a 4 funciones auxiliares (nombre, firma con sus parámetros, qué hace cada una) y en "motivo" por qué. La principal después las usará. Solo si de verdad conviene; si el programador pide hacerla en una sola, no separes.
- Usa las funciones que ya existen en el archivo (mira el mapa), sobre todo las auxiliares ⬜ que el programador creó para esto.
- "entrada": una llamada con valores literales que pase por lo que escribiste o cambiaste (para que el programador prediga qué da). "explicacion": una oración de qué hace.
- Nunca compares contra los valores exactos de un caso para que pase.
Código claro y mínimo, con sus nombres y su estilo. ${ESTILO}

${REUTILIZAR}`;

type Separar = NonNullable<NonNullable<Propuesta["construir"]>["separar"]>;

/**
 * Lo que la IA ofrece en palabras para la función entera (opcional, antes de tu pedido) y, si ya tenía
 * código tuyo, su revisión sin anclarse.
 */
export async function ofrecerTodo(root: string, rel: string, clave: string): Promise<Construir> {
  const c = await cargar(root, rel, clave);
  const comp = ayudaDe(root, rel, c.clave);
  if (!comp.proponerSolucion) throw new Error(`${c.f.nombre} no está en modo programar: cámbialo en el panel Nota (¿Quién escribe? → La IA)`);
  let p = leerConstruir(root, rel, c.clave);
  if (!p) {
    p = { ...nuevaPropuesta(c, rel, comp.ayuda, 0) };
    p.construir.forma = "pedido";
    guardarPropuesta(root, p);
  }
  const previo = p.porciones.find((x) => x.tipo === "ya-estaba");
  const z = makeZoner(root);
  const pedirle = (extra: string) =>
    ask<{ idea: string; alternativas: string[]; previo: { texto: string; porque: string }[] }>({
      kind: "programar:oferta",
      ref: { archivo: rel, funcion: c.f.nombre },
      system: `Propones CÓMO harías la función del programador, en palabras, para que él decida qué pedir. Sin código ni expresiones (puedes nombrar funciones o APIs). "idea": 2 a 4 oraciones concretas (qué recibe, qué revisa, qué devuelve; si conviene separar algo en otra función, dilo). "alternativas": 0 a 2 enfoques distintos con cuándo convienen. "previo": si te muestran código que el programador YA TENÍA, hasta 3 sugerencias o preguntas sin anclarte a él, con su porqué; vacío si no hay o está bien. ${ESTILO}\n\n${REUTILIZAR}\n\n${CRITERIO}`,
      cwd: root,
      sinHerramientas: true,
      schema: { type: "object", additionalProperties: false, required: ["idea", "alternativas", "previo"], properties: { idea: { type: "string" }, alternativas: { type: "array", maxItems: 2, items: { type: "string" } }, previo: { type: "array", maxItems: 3, items: { type: "object", additionalProperties: false, required: ["texto", "porque"], properties: { texto: { type: "string" }, porque: { type: "string" } } } } } },
      ...iaOpts(z.config, "mediano"),
      prompt: [contextoComun(root, rel, { funcion: c.clave }), objetivoDe(c.nota), c.comentario ? `Comentario de la función (su especificación):\n${c.comentario}` : "", previo && !p!.construir.previo ? `Código que el programador YA TENÍA:\n${previo.codigo}` : "", `Función como está:\n${p!.codigo}`, extra].filter(Boolean).join("\n\n"),
    });
  let { data, costUsd } = await pedirle("");
  if (conExpresiones([data.idea, ...data.alternativas].join(" "))) {
    const otra = await pedirle("Tu propuesta anterior traía expresiones de código. Dila SOLO con palabras.");
    data = otra.data;
    costUsd += otra.costUsd;
  }
  return conPropuesta(root, rel, c.clave, p.fecha, (q) => {
    q.construir.forma = "pedido";
    q.construir.ofertas = [{ paso: 0, idea: sinSoluciones(data.idea.trim()), alternativas: data.alternativas.map((x) => sinSoluciones(x.trim())).filter(Boolean), fecha: new Date().toISOString() }];
    if (previo && !q.construir.previo) q.construir.previo = data.previo.map((x) => ({ texto: sinSoluciones(x.texto.trim()), porque: sinSoluciones(x.porque.trim()), estado: "pendiente" as const }));
    q.costo += costUsd;
    return q;
  });
}

/**
 * Tu pedido: la IA escribe la función entera (o el cambio que pides) con SOLO eso. Si es demasiado para una
 * función, en vez de escribirla propone separarla (`separar`: qué auxiliares crear). `una`: hacerla igual en
 * una sola. `forzarSeparar`: pedirle cómo la separaría (p. ej. porque salió muy larga).
 */
export async function pedir(root: string, rel: string, clave: string, texto: string, o: { una?: boolean; forzarSeparar?: boolean; ideal?: boolean } = {}): Promise<Construir> {
  const c = await cargar(root, rel, clave);
  const comp = ayudaDe(root, rel, c.clave);
  if (!comp.proponerSolucion) throw new Error(`${c.f.nombre} no está en modo programar: cámbialo en el panel Nota (¿Quién escribe? → La IA)`);
  let p = leerConstruir(root, rel, c.clave);
  if (!p) {
    p = nuevaPropuesta(c, rel, comp.ayuda, 0);
    p.construir.forma = "pedido";
    guardarPropuesta(root, p);
  }
  if (!o.forzarSeparar) {
    const aud = p.construir.auditoria;
    const ofrecido = [...(p.construir.ofertas ?? []).flatMap((x) => [x.idea, ...x.alternativas]), ...(p.construir.previo ?? []).map((x) => x.texto), ...(p.construir.separar?.auxiliares ?? []).map((x) => x.proposito), ...(aud ? [aud.ideal?.descripcion ?? "", ...(aud.queHacer ?? []), ...aud.hallazgos.map((x) => x.texto)] : [])];
    const err = pedidoValido(texto, ofrecido);
    if (err) throw new Error(err);
  }
  const z = makeZoner(root);
  const max = z.config.practicas.maxLineasFuncion ?? 40;
  const casos = (p.construir.casos ?? []).filter((x) => !x.raro && x.esperado !== "?");
  const { data, costUsd } = await ask<{ cuerpo: string; falta: string; entrada: string; explicacion: string; separar: { nombre: string; firma: string; proposito: string }[]; motivo: string }>({
    kind: o.forzarSeparar ? "programar:separar" : "programar:pedido",
    ref: { archivo: rel, funcion: c.f.nombre },
    system: SYSTEM_PEDIDO(max),
    cwd: root,
    sinHerramientas: true,
    // El ida y vuelta, con la IA chica por defecto (rápido); al final audita la mediana.
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["cuerpo", "falta", "entrada", "explicacion", "separar", "motivo"],
      properties: {
        cuerpo: { type: "string" },
        falta: { type: "string" },
        entrada: { type: "string" },
        explicacion: { type: "string" },
        separar: { type: "array", maxItems: 4, items: { type: "object", additionalProperties: false, required: ["nombre", "firma", "proposito"], properties: { nombre: { type: "string" }, firma: { type: "string" }, proposito: { type: "string" } } } },
        motivo: { type: "string" },
      },
    },
    // Tomar algo de la versión ideal lo hace la misma IA que la propuso (mediana); lo demás, la chica.
    ...iaOpts(z.config, o.ideal ? z.config.programar.modeloAuditoria : z.config.programar.modeloPedidos),
    prompt: [
      contextoComun(root, rel, { funcion: c.clave }),
      objetivoDe(c.nota),
      c.comentario ? `Comentario de la función (su especificación):\n${c.comentario}` : "",
      casos.length ? `Casos:\n${casos.map((x) => `- ${x.llamada} → ${x.esperado}${x.pasa === false ? ` (hoy da ${x.obtenido ?? "?"})` : ""}`).join("\n")}` : "",
      `Función como está:\n${p.codigo}`,
      o.ideal && p.construir.auditoria?.ideal ? `Versión ideal que propuso la auditoría (REFERENCIA: toma de ella SOLO lo que el programador pide):\n${p.construir.auditoria.ideal.codigo}` : "",
      o.forzarSeparar ? `El programador quiere SEPARARLA: propone las auxiliares en "separar" (deja "cuerpo" vacío). Lo que pidió: ${texto.trim()}` : `Pedido del programador: ${texto.trim()}${o.una ? "\n(Pidió hacerla en UNA sola función: no separes.)" : ""}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
  });
  // Es mucho para una función: no se escribe; se propone qué auxiliares crear (tú decides).
  if (!o.una && data.separar.length && (o.forzarSeparar || !data.cuerpo.trim())) {
    const separar: Separar = { pedido: texto.trim(), motivo: sinSoluciones(data.motivo.trim()), auxiliares: data.separar.map((x) => ({ nombre: x.nombre.trim(), firma: x.firma.trim(), proposito: sinSoluciones(x.proposito.trim()) })).filter((x) => /^[A-Za-z_$][\w$]*$/.test(x.nombre)) };
    if (!separar.auxiliares.length) throw new Error("la IA propuso separarla pero sin nombres válidos: vuelve a pedirlo o hazla en una sola");
    return conPropuesta(root, rel, c.clave, p.fecha, (q) => {
      q.construir.forma = "pedido";
      q.construir.separar = separar;
      q.costo += costUsd;
      return q;
    });
  }
  const cuerpo = data.cuerpo.trim() ? reindentar(data.cuerpo, p.construir.base.sangria) : [];
  if (!cuerpo.some((l) => l.trim())) throw new Error(data.falta.trim() ? `no escribí nada: ${data.falta.trim()}` : "la IA no escribió nada con ese pedido: dilo de otra forma");
  const anteriores = p.porciones.map((x) => ({ ...x }));
  if (cuerpo.join("\n") === anteriores.map((x) => x.codigo ?? "").join("\n")) throw new Error(data.falta.trim() ? `no cambié nada: ${data.falta.trim()}` : "con ese pedido no cambió nada: dilo de otra forma");
  const porciones = repartirAjuste(anteriores, cuerpo, texto.trim());
  const nuevas = porciones.filter((x) => x.tipo === "ajuste" && x.orden === texto.trim() && !anteriores.includes(x));
  const datos = new Map(nuevas.map((x) => [x, { entrada: data.entrada.trim(), falta: data.falta.trim(), explicacion: data.explicacion.trim() }] as const));
  const historial = [...(p.construir.historial ?? []), p.porciones].slice(-10);
  const q = await terminarEscritura(root, rel, c, p, porciones, nuevas, datos, costUsd, (q) => {
    q.construir.forma = "pedido";
    q.construir.historial = historial;
    q.construir.escritos = [0];
    delete q.construir.separar;
    delete q.construir.pedidoPendiente;
    // Salió más larga que tu práctica: se avisa (sin IA) y se ofrece separarla.
    if (cuerpo.filter((l) => l.trim()).length > max) q.construir.larga = { lineas: cuerpo.filter((l) => l.trim()).length, max, pedido: texto.trim() };
    else delete q.construir.larga;
  });
  await conNota(root, rel, c.clave, (n) => n.hilo.push(mensaje("tu", `🧭 Pedido: «${texto.trim()}»`, { kind: "programar" })));
  return q;
}

const SYSTEM_AUDITORIA = `Auditas, en UN solo paso, una función que el programador armó con pedidos a una IA más chica, antes de que la inserte. Revisas A CIEGAS: solo su objetivo, el comentario de la función, sus pedidos, los casos (con lo que da cada uno) y el código; no las explicaciones de quien la escribió.
- Evidencia primero ("que_hace": qué hace el código, citando líneas). Después el veredicto.
- "estado": "lista" (cumple lo pedido y no tiene bugs evidentes), "casi" (falta algo concreto) o "falta" (no cumple o tiene un bug claro). "resumen": una o dos oraciones.
- "casos": un comentario por CADA caso (por qué pasa o por qué falla, y si el valor esperado tiene sentido).
- "que_hacer": lo que hay que corregir, en orden de importancia (en palabras, sin código).
- "mejoras": cómo mejorarla aunque ya funcione (claridad, casos borde, rendimiento), con su porqué.
- "ideal": la mejor versión que puedes proponer, sin anclarte a cómo está: "descripcion" (en palabras: qué cambia y por qué es mejor) y "cuerpo" (el cuerpo COMPLETO de esa versión, sin la firma ni la llave de cierre). Si la actual ya es la ideal, repite su cuerpo y dilo.
${ESTILO}`;

/**
 * La auditoría final, en un solo paso (IA mediana por defecto, a ciegas): prueba los casos (los propone
 * si no hay), comenta cada uno, dice qué hacer y cómo mejorar, y ofrece la versión ideal.
 */
export async function auditar(root: string, rel: string, clave: string): Promise<Construir> {
  const c = await cargar(root, rel, clave);
  if (!propuestaConstruir(root, rel, c.clave).porciones.some((x) => x.tipo !== "ya-estaba")) throw new Error("todavía no hay nada que auditar: pide primero qué debe hacer la función");
  // Los casos primero (según la intención; si ya había, se vuelven a probar contra esta versión).
  await casosConstruir(root, rel, c.clave);
  const p = propuestaConstruir(root, rel, c.clave);
  const z = makeZoner(root);
  const pedidos = [...new Set(p.porciones.map((x) => x.orden).filter((x): x is string => !!x))];
  const casos = p.construir.casos ?? [];
  const { data, costUsd } = await ask<{ que_hace: string; estado: "lista" | "casi" | "falta"; resumen: string; casos: { llamada: string; comentario: string }[]; que_hacer: string[]; mejoras: { texto: string; porque: string }[]; ideal: { descripcion: string; cuerpo: string } }>({
    kind: "programar:auditoria",
    ref: { archivo: rel, funcion: c.f.nombre },
    system: SYSTEM_AUDITORIA,
    cwd: root,
    sinHerramientas: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["que_hace", "estado", "resumen", "casos", "que_hacer", "mejoras", "ideal"],
      properties: {
        que_hace: { type: "string" },
        estado: { type: "string", enum: ["lista", "casi", "falta"] },
        resumen: { type: "string" },
        casos: { type: "array", items: { type: "object", additionalProperties: false, required: ["llamada", "comentario"], properties: { llamada: { type: "string" }, comentario: { type: "string" } } } },
        que_hacer: { type: "array", maxItems: 5, items: { type: "string" } },
        mejoras: { type: "array", maxItems: 4, items: { type: "object", additionalProperties: false, required: ["texto", "porque"], properties: { texto: { type: "string" }, porque: { type: "string" } } } },
        ideal: { type: "object", additionalProperties: false, required: ["descripcion", "cuerpo"], properties: { descripcion: { type: "string" }, cuerpo: { type: "string" } } },
      },
    },
    ...iaOpts(z.config, z.config.programar.modeloAuditoria),
    prompt: [
      contextoComun(root, rel, { funcion: c.clave }),
      objetivoDe(c.nota),
      c.comentario ? `Comentario de la función (su especificación):\n${c.comentario}` : "",
      pedidos.length ? `Lo que pidió el programador:\n${pedidos.map((x) => `- ${x}`).join("\n")}` : "",
      casos.length ? `Casos (llamada → esperado · lo que da hoy):\n${casos.map((x) => `- ${x.llamada} → ${x.esperado} · ${x.obtenido ?? "?"}${x.pasa === undefined ? "" : x.pasa ? " (pasa)" : " (falla)"}`).join("\n")}` : "",
      `Código:\n${p.codigo.split("\n").map((l, i) => `${i + 1}| ${l}`).join("\n")}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
  });
  const cuerpoIdeal = data.ideal.cuerpo.trim() ? reindentar(data.ideal.cuerpo, p.construir.base.sangria) : [];
  const ideal = cuerpoIdeal.length ? [...p.construir.base.cabecera, ...cuerpoIdeal, ...p.construir.base.cierre].join("\n") : "";
  return conPropuesta(root, rel, c.clave, p.fecha, (q) => {
    q.construir.auditoria = {
      estado: data.estado,
      resumen: sinSoluciones(data.resumen.trim()),
      casos: data.casos.map((x) => ({ llamada: x.llamada.trim(), comentario: sinSoluciones(x.comentario.trim()) })),
      queHacer: data.que_hacer.map((x) => sinSoluciones(x.trim())).filter(Boolean),
      hallazgos: data.mejoras.map((x) => ({ texto: sinSoluciones(x.texto.trim()), porque: sinSoluciones(x.porque.trim()) })),
      ...(ideal && ideal !== q.codigo ? { ideal: { descripcion: sinSoluciones(data.ideal.descripcion.trim()), codigo: ideal } } : {}),
      codigo: q.codigo,
      fecha: new Date().toISOString(),
    };
    q.costo += costUsd;
    return q;
  });
}

/** El texto de las auxiliares vacías (firma + comentario con lo que hacen), para insertarlas después de la función. */
export async function stubsAuxiliares(root: string, rel: string, clave: string): Promise<{ texto: string; despuesDeLinea: number; auxiliares: Separar["auxiliares"] }> {
  const c = await cargar(root, rel, clave);
  const p = propuestaConstruir(root, rel, c.clave);
  const sep = p.construir.separar;
  if (!sep) throw new Error("no hay una propuesta de separar esta función");
  const existentes = new Set(c.funciones.map((f) => f.nombre));
  const aux = sep.auxiliares.filter((a) => !existentes.has(a.nombre));
  const cab = c.lineas[c.f.linea - 1] ?? "";
  const sangria = cab.match(/^\s*/)![0];
  const py = c.lang.id === "python";
  const metodo = py ? /\(\s*self\b/.test(cab) : !/\bfunction\b|=>/.test(cab) && sangria.length > 0;
  const exp = /^\s*export\s/.test(cab) && !metodo ? "export " : "";
  const texto = aux
    .map((a) => {
      const firma = a.firma.includes("(") ? a.firma.replace(/^(export\s+)?(async\s+)?(function|def)\s+/, "") : `${a.nombre}()`;
      if (py) {
        const f = metodo && !/\(\s*self\b/.test(firma) ? firma.replace("(", "(self, ").replace("(self, )", "(self)") : firma;
        return `\n${sangria}def ${f.replace(/:\s*$/, "")}:\n${sangria}    # ${a.proposito}\n${sangria}    pass`;
      }
      return `\n${sangria}// ${a.proposito}\n${sangria}${metodo ? "" : `${exp}function `}${firma.replace(/\s*\{?\s*$/, "")} {\n${sangria}}`;
    })
    .join("\n");
  return { texto, despuesDeLinea: c.f.linea - 1 + c.f.lineas, auxiliares: aux };
}

/**
 * Las auxiliares ya están en tu archivo (las insertó tu clic): quedan como tareas con lo que hacen (así
 * la IA las conoce con su propósito) y tu pedido queda listo para escribir la principal usándolas.
 */
export async function registrarAuxiliares(root: string, rel: string, clave: string): Promise<Construir> {
  const c = await cargar(root, rel, clave);
  const p = propuestaConstruir(root, rel, c.clave);
  const sep = p.construir.separar;
  if (!sep) throw new Error("no hay una propuesta de separar esta función");
  agregarTareas(
    root,
    sep.auxiliares.map((a) => ({ titulo: `Crear ${a.nombre} en ${rel}: ${a.proposito}`.slice(0, 120), archivo: rel, funcion: a.nombre, detalle: `${a.proposito} (la usa ${c.f.nombre}; trabájala en su propia nota)`, origen: "plano" as const })),
  );
  await actualizarIndice(root, [rel]).catch(() => undefined);
  return conPropuesta(root, rel, c.clave, p.fecha, (q) => {
    q.construir.pedidoPendiente = sep.pedido;
    delete q.construir.separar;
    return q;
  });
}

/** Volver al borrador anterior a tu último pedido. */
export async function deshacerPedido(root: string, rel: string, clave: string): Promise<Construir> {
  const c = await cargar(root, rel, clave);
  const p = propuestaConstruir(root, rel, c.clave);
  const hist = p.construir.historial ?? [];
  if (!hist.length) throw new Error("no hay un pedido anterior para deshacer");
  return conPropuesta(root, rel, c.clave, p.fecha, (q) => {
    q.porciones = hist[hist.length - 1]!;
    q.construir.historial = hist.slice(0, -1);
    q.codigo = armar(q.construir.base, q.porciones);
    delete q.construir.escritos;
    delete q.construir.larga;
    if (q.construir.casos) q.construir.casos = q.construir.casos.map((x) => ({ ...x, obtenido: undefined, pasa: undefined }) as CasoConstruir);
    if (q.construir.prediccion) q.construir.prediccion = { llamada: q.construir.prediccion.llamada };
    return q;
  });
}

// --- 3. Casos al final y tu predicción -------------------------------------------------------------------

/** Normaliza el esperado de un caso de tests.ts al formato del probador ("error: …" para los errores). */
const esperadoDe = (x: { tipo: string; esperado: string }) => (x.tipo === "error" && !/^\s*error\b/i.test(x.esperado) ? `error: ${x.esperado}` : x.esperado);

/** Corre un caso contra el borrador (en una copia). */
async function probarCaso(root: string, rel: string, c: Cargado, codigo: string, caso: CasoConstruir): Promise<CasoConstruir> {
  if (caso.esperado === "?") return { ...caso, obtenido: undefined, pasa: undefined };
  const { texto } = await copiaConFuncion(c, codigo);
  const r = await ejecutarCopia(root, rel, c, texto, caso.llamada);
  if (r.infra) return { ...caso, obtenido: `no se pudo ejecutar: ${r.error ?? ""}`, pasa: false };
  return { ...caso, obtenido: r.ok ? JSON.stringify(r.valor) : `error: ${r.error ?? ""}`, pasa: cumple(caso.esperado, r) };
}

/**
 * Los casos del final: según la intención (objetivo, comentario y plan; no el borrador), probados contra
 * el borrador. Uno queda para que predigas la función: su resultado no se muestra hasta que digas qué esperas.
 * Si ya había casos (cambió el borrador), se vuelven a probar sin IA.
 */
export async function casosConstruir(root: string, rel: string, clave: string, o: { nuevos?: boolean } = {}): Promise<Propuesta> {
  const c = await cargar(root, rel, clave);
  const p = propuestaConstruir(root, rel, c.clave);
  if (p.construir.forma === "pedido" ? !p.porciones.some((x) => x.tipo !== "ya-estaba") : pasoPendiente(p, c.nota?.plan?.pasos.length ?? p.construir.pasosPlan ?? 0))
    throw new Error(p.construir.forma === "pedido" ? "primero pide qué debe hacer la función" : "faltan pasos del plan: termina primero los pasos, de a uno");
  if (p.construir.casos?.length && !o.nuevos) {
    const reprobados: CasoConstruir[] = [];
    for (const x of p.construir.casos) reprobados.push(x.raro ? x : await probarCaso(root, rel, c, p.codigo, x));
    const candidato = reprobados.find((x) => x.esperado !== "?" && x.pasa !== undefined);
    return conPropuesta(root, rel, c.clave, p.fecha, (q) => {
      q.construir.casos = reprobados;
      if (!q.construir.prediccion && candidato) q.construir.prediccion = { llamada: candidato.llamada };
      return q;
    });
  }
  const plan = c.nota?.plan;
  const r = await generarCasos(root, rel, c.f.nombre, {
    extra: [objetivoDe(c.nota), plan ? `Plan de la función:\n${plan.pasos.map((x, i) => `${i + 1}. ${x.texto}`).join("\n")}` : "", "La función todavía no está escrita en el archivo: propón los casos según su intención (y el comentario que tiene encima)."].filter(Boolean).join("\n\n"),
  });
  const casos: CasoConstruir[] = [];
  for (const x of r.casos.slice(0, 8)) casos.push(await probarCaso(root, rel, c, p.codigo, { descripcion: x.descripcion, llamada: x.llamada, esperado: esperadoDe(x), ...(x.duda ? { duda: x.duda } : {}) }));
  // La predicción: un caso con resultado (mejor uno borde), que no sea una duda.
  const candidatos = casos.filter((x) => x.esperado !== "?" && x.obtenido !== undefined && !x.obtenido.startsWith("no se pudo"));
  const elegido = candidatos.find((x) => esBorde(x.llamada, x.esperado)) ?? candidatos[0];
  return conPropuesta(root, rel, c.clave, p.fecha, (q) => {
    q.construir.casos = casos;
    if (elegido) q.construir.prediccion = { llamada: elegido.llamada };
    else delete q.construir.prediccion;
    q.costo += r.costoUsd;
    return q;
  });
}

/** Tu predicción de la función: qué esperas que dé el caso elegido, ANTES de ver el resultado. */
export async function predecirConstruir(root: string, rel: string, clave: string, espero: string): Promise<NonNullable<NonNullable<Propuesta["construir"]>["prediccion"]>> {
  const c = await cargar(root, rel, clave);
  const p = propuestaConstruir(root, rel, c.clave);
  const pred = p.construir.prediccion;
  if (!pred) throw new Error("todavía no hay un caso para predecir: pide los casos primero");
  if (pred.espero !== undefined) throw new Error("ya hiciste la predicción de esta función");
  if (!espero.trim()) throw new Error("escribe qué esperas ANTES de ver el resultado");
  const { texto } = await copiaConFuncion(c, p.codigo);
  const r = await ejecutarCopia(root, rel, c, texto, pred.llamada);
  if (r.infra) throw new Error(`no se pudo ejecutar el borrador: ${r.error ?? "sin detalle"}`);
  const obtenido = r.ok ? JSON.stringify(r.valor) : `error: ${r.error ?? ""}`;
  const acierto = cumple(espero, r);
  let explicacion = "";
  if (!acierto)
    try {
      const { data } = await ask<{ texto: string }>({
        kind: "programar:diferencia",
        system: SYSTEM_DIFERENCIA,
        cwd: root,
        sinHerramientas: true,
        sinRazonar: true,
        schema: { type: "object", additionalProperties: false, required: ["texto"], properties: { texto: { type: "string" } } },
        ...iaOpts(makeZoner(root).config, "chico"),
        prompt: `Código:\n${p.codigo.split("\n").map((l, i) => `${i + 1}| ${l}`).join("\n")}\n\nEntrada: ${pred.llamada}\nEsperaba: ${espero}\nObtuvo: ${obtenido}`,
      });
      explicacion = data.texto.trim();
    } catch {
      /* sin explicación: igual ve el resultado real */
    }
  return conPropuesta(root, rel, c.clave, p.fecha, (q) => {
    q.construir.prediccion = { llamada: pred.llamada, espero: espero.trim(), obtenido, acierto, ...(explicacion ? { explicacion } : {}) };
    return q.construir.prediccion;
  });
}

/**
 * Editas (o agregas) un caso. Se prueba contra el borrador; si falla, la IA mira si encaja con el
 * objetivo y los otros casos: si encaja, lo ajustas con una orden tuya; si no, queda marcado como raro y
 * se te pregunta (decisión): la IA no tuerce el código para cumplir un caso que no tiene sentido.
 */
export async function editarCaso(root: string, rel: string, clave: string, i: number, llamada: string, esperado: string): Promise<CasoConstruir> {
  const c = await cargar(root, rel, clave);
  const p = propuestaConstruir(root, rel, c.clave);
  const e = validarExpresion(llamada, new Set([c.f.nombre]), c.lang.id);
  if (e) throw new Error(`la llamada tiene que ser ${c.f.nombre}(…) con valores: ${e}`);
  if (!/^\s*error\b/i.test(esperado) && esperado.trim() !== "?" && !sonLiterales(esperado)) throw new Error(`el esperado "${esperado}" tiene que ser un valor (número, texto entre comillas, true/false, lista…) o "error: <parte del mensaje>"`);
  let caso = await probarCaso(root, rel, c, p.codigo, { descripcion: p.construir.casos?.[i]?.descripcion ?? "caso tuyo", llamada: llamada.trim(), esperado: esperado.trim(), tuyo: true });
  if (caso.pasa === false) {
    const otros = (p.construir.casos ?? []).filter((_, j) => j !== i).map((x) => `- ${x.llamada} → ${x.esperado}`);
    try {
      const { data } = await ask<{ encaja: boolean; porque: string }>({
        kind: "programar:caso",
        ref: { archivo: rel, funcion: c.f.nombre },
        system: `El programador escribió un caso de prueba para su función. Di si el caso ENCAJA con el objetivo de la función y con los otros casos ("encaja" true), o si los contradice o no tiene sentido ("encaja" false). En "porque", UNA oración concreta. No juzgues el código: solo el caso. ${ESTILO}`,
        cwd: root,
        sinHerramientas: true,
        sinRazonar: true,
        schema: { type: "object", additionalProperties: false, required: ["encaja", "porque"], properties: { encaja: { type: "boolean" }, porque: { type: "string" } } },
        ...iaOpts(makeZoner(root).config, "chico"),
        prompt: [objetivoDe(c.nota), c.comentario ? `Comentario de la función: ${c.comentario}` : "", c.nota?.plan ? `Plan: ${c.nota.plan.pasos.map((x) => x.texto).join(" / ")}` : "", otros.length ? `Otros casos:\n${otros.join("\n")}` : "", `Caso nuevo: ${caso.llamada} → ${caso.esperado}`].filter(Boolean).join("\n\n"),
      });
      if (data.encaja) caso = { ...caso, ajustar: true };
      else {
        caso = { ...caso, raro: data.porque.trim() };
        proponerDecisiones(
          root,
          [
            {
              pregunta: `¿${caso.llamada} debe dar ${caso.esperado}? (${data.porque.trim()})`,
              opciones: [
                { opcion: "Sí: mantener el caso", consecuencia: "lo ajustas con una orden (sin comparar contra ese valor exacto)" },
                { opcion: "No: quitar el caso", consecuencia: "el caso se descarta" },
              ],
            },
          ],
          { archivo: rel, funcion: c.clave },
          "programar",
        );
      }
    } catch {
      caso = { ...caso, ajustar: true }; // sin opinión de la IA: lo decides tú al dar la orden de ajuste
    }
  }
  return conPropuesta(root, rel, c.clave, p.fecha, (q) => {
    const casos = (q.construir.casos ??= []);
    if (i >= 0 && i < casos.length) casos[i] = caso;
    else casos.push(caso);
    return caso;
  });
}
