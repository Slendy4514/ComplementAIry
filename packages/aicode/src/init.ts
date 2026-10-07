import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_CONFIG } from "./config.js";
import { stripJsonc } from "./snippets.js";

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "cli.js");

/** Cómo se invoca aicode desde los hooks: el binario global si existe, si no, la ruta absoluta. */
export function aicodeCommand(): string {
  try {
    const found = execFileSync("sh", ["-c", "command -v aicode"], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    if (found) return "aicode";
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

const CLAUDE_MD_MARK = "<!-- aicode:inicio -->";
const CLAUDE_MD = `${CLAUDE_MD_MARK}
## AICode: el humano programa, la IA acompaña

El código lo escribe el humano. Tu rol es **acompañar**: dar ideas, estructura, piezas y revisión.

- No escribas código en zona humana (un hook lo bloquea; no lo esquives por shell ni scripts).
- Comunícate con comentarios en el código: \`// @guia[<id>] <tipo>: <texto>\` (con el comentario del lenguaje).
  Tipos: \`plano\` (qué funciones crear y qué hace cada una, en palabras), \`pieza\` (función/API útil + link a docs),
  \`snippet [ ]\` (sugerir un snippet de la biblioteca: \`snippet [ ]: <nombre> clave=valor\`; SIEMPRE apagado, lo activa el humano con [x]),
  \`pista\`, \`pregunta\`, \`revision\` (Conventional Comments), \`ejemplo\` (análogo, de otro dominio).
- Modo DIRECTO por defecto: si pide un plan, cómo seguir, cómo estructurar un archivo o la arquitectura, dalo directo (plano, piezas, snippets), sin escalonar.
- Escalera (pista → piezas → pasos en palabras → ejemplo) solo en zonas críticas o si pide aprender (\`!aprender\`). Una pregunta nueva empieza de cero; solo sube si pide más ayuda.
- Escalones a pedido: \`!pista\`, \`!piezas\`, \`!pseudo\`, \`!ejemplo\`, \`!plano\`, \`!snippet\`, \`!arquitectura\`.
- El humano te habla con \`@ia? <pregunta>\` y responde con \`@yo: <intento>\`. No borres ni cambies sus comentarios.
- Comandos (instalar, git, mover archivos): sugiérelos y que los corra el humano.
- Biblioteca de snippets: \`aicode snippet lista\`. Zonas donde sí puedes escribir: \`zonas.delegadas\` en \`.aicode/config.json\`.
- Qué busca el proyecto y las reglas de estilo del programador (respétalas y señala cuando no se cumplen):
  @.aicode/proyecto.md
  @.aicode/reglas.md
<!-- aicode:fin -->
`;

export interface InitResult {
  changes: string[];
}

export function init(target: string): InitResult {
  const changes: string[] = [];
  const cmd = `${aicodeCommand()} hook`;

  // 1. Hooks de Claude Code.
  const settingsFile = path.join(target, ".claude", "settings.json");
  const settings: Settings = fs.existsSync(settingsFile) ? (JSON.parse(fs.readFileSync(settingsFile, "utf8")) as Settings) : {};
  settings.hooks ??= {};
  const ensure = (event: string, matcher: string) => {
    const list = (settings.hooks![event] ??= []);
    const mine = list.find((e) => e.hooks.some((h) => / hook$/.test(h.command) && h.command.includes("aicode")));
    if (mine) {
      mine.matcher = matcher;
      mine.hooks = [{ type: "command", command: cmd, timeout: 60 }];
    } else list.push({ matcher, hooks: [{ type: "command", command: cmd, timeout: 60 }] });
  };
  ensure("PreToolUse", "Edit|Write|MultiEdit|NotebookEdit|Bash");
  ensure("PostToolUse", "Bash");
  ensure("PostToolUseFailure", "Bash");
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + "\n");
  changes.push(".claude/settings.json: hooks de aicode");

  // 2. Configuración.
  const configFile = path.join(target, ".aicode", "config.json");
  if (!fs.existsSync(configFile)) {
    fs.mkdirSync(path.dirname(configFile), { recursive: true });
    fs.writeFileSync(configFile, JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n");
    changes.push(".aicode/config.json: configuración inicial (todo es zona humana)");
  }

  // 3. .gitignore
  const gi = path.join(target, ".gitignore");
  const giText = fs.existsSync(gi) ? fs.readFileSync(gi, "utf8") : "";
  if (!giText.split("\n").includes(".aicode/cache/")) {
    fs.writeFileSync(gi, giText + (giText && !giText.endsWith("\n") ? "\n" : "") + ".aicode/cache/\n");
    changes.push(".gitignore: .aicode/cache/");
  }

  // 4. Pre-commit: no se commitean comentarios de conversación.
  const hookFile = path.join(target, ".githooks", "pre-commit");
  fs.mkdirSync(path.dirname(hookFile), { recursive: true });
  fs.writeFileSync(hookFile, `#!/bin/sh\n# aicode: rechaza commits con comentarios de conversación pendientes o que no pasan las verificaciones rápidas.\n${aicodeCommand()} guia check --staged || exit 1\nexec ${aicodeCommand()} gate --staged --rapido\n`, { mode: 0o755 });
  changes.push(".githooks/pre-commit");
  try {
    execFileSync("git", ["rev-parse", "--git-dir"], { cwd: target, stdio: "ignore" });
    execFileSync("git", ["config", "core.hooksPath", ".githooks"], { cwd: target, stdio: "ignore" });
    changes.push("git config core.hooksPath .githooks");
  } catch {
    changes.push("(no es repo git: cuando hagas `git init`, corré `git config core.hooksPath .githooks`)");
  }

  // 5. CLAUDE.md
  const md = path.join(target, "CLAUDE.md");
  const mdText = fs.existsSync(md) ? fs.readFileSync(md, "utf8") : "";
  if (!mdText.includes(CLAUDE_MD_MARK)) {
    fs.writeFileSync(md, mdText + (mdText ? "\n" : "") + CLAUDE_MD);
    changes.push("CLAUDE.md: sección AICode");
  } else {
    // Refresca la sección (entre los marcadores) sin tocar el resto del archivo.
    const next = mdText.replace(/<!-- aicode:inicio -->[\s\S]*?<!-- aicode:fin -->\n?/, CLAUDE_MD);
    if (next !== mdText) {
      fs.writeFileSync(md, next);
      changes.push("CLAUDE.md: sección AICode actualizada");
    }
  }
  // 6. Qué busca el proyecto y reglas, escritas por el humano.
  for (const [name, content] of Object.entries(TEMPLATES)) {
    const f = path.join(target, ".aicode", name);
    if (!fs.existsSync(f)) {
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, content);
      changes.push(`.aicode/${name}: plantilla para completar`);
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
      changes.push("(.vscode/tasks.json no se pudo leer; no se tocó. Agregá las tareas AICode a mano o usá la extensión)");
    }
  }
  if (tasksOk) {
  tasks.version ??= "2.0.0";
  tasks.tasks = (tasks.tasks ?? []).filter((t) => !t.label?.startsWith("AICode:"));
  const base = aicodeCommand();
  const mkTask = (label: string, args: string) => ({
    label,
    type: "shell",
    command: `${base} ${args}`,
    presentation: { reveal: "silent", panel: "shared", clear: true },
    problemMatcher: [],
  });
  tasks.tasks.push(mkTask("AICode: guía", 'guia "${file}"'), mkTask("AICode: revisar", 'revisar "${file}"'), mkTask("AICode: limpiar", "guia clean"));
  fs.mkdirSync(path.dirname(tasksFile), { recursive: true });
  fs.writeFileSync(tasksFile, JSON.stringify(tasks, null, 2) + "\n");
  changes.push(".vscode/tasks.json: tareas AICode (guía, revisar, limpiar)");
  }
  // 8. Skills para el chat de Claude Code y workflow de CI.
  const kit = path.join(path.dirname(CLI), "..", "kit");
  const base = path.join(target, ".vscode", "aicode-base.code-snippets");
  if (!fs.existsSync(base) && fs.existsSync(path.join(kit, "snippets", "base.code-snippets"))) {
    fs.mkdirSync(path.dirname(base), { recursive: true });
    fs.copyFileSync(path.join(kit, "snippets", "base.code-snippets"), base);
    changes.push(".vscode/aicode-base.code-snippets: estructuras básicas (fn, try, test, express-ruta...); editalas a gusto");
  }
  const skillsDir = path.join(kit, "skills");
  if (fs.existsSync(skillsDir)) {
    for (const name of fs.readdirSync(skillsDir)) {
      const dest = path.join(target, ".claude", "skills", name, "SKILL.md");
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(skillsDir, name, "SKILL.md"), dest);
    }
    changes.push(".claude/skills: aicode-guia, aicode-revisar, aicode-snippet");
  }
  const wf = path.join(target, ".github", "workflows", "aicode.yml");
  if (!fs.existsSync(wf) && fs.existsSync(path.join(kit, "github", "aicode.yml"))) {
    fs.mkdirSync(path.dirname(wf), { recursive: true });
    fs.copyFileSync(path.join(kit, "github", "aicode.yml"), wf);
    changes.push(".github/workflows/aicode.yml: CI con las verificaciones deterministas");
  }
  return { changes };
}

/** Atajos sugeridos. Con la extensión de VSCode (packages/vscode-aicode) vienen incluidos. */
export const KEYBINDINGS = `[
  { "key": "ctrl+alt+g", "command": "workbench.action.tasks.runTask", "args": "AICode: guía" },
  { "key": "ctrl+alt+r", "command": "workbench.action.tasks.runTask", "args": "AICode: revisar" }
]`;

const TEMPLATES: Record<string, string> = {
  "proyecto.md": `# Qué busca este proyecto

<!-- Escribí con tus palabras. La IA lo lee en cada guía y revisión. Ejemplos de qué poner: -->
<!-- - Para qué sirve y para quién es. -->
<!-- - Qué es lo más importante (ej.: "que nunca se pierda un pago", "que sea simple de mantener"). -->
<!-- - Restricciones: lenguajes, librerías permitidas, rendimiento, seguridad. -->
<!-- - Qué querés aprender o practicar con este proyecto. -->
`,
  "reglas.md": `# Reglas de cómo escribimos código

<!-- Tu "código de conducta" en lenguaje natural. La revisión te señala cuando no se cumple. -->
<!-- Ejemplos: -->
<!-- - Nombres en español y descriptivos; nada de abreviaturas como "tmp" o "x2". -->
<!-- - Funciones de menos de 30 líneas; si crece, se divide. -->
<!-- - Los errores se lanzan con mensajes que digan qué valor falló. -->
<!-- Reglas que aplican solo a una carpeta: .aicode/reglas/<nombre>.md con frontmatter "paths: [src/api/**]". -->
<!-- Reglas verificables mecánicamente (sin IA): .aicode/reglas.json -->
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
