import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_CONFIG, dataDir } from "../proyecto/config.js";
import { stripJsonc } from "../proyecto/snippets.js";
import { scriptsGitHooks } from "../garantias/gitHooks.js";
import { archivoGlobalMd, PLANTILLA_GLOBAL } from "../proyecto/reglas.js";

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "cli.js");

/** Cómo se invoca cai desde los hooks: el binario global si existe, si no, la ruta absoluta. */
export function caiCommand(): string {
  try {
    const found = execFileSync("sh", ["-c", "command -v cai"], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    if (found) return "cai";
  } catch {
    /* no está en el PATH */
  }
  return `node ${JSON.stringify(CLI)}`;
}

interface HookEntry {
  matcher?: string;
  hooks: { type: string; command: string; timeout?: number }[];
}
type Settings = { hooks?: Record<string, HookEntry[]> } & Record<string, unknown>;

const CLAUDE_MD_MARK = "<!-- cai:inicio -->";
/** Versión de estas instrucciones: la extensión ofrece actualizarlas si el CLAUDE.md tiene una más vieja. */
export const CLAUDE_MD_VERSION = "1.0";
const CLAUDE_MD = `${CLAUDE_MD_MARK}
<!-- cai:version ${CLAUDE_MD_VERSION} -->
## ComplementAIry v1: programar CON IA, sin vibe coding (ver Manifiesto.md)

El programador decide y entiende; tú eres un pasante calificado: propones, explicas y, solo dentro de una tarea aprobada, implementas.

- **Sin una tarea en ejecución ligada a esta sesión no escribes código** (el hook lo bloquea; no lo esquives por shell). Puedes leer, explicar, planificar y guiar con notas (\`cai responder\`, \`cai verificar\`, \`cai revisar <archivo>\`).
- **Para delegar**, el programador: \`cai pedir "…"\` → responde la entrevista de restricciones → escribe su diseño → tú planificas sin código (\`cai tarea <id> --planificar\`) → él decide y aprueba → \`--ejecutar\`. Si te pide "hazlo" sin tarea, ayúdalo a crearla (skill \`cai\`).
- **Dentro de la tarea** (skill \`cai-tarea\`): EXACTAMENTE el plan, solo en el alcance, sin dependencias nuevas, en pasos chicos, sin tocar lo que hay que preservar ni las líneas que él escribió (refactoriza alrededor). Nunca en líneas rojas. Solo construcciones que él ya escribió a mano (licencias, I.6).
- **Prohibido adivinar:** si algo es ambiguo, detente y presenta 2 opciones con pros y contras.
- **Al terminar cada paso:** qué hiciste, por qué ese patrón, casos borde, impacto en rendimiento y cómo probarlo. Luego \`cai avanzar\`.
- **Lo tuyo no se integra sin su evidencia** (explicación, predicción ejecutada, bordes o mutante, tramo por tramo). Nunca la des por él.
- **Si das vueltas** (mismo error, cambios que van y vuelven), para y propón replantear: la tarea se desconecta sola.
- **Solo lo hace el programador** (el hook lo rechaza si lo intentas): pedir, responder la entrevista, diseñar, aprobar, ejecutar, dar evidencia, puntuar o elegir en decisiones, volver, katas, reconstrucción, repaso, foco del día. Para que decida algo: AskUserQuestion con header \`cai:<id>\` (detalle en la skill \`cai\`).
- **Ayuda que sí das:** ideas y piezas con su porqué, sin anclarte a cómo está hecho; ejemplos análogos; preguntas que lo hagan pensar. En tareas \`aprender\` no le das el código.
- **Lo que ya se sabe:** \`cai tarea <id>\`, \`cai decisiones\`, \`cai informe\`, \`cai mapa\`, \`cai reglas <archivo>\`, \`cai hoy\`. Una sesión = una tarea; si la conversación se alarga: \`cai traspaso <id>\`.
- Qué busca el proyecto y sus reglas (respétalas y señala cuando no se cumplen):
  @.cai/proyecto.md
  @.cai/reglas.md
<!-- cai:fin -->
`;

export interface InitResult {
  changes: string[];
}

export function init(target: string): InitResult {
  const changes: string[] = [];
  const cmd = `${caiCommand()} hook`;

  // 1. Hooks de Claude Code.
  const settingsFile = path.join(target, ".claude", "settings.json");
  const settings: Settings = fs.existsSync(settingsFile) ? (JSON.parse(fs.readFileSync(settingsFile, "utf8")) as Settings) : {};
  settings.hooks ??= {};
  const ensure = (event: string, matcher: string) => {
    const list = (settings.hooks![event] ??= []);
    // También reconoce las entradas creadas con el nombre anterior (aicode) para no duplicarlas.
    const mine = list.find((e) => e.hooks.some((h) => / hook$/.test(h.command) && /\b(cai|complementairy|aicode)\b|cli\.js/.test(h.command)));
    if (mine) {
      mine.matcher = matcher;
      mine.hooks = [{ type: "command", command: cmd, timeout: 60 }];
    } else list.push({ matcher, hooks: [{ type: "command", command: cmd, timeout: 60 }] });
  };
  ensure("PreToolUse", "Edit|Write|MultiEdit|NotebookEdit|Bash|AskUserQuestion|mcp__.*");
  // AskUserQuestion: lo que solo decides tú (decisiones, descartar, confirmar objetivos…) se registra con tu respuesta.
  // Edit/Write: la procedencia (esas líneas son de la IA) y las señales de bucle.
  ensure("PostToolUse", "Edit|Write|MultiEdit|Bash|AskUserQuestion");
  ensure("PostToolUseFailure", "Bash");
  // v1: sesión ligada a una tarea, conversación corta y modelo fijo por fase, checkpoints al detenerse.
  ensure("SessionStart", "");
  ensure("UserPromptSubmit", "");
  ensure("Stop", "");
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + "\n");
  changes.push(".claude/settings.json: hooks de cai");

  // 1b. MCP propio (herramientas tipadas: estado de la tarea, proponer plan, presentar opciones…).
  const mcpFile = path.join(target, ".mcp.json");
  const mcp = fs.existsSync(mcpFile) ? (JSON.parse(fs.readFileSync(mcpFile, "utf8")) as { mcpServers?: Record<string, unknown> }) : {};
  if (!mcp.mcpServers?.complementairy) {
    const [bin, ...resto] = caiCommand().split(" ");
    mcp.mcpServers = { ...mcp.mcpServers, complementairy: { command: bin, args: [...resto.map((x) => x.replace(/^"|"$/g, "")), "mcp"] } };
    fs.writeFileSync(mcpFile, JSON.stringify(mcp, null, 2) + "\n");
    changes.push(".mcp.json: servidor MCP complementairy (cai mcp)");
  }

  // 2. Configuración.
  const configFile = path.join(dataDir(target), "config.json");
  if (!fs.existsSync(configFile)) {
    fs.mkdirSync(path.dirname(configFile), { recursive: true });
    // modosVersion 2: "programar" ya significa el modo nuevo (no se migra a "sugerir").
    fs.writeFileSync(configFile, JSON.stringify({ ...DEFAULT_CONFIG, version: 1, modosVersion: 2 }, null, 2) + "\n");
    changes.push(".cai/config.json: configuración inicial (todo es zona humana)");
  }

  // 3. .gitignore
  const gi = path.join(target, ".gitignore");
  const giText = fs.existsSync(gi) ? fs.readFileSync(gi, "utf8") : "";
  if (!giText.split("\n").includes(".cai/cache/")) {
    fs.writeFileSync(gi, giText + (giText && !giText.endsWith("\n") ? "\n" : "") + ".cai/cache/\n");
    changes.push(".gitignore: .cai/cache/");
  }

  // 4. Git hooks: procedencia y evidencia (pre-commit), trailers (commit-msg), cierre de tareas y licencias
  // (post-commit), convención de ramas (pre-push, post-checkout). Merge driver de la procedencia.
  for (const [nombre, contenido] of Object.entries(scriptsGitHooks(caiCommand()))) {
    const f = path.join(target, ".githooks", nombre);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, contenido, { mode: 0o755 });
  }
  changes.push(".githooks/: pre-commit, commit-msg, post-commit, pre-push, post-checkout");
  const ga = path.join(target, ".gitattributes");
  const gaText = fs.existsSync(ga) ? fs.readFileSync(ga, "utf8") : "";
  if (!gaText.includes("merge=cai-procedencia")) {
    fs.writeFileSync(ga, gaText + (gaText && !gaText.endsWith("\n") ? "\n" : "") + ".cai/procedencia/*.json merge=cai-procedencia\n");
    changes.push(".gitattributes: merge driver de la procedencia");
  }
  try {
    const top = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: target, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    // Solo si el proyecto ES la raíz del repo: si está dentro de otro repo, no se toca la config del repo padre.
    if (fs.realpathSync(top) === fs.realpathSync(target)) {
      execFileSync("git", ["config", "core.hooksPath", ".githooks"], { cwd: target, stdio: "ignore" });
      execFileSync("git", ["config", "merge.cai-procedencia.name", "ComplementAIry: une la procedencia por huella"], { cwd: target, stdio: "ignore" });
      execFileSync("git", ["config", "merge.cai-procedencia.driver", `${caiCommand()} merge-procedencia %O %A %B`], { cwd: target, stdio: "ignore" });
      changes.push("git config core.hooksPath .githooks + merge driver cai-procedencia");
    } else {
      changes.push(`(está dentro del repo ${top}: no se activó el pre-commit para no cambiar ese repo)`);
    }
  } catch {
    changes.push("(no es repo git: cuando hagas `git init`, corre `git config core.hooksPath .githooks`)");
  }

  // 5. CLAUDE.md (solo la sección de ComplementAIry) y 6. lo que escribe el humano.
  changes.push(...refrescarClaudeMd(target));
  return initResto(target, changes);
}

/** Solo la sección ComplementAIry del CLAUDE.md (entre sus marcadores); el resto del archivo no se toca. */
export function refrescarClaudeMd(target: string): string[] {
  const changes: string[] = [];
  const md = path.join(target, "CLAUDE.md");
  const mdText = fs.existsSync(md) ? fs.readFileSync(md, "utf8") : "";
  if (!mdText.includes(CLAUDE_MD_MARK) && !mdText.includes("<!-- aicode:inicio -->")) {
    fs.writeFileSync(md, mdText + (mdText ? "\n" : "") + CLAUDE_MD);
    changes.push("CLAUDE.md: sección ComplementAIry");
  } else {
    // Refresca la sección (entre los marcadores) sin tocar el resto del archivo.
    const next = mdText.replace(/<!-- (?:cai|aicode):inicio -->[\s\S]*?<!-- (?:cai|aicode):fin -->\n?/, CLAUDE_MD);
    if (next !== mdText) {
      fs.writeFileSync(md, next);
      changes.push("CLAUDE.md: sección ComplementAIry actualizada");
    }
  }
  return changes;
}

function initResto(target: string, changes: string[]): InitResult {
  // 5b. Tus reglas globales (III.2): una vez, para todos tus proyectos.
  if (!fs.existsSync(archivoGlobalMd())) {
    fs.mkdirSync(path.dirname(archivoGlobalMd()), { recursive: true });
    fs.writeFileSync(archivoGlobalMd(), PLANTILLA_GLOBAL);
    changes.push(`${archivoGlobalMd()}: tus reglas globales (complétalas: \`cai doctor\` las exige)`);
  }
  // 6. Qué busca el proyecto y reglas, escritas por el humano.
  for (const [name, content] of Object.entries(TEMPLATES)) {
    const f = path.join(dataDir(target), name);
    if (!fs.existsSync(f)) {
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, content);
      changes.push(`.cai/${name}: plantilla para completar`);
    }
  }

  // 7. VSCode: tareas que disparan la guía y la revisión sobre el archivo abierto.
  const tasksFile = path.join(target, ".vscode", "tasks.json");
  let tasks: { version?: string; tasks?: { label?: string }[] } = {};
  let tasksOk = true;
  if (fs.existsSync(tasksFile)) {
    try {
      tasks = JSON.parse(stripJsonc(fs.readFileSync(tasksFile, "utf8"))) as typeof tasks;
    } catch {
      tasksOk = false;
      changes.push("(.vscode/tasks.json no se pudo leer; no se tocó. Agrega las tareas ComplementAIry a mano o usa la extensión)");
    }
  }
  if (tasksOk) {
  tasks.version ??= "2.0.0";
  tasks.tasks = (tasks.tasks ?? []).filter((t) => !/^(ComplementAIry|AICode):/.test(t.label ?? ""));
  const base = caiCommand();
  const mkTask = (label: string, args: string) => ({
    label,
    type: "shell",
    command: `${base} ${args}`,
    presentation: { reveal: "silent", panel: "shared", clear: true },
    problemMatcher: [],
  });
  tasks.tasks.push(mkTask("ComplementAIry: guía", 'guia "${file}"'), mkTask("ComplementAIry: revisar", 'revisar "${file}"'), mkTask("ComplementAIry: limpiar", "guia clean"));
  fs.mkdirSync(path.dirname(tasksFile), { recursive: true });
  fs.writeFileSync(tasksFile, JSON.stringify(tasks, null, 2) + "\n");
  changes.push(".vscode/tasks.json: tareas ComplementAIry (guía, revisar, limpiar)");
  }
  // 8. Skills para el chat de Claude Code y workflow de CI.
  const kit = path.join(path.dirname(CLI), "..", "kit");
  const base = path.join(target, ".vscode", "cai-base.code-snippets");
  const baseVieja = path.join(target, ".vscode", "aicode-base.code-snippets");
  if (!fs.existsSync(base) && fs.existsSync(baseVieja)) {
    fs.renameSync(baseVieja, base); // conserva lo que hayas editado
    changes.push(".vscode/aicode-base.code-snippets → cai-base.code-snippets");
  }
  if (!fs.existsSync(base) && fs.existsSync(path.join(kit, "snippets", "base.code-snippets"))) {
    fs.mkdirSync(path.dirname(base), { recursive: true });
    fs.copyFileSync(path.join(kit, "snippets", "base.code-snippets"), base);
    changes.push(".vscode/cai-base.code-snippets: estructuras básicas (fn, try, test, express-ruta...); editalas a gusto");
  }
  const skillsDir = path.join(kit, "skills");
  for (const vieja of ["aicode-guia", "aicode-revisar", "aicode-snippet"]) {
    const d = path.join(target, ".claude", "skills", vieja);
    if (fs.existsSync(path.join(d, "SKILL.md"))) {
      fs.rmSync(path.join(d, "SKILL.md"));
      if (!fs.readdirSync(d).length) fs.rmdirSync(d);
    }
  }
  if (fs.existsSync(skillsDir)) {
    for (const name of fs.readdirSync(skillsDir)) {
      const dest = path.join(target, ".claude", "skills", name, "SKILL.md");
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(skillsDir, name, "SKILL.md"), dest);
    }
    changes.push(".claude/skills: cai, cai-tarea, cai-guia, cai-revisar, cai-snippet");
  }
  const wf = path.join(target, ".github", "workflows", "complementairy.yml");
  if (!fs.existsSync(wf) && fs.existsSync(path.join(kit, "github", "complementairy.yml"))) {
    fs.mkdirSync(path.dirname(wf), { recursive: true });
    fs.copyFileSync(path.join(kit, "github", "complementairy.yml"), wf);
    changes.push(".github/workflows/complementairy.yml: CI con las verificaciones deterministas");
  }
  return { changes };
}

/** Atajos sugeridos. Con la extensión de VSCode (packages/vscode-complementairy) vienen incluidos. */
export const KEYBINDINGS = `[
  { "key": "ctrl+alt+g", "command": "workbench.action.tasks.runTask", "args": "ComplementAIry: guía" },
  { "key": "ctrl+alt+r", "command": "workbench.action.tasks.runTask", "args": "ComplementAIry: revisar" }
]`;

const TEMPLATES: Record<string, string> = {
  "proyecto.md": `# Qué busca este proyecto

<!-- Escribe con tus palabras. La IA lo lee en cada guía y revisión. Ejemplos de qué poner: -->
<!-- - Para qué sirve y para quién es. -->
<!-- - Qué es lo más importante (ej.: "que nunca se pierda un pago", "que sea simple de mantener"). -->
<!-- - Restricciones: lenguajes, librerías permitidas, rendimiento, seguridad. -->
<!-- - Qué quieres aprender o practicar con este proyecto. -->
`,
  "reglas.md": `# Reglas de cómo escribimos código

<!-- Las secciones con ## son obligatorias (III.3): \`cai doctor\` las exige y el plan las respeta. -->

## Stack y versiones
<!-- Una por línea: nombre@versión (se contrasta con package.json / pyproject). Ej.: - typescript@5.6 -->

## Datos
<!-- Esquema de la base de datos (o la ruta al archivo del esquema) y cómo se accede. -->

## API
<!-- Patrones de diseño de la API: rutas, errores, versionado, autenticación. -->

## Ramas
<!-- Convención de nombres de rama. La regex verificable va en .cai/config.json → flujo.ramas -->

## Pruebas
<!-- Qué se prueba y cómo (unitarias, integración); comando para correrlas. -->

## Estilo
<!-- Tu "código de conducta" en lenguaje natural. La revisión te señala cuando no se cumple. -->
<!-- Ejemplos: -->
<!-- - Nombres en español y descriptivos; nada de abreviaturas como "tmp" o "x2". -->
<!-- - Funciones de menos de 30 líneas; si crece, se divide. -->
<!-- - Los errores se lanzan con mensajes que digan qué valor falló. -->
<!-- Reglas que aplican solo a una carpeta: .cai/reglas/<nombre>.md con frontmatter "paths: [src/api/**]". -->
<!-- Reglas verificables mecánicamente (sin IA): .cai/reglas.json -->
`,
  "reglas.json": JSON.stringify(
    {
      $comentario: "Reglas deterministas: se verifican con expresiones regulares, sin IA. 'archivos' son globs.",
      reglas: [
        { id: "sin-console-log", descripcion: "No dejar console.log en el código", patron: "console\\.log\\(", archivos: ["src/**/*.ts", "src/**/*.js"], activa: false },
      ],
    },
    null,
    2,
  ) + "\n",
};
