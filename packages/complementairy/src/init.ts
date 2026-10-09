import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_CONFIG, dataDir } from "./config.js";
import { stripJsonc } from "./snippets.js";

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "cli.js");

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
export const CLAUDE_MD_VERSION = "0.9";
const CLAUDE_MD = `${CLAUDE_MD_MARK}
<!-- cai:version ${CLAUDE_MD_VERSION} -->
## ComplementAIry: el humano programa, la IA acompaña

El código lo escribe el humano. Tu rol es **acompañar**: dar ideas, estructura, piezas y revisión.

- No escribas código en zona humana (un hook lo bloquea; no lo esquives por shell ni scripts).
- **Vista notas** (la de VSCode, por defecto; \`"vista"\` en \`.cai/config.json\`): lo que tengas que decirle sobre su código va a **notas** (una por función), nunca como comentarios en el archivo (el hook lo bloquea). Usa \`cai responder <archivo> --linea <N> --texto "..."\` (o \`--archivo-entero\`), \`cai revisar <archivo>\` y \`cai verificar <archivo> --funcion <nombre>\` ("¿quedó lista?"), y resume en el chat.
- **Vista comentarios:** comunícate con comentarios en el código: \`// @guia[<id>] <tipo>: <texto>\` (con el comentario del lenguaje).
  Tipos: \`plano\` (qué funciones crear y qué hace cada una, en palabras), \`pieza\` (función/API útil + link a docs),
  \`snippet [ ]\` (sugerir un snippet de la biblioteca: \`snippet [ ]: <nombre> clave=valor\`; SIEMPRE apagado, lo activa el humano con [x]),
  \`pista\`, \`pregunta\`, \`revision\` (Conventional Comments), \`ejemplo\` (análogo, de otro dominio).
- Modo DIRECTO por defecto: si pide un plan, cómo seguir, cómo estructurar un archivo o la arquitectura, dalo directo (plano, piezas, snippets), sin escalonar.
- Escalera (pista → piezas → pasos en palabras → ejemplo) solo en zonas críticas o si pide aprender (\`!aprender\`). Una pregunta nueva empieza de cero; solo sube si pide más ayuda.
- Escalones a pedido: \`!pista\`, \`!piezas\`, \`!pseudo\`, \`!ejemplo\`, \`!plano\`, \`!snippet\`, \`!arquitectura\`, \`!tests\`.
- Tests: \`cai tests <archivo> <función> --probar\` propone casos (según la intención, no según el código actual) y los ejecuta; también funciona con código sin export (se carga aislado). Guardarlos como tests lo decide el programador (botón 🧪). Si el valor esperado depende de él, pregúntale.
- Criterio: no te ancles a cómo está hecho; si hay un enfoque claramente mejor, propónlo con su porqué. Si te falta contexto, pregunta en vez de suponer.
- Memoria del proyecto: \`.cai/conocimiento.md\` (módulos y respuestas del programador); visión general: \`cai panorama\`.
- Autoría: lo marcado como \`heredado\` en \`.cai/config.json\` no lo escribió el programador (no se lo atribuyas; explícalo); \`terceros\` se ignora.
- El humano te habla con \`@ia? <pregunta>\` y responde con \`@yo: <intento>\`. No borres ni cambies sus comentarios.
- Desde el chat puedes correr los comandos \`cai\` (uno por llamada, sin encadenar): \`cai siguiente\`, \`cai responder …\`, \`cai verificar …\`, \`cai guia <archivo>\`, \`cai revisar <archivo>\`, \`cai tests <archivo> <función>\`, \`cai panorama\`, \`cai plano\`, \`cai arquitectura\`, \`cai conocer --sin-preguntas\`, \`cai gate\`, \`cai uso\`, \`cai doctor\`, \`cai origen\` (detalle en la skill \`cai\`). Los hace el humano: \`cai init\`, \`cai expandir\`, \`cai snippet nuevo\`, \`cai perfil set\`, \`cai memoria responder\`.
- **Lo que ya se sabe** (úsalo antes de responder; no pienses de cero): \`cai indice\` (cada función con su estado, tests y quién llama a quién), \`cai decisiones\` (lo que el programador decidió: respétalo, no lo vuelvas a preguntar), \`cai hoy\` (qué cambió), \`cai deuda\` (lo pendiente), \`.cai/estructura.json\` y \`.cai/panorama.md\`.
- **Preguntas generales del proyecto:** responde en el chat (puedes usar \`cai chat --texto "…"\`, que deja decisiones y tareas con botones en el panel). Si algo depende de una decisión del programador, pregúntale; **nunca decidas ni retractes por él** (\`cai decisiones decidir/retractar\` es suyo).
- **"¿Está listo?"**: \`cai verificar <archivo> --funcion <nombre>\` (una función) o \`cai revisar <archivo> --completo\` (el archivo, con veredicto). Tests: \`cai tests <archivo> <función> --probar\`.
- Otros comandos (instalar, git, mover archivos): sugiérelos y que los corra el humano.
- Biblioteca de snippets: \`cai snippet lista\`. Zonas donde sí puedes escribir: \`zonas.delegadas\` en \`.cai/config.json\`.
- Qué busca el proyecto y las reglas de estilo del programador (respétalas y señala cuando no se cumplen):
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
  ensure("PreToolUse", "Edit|Write|MultiEdit|NotebookEdit|Bash");
  ensure("PostToolUse", "Bash");
  ensure("PostToolUseFailure", "Bash");
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + "\n");
  changes.push(".claude/settings.json: hooks de cai");

  // 2. Configuración.
  const configFile = path.join(dataDir(target), "config.json");
  if (!fs.existsSync(configFile)) {
    fs.mkdirSync(path.dirname(configFile), { recursive: true });
    fs.writeFileSync(configFile, JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n");
    changes.push(".cai/config.json: configuración inicial (todo es zona humana)");
  }

  // 3. .gitignore
  const gi = path.join(target, ".gitignore");
  const giText = fs.existsSync(gi) ? fs.readFileSync(gi, "utf8") : "";
  if (!giText.split("\n").includes(".cai/cache/")) {
    fs.writeFileSync(gi, giText + (giText && !giText.endsWith("\n") ? "\n" : "") + ".cai/cache/\n");
    changes.push(".gitignore: .cai/cache/");
  }

  // 4. Pre-commit: no se commitean comentarios de conversación.
  const hookFile = path.join(target, ".githooks", "pre-commit");
  fs.mkdirSync(path.dirname(hookFile), { recursive: true });
  fs.writeFileSync(hookFile, `#!/bin/sh\n# cai: rechaza commits con comentarios de conversación pendientes o que no pasan las verificaciones rápidas.\n${caiCommand()} guia check --staged || exit 1\nexec ${caiCommand()} gate --staged --rapido\n`, { mode: 0o755 });
  changes.push(".githooks/pre-commit");
  try {
    const top = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: target, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    // Solo si el proyecto ES la raíz del repo: si está dentro de otro repo, no se toca la config del repo padre.
    if (fs.realpathSync(top) === fs.realpathSync(target)) {
      execFileSync("git", ["config", "core.hooksPath", ".githooks"], { cwd: target, stdio: "ignore" });
      changes.push("git config core.hooksPath .githooks");
    } else {
      changes.push(`(está dentro del repo ${top}: no se activó el pre-commit para no cambiar ese repo)`);
    }
  } catch {
    changes.push("(no es repo git: cuando hagas `git init`, corré `git config core.hooksPath .githooks`)");
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
      changes.push("(.vscode/tasks.json no se pudo leer; no se tocó. Agregá las tareas ComplementAIry a mano o usá la extensión)");
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
    changes.push(".claude/skills: cai, cai-guia, cai-revisar, cai-snippet");
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
