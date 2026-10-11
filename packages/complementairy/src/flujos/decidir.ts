/**
 * MARCOS DE DECISIÓN (manifiesto I.5, IV.3, V.2.4, VI.2): la IA propone opciones; decides TÚ, con números
 * tuyos y cuentas deterministas.
 *
 *   binaria      2 opciones con pros y contras → eliges con tu porqué
 *   matriz       criterios y pesos (tuyos, ANTES de ver los puntajes de la IA) → tus puntajes 1–5 → total,
 *                sensibilidad ("decisión frágil" si un cambio < 10 puntos de un peso la da vuelta); los
 *                puntajes de la IA se muestran DESPUÉS y una diferencia ≥ 2 te pide una nota
 *   ev           escenarios × probabilidad × costo (tuyos) → valor esperado, minimax regret, peor caso
 *   alternativas "muéstrame 3 enfoques distintos" → una decisión con 3 opciones
 * Cierre: eliges, escribes por qué, qué te haría cambiar de opinión y cuándo revisarla. Si es de
 * arquitectura, sale un ADR.
 */
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../proyecto/config.js";
import { actualizarDecision, cargarDecisiones, decidir as decidirBase, proponerDecisiones, type Decision } from "../proyecto/decisiones.js";
import { nuevoAdr } from "./arquitectura.js";
import { consultarRol } from "../ia/roles.js";
import { comoDato } from "../ia/decisor.js";
import { conContenido } from "../nucleo/especificidad.js";
import { calcularEV, calcularMatriz, discrepancias, type Criterio, type Puntajes } from "../nucleo/matriz.js";

export function buscar(root: string, id: string): Decision {
  const d = cargarDecisiones(root).find((x) => x.id === id);
  if (!d) throw new Error(`no existe la decisión ${id} (\`cai decidir\` las lista)`);
  return d;
}

/** "a:50,b:30,c:20" → criterios. */
export function leerCriterios(t: string): Criterio[] {
  return t.split(",").map((x) => {
    const [n, p] = x.split(":").map((s) => s.trim());
    if (!n || !p || !Number.isFinite(Number(p))) throw new Error(`criterio inválido «${x}»: usa nombre:peso (los pesos suman 100)`);
    return { nombre: n, peso: Number(p) };
  });
}

/** "A:x=4,y=3;B:x=2,y=5" → puntajes. */
export function leerPuntajes(t: string): Puntajes {
  const out: Puntajes = {};
  for (const bloque of t.split(";").map((s) => s.trim()).filter(Boolean)) {
    const i = bloque.indexOf(":");
    if (i < 0) throw new Error(`puntaje inválido «${bloque}»: usa Opción:criterio=1..5,criterio=…`);
    const o = bloque.slice(0, i).trim();
    out[o] = {};
    for (const kv of bloque.slice(i + 1).split(",")) {
      const [k, v] = kv.split("=").map((s) => s.trim());
      if (k && v) out[o]![k] = Number(v);
    }
  }
  return out;
}

export function fijarCriterios(root: string, id: string, criterios: Criterio[]): Decision {
  const d = buscar(root, id);
  if (d.marco?.puntajes) throw new Error("ya puntuaste: cambiar los pesos después de ver los puntajes es acomodar el resultado. Retracta y vuelve a empezar si de verdad cambiaron los criterios");
  const suma = criterios.reduce((a, c) => a + c.peso, 0);
  if (Math.abs(suma - 100) > 0.001) throw new Error(`los pesos deben sumar 100 (suman ${suma})`);
  return actualizarDecision(root, id, (x) => ({ ...x, marco: { ...(x.marco ?? { tipo: "matriz" }), tipo: "matriz", criterios } }));
}

/** La IA sugiere puntajes (se guardan OCULTOS hasta que puntúes tú). */
export async function puntajesIa(root: string, id: string): Promise<Decision> {
  const d = buscar(root, id);
  const cs = d.marco?.criterios;
  if (!cs?.length) throw new Error("primero tus criterios y pesos (`--criterios a:50,b:50`): así no te anclas en la IA");
  const r = await consultarRol<{ puntajes: { opcion: string; criterio: string; puntaje: number; evidencia: string }[] }>(loadConfig(root), "interrogar", {
    kind: "decidir:puntajes",
    system: "Puntúas opciones de una decisión técnica (1 = muy mal, 5 = muy bien) por criterio, con evidencia concreta (archivo, documentación o razonamiento). Honesto: si no sabes, 3 y dilo.",
    prompt: `Decisión: ${d.pregunta}\nOpciones: ${d.opciones.map((o) => `${o.opcion} (${o.consecuencia})`).join(" | ")}\nCriterios: ${cs.map((c) => c.nombre).join(", ")}`,
    schema: { type: "object", required: ["puntajes"], properties: { puntajes: { type: "array", items: { type: "object", required: ["opcion", "criterio", "puntaje", "evidencia"], properties: { opcion: { type: "string" }, criterio: { type: "string" }, puntaje: { type: "number" }, evidencia: { type: "string" } } } } } },
    cwd: root,
  });
  const p: Puntajes = {};
  for (const x of r.data.puntajes) (p[x.opcion] ??= {})[x.criterio] = Math.max(1, Math.min(5, Math.round(x.puntaje)));
  return actualizarDecision(root, id, (x) => ({ ...x, marco: { ...(x.marco ?? { tipo: "matriz" }), puntajesIa: p, notas: { ...x.marco?.notas, _evidenciaIa: r.data.puntajes.map((y) => `${y.opcion}/${y.criterio}: ${y.evidencia}`).join("\n") } } }));
}

/** Tus puntajes. Devuelve el resultado y las discrepancias con la IA (recién ahora se ven). */
export function puntuar(root: string, id: string, p: Puntajes): { decision: Decision; resultado: ReturnType<typeof calcularMatriz>; discrepancias: ReturnType<typeof discrepancias> } {
  const d = buscar(root, id);
  const cs = d.marco?.criterios;
  if (!cs?.length) throw new Error("primero tus criterios y pesos (`--criterios`)");
  const opciones = d.opciones.map((o) => o.opcion);
  const resultado = calcularMatriz(cs, opciones, p);
  const disc = d.marco?.puntajesIa ? discrepancias(p, d.marco.puntajesIa) : [];
  const decision = actualizarDecision(root, id, (x) => ({ ...x, marco: { ...x.marco!, puntajes: p, resultado: resultado as unknown as Record<string, unknown> } }));
  return { decision, resultado, discrepancias: disc };
}

export function anotar(root: string, id: string, clave: string, nota: string): Decision {
  if (conContenido(nota).length < 3) throw new Error("la nota tiene que decir por qué difieres (una oración)");
  return actualizarDecision(root, id, (x) => ({ ...x, marco: { ...(x.marco ?? { tipo: "matriz" }), notas: { ...x.marco?.notas, [clave]: nota } } }));
}

export function valorEsperado(root: string, id: string, escenarios: { nombre: string; probabilidad: number }[], valores: Record<string, Record<string, number>>, minimizar = true) {
  const d = buscar(root, id);
  const r = calcularEV(escenarios, d.opciones.map((o) => o.opcion), valores, minimizar);
  actualizarDecision(root, id, (x) => ({ ...x, marco: { ...(x.marco ?? {}), tipo: "ev", escenarios, valores, minimizar, resultado: r as unknown as Record<string, unknown> } }));
  return r;
}

/**
 * Cierre (solo humano): eliges con tu porqué. Si hubo matriz, las discrepancias ≥ 2 con la IA necesitan nota.
 * `adr`: genera docs/adr/NNNN con el contexto, las opciones, la matriz y tu decisión.
 */
export function cerrar(root: string, id: string, eleccion: string, porque: string, o: { cambiaria?: string; revisar?: string; adr?: boolean } = {}): Decision {
  const d = buscar(root, id);
  if (conContenido(porque).length < 3) throw new Error("escribe por qué eliges esa opción, con tus palabras (I.5: tú decides; la IA solo propuso)");
  if (d.origen.startsWith("disparador") && !o.adr) throw new Error("esta decisión es de arquitectura (módulo nuevo, esquema o API pública): ciérrala con --adr para que quede el registro");
  if (d.marco?.puntajes && d.marco.puntajesIa) {
    const sinNota = discrepancias(d.marco.puntajes, d.marco.puntajesIa).filter((x) => !d.marco?.notas?.[`${x.opcion}/${x.criterio}`]);
    if (sinNota.length) throw new Error(`antes de cerrar, anota por qué difieres de la IA en: ${sinNota.map((x) => `${x.opcion}/${x.criterio} (tú ${x.tuyo}, IA ${x.ia})`).join(", ")} (\`--nota "<opción>/<criterio>" "…"\`)`);
  }
  decidirBase(root, id, eleccion);
  let n = actualizarDecision(root, id, (x) => ({ ...x, porque: porque.trim(), ...(o.cambiaria ? { cambiaria: o.cambiaria.trim() } : {}), ...(o.revisar ? { revisar: o.revisar } : {}) }));
  if (o.adr) {
    const f = nuevoAdr(root, d.pregunta);
    const abs = path.isAbsolute(f) ? f : path.join(root, f);
    const matriz = n.marco?.criterios && n.marco.puntajes ? `\n## Matriz (tus puntajes)\n| Opción | ${n.marco.criterios.map((c) => `${c.nombre} (${c.peso})`).join(" | ")} |\n|---|${n.marco.criterios.map(() => "---").join("|")}|\n${n.opciones.map((op) => `| ${op.opcion} | ${n.marco!.criterios!.map((c) => n.marco!.puntajes![op.opcion]?.[c.nombre] ?? "-").join(" | ")} |`).join("\n")}\n` : "";
    fs.writeFileSync(abs, `# ${d.pregunta}\n\nEstado: aceptada · ${new Date().toISOString().slice(0, 10)}\n\n## Contexto\n${d.origen}${d.tarea ? ` (tarea ${d.tarea})` : ""}\n\n## Opciones\n${n.opciones.map((op) => `- **${op.opcion}**: ${op.consecuencia}`).join("\n")}\n${matriz}\n## Decisión\n${eleccion}\n\n${porque}\n\n## Qué me haría cambiar de opinión\n${o.cambiaria ?? "-"}\n\n## Revisar\n${o.revisar ?? "-"}\n`);
    n = actualizarDecision(root, id, (x) => ({ ...x, adr: path.relative(root, abs) }));
  }
  return n;
}

/** "Muéstrame 3 enfoques distintos" (VI.2): una decisión con 3 opciones, pros y contras. */
export async function alternativas(root: string, problema: string, n = 3): Promise<Decision> {
  if (conContenido(problema).length < 4) throw new Error("describe el problema con detalle (qué quieres resolver y con qué restricciones)");
  const r = await consultarRol<{ opciones: { opcion: string; pros: string; contras: string; cuando: string }[] }>(loadConfig(root), "planificar", {
    kind: "decidir:alternativas",
    system: `Propones ${n} enfoques DISTINTOS (no variaciones) para un problema técnico, cada uno con pros, contras y cuándo conviene. Sin código. No recomiendas: el programador decide.`,
    prompt: comoDato("problema", problema),
    schema: { type: "object", required: ["opciones"], properties: { opciones: { type: "array", minItems: 2, maxItems: 4, items: { type: "object", required: ["opcion", "pros", "contras", "cuando"], properties: { opcion: { type: "string" }, pros: { type: "string" }, contras: { type: "string" }, cuando: { type: "string" } } } } } },
    cwd: root,
  });
  const [d] = proponerDecisiones(root, [{ pregunta: problema.trim(), opciones: r.data.opciones.map((o) => ({ opcion: o.opcion, consecuencia: `pros: ${o.pros} · contras: ${o.contras} · conviene cuando: ${o.cuando}` })) }], {}, "alternativas");
  if (!d) throw new Error("ya hay una decisión parecida pendiente o vigente (`cai decidir`)");
  return d;
}

/** Resumen legible de una decisión (para `cai decidir <id>`). Los puntajes de la IA solo aparecen si ya puntuaste. */
export function describirDecision(d: Decision): string[] {
  const out = [`${d.id} · ${d.pregunta} [${d.estado}${d.eleccion ? `: ${d.eleccion}` : ""}]${d.tarea ? ` (tarea ${d.tarea})` : ""}`, ...d.opciones.map((o) => `  - ${o.opcion}: ${o.consecuencia}`)];
  const m = d.marco;
  if (m?.criterios) out.push(`  criterios: ${m.criterios.map((c) => `${c.nombre} ${c.peso}`).join(" · ")}`);
  if (m?.puntajes) out.push(`  tus puntajes: ${JSON.stringify(m.puntajes)}`);
  if (m?.puntajes && m.puntajesIa) out.push(`  puntajes de la IA (después de los tuyos): ${JSON.stringify(m.puntajesIa)}`);
  if (m?.resultado) out.push(`  resultado: ${JSON.stringify(m.resultado)}`);
  if (d.porque) out.push(`  por qué: ${d.porque}`);
  if (d.adr) out.push(`  ADR: ${d.adr}`);
  return out;
}
