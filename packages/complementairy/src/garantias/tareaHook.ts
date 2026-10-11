/**
 * Garantías v1 en los hooks de Claude Code (deterministas; la IA no puede saltárselas):
 *
 *  PreToolUse Edit/Write   la IA escribe código SOLO si hay una tarea EJECUTANDO ligada a la sesión y el archivo
 *                          está en su alcance; nunca en líneas rojas; sin dependencias nuevas si así se decidió;
 *                          sin tocar lo que hay que preservar ni tus líneas de la tarea; en pasos chicos
 *                          (presupuesto); y solo construcciones que ya escribiste tú a mano (licencias, I.6)
 *  PostToolUse Edit/Write  procedencia (esas líneas son de la IA, nivel 0) y señales de bucle
 *  SessionStart            liga la sesión a la tarea en ejecución e inyecta su contexto (o modo exploración)
 *  UserPromptSubmit        conversación corta (umbral de turnos → traspaso), modelo fijo por fase, pedidos vagos
 *  Stop                    checkpoint si los tests pasan; si lo escrito sin revisar supera el presupuesto → revisión
 *  PreToolUse mcp__*       leer se permite; escribir en sistemas externos pide confirmación ("ask")
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import picomatch from "picomatch";
import type { Zoner } from "../proyecto/config.js";
import { loadConfig } from "../proyecto/config.js";
import { langFor } from "../nucleo/lang.js";
import { parse } from "../nucleo/comments.js";
import { medir } from "../proyecto/metricas.js";
import { runGate } from "./gate.js";
import { dividir, huellaLinea, lineasNuevas } from "../nucleo/diffLineas.js";
import { construccionesDe, describir } from "../nucleo/construcciones.js";
import { pedidoEspecifico, esVago } from "../nucleo/especificidad.js";
import type { Tarea } from "../nucleo/flujo.js";
import { asentar, cargarRegistro } from "../proyecto/procedencia.js";
import { licenciasFaltantes } from "../proyecto/expediente.js";
import { dependenciaFuera } from "../proyecto/reglas.js";
import { conTarea, listarTareas, tareaEjecutando } from "../proyecto/tareas.js";
import { checkpoint, registrarContexto, registrarDenegacion, registrarEdicion, registrarPrueba, registrarRespuestaIa } from "./bucle.js";
import { sinEvidencia } from "../proyecto/estadoTarea.js";
import { sugerencia } from "../nucleo/flujo.js";
import { refDeRol } from "../proyecto/rolesConfig.js";
import { cargarDecisiones } from "../proyecto/decisiones.js";

const enAlcance = (t: Tarea, rel: string) => t.restricciones.alcance.length > 0 && picomatch(t.restricciones.alcance, { dot: true })(rel);

function deps(texto: string, rel: string): Set<string> {
  const out = new Set<string>();
  if (/package\.json$/.test(rel)) {
    try {
      const j = JSON.parse(texto) as Record<string, Record<string, string> | undefined>;
      for (const k of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) for (const d of Object.keys(j[k] ?? {})) out.add(d);
    } catch {
      /* JSON a medias: lo verá el gate */
    }
  } else if (/requirements[\w.-]*\.txt$/.test(rel)) for (const m of texto.matchAll(/^([A-Za-z0-9_.-]+)/gm)) out.add(m[1]!.toLowerCase());
  else if (/pyproject\.toml$/.test(rel)) for (const m of texto.matchAll(/^\s*["']([A-Za-z0-9_.-]+)\s*[=<>~!]/gm)) out.add(m[1]!.toLowerCase());
  return out;
}

function textoEnBase(root: string, base: string | undefined, rel: string): string {
  if (!base) return "";
  try {
    return execFileSync("git", ["show", `${base}:${rel}`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "";
  }
}

/**
 * ¿Puede la IA hacer esta edición dentro de su tarea? null = sí; si no, por qué (para el mensaje de denegación).
 * Antes de decidir, lo que cambió a mano se asienta como tuyo.
 */
export async function edicionPermitida(z: Zoner, t: Tarea, abs: string, antes: string, despues: string): Promise<string | null> {
  const rel = z.rel(abs);
  if (z.isRoja(abs)) return `${rel} es LÍNEA ROJA (lógica central, rutas críticas o seguridad): la IA nunca escribe aquí, ni dentro de una tarea. Explica y guía; el código lo escribe el programador.`;
  if (!enAlcance(t, rel) && !/(^|\/)(package\.json|requirements[\w.-]*\.txt|pyproject\.toml)$/.test(rel))
    return `${rel} está fuera del alcance de la tarea ${t.id} (${t.restricciones.alcance.join(", ") || "sin alcance"}). Si hace falta, el programador lo amplía (\`cai tarea ${t.id} --alcance …\`).`;
  // Dependencias nuevas.
  const nuevasDeps = [...deps(despues, rel)].filter((d) => !deps(antes, rel).has(d));
  if (nuevasDeps.length) {
    if (t.restricciones.sinDependencias) return `la tarea ${t.id} se aprobó SIN dependencias nuevas y esto agrega ${nuevasDeps.join(", ")}. Si hace falta, propónlo como decisión al programador.`;
    const fuera = nuevasDeps.map(dependenciaFuera).filter(Boolean);
    if (fuera.length) return `${fuera.join("; ")}: eso es una decisión del programador (\`cai decidir\`), no tuya.`;
  }
  if (!langFor(rel)) return null;
  const lang = langFor(rel)!;
  // Lo tuyo primero: lo que cambió a mano desde la última vez es tuyo.
  asentar(z.root, rel, antes, { origen: "humano" });
  // Preservar: el cuerpo de esas funciones no cambia ("@firma": solo su firma).
  const preservar = t.restricciones.preservar.filter((p) => p.startsWith(`${rel}#`)).map((p) => {
    const k = p.slice(rel.length + 1);
    return { nombre: k.replace(/@firma$/, "").replace(/#\d+$/, ""), soloFirma: k.endsWith("@firma") };
  });
  if (preservar.length) {
    const cuerpo = async (src: string) => {
      const m = medir(src, await parse(src, lang));
      const ls = src.split(/\r?\n/);
      return new Map(m.funciones.map((f) => [f.nombre, { todo: ls.slice(f.linea - 1, f.linea - 1 + f.lineas).join("\n"), firma: (ls[f.linea - 1] ?? "").trim() }]));
    };
    const [a, d] = [await cuerpo(antes), await cuerpo(despues)];
    const tocadas = preservar.filter((p) => a.has(p.nombre) && (p.soloFirma ? a.get(p.nombre)!.firma !== d.get(p.nombre)?.firma : a.get(p.nombre)!.todo !== d.get(p.nombre)?.todo));
    if (tocadas.length) return `${tocadas.map((p) => `${p.nombre}${p.soloFirma ? " (su firma)" : ""}`).join(", ")} se debe PRESERVAR en la tarea ${t.id} (lo pidió el programador): no lo cambies.`;
  }
  // Tus líneas de la tarea (escritas a mano después de empezar): la IA refactoriza alrededor, no encima (V.4.3).
  const reg = cargarRegistro(z.root, rel);
  // Sin base de git no se puede saber qué escribiste DESPUÉS de empezar la tarea: no se adivina.
  if (reg && t.base) {
    const base = new Set(dividir(textoEnBase(z.root, t.base, rel)).map(huellaLinea));
    const tuyas = reg.lineas.filter((l) => l.o === "humano" && !base.has(l.h)).map((l) => l.h);
    const quedan = new Set(dividir(despues).map(huellaLinea));
    const borradas = tuyas.filter((h) => !quedan.has(h));
    if (borradas.length) return `esta edición cambia ${borradas.length} línea(s) que el programador escribió a mano en esta tarea: refactoriza ALREDEDOR de sus cambios, sin tocarlos (V.4.3).`;
  }
  // Pasos chicos: presupuesto por edición y por tramo sin revisar.
  const nuevas = lineasNuevas(antes, despues).length;
  const tope = t.restricciones.presupuestoLineas;
  if (nuevas > tope) return `esta edición escribe ${nuevas} líneas y el presupuesto por paso es ${tope}: divídela en pasos más chicos (se revisan mejor).`;
  const pendientes = sinEvidencia(z.root, t).reduce((a, x) => a + (x.hasta - x.desde + 1), 0);
  if (pendientes + nuevas > tope * 2) return `ya hay ${pendientes} líneas tuyas (de la IA) sin revisar en ${t.id}: el programador revisa antes de seguir (\`cai avanzar ${t.id}\` → \`cai revisar --tarea ${t.id}\`).`;
  // Licencias (I.6): solo construcciones que el programador ya escribió a mano.
  if (t.ejecutor !== "humano") {
    const ya = await construccionesDe(antes, lang);
    const faltan = licenciasFaltantes([...(await construccionesDe(despues, lang))].filter((c) => !ya.has(c)));
    if (faltan.length) return `usa ${faltan.map((f) => `${f} (${describir(f)})`).join(", ")}, que el programador todavía no escribió a mano (Regla de Oro del Aprendiz, I.6). Que haga la kata primero: \`cai kata ${faltan[0]}\`. O hazlo sin esa construcción.`;
  }
  return null;
}

/** La tarea de esta sesión (o la única en ejecución). */
export const tareaDe = (root: string, sesion?: string) => tareaEjecutando(root, sesion);

/** PostToolUse Edit/Write de la IA dentro de una tarea: procedencia + señales de bucle. */
export function despuesDeEditar(z: Zoner, t: Tarea, abs: string): string[] {
  const rel = z.rel(abs);
  if (!fs.existsSync(abs)) return [];
  const contenido = fs.readFileSync(abs, "utf8");
  const nuevas = asentar(z.root, rel, contenido, { origen: "ia", autor: `claude-code/${t.ejecutor}`, tarea: t.id });
  const n = conTarea(z.root, t.id, (x) => ({ ...x, tocados: [...new Set([...x.tocados, rel])] }));
  const lineasTarea = (cargarRegistro(z.root, rel)?.lineas ?? []).filter((l) => l.t === t.id).length;
  const senales = registrarEdicion(z.root, n, rel, contenido, lineasTarea);
  return [`${rel}: ${nuevas.length} línea(s) de la IA registradas (sin revisar)`, ...(senales.length ? [`señales de bucle: ${senales.join(", ")}`] : [])];
}

export function denegada(root: string, t: Tarea | undefined): void {
  if (t) registrarDenegacion(root, t);
}

/** PostToolUse Bash: corridas de tests (mismo fallo repetido). */
export function despuesDeBash(root: string, t: Tarea, comando: string, respuesta: unknown): void {
  if (!/\b(vitest|jest|pytest|mocha|ava|(pnpm|npm|yarn)\s+(run\s+)?test|go test|cargo test)\b/.test(comando)) return;
  const r = respuesta as { stdout?: string; stderr?: string; interrupted?: boolean } | string | undefined;
  const salida = typeof r === "string" ? r : `${r?.stdout ?? ""}\n${r?.stderr ?? ""}`;
  const falla = /\b(FAIL|failed|✗|×|Error:|AssertionError|Traceback)\b/.test(salida) && !/\b0 failed\b/.test(salida);
  const verdes = Number(/(\d+)\s+passed/.exec(salida)?.[1] ?? NaN);
  registrarPrueba(root, t, salida, !falla, Number.isFinite(verdes) ? verdes : undefined);
}

// --- SessionStart ------------------------------------------------------------------------------------------

export function alIniciarSesion(root: string, sesion: string, fuente?: string): string {
  const ts = listarTareas(root);
  let t = ts.find((x) => x.sesion === sesion && x.estado === "ejecutando");
  if (!t) {
    const libres = ts.filter((x) => x.estado === "ejecutando" && !x.sesion);
    if (libres.length === 1) t = conTarea(root, libres[0]!.id, (x) => ({ ...x, sesion }));
  }
  if (fuente === "compact" && t) registrarContexto(root, t, "compactación");
  if (!t) {
    const act = ts.filter((x) => !["cerrada", "descartada"].includes(x.estado));
    return [
      "[cai] Modo EXPLORACIÓN: no hay una tarea en ejecución ligada a esta sesión. Puedes leer, explicar, planificar y guiar; NO escribir código (el hook lo bloquea).",
      "Para delegar: el programador crea una tarea (`cai pedir \"…\"`), responde la entrevista, escribe su diseño, aprueba el plan y la ejecuta (`cai tarea <id> --ejecutar`). Una sesión = una tarea (IV.6).",
      act.length ? `Tareas activas: ${act.slice(0, 6).map((x) => `${x.id} ${x.estado} «${x.titulo}»`).join(" · ")}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }
  return [
    `[cai] Esta sesión implementa la tarea ${t.id}: «${t.titulo}» (una sesión = una tarea).`,
    `Alcance (solo estos archivos): ${t.restricciones.alcance.join(", ")}`,
    `${t.restricciones.sinDependencias ? "Sin dependencias nuevas. " : ""}${t.restricciones.preservar.length ? `Preservar: ${t.restricciones.preservar.join(", ")}. ` : ""}Pasos de ≤ ${t.restricciones.presupuestoLineas} líneas.`,
    t.plan ? `Plan aprobado (implementa EXACTAMENTE esto):\n${t.plan.pasos.map((p, i) => `${i + 1}. ${p}`).join("\n")}\nCómo probar: ${t.plan.comoProbar.join(" · ")}` : "",
    t.parafrasis ? `Lo que el programador entendió del plan: ${t.parafrasis}` : "",
    (() => {
      const ds = cargarDecisiones(root).filter((d) => d.tarea === t!.id && d.estado === "vigente");
      return ds.length ? `Decisiones del programador (respétalas):\n${ds.map((d) => `- ${d.pregunta} → ${d.eleccion}${d.porque ? ` (porque ${d.porque})` : ""}`).join("\n")}` : "";
    })(),
    t.replanteo ? `Replanteo del programador después de desconectar: ${t.replanteo}` : "",
    (() => {
      const f = path.join(root, ".cai", "tareas", t.id, "traspaso.md");
      return fs.existsSync(f) ? `Traspaso de la sesión anterior (corregido por el programador):\n${fs.readFileSync(f, "utf8").replace(/<!--[\s\S]*?-->/g, "").trim()}` : "";
    })(),
    "Si algo es ambiguo, NO adivines: deja de editar y presenta 2 opciones con pros y contras. Al terminar cada paso, explica qué hiciste y cómo probarlo.",
  ]
    .filter(Boolean)
    .join("\n");
}

// --- UserPromptSubmit ---------------------------------------------------------------------------------------

interface Linea {
  type?: string;
  message?: { role?: string; model?: string; content?: unknown };
  timestamp?: string;
}

function leerTranscript(p?: string): Linea[] {
  if (!p) return [];
  try {
    return fs
      .readFileSync(p, "utf8")
      .split("\n")
      .filter(Boolean)
      .flatMap((l) => {
        try {
          return [JSON.parse(l) as Linea];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

const IMPERATIVO = /^\s*(agrega|añade|crea|haz|implementa|arregla|corrige|cambia|quita|elimina|mueve|renombra|refactoriza|escribe|programa|mejora|optimiza|pon|actualiza|add|create|fix|implement|make|change|remove|refactor|write)\b/i;

/** Devuelve { block, reason } o un contexto para agregar. */
export function alEnviarPrompt(root: string, sesion: string, prompt: string, transcript?: string): { block?: string; contexto?: string } {
  const c = loadConfig(root);
  const ts = listarTareas(root);
  const t = ts.find((x) => x.sesion === sesion && !["cerrada", "descartada"].includes(x.estado));
  const lineas = leerTranscript(transcript);
  const turnos = lineas.filter((l) => l.type === "user" && typeof l.message?.content === "string").length;
  if (turnos >= c.flujo.maxTurnos) {
    if (t) registrarContexto(root, t, "turnos");
    return { block: `[cai] Esta conversación ya tiene ${turnos} turnos (máximo ${c.flujo.maxTurnos}): las conversaciones largas confunden al modelo y encarecen cada mensaje (IV.6). Cierra con \`cai traspaso${t ? ` ${t.id}` : ""}\` (resumen que corriges tú) y abre una sesión nueva con /clear.` };
  }
  const modelos = [...new Set(lineas.filter((l) => l.type === "assistant" && l.message?.model && l.message.model !== "<synthetic>").map((l) => l.message!.model!))];
  if (t && modelos.length > 1) return { block: `[cai] En esta conversación se cambió de modelo (${modelos.join(" → ")}): se pierde la caché de contexto y cambia el criterio a mitad de la tarea (IV.5). Planificar y ejecutar van en sesiones distintas; vuelve al modelo de la fase o abre otra sesión.` };
  // IV.5: la fase pide una clase de modelo (razonamiento para planificar, código para implementar).
  const ultimo = modelos[modelos.length - 1];
  const esperado = t ? (["diseñada", "borrador"].includes(t.estado) ? refDeRol(c, "planificar") : t.estado === "ejecutando" ? refDeRol(c, "implementar") : "") : "";
  const familia = (m: string) => /opus|sonnet|haiku|gpt|gemini|deepseek|qwen/i.exec(m)?.[0]?.toLowerCase() ?? m;
  const avisoModelo = ultimo && esperado && familia(ultimo) !== familia(esperado.split(":").pop() ?? "") ? `[cai] Esta fase (${t!.estado}) pide ${esperado.split(":").pop()} y la sesión usa ${ultimo} (IV.5: razonamiento para planificar, modelo de código para implementar). Cámbialo al empezar una sesión nueva, no a mitad.` : "";
  if (IMPERATIVO.test(prompt)) {
    if (!t || t.estado !== "ejecutando") {
      return { contexto: "[cai] El programador pide un cambio pero no hay tarea en ejecución: no escribas código (el hook lo bloquea). Ayúdalo a convertirlo en una tarea: `cai pedir \"<su pedido>\"` separa los temas y arma la entrevista de restricciones." };
    }
    const vago = pedidoEspecifico(prompt, []) && (esVago(prompt) || prompt.trim().split(/\s+/).length < 5);
    if (vago) return { block: `[cai] Pedido vago para delegar (IV.1): di qué cambiar, dónde (archivo, función, campo) y cómo sabrás que funciona. Ejemplo: «Añade un campo booleano \`editable\` a \`users\`, exponlo en \`GET /api/users/:id\` y renderiza \`EditButton\` según ese campo».` };
  }
  return t ? { contexto: `[cai] Tarea ${t.id} (${t.estado}): ${sugerencia(t)}${avisoModelo ? `\n${avisoModelo}` : ""}` } : {};
}

// --- Stop ---------------------------------------------------------------------------------------------------

export function alDetenerse(root: string, sesion: string, ultimoTexto?: string): string | null {
  const t = tareaEjecutando(root, sesion);
  if (!t) return null;
  if (ultimoTexto) registrarRespuestaIa(root, t, ultimoTexto);
  const pend = sinEvidencia(root, t).reduce((a, x) => a + (x.hasta - x.desde + 1), 0);
  let verde = false;
  if (t.tocados.length) {
    try {
      const g = runGate(root, t.tocados, { solo: ["tests"], timeoutMs: 120_000 });
      verde = !g.diags.some((d) => d.bloqueante) && g.corridas.some((x) => x.estado === "ok");
    } catch {
      /* sin tests */
    }
  }
  if (verde) checkpoint(root, t.id, "tests en verde");
  if (pend > t.restricciones.presupuestoLineas) {
    conTarea(root, t.id, (x) => ({ ...x, estado: "en-revision", actualizada: new Date().toISOString(), historial: [...x.historial, { de: x.estado, a: "en-revision", cuando: new Date().toISOString(), motivo: `${pend} líneas sin revisar (presupuesto ${x.restricciones.presupuestoLineas})` }] }));
    return `[cai] ${t.id}: ${pend} líneas de la IA sin revisar → pasa a revisión. El programador da evidencia por tramo: \`cai revisar --tarea ${t.id}\`.${verde ? " (checkpoint guardado: tests en verde)" : ""}`;
  }
  return `[cai] ${t.id}: ${pend} líneas sin revisar.${verde ? " Checkpoint guardado (tests en verde)." : ""} Al terminar: \`cai avanzar ${t.id}\`.`;
}

// --- MCP -------------------------------------------------------------------------------------------------------

const ESCRIBE = /(create|update|delete|remove|write|post|send|publish|deploy|provision|merge|push|comment|close|assign|upload|insert|execute|run|apply|set|put|patch)/i;
/** null = permitir; "ask" = que el humano confirme (escribe en un sistema externo). */
export function politicaMcp(tool: string): { decision: "ask"; razon: string } | null {
  const accion = tool.split("__").pop() ?? tool;
  if (ESCRIBE.test(accion) && !/^(get|list|read|search|fetch|query|describe|find)/i.test(accion)) return { decision: "ask", razon: `[cai] ${tool} modifica un sistema externo: confírmalo tú (III.4: interacción controlada).` };
  return null;
}

/** Lista legible de lo que la IA puede hacer ahora (para mensajes de denegación). */
export function porQueNoPuede(root: string, rel: string, sesion?: string): string {
  const ts = listarTareas(root);
  const ej = ts.filter((t) => t.estado === "ejecutando");
  if (!ej.length) return "no hay ninguna tarea en ejecución: la IA solo escribe código dentro de una tarea con diseño humano y plan aprobado (`cai pedir \"…\"`).";
  const mia = ej.find((t) => t.sesion === sesion);
  if (!mia) return `la tarea en ejecución (${ej.map((t) => t.id).join(", ")}) está ligada a otra sesión: una sesión = una tarea.`;
  return `${rel} no está en el alcance de ${mia.id}.`;
}
