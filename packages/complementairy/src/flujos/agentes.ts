/**
 * Flujos avanzados (manifiesto V.6) y conversación corta (IV.6):
 *
 *   git        "crea una rama de release y aplica cherry-pick de los arreglos" → la IA traduce a comandos git;
 *              los riesgos se detectan SIN IA; los ejecutas tú (`--ejecutar`), los destructivos con `--confirmo <rama>`
 *   paralelo   un worktree por tarea aprobada (rama con la convención), tablero de todas
 *   agente     un agente por ROL con permisos impuestos en código (canUseTool), no en el prompt:
 *                implementador  escribe solo en el alcance, sin tests
 *                tester         escribe solo tests y NO puede leer la implementación (tests desde la especificación)
 *                revisor        solo lee; deja su revisión como texto (nunca reemplaza tu evidencia)
 *                refactorizador alcance menos tus líneas, con los tests congelados
 *   traspaso   resumen de la tarea para seguir en una sesión NUEVA (lo corriges tú)
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import picomatch from "picomatch";
import { dataDir, loadConfig, makeZoner } from "../proyecto/config.js";
import { sdk } from "../ia/llm.js";
import { riesgos } from "./terminal.js";
import { consultarRol, refDeRol, partir } from "../ia/roles.js";
import { comoDato } from "../ia/decisor.js";
import { conContenido } from "../nucleo/especificidad.js";
import type { Tarea } from "../nucleo/flujo.js";
import { asentar } from "../proyecto/procedencia.js";
import { ramaInvalida } from "../proyecto/reglas.js";
import { cargarTarea, conTarea, listarTareas } from "../proyecto/tareas.js";
import { edicionPermitida } from "../garantias/tareaHook.js";
import { cargarDecisiones } from "../proyecto/decisiones.js";
import { listFiles } from "../proyecto/files.js";

// --- Git en lenguaje natural ---------------------------------------------------------------------------------

export interface PlanGit {
  pedido: string;
  comandos: { cmd: string; explica: string; riesgos: string[] }[];
  advertencias: string[];
}

const archivoPlanGit = (root: string) => path.join(dataDir(root), "cache", "git-plan.json");
const DESTRUCTIVO = /\b(reset\s+--hard|push\s+(-f|--force)|branch\s+-D|clean\s+-[a-z]*f|rebase|checkout\s+--\s|restore\s|filter-branch|reflog\s+expire|gc\s+--prune|stash\s+(drop|clear)|tag\s+-d|push\s+\S+\s+:)/;

export async function traducirGit(root: string, pedido: string): Promise<PlanGit> {
  if (conContenido(pedido).length < 3) throw new Error("di qué quieres hacer con git (ramas, commits, cherry-pick…)");
  let estado = "";
  try {
    estado = execFileSync("git", ["status", "-sb"], { cwd: root, encoding: "utf8" }) + execFileSync("git", ["log", "--oneline", "-15"], { cwd: root, encoding: "utf8" }) + execFileSync("git", ["branch", "-a"], { cwd: root, encoding: "utf8" });
  } catch {
    /* sin git */
  }
  const r = await consultarRol<{ comandos: { cmd: string; explica: string }[]; advertencias: string[] }>(loadConfig(root), "traducirGit", {
    kind: "git",
    system: "Traduces un pedido de git en lenguaje natural a una lista ORDENADA de comandos git concretos (uno por elemento, solo `git …`, sin encadenar con && ni ;). Cada uno con su explicación en una oración. Advierte lo que pueda perder trabajo. Si es ambiguo, NO adivines: deja `comandos` vacío y explica en advertencias qué falta saber (2 opciones).",
    prompt: `Estado del repo:\n${estado}\n\nPedido:\n${comoDato("pedido", pedido)}`,
    schema: { type: "object", required: ["comandos", "advertencias"], properties: { comandos: { type: "array", items: { type: "object", required: ["cmd", "explica"], properties: { cmd: { type: "string" }, explica: { type: "string" } } } }, advertencias: { type: "array", items: { type: "string" } } } },
    cwd: root,
  });
  const plan: PlanGit = { pedido, comandos: r.data.comandos.map((c) => ({ ...c, riesgos: [...riesgos(c.cmd), ...(DESTRUCTIVO.test(c.cmd) ? ["destructivo: puede perder trabajo"] : [])] })), advertencias: r.data.advertencias };
  const ramaNueva = plan.comandos.map((c) => /\b(?:checkout\s+-b|switch\s+-c|branch)\s+([\w./-]+)/.exec(c.cmd)?.[1]).find(Boolean);
  if (ramaNueva) {
    const mala = ramaInvalida(root, ramaNueva);
    if (mala) plan.advertencias.push(mala);
  }
  fs.mkdirSync(path.dirname(archivoPlanGit(root)), { recursive: true });
  fs.writeFileSync(archivoPlanGit(root), JSON.stringify(plan, null, 2));
  return plan;
}

/** Argumentos de un comando git sin shell (comillas simples o dobles). Rechaza metacaracteres. */
export function argsGit(cmd: string): string[] {
  if (/[;&|`$()<>\n]/.test(cmd)) throw new Error(`no ejecuto comandos con encadenamientos o redirecciones: ${cmd}`);
  const partes = [...cmd.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]!);
  if (partes[0] !== "git") throw new Error(`solo comandos git: ${cmd}`);
  return partes.slice(1);
}

/** Ejecuta el plan guardado (solo humano). Lo destructivo exige escribir el nombre de la rama actual. */
export function ejecutarPlanGit(root: string, confirmo?: string): string[] {
  const plan = JSON.parse(fs.readFileSync(archivoPlanGit(root), "utf8")) as PlanGit;
  const rama = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const out: string[] = [];
  for (const c of plan.comandos) {
    if (c.riesgos.length && confirmo !== rama) {
      // Lo destructivo: primero se ve qué haría (dry-run cuando git lo permite), después se confirma.
      const args = argsGit(c.cmd);
      const seco = /^(push|clean|rm|add|mv)$/.test(args[0] ?? "") ? [...args, args[0] === "clean" ? "-n" : "--dry-run"] : null;
      let vista = "";
      if (seco) {
        try {
          vista = execFileSync("git", seco, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
        } catch (e) {
          vista = String((e as { stderr?: string }).stderr ?? "").trim();
        }
      }
      out.push(`⛔ ${c.cmd}: ${c.riesgos.join("; ")}.${vista ? `\nQué haría (dry-run):\n${vista}` : " (sin dry-run en git para esto: revisa con git status / git log)"}\nSi estás de acuerdo: cai git --ejecutar --confirmo ${rama}`);
      break;
    }
    try {
      out.push(`$ ${c.cmd}\n${execFileSync("git", argsGit(c.cmd), { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()}`);
    } catch (e) {
      out.push(`✘ ${c.cmd}: ${(e as { stderr?: string }).stderr?.toString().trim() ?? (e as Error).message}`);
      break;
    }
  }
  fs.rmSync(archivoPlanGit(root), { force: true });
  return out;
}

// --- Worktrees en paralelo ------------------------------------------------------------------------------------

const slug = (t: string) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30);

/** Nombre de rama que cumple la convención si se puede (feature/, fix/, refactor/…), si no cai/<id>-<slug>. */
export function nombreRama(root: string, t: Tarea): string {
  const pref = t.tipo === "bug" ? "fix" : t.tipo === "refactor" ? "refactor" : "feature";
  for (const c of [`${pref}/${t.id}-${slug(t.titulo)}`, `${pref}/${slug(t.titulo)}`, `cai/${t.id}-${slug(t.titulo)}`]) if (!ramaInvalida(root, c)) return c;
  return `cai/${t.id}-${slug(t.titulo)}`;
}

export function crearWorktree(root: string, id: string): { dir: string; rama: string } {
  const t = cargarTarea(root, id);
  if (t.estado !== "aprobada") throw new Error(`la tarea ${id} está ${t.estado}: en paralelo van tareas aprobadas`);
  const rama = nombreRama(root, t);
  const dir = path.join(path.dirname(root), `${path.basename(root)}.cai`, id);
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  execFileSync("git", ["worktree", "add", "-b", rama, dir], { cwd: root, stdio: "ignore" });
  // El worktree necesita la tarea (y el resto de .cai) aunque no esté commiteado.
  fs.cpSync(path.join(dataDir(root)), path.join(dir, ".cai"), { recursive: true, filter: (s) => !s.includes(`${path.sep}cache`) });
  if (fs.existsSync(path.join(root, ".claude"))) fs.cpSync(path.join(root, ".claude"), path.join(dir, ".claude"), { recursive: true });
  conTarea(root, id, (x) => ({ ...x, worktree: dir, rama }));
  conTarea(dir, id, (x) => ({ ...x, worktree: dir, rama }));
  return { dir, rama };
}

/** Tablero: tareas del repo y de cada worktree, con su estado y señales. */
export function tablero(root: string): string[] {
  const filas: string[] = [];
  const ver = (r: string, donde: string) => {
    for (const t of listarTareas(r).filter((x) => !["cerrada", "descartada"].includes(x.estado)))
      filas.push(`${t.id.padEnd(5)} ${t.estado.padEnd(13)} ${donde.padEnd(28)} ${t.bucle?.senales.length ? `⚠ ${t.bucle.senales.join(",")} ` : ""}${t.titulo}`);
  };
  ver(root, "(aquí)");
  try {
    const wts = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: root, encoding: "utf8" }).split("\n").filter((l) => l.startsWith("worktree ")).map((l) => l.slice(9));
    for (const w of wts) if (path.resolve(w) !== path.resolve(root) && fs.existsSync(path.join(w, ".cai"))) ver(w, path.relative(path.dirname(root), w));
  } catch {
    /* sin git */
  }
  return filas.length ? ["ID    ESTADO        DÓNDE                        TAREA", ...filas] : ["no hay tareas activas"];
}

// --- Agentes por rol (permisos en código) -----------------------------------------------------------------------

export type RolAgente = "implementador" | "tester" | "revisor" | "refactorizador";

const ES_TEST = picomatch(["**/*.test.*", "**/*.spec.*", "tests/**", "test/**", "**/__tests__/**", "**/test_*.py", "**/*_test.py"], { dot: true });

/** Qué puede hacer un rol con una herramienta (determinista). null = permitido. */
export function permisoRol(rol: RolAgente, t: Tarea, tool: string, rel: string | undefined): string | null {
  const escribe = ["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(tool);
  if (tool === "Bash" && rol !== "tester") return "este rol no usa la terminal";
  // Buscar texto dentro de los archivos sería leer la implementación por otro camino.
  if (tool === "Grep" && rol === "tester") return "el tester no busca dentro del código: escribe los tests desde el plan y las firmas";
  if (!rel) return null;
  const alcance = t.restricciones.alcance.length ? picomatch(t.restricciones.alcance, { dot: true })(rel) : false;
  switch (rol) {
    case "revisor":
      return escribe ? "el revisor solo lee" : null;
    case "tester":
      if (escribe) return ES_TEST(rel) ? null : "el tester solo escribe tests";
      if (alcance && !ES_TEST(rel)) return "el tester NO lee la implementación: escribe los tests desde el plan y las firmas (así no copia los bugs)";
      return null;
    case "implementador":
      if (escribe && ES_TEST(rel)) return "el implementador no escribe tests (los escribe el tester; los valores esperados, el programador)";
      if (escribe && !alcance) return "fuera del alcance de la tarea";
      return null;
    case "refactorizador":
      if (escribe && ES_TEST(rel)) return "los tests están congelados durante el refactor";
      if (escribe && !alcance) return "fuera del alcance de la tarea";
      return null;
  }
}

const SISTEMA_ROL: Record<RolAgente, string> = {
  implementador: "Eres el IMPLEMENTADOR. Implementa EXACTAMENTE el plan aprobado, paso a paso, en cambios chicos. Solo los archivos del alcance, sin dependencias nuevas, sin tests. Si algo es ambiguo, detente y descríbelo con 2 opciones. Al final: qué hiciste y cómo probarlo.",
  tester: "Eres el TESTER. Escribe tests desde la ESPECIFICACIÓN (plan, criterios y firmas), sin ver la implementación. Si un valor esperado depende de una decisión del programador, deja el test marcado como pendiente con la pregunta.",
  revisor: "Eres el REVISOR. Lee el código de la tarea a ciegas (sin la conversación) y reporta: bugs, casos borde, concurrencia, rendimiento y caché, seguridad, y si cumple el plan. Concreto, con archivo y línea. No escribes nada.",
  refactorizador: "Eres el REFACTORIZADOR. Mejora la estructura según la revisión SIN cambiar comportamiento: los tests están congelados y no tocas las líneas que el programador escribió a mano.",
};

/** Corre un agente con su rol. Los permisos se aplican en `canUseTool` (y la edición pasa por las garantías de la tarea). */
export async function correrAgente(root: string, id: string, rol: RolAgente, extra = ""): Promise<{ texto: string; tocados: string[] }> {
  const t = cargarTarea(root, id);
  if (rol !== "revisor" && t.estado !== "ejecutando") throw new Error(`la tarea ${id} está ${t.estado}: los agentes que escriben trabajan con la tarea en ejecución (\`cai tarea ${id} --ejecutar\`)`);
  const z = makeZoner(root);
  const antes = new Map<string, string>();
  const todos = listFiles(z);
  const coincide = (globs: string[]) => { if (!globs.length) return []; const m = picomatch(globs, { dot: true }); return todos.filter((x) => m(x)); };
  for (const f of coincide([...t.restricciones.alcance, "**/*.test.*", "tests/**", "test/**"])) antes.set(f, fs.readFileSync(path.join(root, f), "utf8"));
  const [, modelo] = partir(refDeRol(loadConfig(root), rol === "revisor" ? "revisar" : "implementar"));
  const { query } = await sdk();
  const firmas = t.plan?.funcionesClave.map((f) => `- ${f.nombre}: ${f.que}`).join("\n") ?? "";
  const prompt = `Tarea ${t.id}: ${t.titulo}\nAlcance: ${t.restricciones.alcance.join(", ")}\nPlan aprobado:\n${t.plan?.pasos.map((p, i) => `${i + 1}. ${p}`).join("\n") ?? ""}\nCriterios: ${t.diseno?.criterios.join(" | ") ?? ""}\nFunciones clave:\n${firmas}\n${decididas(root, t.id)}${t.adjuntos.length ? `Capturas (míralas con Read): ${t.adjuntos.map((a) => path.join(root, a)).join(", ")}\n` : ""}${extra}`;
  let texto = "";
  const q = query({
    prompt,
    options: {
      cwd: root,
      systemPrompt: SISTEMA_ROL[rol],
      settingSources: [],
      persistSession: false,
      ...(modelo ? { model: modelo } : {}),
      // Lo que está en allowedTools se aprueba SIN pasar por canUseTool. Por eso queda vacío: las herramientas
      // están disponibles (tools), pero cada uso lo decide canUseTool con los permisos del rol.
      tools: rol === "revisor" ? ["Read", "Grep", "Glob"] : ["Read", "Grep", "Glob", "Edit", "Write", "MultiEdit", ...(rol === "tester" ? ["Bash"] : [])],
      allowedTools: [], // nada pre-aprobado: cada uso pasa por canUseTool (si no, el SDK saltea los permisos del rol)
      disallowedTools: ["WebSearch", "Task", "NotebookEdit"],
      maxTurns: 40,
      canUseTool: async (tool: string, input: Record<string, unknown>) => {
        const file = (input.file_path ?? input.path) as string | undefined;
        const rel = file ? z.rel(path.resolve(root, file)) : undefined;
        const no = permisoRol(rol, t, tool, rel);
        if (no) return { behavior: "deny" as const, message: `[cai] ${no}` };
        if (rel && ["Edit", "Write", "MultiEdit"].includes(tool)) {
          const abs = path.join(root, rel);
          const a = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : "";
          const edits = tool === "MultiEdit" ? ((input.edits as { old_string: string; new_string: string }[]) ?? []) : [{ old_string: String(input.old_string ?? ""), new_string: String(input.new_string ?? "") }];
          const d = tool === "Write" ? String(input.content ?? "") : edits.reduce((acc, e) => acc.replace(e.old_string, () => e.new_string), a);
          const malo = rol === "tester" ? null : await edicionPermitida(z, { ...t, estado: "ejecutando" }, abs, a, d);
          if (malo) return { behavior: "deny" as const, message: `[cai] ${malo}` };
        }
        if (tool === "Bash" && !/^\s*(pnpm|npm|npx|yarn)\s+(run\s+)?(test|vitest)|^\s*(vitest|jest|pytest)\b/.test(String(input.command ?? ""))) return { behavior: "deny" as const, message: "[cai] el tester solo corre los tests" };
        return { behavior: "allow" as const, updatedInput: input };
      },
    },
  });
  for await (const m of q) if (m.type === "result" && m.subtype === "success") texto = String(m.result ?? "");
  // Procedencia: lo que cambió es del agente (con su rol).
  const tocados: string[] = [];
  for (const f of coincide(t.restricciones.alcance.concat(rol === "tester" ? ["**/*.test.*", "tests/**", "test/**"] : [])).concat(listFiles(z).filter((x) => !todos.includes(x)))) {
      const abs = path.join(root, f);
      if (f.startsWith(".cai/") || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
      const ahora = fs.readFileSync(abs, "utf8");
      if (antes.get(f) === ahora) continue;
      // Lo que había antes es tuyo (un archivo nuevo empieza vacío: todo lo que tiene lo escribió el agente).
      asentar(root, f, antes.get(f) ?? "", { origen: "humano" });
      asentar(root, f, ahora, { origen: "ia", autor: `agente:${rol}`, tarea: t.id });
      tocados.push(f);
    }
  if (tocados.length) conTarea(root, id, (x) => ({ ...x, tocados: [...new Set([...x.tocados, ...tocados])] }));
  if (rol === "revisor") conTarea(root, id, (x) => ({ ...x, dialogo: [...x.dialogo, { quien: "ia" as const, fase: "revisor", texto, cuando: new Date().toISOString() }] }));
  return { texto, tocados };
}

/** Lo que el programador ya decidió en la tarea, con su elección y su porqué (los agentes no adivinan). */
export function decididas(root: string, id: string): string {
  const ds = cargarDecisiones(root).filter((d) => d.tarea === id && d.estado === "vigente");
  return ds.length ? `Decisiones del programador (respétalas):\n${ds.map((d) => `- ${d.pregunta} → ${d.eleccion}${d.porque ? ` (porque ${d.porque})` : ""}`).join("\n")}\n` : "";
}

// --- Traspaso de sesión ----------------------------------------------------------------------------------------

export const archivoTraspaso = (root: string, id: string) => path.join(dataDir(root), "tareas", id, "traspaso.md");

/** Resumen de la tarea para seguir en una sesión NUEVA. Lo escribe la IA chica; lo corriges tú antes de usarlo. */
export async function traspaso(root: string, id: string): Promise<string> {
  const t = cargarTarea(root, id);
  const r = await consultarRol<{ resumen: string; hecho: string[]; falta: string[]; cuidado: string[] }>(loadConfig(root), "traspaso", {
    kind: "traspaso",
    system: "Resumes una tarea de programación para continuarla en una conversación nueva: qué se decidió, qué está hecho, qué falta y qué cuidar. Corto y concreto. Sin código.",
    prompt: comoDato("tarea", JSON.stringify({ titulo: t.titulo, estado: t.estado, diseno: t.diseno, plan: t.plan?.pasos, restricciones: t.restricciones, dialogo: t.dialogo.slice(-30) })),
    schema: { type: "object", required: ["resumen", "hecho", "falta", "cuidado"], properties: { resumen: { type: "string" }, hecho: { type: "array", items: { type: "string" } }, falta: { type: "array", items: { type: "string" } }, cuidado: { type: "array", items: { type: "string" } } } },
    cwd: root,
  });
  const md = `# Traspaso de ${t.id}: ${t.titulo}\n\n<!-- Escrito por la IA: CORRÍGELO antes de abrir la sesión nueva (lo que quede aquí es lo que la IA va a creer). -->\n\n${r.data.resumen}\n\n## Hecho\n${r.data.hecho.map((x) => `- ${x}`).join("\n")}\n\n## Falta\n${r.data.falta.map((x) => `- ${x}`).join("\n")}\n\n## Cuidado\n${r.data.cuidado.map((x) => `- ${x}`).join("\n")}\n`;
  fs.mkdirSync(path.dirname(archivoTraspaso(root, id)), { recursive: true });
  fs.writeFileSync(archivoTraspaso(root, id), md);
  conTarea(root, id, (x) => {
    const { sesion: _s, ...resto } = x;
    return resto as Tarea;
  });
  return path.relative(root, archivoTraspaso(root, id));
}
