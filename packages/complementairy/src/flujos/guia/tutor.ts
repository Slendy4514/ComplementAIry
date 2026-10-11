import fs from "node:fs";
import { contextoComun } from "../../proyecto/contexto.js";
import path from "node:path";
import { parse } from "../../nucleo/comments.js";
import { contextBlock, projectContext, CRITERIO } from "../../proyecto/contexto.js";
import { modoEfectivo } from "../../proyecto/modos.js";
import { cargarNotas } from "../../proyecto/notas.js";
import { responderNota } from "./responder.js";
import { medir } from "../../proyecto/metricas.js";
import { proponerTests } from "../tests.js";
import { biblioteca, paraLenguaje, parseLlamada, type Snippet } from "../biblioteca.js";
import { makeZoner, notaOrigen, origenDe, type Config } from "../../proyecto/config.js";
import { fileIdentifiers, guardReplies } from "../../nucleo/guard.js";
import { langFor } from "../../nucleo/lang.js";
import { ask, iaOpts } from "../../ia/llm.js";
import { loadPerfil, nivelDe, puntaje, registrar, temasDe, type Nivel } from "../../proyecto/profile.js";
import { indentAt, insertBelow, renderReply, type Reply } from "../../nucleo/render.js";
import { deleteHilo, getHilo, hilosDe, loadEstado, saveEstado, setHilo, type Estado } from "../../proyecto/state.js";
import { findThreads, nextThreadId, regionOf, type Thread } from "../../nucleo/threads.js";
import { verifyCommentOnly } from "../../nucleo/soloComentarios.js";
import { REUTILIZAR } from "../../nucleo/prompts.js";

export const TIPOS = ["pista", "pieza", "plano", "snippet", "pregunta", "revision", "ejemplo"] as const;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["respuestas", "nivel_usado"],
  properties: {
    respuestas: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["tipo", "texto", "links"],
        properties: {
          tipo: { type: "string", enum: [...TIPOS] },
          texto: { type: "string" },
          links: { type: "array", items: { type: "string" } },
        },
      },
    },
    nivel_usado: { type: "integer", minimum: 1, maximum: 4 },
  },
};

export const SYSTEM = `Eres el tutor de ComplementAIry. El programador escribe su código; tú le das ideas, estructura y piezas con comentarios. NUNCA escribes código de su archivo.

Hay dos modos (el sistema te dice cuál):
- DIRECTO (lo normal): ayuda útil de inmediato, sin hacerlo esperar. Según lo que pida:
  · "pieza": qué funciones, APIs o conceptos le sirven, con link a la documentación oficial.
  · "plano": cómo organizar el archivo o la tarea: qué funciones crear, qué hace cada una (en palabras: qué recibe, qué devuelve, qué casos cuida) y en qué orden. Es estructura, no implementación.
  · "snippet": si una estructura conocida de la BIBLIOTECA DE SNIPPETS sirve, sugiérela así: texto = "<nombre> clave=valor clave2=\"valor con espacios\" — para qué sirve aquí". Solo snippets de la lista; las claves son sus marcadores. El programador la expande con un atajo.
  · "pregunta": si falta una decisión suya, pregúntala.
- ESCALERA (zona crítica o cuando quiere aprender): ayuda gradual hasta el nivel máximo indicado:
  1 = pregunta guía o concepto, 2 = piezas con docs, 3 = pasos en palabras, 4 = ejemplo análogo de OTRO dominio.

Reglas:
- Nunca código del caso del programador (ni en bloques ni en una línea). Nombres de funciones y firmas en palabras, sí.
- Español neutro con tuteo, breve y concreto: 1 a 4 respuestas, cada una de 1 a 3 oraciones (un plano puede tener una lista corta).
- Si el programador escribió un intento ("PROGRAMADOR (intento)"), evalúalo primero; si ya resolvió, díselo en una línea (tipo "revision", empezando con "praise:").
- Si el sistema indica que no hubo intento en código crítico, no avances: pide un intento (tipo "pregunta").
- Adáptate a su nivel: aprendiz = explica términos; intermedio = directo; experto = mínimo y técnico.
- Links: solo documentación oficial que conozcas con certeza. Si dudas de una URL, no la pongas.
- No cites números de línea. Puedes leer el proyecto con Read/Grep/Glob. No intentes modificar nada.

${REUTILIZAR}

${CRITERIO}`;

export const NIVEL_BASE: Record<Nivel, number> = { aprendiz: 1, intermedio: 1, experto: 2 };
/** Ajuste del perfil cuando un hilo se resuelve (desaparece del archivo), según el nivel que hizo falta. */
const DELTA_RESUELTO = [0, 0.08, 0.04, 0, -0.04];

export { iaOpts, type Tamano } from "../../ia/llm.js";

/** Escalones y formatos que el humano puede pedir directamente en un @ia?. */
export const PEDIDOS: { re: RegExp; nivel: number; tipo: string; que: string }[] = [
  { re: /!pista\b/i, nivel: 1, tipo: "pista", que: "una pista o pregunta guía, nada más" },
  { re: /!piezas?\b/i, nivel: 2, tipo: "pieza", que: "las piezas: funciones/APIs que sirven, con documentación" },
  { re: /!pseudo(c[oó]digo)?\b/i, nivel: 3, tipo: "pista", que: "pseudocódigo: los pasos en palabras, sin sintaxis del lenguaje" },
  { re: /!ejemplo\b/i, nivel: 4, tipo: "ejemplo", que: "un ejemplo análogo de otro dominio" },
  { re: /!plano\b/i, nivel: 2, tipo: "plano", que: "el plano: qué funciones crear, qué hace cada una y en qué orden" },
  { re: /!snippets?\b/i, nivel: 2, tipo: "snippet", que: "qué snippets de la biblioteca usar y con qué valores" },
  { re: /!tests?\b/i, nivel: 2, tipo: "tests", que: "casos de prueba" },
  {
    re: /!arquitectura\b/i,
    nivel: 2,
    tipo: "plano",
    que: "arquitectura: cómo encaja esto en el proyecto (capas, módulos, carpetas, dependencias) y por qué; lee docs/ESTRUCTURA.md y docs/adr si existen",
  },
];

export function pedidoExplicito(texto: string): (typeof PEDIDOS)[number] | undefined {
  return PEDIDOS.find((p) => p.re.test(texto));
}

/** Nombres de los marcadores de un snippet (`${1:metodo}` → metodo). */
export function marcadores(sn: Snippet): string[] {
  return [...new Set([...sn.body.join("\n").matchAll(/\$\{\d+:([^${}]*)\}/g)].map((m) => m[1]!))];
}

export function splitQuestions(q: string): string[] {
  const parts: string[] = [];
  let cur = "";
  let inCode = false;
  for (let i = 0; i < q.length; i++) {
    const ch = q[i]!;
    cur += ch;
    if (ch === "`") inCode = !inCode;
    if (ch === "?" && !inCode && /^\s+[¿A-ZÁÉÍÓÚÑ]/.test(q.slice(i + 1))) {
      parts.push(cur.trim());
      cur = "";
    }
  }
  if (cur.trim()) parts.push(cur.trim());
  const ok = parts.filter((p) => p.length > 3);
  return ok.length > 1 ? ok : [q.trim()];
}

function numbered(src: string, mark: number, from = 0, to = Infinity): string {
  return src
    .split("\n")
    .map((l, i) => ({ l, i }))
    .filter(({ i }) => i >= from && i <= to)
    .map(({ l, i }) => `${String(i + 1).padStart(4)}| ${l}${i === mark ? "   ◀ HILO" : ""}`)
    .join("\n");
}

interface Task {
  /** `!tests`: en vez de responder, se proponen casos en el archivo de tests. */
  tests?: string | true;
  thread: Thread;
  id: string;
  turn: number;
  level: number;
  sub: string;
  subIndex: number;
  subTotal: number;
  prompt: string;
  /** Modo aprender sin un intento todavía: no se aceptan snippets. */
  sinSnippets?: boolean;
}

export interface GuiaResult {
  respondidos: number;
  resueltos: number;
  costoUsd: number;
  avisos: string[];
}

/** Registra en el perfil los hilos que desaparecieron del archivo (resueltos). Devuelve cuántos. */
export function resolveMissing(estado: Estado, rel: string, present: Set<string>): number {
  let n = 0;
  for (const [id, h] of hilosDe(estado, rel)) {
    if (present.has(id)) continue;
    for (const tema of h.temas) registrar(tema, DELTA_RESUELTO[h.nivel] ?? 0, `hilo resuelto con nivel ${h.nivel}: "${h.pregunta.slice(0, 60)}"`);
    deleteHilo(estado, rel, id);
    n++;
  }
  return n;
}

export async function runGuia(root: string, rel: string, log: (s: string) => void = () => {}): Promise<GuiaResult> {
  const abs = path.join(root, rel);
  const lang = langFor(rel);
  if (!lang) throw new Error(`tipo de archivo sin soporte: ${rel}`);
  const src = fs.readFileSync(abs, "utf8");
  const parsed = await parse(src, lang);
  const z = makeZoner(root);
  const critical = z.isCritical(abs);
  const perfil = loadPerfil();
  const temas = temasDe(lang.id, src);
  const nivelProg = nivelDe(puntaje(perfil, lang.id));
  const estado = loadEstado(root);
  const threads = findThreads(src, parsed.comments);
  const result: GuiaResult = { respondidos: 0, resueltos: 0, costoUsd: 0, avisos: [] };
  const ctx = contextoComun(root, rel);
  const libreria = paraLenguaje(biblioteca(root), lang.id);
  const bibliotecaTexto = libreria
    .map((sn) => `- ${sn.nombre}: ${sn.descripcion}${marcadores(sn).length ? ` (marcadores: ${marcadores(sn).join(", ")})` : ""}`)
    .join("\n");

  // Vista "notas": las preguntas @ia? del archivo se responden en notas (el archivo no se toca).
  if (z.config.vista === "notas") return guiaEnNotas(root, rel, src, threads, result, log);

  // 1. Hilos que ya no están en el archivo: el humano los resolvió y los borró.
  result.resueltos = resolveMissing(estado, rel, new Set(threads.map((t) => t.id).filter((x): x is string => !!x)));

  // 2. Armar una tarea por cada pregunta pendiente (y por cada sub-pregunta).
  const taken = new Set<string>();
  const tasks: Task[] = [];
  const lines = src.split("\n").length;
  for (const t of threads.filter((x) => x.pending)) {
    const id = t.id ?? nextThreadId(parsed.comments, taken);
    taken.add(id);
    const prev = (t.id && getHilo(estado, rel, t.id)?.nivel) || t.aiTurns;
    const region = regionOf(src, parsed, t.anchor.start);
    const lastHuman = t.turns[t.turns.length - 1]!.texto;
    const pidioTodo = /!todo\b/.test(lastHuman);
    const pidioNivel = /!nivel\s*([1-4])/.exec(lastHuman);
    const pedido = pedidoExplicito(lastHuman);
    // Solo se sube de nivel si se pide más ayuda explícitamente. Una pregunta nueva vuelve al inicio;
    // un @yo: (intento) se evalúa al mismo nivel.
    const pideMas = /!mas\b|m[aá]s ayuda|dame m[aá]s|qu[eé] m[aá]s|no entiendo|otra pista|sigo sin|no me sale|m[aá]s detalle/i.test(lastHuman);
    const ef = modoEfectivo(z.config, rel);
    const modo: "directo" | "escalera" = critical || /!aprender\b/.test(lastHuman) || ef.c.escalera ? "escalera" : "directo";
    // Modo aprender: snippets recién después de un intento tuyo (un @yo:).
    const sinSnippets = !ef.c.snippetsSinIntento && !t.turns.some((x) => x.quien === "humano" && x.intento);
    const base = modo === "directo" ? 2 : NIVEL_BASE[nivelProg];
    let level = prev === 0 ? base : pideMas ? Math.min(4, Math.max(prev, base) + 1) : t.lastHuman?.kind === "ia" ? base : Math.max(prev, base);
    let sinIntento = false;
    let salto = false;
    // ¿Hubo un intento desde la última respuesta? (un @yo: o un cambio en el código de la región)
    const lastAi = t.turns.map((x) => x.quien).lastIndexOf("ia");
    const intento = t.turns.slice(lastAi + 1).some((x) => x.intento);
    if (critical) {
      const st = t.id ? getHilo(estado, rel, t.id) : undefined;
      if (prev > 0 && !intento && st && st.regionHash === region.hash) {
        level = prev;
        sinIntento = true;
      }
      // Pedir un escalón concreto en zona crítica: como mucho uno más, salvo que haya intento.
      if (pedido && !sinIntento) level = intento ? pedido.nivel : Math.min(pedido.nivel, Math.max(prev, base) + 1);
    } else if (pedido) {
      level = pedido.nivel; // pedido explícito: el humano manda (no es "saltarse" nada)
    } else if (pidioTodo || pidioNivel) {
      const n = pidioTodo ? 4 : Number(pidioNivel![1]);
      salto = n > Math.max(level, prev);
      level = n;
    }
    if (salto) registrar(lang.id, -0.06, "pidió saltar la escalera");
    else if (pideMas && modo === "escalera") registrar(lang.id, -0.02, "pidió más ayuda en un hilo");

    const sugeridos = (th: Thread) => libreria.filter((sn) => th.turns.some((x) => x.quien === "ia" && new RegExp(`snippet \\[.\\]: ${sn.nombre.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(x.texto)));
    const subs = t.aiTurns === 0 ? splitQuestions(t.turns[0]!.texto) : [lastHuman];
    const row = t.anchor.row;
    const fileView = lines <= 400 ? numbered(src, row) : numbered(src, row, Math.max(0, row - 60), row + 60);
    const conversation = t.turns.map((x) => `${x.quien === "ia" ? "TUTOR" : x.intento ? "PROGRAMADOR (intento)" : "PROGRAMADOR"}: ${x.texto}`).join("\n");
    if (pedido?.tipo === "tests") {
      // Función que rodea la pregunta (si es exportada); si no, todo el archivo.
      const fn = medir(src, parsed).funciones.filter((f) => f.exportada && f.linea <= row + 2 && f.linea + f.lineas >= row + 1).pop();
      tasks.push({ tests: fn?.nombre ?? true, thread: t, id, turn: t.aiTurns + 1, level, sub: lastHuman, subIndex: 0, subTotal: 1, prompt: "" });
      continue;
    }
    subs.forEach((sub, i) => {
      tasks.push({
        sinSnippets,
        thread: t,
        id,
        turn: t.aiTurns + 1,
        level,
        sub,
        subIndex: i,
        subTotal: subs.length,
        prompt: [
          `Archivo: ${rel} (${lang.id})${critical ? " — ZONA CRÍTICA" : ""}`,
          notaOrigen(origenDe(z.config, rel)),
          `Programador: ${nivelProg} en ${lang.id}. Temas del archivo: ${temas.join(", ")}.`,
          modo === "directo" ? `MODO DIRECTO.${level > 2 ? ` Pidió más detalle: puedes llegar a pasos en palabras${level > 3 ? " o un ejemplo análogo de otro dominio" : ""}.` : ""}` : `MODO ESCALERA. Nivel MÁXIMO permitido de la escalera: ${level}.`,
          `(nivel interno: ${level})`,
          pedido ? `El programador pidió explícitamente: ${pedido.que}. Responde con eso (tipo "${pedido.tipo}").` : "",
          sugeridos(t).length
            ? `Snippets que ya sugeriste en este hilo (si pregunta por alguna parte, explícala; si quiere otros valores, dile qué cambiar en la línea antes de marcar [x]):\n${sugeridos(t)
                .map((sn) => `${sn.nombre}:\n${sn.body.join("\n")}`)
                .join("\n\n")}`
            : "",
          bibliotecaTexto && !sinSnippets ? `BIBLIOTECA DE SNIPPETS (${lang.id}):\n${bibliotecaTexto}` : "",
          sinSnippets ? "MODO APRENDER: todavía no sugieras snippets; primero que lo intente (con un @yo:)." : "",
          sinIntento ? "En zona crítica el programador pidió más ayuda sin intentar nada: no avances, pedile un intento." : "",
          ctx ? `\n${ctx}\n` : "",
          "Conversación del hilo:",
          conversation,
          "",
          subs.length > 1 ? `Responde SOLO esta parte (${i + 1}/${subs.length}): ${sub}` : `Responde al último mensaje del programador.`,
          "",
          "Código (◀ HILO marca dónde está la conversación):",
          fileView,
        ]
          .filter((l) => l !== "")
          .join("\n"),
      });
    });
  }
  if (!tasks.length) {
    if (result.resueltos) saveEstado(root, estado);
    return result;
  }

  // 3. Una llamada independiente por tarea, en paralelo.
  const userIds = fileIdentifiers(parsed.root, src);
  log(`cai: ${tasks.length} consulta(s) en paralelo para ${rel}`);
  const settled = await Promise.allSettled(
    tasks.map(async (task) => {
      const tag = `${task.id}${task.subTotal > 1 ? `:${task.subIndex + 1}` : ""}`;
      if (task.tests) {
        log(`  → [${tag}] casos de prueba${task.tests === true ? "" : ` para ${task.tests}`}`);
        const r = await proponerTests(root, rel, task.tests === true ? undefined : task.tests);
        result.costoUsd += r.costoUsd;
        const texto = r.casos
          ? `Te propuse ${r.casos} caso(s) en ${r.archivo}${r.preguntas ? `; en ${r.preguntas} te pregunto qué debería pasar` : ""}. Revisa cada uno, ajusta el valor esperado y márcalo [x] para convertirlo en test.`
          : `No pude proponer casos válidos (${r.descartados.join("; ") || "sin funciones exportadas"}).`;
        return { task, replies: [{ tipo: "pista", texto, links: [] }], level: task.level };
      }
      log(`  → [${tag}] nivel ${task.level}: ${task.sub.slice(0, 70)}`);
      let prompt = task.prompt;
      for (let attempt = 0; attempt < 2; attempt++) {
        const { data, costUsd } = await ask<{ respuestas: Reply[]; nivel_usado: number }>({ kind: "guia", system: SYSTEM, prompt, schema: SCHEMA, cwd: root, ...iaOpts(z.config, "mediano") });
        result.costoUsd += costUsd;
        const level = Math.min(task.level, data.nivel_usado || task.level);
        const g = guardReplies(Array.isArray(data?.respuestas) ? data.respuestas : [], task.level, userIds);
        // Sugerencias de snippet: solo de la biblioteca (determinista).
        g.ok = g.ok.filter((r) => {
          if (r.tipo !== "snippet") return true;
          if (task.sinSnippets) {
            g.rejected.push({ reply: r, why: "modo aprender: snippets recién después de un intento" });
            return false;
          }
          const ll = parseLlamada(r.texto);
          if (ll && libreria.some((sn) => sn.nombre === ll.nombre)) return true;
          g.rejected.push({ reply: r, why: `sugirió un snippet que no existe en la biblioteca (${ll?.nombre ?? "?"})` });
          return false;
        });
        if (!g.rejected.length || attempt === 1) {
          for (const r of g.rejected) result.avisos.push(`[${tag}] respuesta descartada: ${r.why}`);
          const ok = g.ok.length
            ? g.ok
            : [{ tipo: "pista", texto: "(La respuesta daba más de lo que corresponde a este nivel y se descartó. Contame qué intentaste con un @yo: y seguimos.)", links: [] }];
          return { task, replies: ok, level };
        }
        prompt = `${task.prompt}\n\nTu respuesta anterior no cumplió las reglas: ${g.rejected.map((r) => r.why).join("; ")}. Corregila.`;
      }
      throw new Error("inalcanzable");
    }),
  );
  // Si una consulta falla, las demás igual se escriben.
  const answers = settled.flatMap((r, i) => {
    if (r.status === "fulfilled") return [r.value];
    result.avisos.push(`[${tasks[i]!.id}] no se pudo responder: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
    return [];
  });
  if (!answers.length) return result;

  // 4. Insertar en el archivo ACTUAL (el humano pudo seguir editando), anclando por texto.
  const current = fs.readFileSync(abs, "utf8");
  const curParsed = await parse(current, lang);
  const curThreads = findThreads(current, curParsed.comments);
  const byThread = new Map<Thread, typeof answers>();
  for (const a of answers) byThread.set(a.task.thread, [...(byThread.get(a.task.thread) ?? []), a]);
  const placements: { at: (typeof curThreads)[number]; lines: string[] }[] = [];
  for (const [orig, list] of byThread) {
    const same = threads.filter((t) => t.anchor.text === orig.anchor.text);
    const idx = same.indexOf(orig);
    const target = curThreads.filter((t) => t.anchor.text === orig.anchor.text)[idx];
    if (!target || target.last.text !== orig.last.text) {
      result.avisos.push(`hilo "${orig.turns[0]!.texto.slice(0, 40)}" cambió mientras se respondía; volvé a pedir guía`);
      continue;
    }
    const indent = indentAt(current, target.anchor);
    const out: string[] = [];
    for (const a of list.sort((x, y) => x.task.subIndex - y.task.subIndex)) {
      for (const r of a.replies) {
        const texto = a.task.subTotal > 1 ? `(${a.task.subIndex + 1}/${a.task.subTotal}) ${r.texto}` : r.texto;
        out.push(...renderReply(lang, indent, `${a.task.id}.${a.task.turn}`, { ...r, texto }));
      }
    }
    placements.push({ at: target, lines: out });
    const a0 = list[0]!;
    setHilo(estado, rel, a0.task.id, {
      file: rel,
      pregunta: orig.turns[0]!.texto,
      nivel: Math.max(...list.map((x) => x.level)),
      regionHash: regionOf(current, curParsed, target.anchor.start).hash,
      temas,
      actualizado: new Date().toISOString(),
    });
    result.respondidos++;
  }
  let next = current;
  for (const p of placements.sort((a, b) => b.at.last.end - a.at.last.end)) next = insertBelow(next, p.at.last, p.lines);

  // 5. La misma regla que se le aplica a la IA: solo se agregaron comentarios @guia.
  const v = await verifyCommentOnly(current, next, lang);
  if (!v.ok) throw new Error(`no se escribió ${rel}: la inserción no pasó la verificación (${v.reasons.join("; ")})`);
  if (next !== current) fs.writeFileSync(abs, next);
  saveEstado(root, estado);
  return result;
}

/** @ia? escritos en el archivo → conversación en una nota anclada al código que sigue. */
async function guiaEnNotas(root: string, rel: string, src: string, threads: Thread[], result: GuiaResult, log: (s: string) => void): Promise<GuiaResult> {
  const lineas = src.split(/\r?\n/);
  const notas = cargarNotas(root, rel, src);
  for (const t of threads) {
    const humanos = t.turns.filter((x) => x.quien === "humano");
    const fuente = `ia?:${t.anchor.text.trim()}`;
    // Lo ya respondido de este @ia? cuenta aunque su nota esté cerrada (si no, se volvería a responder).
    const conFuente = notas.filter((n) => n.fuentes?.[fuente] !== undefined || n.fuente === fuente);
    const ya = Math.max(0, ...conFuente.map((n) => n.fuentes?.[fuente] ?? (n.fuente === fuente ? (n.turnos ?? 0) : 0)));
    const nota = conFuente.find((n) => n.estado === "abierta");
    if (humanos.length <= ya) continue;
    // Ancla: la primera línea de código después del hilo.
    let linea = t.last.row + 2;
    while (linea <= lineas.length && /^\s*(\/\/|#|--|\/\*|\*|<!--|$)/.test(lineas[linea - 1]!)) linea++;
    if (linea > lineas.length) linea = t.anchor.row + 1;
    try {
      const r = await responderNota(
        root,
        {
          archivo: rel,
          ...(nota ? { notaId: nota.id } : { linea }),
          texto: humanos.slice(ya).map((x) => x.texto).join("\n"),
          origen: "pregunta",
          fuente,
          turnos: humanos.length,
        },
        log,
      );
      result.costoUsd += r.costoUsd;
      result.respondidos++;
    } catch (e) {
      result.avisos.push(e instanceof Error ? e.message : String(e));
    }
  }
  return result;
}
