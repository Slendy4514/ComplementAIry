/**
 * PRÁCTICA SIN IA (manifiesto I.6, II.5 y VI.3):
 *
 *   kata          ganar una licencia: escribes a mano una versión mínima que usa esa construcción, en una carpeta
 *                 aislada SIN IA (el hook bloquea todo prompt ahí y cai se niega a llamar a la IA). Pasa tu caso +
 *                 uno oculto, verificados ejecutando.
 *   repaso        predicciones espaciadas (1, 7 y 30 días) sobre código que revisaste; licencias por repasar.
 *                 Fallar baja el nivel del tramo (hay que volver a revisarlo).
 *   reconstruir   el ejercicio semanal: una funcionalidad que hiciste con IA, desde cero, solo con docs oficiales,
 *                 en un worktree sin IA, contra un oráculo oculto (los tests originales). Al final, el diff y tu reflexión.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dataDir, loadConfig, makeZoner } from "../proyecto/config.js";
import { parse } from "../nucleo/comments.js";
import { listFiles } from "../proyecto/files.js";
import { langFor } from "../nucleo/lang.js";
import { medir } from "../proyecto/metricas.js";
import { coincide, ejecutar } from "./predict.js";
import { home, registrar } from "../proyecto/profile.js";
import { runGate } from "../garantias/gate.js";
import { consultarRol } from "../ia/roles.js";
import { construccionesDe, describir } from "../nucleo/construcciones.js";
import { conContenido } from "../nucleo/especificidad.js";
import { asentar, bajarNivel, cargarRegistro, listarRegistros, miEmail, registrarRevision } from "../proyecto/procedencia.js";
import { guardarEvidencia, listarEvidencias } from "../proyecto/evidencias.js";
import { ganarLicencias, porRepasar, registrarPractica, registrarCalibracion } from "../proyecto/expediente.js";
import { listarTareas } from "../proyecto/tareas.js";
import { ejecutarLlamada } from "./ejecutarLlamada.js";
import { caiCommand } from "../cli/init.js";

/** Marca de carpeta SIN IA (kata, reconstrucción): el hook bloquea prompts y `ask` se niega. */
export const marcaSinIa = (root: string) => path.join(root, ".cai", "cache", "sin-ia.json");
export const esSinIa = (root: string) => fs.existsSync(marcaSinIa(root));

function marcarSinIa(root: string, motivo: string): void {
  fs.mkdirSync(path.dirname(marcaSinIa(root)), { recursive: true });
  fs.writeFileSync(marcaSinIa(root), JSON.stringify({ motivo, desde: new Date().toISOString() }));
  // Si alguien abre Claude Code aquí, los hooks bloquean todo prompt y toda herramienta (salvo WebFetch a docs).
  const settings = path.join(root, ".claude", "settings.local.json");
  fs.mkdirSync(path.dirname(settings), { recursive: true });
  const cmd = `${caiCommand()} hook`;
  fs.writeFileSync(settings, JSON.stringify({ hooks: { UserPromptSubmit: [{ matcher: "", hooks: [{ type: "command", command: cmd }] }], PreToolUse: [{ matcher: ".*", hooks: [{ type: "command", command: cmd }] }] } }, null, 2));
}

// --- Katas -------------------------------------------------------------------------------------------------

export interface Kata {
  id: string;
  construccion: string;
  lenguaje: string;
  dir: string;
  archivo: string;
  consigna: string;
  /** Caso oculto (lo genera la IA al crear la kata; no lo ves hasta verificar). */
  oculto: { llamada: string; esperado: string; funcion: string };
  proyecto: string;
  creada: string;
}

const dirKatas = () => path.join(home(), "katas");
const ext = (lang: string) => (lang === "python" ? "py" : lang === "javascript" ? "mjs" : "ts");

export async function nuevaKata(root: string, construccion: string, lenguaje = "typescript"): Promise<Kata> {
  const c = loadConfig(root);
  const r = await consultarRol<{ consigna: string; funcion: string; firma: string; oculto: { llamada: string; esperado: string } }>(c, "clasificar", {
    kind: "kata",
    system: `Diseñas una kata MÍNIMA (10-15 minutos) para practicar una construcción de programación a mano. Una sola función con nombre y firma; la consigna dice QUÉ debe hacer (no cómo) y obliga a usar la construcción. "oculto": una llamada con argumentos literales y su resultado esperado (literal JSON), que el programador no verá hasta verificar. Sin código de solución.`,
    prompt: `Construcción: ${construccion} (${describir(construccion)}). Lenguaje: ${lenguaje}.`,
    schema: { type: "object", required: ["consigna", "funcion", "firma", "oculto"], properties: { consigna: { type: "string" }, funcion: { type: "string" }, firma: { type: "string" }, oculto: { type: "object", required: ["llamada", "esperado"], properties: { llamada: { type: "string" }, esperado: { type: "string" } } } } },
    cwd: root,
  });
  const n = fs.existsSync(dirKatas()) ? fs.readdirSync(dirKatas()).length + 1 : 1;
  const id = `k${n}`;
  const dir = path.join(dirKatas(), id);
  const archivo = `kata.${ext(lenguaje)}`;
  fs.mkdirSync(dir, { recursive: true });
  marcarSinIa(dir, `kata ${id}: ${construccion}`);
  fs.writeFileSync(path.join(dir, archivo), lenguaje === "python" ? `# ${r.data.consigna}\n# Escríbela tú, a mano, usando: ${describir(construccion)}\n${r.data.firma}:\n    pass\n` : `// ${r.data.consigna}\n// Escríbela tú, a mano, usando: ${describir(construccion)}\nexport ${r.data.firma} {\n}\n`);
  fs.writeFileSync(path.join(dir, "caso.json"), JSON.stringify({ llamada: `${r.data.funcion}(…)`, esperado: "…", nota: "Escribe TU caso: una llamada con argumentos literales y lo que debe devolver" }, null, 2));
  fs.writeFileSync(path.join(dir, "LEEME.md"), `# Kata ${id}: ${describir(construccion)}\n\n${r.data.consigna}\n\n1. Escribe la función en \`${archivo}\` (sin IA: aquí todo prompt se bloquea).\n2. Completa \`caso.json\` con tu propio caso.\n3. \`cai kata verificar ${id}\` corre tu caso y uno oculto.\n\nSolo documentación oficial.\n`);
  const k: Kata = { id, construccion, lenguaje, dir, archivo, consigna: r.data.consigna, oculto: { ...r.data.oculto, funcion: r.data.funcion }, proyecto: root, creada: new Date().toISOString() };
  fs.writeFileSync(path.join(dir, ".cai", "cache", "kata.json"), JSON.stringify(k, null, 2));
  return k;
}

export function cargarKata(id: string): Kata {
  const f = path.join(dirKatas(), id, ".cai", "cache", "kata.json");
  if (!fs.existsSync(f)) throw new Error(`no existe la kata ${id}`);
  return JSON.parse(fs.readFileSync(f, "utf8")) as Kata;
}

/** Verifica la kata: usa la construcción, tu caso y el oculto pasan → licencia. */
export async function verificarKata(id: string): Promise<{ ok: boolean; mensajes: string[] }> {
  const k = cargarKata(id);
  const abs = path.join(k.dir, k.archivo);
  const src = fs.readFileSync(abs, "utf8");
  const lang = langFor(abs)!;
  const mensajes: string[] = [];
  const usa = await construccionesDe(src, lang);
  if (!usa.has(k.construccion)) mensajes.push(`✘ tu solución no usa ${describir(k.construccion)} (es lo que practica esta kata)`);
  const caso = JSON.parse(fs.readFileSync(path.join(k.dir, "caso.json"), "utf8")) as { llamada: string; esperado: string };
  if (/…/.test(caso.llamada + caso.esperado)) mensajes.push("✘ completa caso.json con tu propio caso");
  const correr = (llamada: string, esperado: string, quien: string) => {
    const r = ejecutar(k.dir, k.archivo, lang.id, { funcion: k.oculto.funcion, expresion: llamada });
    const ok = !r.infra && coincide(esperado, r);
    mensajes.push(`${ok ? "✔" : "✘"} ${quien}: ${llamada} → esperaba ${esperado}, dio ${r.ok ? JSON.stringify(r.valor) : r.error}`);
    return ok;
  };
  const ok = !mensajes.length && correr(caso.llamada, caso.esperado, "tu caso") && correr(k.oculto.llamada, k.oculto.esperado, "caso oculto");
  registrarPractica({ tipo: "kata", que: k.construccion, ok, proyecto: k.proyecto });
  if (ok) {
    const ganadas = ganarLicencias([k.construccion, ...[...usa].filter((x) => x.startsWith("import:"))], "kata", k.proyecto, `kata ${id}`);
    mensajes.push(`Licencia ganada: ${ganadas.join(", ") || k.construccion} (vigente mientras la uses)`);
    registrar(lang.id, 0.04, `kata ${k.construccion}`);
  }
  return { ok, mensajes };
}

// --- Repaso espaciado ----------------------------------------------------------------------------------------

export interface ItemRepaso {
  n: number;
  tipo: "prediccion" | "licencia";
  archivo?: string;
  funcion?: string;
  hace: string;
  pide: string;
}

const DIAS = [1, 7, 30];

/** Hasta 4 cosas para repasar hoy: código que revisaste hace ~1, 7 o 30 días, y licencias por renovar. */
export async function itemsRepaso(root: string): Promise<ItemRepaso[]> {
  const persona = miEmail(root);
  const ahora = Date.now();
  const evs = listarEvidencias(root, { persona }).filter((e) => e.ok && e.funcion);
  const vistos = new Set<string>();
  const out: ItemRepaso[] = [];
  for (const e of evs.reverse()) {
    const dias = (ahora - Date.parse(e.fecha)) / 86400_000;
    if (!DIAS.some((d) => Math.abs(dias - d) <= Math.max(0.5, d * 0.2))) continue;
    const clave = `${e.archivo}#${e.funcion}`;
    if (vistos.has(clave) || !fs.existsSync(path.join(root, e.archivo))) continue;
    vistos.add(clave);
    out.push({ n: out.length + 1, tipo: "prediccion", archivo: e.archivo, funcion: e.funcion!, hace: `revisada hace ${Math.round(dias)} día(s)`, pide: `sin mirar el código: elige una entrada y predice (\`cai repaso --item ${out.length + 1} --llamada "${e.funcion}(…)" --espero "…"\`)` });
    if (out.length >= 3) break;
  }
  // De vez en cuando, código "tuyo" (detecta lo retipeado de otra pantalla).
  const regs = listarRegistros(root).filter((r) => r.lineas.some((l) => l.o === "humano"));
  if (regs.length && Math.random() < 0.15 && out.length < 4) {
    const r = regs[Math.floor(Math.random() * regs.length)]!;
    const lang = langFor(r.archivo);
    if (lang && fs.existsSync(path.join(root, r.archivo))) {
      const src = fs.readFileSync(path.join(root, r.archivo), "utf8");
      const f = medir(src, await parse(src, lang)).funciones.find((x) => x.exportada);
      if (f) out.push({ n: out.length + 1, tipo: "prediccion", archivo: r.archivo, funcion: f.nombre, hace: "código tuyo (control sorpresa)", pide: `predice una llamada a ${f.nombre}` });
    }
  }
  for (const l of porRepasar().slice(0, 4 - out.length)) out.push({ n: out.length + 1, tipo: "licencia", hace: `licencia ${l.id} sin usar hace más de 8 semanas`, pide: `renuévala con una kata: \`cai kata ${l.id}\`` });
  fs.mkdirSync(path.join(dataDir(root), "cache"), { recursive: true });
  fs.writeFileSync(path.join(dataDir(root), "cache", "repaso.json"), JSON.stringify(out));
  return out;
}

export async function responderRepaso(root: string, n: number, llamada: string, espero: string, seguridad?: number): Promise<{ ok: boolean; mensaje: string }> {
  let items: ItemRepaso[] = [];
  try {
    items = JSON.parse(fs.readFileSync(path.join(dataDir(root), "cache", "repaso.json"), "utf8")) as ItemRepaso[];
  } catch {
    throw new Error("primero mira qué repasar: `cai repaso`");
  }
  const it = items.find((x) => x.n === n);
  if (!it || it.tipo !== "prediccion" || !it.archivo || !it.funcion) throw new Error(`no hay un ítem de predicción ${n}`);
  const lang = langFor(it.archivo)!;
  const r = await ejecutarLlamada(root, it.archivo, llamada);
  if (r.infra) throw new Error(`no pude ejecutar: ${r.error}`);
  const ok = coincide(espero, r);
  registrarPractica({ tipo: "repaso", que: `${it.archivo}#${it.funcion}`, ok, proyecto: root });
  if (seguridad) registrarCalibracion({ seguridad, acierto: ok, dominio: lang.id, proyecto: root });
  registrar(lang.id, ok ? 0.03 : -0.05, `repaso ${it.funcion}`);
  if (!ok) {
    // El tramo vuelve a pedir revisión: lo que no recuerdas, no lo entiendes del todo.
    const reg = cargarRegistro(root, it.archivo);
    if (reg) bajarNivel(root, it.archivo, reg.lineas.map((_, i) => i), 1);
  }
  return { ok, mensaje: `${llamada} → predijiste ${espero}, dio ${r.ok ? JSON.stringify(r.valor) : r.error}${ok ? " ✔" : " ✘ (vuelve a revisarla: `cai revisar " + it.archivo + "`)"}` };
}

// --- Reconstrucción semanal ---------------------------------------------------------------------------------------

export interface Candidata {
  archivo: string;
  funcion: string;
  lineasIa: number;
  tarea: string;
}

/** Las 3 funciones de la semana con más código de la IA (de tareas cerradas). */
export async function candidatasReconstruccion(root: string): Promise<Candidata[]> {
  const semana = Date.now() - 7 * 86400_000;
  const tareas = listarTareas(root).filter((t) => t.ejecutor !== "humano" && t.estado === "cerrada" && Date.parse(t.actualizada) >= semana);
  const out: Candidata[] = [];
  for (const t of tareas)
    for (const rel of t.tocados) {
      const lang = langFor(rel);
      const reg = cargarRegistro(root, rel);
      if (!lang || !reg || !fs.existsSync(path.join(root, rel))) continue;
      const src = fs.readFileSync(path.join(root, rel), "utf8");
      for (const f of medir(src, await parse(src, lang)).funciones) {
        const n = reg.lineas.slice(f.linea - 1, f.linea - 1 + f.lineas).filter((l) => l.o === "ia" && l.t === t.id).length;
        if (n >= 3) out.push({ archivo: rel, funcion: f.nombre, lineasIa: n, tarea: t.id });
      }
    }
  return out.sort((a, b) => b.lineasIa - a.lineasIa).slice(0, 3);
}

const estadoRec = (root: string) => path.join(dataDir(root), "cache", "reconstruccion.json");

/** Crea el worktree sin IA, con la función vaciada y los tests que la nombran ocultos (oráculo). */
export async function empezarReconstruccion(root: string, c: Candidata): Promise<{ dir: string; oraculo: string[] }> {
  const dir = path.join(path.dirname(root), `${path.basename(root)}.cai-reconstruccion-${c.funcion}`);
  if (fs.existsSync(dir)) throw new Error(`ya existe ${dir}: termina o borra esa reconstrucción (\`cai reconstruir terminar\`)`);
  execFileSync("git", ["worktree", "add", "--detach", dir, "HEAD"], { cwd: root, stdio: "ignore" });
  marcarSinIa(dir, `reconstrucción de ${c.funcion}`);
  const abs = path.join(dir, c.archivo);
  const src = fs.readFileSync(abs, "utf8");
  const lang = langFor(abs)!;
  const f = medir(src, await parse(src, lang)).funciones.find((x) => x.nombre === c.funcion);
  if (!f) throw new Error(`no encontré ${c.funcion} en ${c.archivo}`);
  const ls = src.split(/\r?\n/);
  const firma = ls[f.linea - 1]!;
  const cierre = lang.id === "python" ? `${" ".repeat(firma.length - firma.trimStart().length + 4)}pass  # reconstrúyela desde cero` : `${" ".repeat(firma.length - firma.trimStart().length)}}`;
  const vacia = lang.id === "python" ? [firma, cierre] : [firma.includes("{") ? firma : `${firma} {`, `${" ".repeat(firma.length - firma.trimStart().length + 2)}// reconstrúyela desde cero (solo documentación oficial)`, cierre];
  fs.writeFileSync(abs, [...ls.slice(0, f.linea - 1), ...vacia, ...ls.slice(f.linea - 1 + f.lineas)].join("\n"));
  // Oráculo oculto: los tests que nombran la función salen del árbol hasta verificar.
  const z = makeZoner(dir);
  const oraculo = listFiles(z).filter((x) => /(\.|_)(test|spec)\.\w+$|^tests?\//.test(x) && fs.readFileSync(path.join(dir, x), "utf8").includes(c.funcion));
  const escondite = path.join(dir, ".cai", "cache", "oraculo");
  for (const t of oraculo) {
    fs.mkdirSync(path.dirname(path.join(escondite, t)), { recursive: true });
    fs.renameSync(path.join(dir, t), path.join(escondite, t));
  }
  fs.mkdirSync(path.dirname(estadoRec(root)), { recursive: true });
  fs.writeFileSync(estadoRec(root), JSON.stringify({ ...c, dir, oraculo, inicio: new Date().toISOString() }));
  return { dir, oraculo };
}

/** Corre el oráculo, muestra el diff con la versión de la IA y registra tu reflexión. */
export function terminarReconstruccion(root: string, reflexion: string): { ok: boolean; mensajes: string[]; diff: string } {
  if (conContenido(reflexion).length < 8) throw new Error("escribe tu reflexión: qué difiere tu versión de la original y por qué (al menos dos oraciones)");
  const e = JSON.parse(fs.readFileSync(estadoRec(root), "utf8")) as Candidata & { dir: string; oraculo: string[]; inicio: string };
  const escondite = path.join(e.dir, ".cai", "cache", "oraculo");
  for (const t of e.oraculo) {
    fs.mkdirSync(path.dirname(path.join(e.dir, t)), { recursive: true });
    fs.renameSync(path.join(escondite, t), path.join(e.dir, t));
  }
  const g = e.oraculo.length ? runGate(e.dir, e.oraculo, { solo: ["tests"] }) : null;
  const ok = !g || !g.diags.some((d) => d.bloqueante);
  let diff = "";
  try {
    diff = execFileSync("git", ["diff", "--no-index", "--", path.join(root, e.archivo), path.join(e.dir, e.archivo)], { encoding: "utf8" });
  } catch (x) {
    diff = String((x as { stdout?: string }).stdout ?? "");
  }
  const minutos = Math.round((Date.now() - Date.parse(e.inicio)) / 60000);
  registrarPractica({ tipo: "reconstruccion", que: `${e.archivo}#${e.funcion}`, ok, proyecto: root, nota: reflexion, segundos: minutos * 60 });
  const mensajes = [ok ? `✔ el oráculo (${e.oraculo.length} archivo(s) de tests) pasa con tu versión (${minutos} min)` : `✘ el oráculo falla: ${g!.diags.filter((d) => d.bloqueante).map((d) => d.msg).slice(0, 3).join(" | ")}`];
  if (ok) {
    // La evidencia más fuerte sobre las líneas originales de la IA.
    const reg = cargarRegistro(root, e.archivo);
    const src = fs.readFileSync(path.join(root, e.archivo), "utf8");
    const idx = (reg?.lineas ?? []).map((l, i) => (l.o === "ia" ? i : -1)).filter((i) => i >= 0);
    const ev = guardarEvidencia(root, { tipo: "reconstruccion", archivo: e.archivo, funcion: e.funcion, huellas: idx.map((i) => reg!.lineas[i]!.h), persona: miEmail(root), texto: reflexion, ok: true, tarea: e.tarea });
    asentar(root, e.archivo, src, { origen: "humano" });
    registrarRevision(root, e.archivo, src, idx, 4, ev.id);
    mensajes.push("Las líneas originales quedan con evidencia de reconstrucción (nivel 4).");
  }
  try {
    execFileSync("git", ["worktree", "remove", "--force", e.dir], { cwd: root, stdio: "ignore" });
  } catch {
    mensajes.push(`(no pude borrar el worktree ${e.dir}; bórralo con \`git worktree remove\`)`);
  }
  fs.rmSync(estadoRec(root), { force: true });
  return { ok, mensajes, diff };
}

export const reconstruccionEnCurso = (root: string) => fs.existsSync(estadoRec(root));
void os;
