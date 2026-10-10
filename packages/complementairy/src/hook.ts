import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkBash } from "./bash.js";
import { makeZoner, type Zoner } from "./config.js";
import { langFor } from "./lang.js";
import { registrarRespuestas, respuestasInventadas, validarPreguntaCai } from "./confirmar.js";
import { checkLeftovers, checkSnapshot, soloHumano, takeSnapshot } from "./snapshot.js";
import { snippetPolicy } from "./snippets.js";
import { verifyCommentOnly } from "./verify.js";

/** Lo que Claude Code manda por stdin a un hook. */
export interface HookInput {
  hook_event_name: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: unknown;
  tool_use_id?: string;
  session_id?: string;
  cwd?: string;
}

/** Respuesta para Claude Code (se imprime como JSON). null = no opinar, sigue el flujo normal. */
export type HookOutput = Record<string, unknown> | null;

const deny = (reason: string): HookOutput => ({
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: `[cai] ${reason}`,
  },
});

interface EditSpec {
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}

/** Variantes que la herramienta Edit puede aceptar aunque no coincidan byte a byte (CRLF, comillas tipográficas). */
function variants(old: string, content: string): string[] {
  const out = [old];
  if (content.includes("\r\n") && !old.includes("\r\n")) out.push(old.replace(/\n/g, "\r\n"));
  const straight = old.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');
  if (straight !== old) out.push(straight);
  return out;
}

/** Simula la edición. null = no se puede simular con certeza (y entonces se deniega: falla cerrada). */
function applyEdits(content: string, edits: EditSpec[]): string | null {
  let out = content;
  for (const e of edits) {
    if (typeof e.old_string !== "string" || typeof e.new_string !== "string") return null;
    if (e.old_string === "") {
      if (out !== "") return null;
      out = e.new_string;
      continue;
    }
    const found = variants(e.old_string, out).find((v) => out.includes(v));
    if (!found) return null;
    const nl = found.includes("\r\n") && !e.new_string.includes("\r\n") ? e.new_string.replace(/\n/g, "\r\n") : e.new_string;
    out = e.replace_all ? out.split(found).join(nl) : out.replace(found, () => nl);
  }
  return out;
}

const NO_SIMULABLE =
  "no se pudo simular la edición con exactitud (old_string no coincide con el archivo). " +
  "Releé el archivo y usá un old_string idéntico; por seguridad, lo que no se puede verificar se bloquea.";

/** Tamaño máximo que se verifica dentro del tiempo del hook; más grande se bloquea (nunca se deja pasar sin verificar). */
const MAX_VERIFY_BYTES = 2 * 1024 * 1024;

function isTemp(abs: string): boolean {
  const tmp = [os.tmpdir(), "/tmp"].map((t) => path.resolve(t) + path.sep);
  return tmp.some((t) => abs.startsWith(t));
}

/** Ruta real (resuelve symlinks del archivo o, si no existe, de su carpeta). */
function realPath(abs: string): string {
  try {
    return fs.realpathSync(abs);
  } catch {
    try {
      return path.join(fs.realpathSync(path.dirname(abs)), path.basename(abs));
    } catch {
      return abs;
    }
  }
}

/** Líneas con @guia (sin espacios de los extremos), como multiconjunto. */
const lineasGuia = (t: string) => t.split(/\r?\n/).filter((l) => l.includes("@guia[")).map((l) => l.trim());
/** ¿El cambio agrega o reescribe algún @guia? (limpiar los que había sí se permite) */
function agregaGuia(antes: string, despues: string): boolean {
  const quedan = new Map<string, number>();
  for (const l of lineasGuia(antes)) quedan.set(l, (quedan.get(l) ?? 0) + 1);
  for (const l of lineasGuia(despues)) {
    const n = quedan.get(l) ?? 0;
    if (!n) return true;
    quedan.set(l, n - 1);
  }
  return false;
}

async function preEdit(z: Zoner, tool: string, input: Record<string, unknown>): Promise<HookOutput> {
  const file = (input.file_path ?? input.notebook_path) as string | undefined;
  if (!file) return null;
  const lexical = path.resolve(z.root, file);
  const abs = realPath(lexical);
  // Un symlink no puede sacar ni meter un archivo de zona: decide la ruta real (y la más restrictiva).
  const zones = [z.zoneOf(lexical), z.zoneOf(abs)];
  const zone = zones.includes("protegida") ? "protegida" : zones.includes("humana") ? "humana" : z.zoneOf(abs);
  if (zone === "fuera") return isTemp(abs) && isTemp(lexical) ? null : deny(`${file} está fuera del proyecto.`);
  if (zone === "protegida") return deny(`${z.rel(abs)} está protegido: son las reglas del proyecto y solo las cambia el humano.`);
  if (zone === "delegada") return null;
  if (zone === "snippets") {
    const before = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : "";
    const after = tool === "Write" ? String(input.content ?? "") : applyEdits(before, tool === "MultiEdit" ? ((input.edits as EditSpec[]) ?? []) : [input as unknown as EditSpec]);
    if (after === null) return deny(NO_SIMULABLE);
    const p = snippetPolicy(z, after);
    if (!p.allowed) return deny(`snippet no delegable: ${p.why}. Guiá al programador para que lo escriba él (cai snippet nuevo <nombre> crea la base desde su propio código).`);
    return p.aviso ? { systemMessage: `[cai] ${p.aviso}` } : null;
  }

  if (tool === "NotebookEdit") return deny("los notebooks son zona humana; la IA no los edita.");
  const lang = langFor(abs);
  if (!lang) {
    return deny(
      `${z.rel(abs)} es zona humana y su tipo de archivo no tiene soporte de comentarios. ` +
        `Si es trivial, el humano puede delegarlo en .cai/config.json (zonas.delegadas).`,
    );
  }
  if (fs.existsSync(abs) && fs.statSync(abs).size > MAX_VERIFY_BYTES) return deny(`${z.rel(abs)} es demasiado grande para verificarlo; la IA no puede editarlo.`);
  const before = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : "";
  let after: string | null;
  if (tool === "Write") after = String(input.content ?? "");
  else if (tool === "MultiEdit") after = applyEdits(before, (input.edits as EditSpec[]) ?? []);
  else after = applyEdits(before, [input as unknown as EditSpec]);
  if (after === null) return deny(NO_SIMULABLE);
  if (after.length > MAX_VERIFY_BYTES) return deny("el resultado es demasiado grande para verificarlo.");

  const v = await verifyCommentOnly(before, after, lang);
  const rel = z.rel(abs);
  const comoNota = `cai responder ${rel} --linea <N> --texto "<lo que quieres decirle>" (o --archivo-entero; para revisar: cai revisar ${rel}; "¿quedó lista?": cai verificar ${rel} --funcion <nombre>)`;
  // Vista notas (la de VSCode por defecto): lo que dice la IA va a NOTAS, no al archivo. Se puede
  // limpiar @guia viejos, pero no agregar nuevos.
  if (v.ok && z.config.vista === "notas" && agregaGuia(before, after))
    return deny(`este proyecto usa la vista de NOTAS: no escribas comentarios @guia en ${rel}. Deja la nota con un comando de cai (un solo comando, sin encadenar): ${comoNota}. Después resume en el chat.`);
  if (v.ok) return null;
  return deny(
    `${rel} es zona humana: la IA nunca escribe código.\n- ` +
      v.reasons.join("\n- ") +
      (z.config.vista === "notas"
        ? `\nGuía al programador con una nota: ${comoNota}.`
        : `\nGuía al programador con comentarios (// @guia[id] pista|pieza|pregunta|revision|ejemplo: ...) en vez de escribir el código.`),
  );
}

export async function runHook(input: HookInput, root: string): Promise<HookOutput> {
  const z = makeZoner(root);
  const tool = input.tool_name ?? "";
  const ti = input.tool_input ?? {};

  if (input.hook_event_name === "PreToolUse") {
    if (["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(tool)) return preEdit(z, tool, ti);
    // Lo que solo decides tú se registra con TU respuesta: una pregunta con respuestas ya puestas no vale.
    if (tool === "AskUserQuestion") {
      if (respuestasInventadas(ti)) return deny("la pregunta ya traía respuestas: las respuestas las da el humano con un clic.");
      for (const q of (ti.questions ?? []) as { header?: string }[]) {
        if (!/^cai:/i.test(q.header ?? "")) continue;
        const malo = validarPreguntaCai(root, q);
        if (malo) return deny(`pregunta ${q.header}: ${malo}.`);
      }
      return null;
    }
    if (tool === "Bash") {
      const cmd = String(ti.command ?? "");
      const v = checkBash(cmd, z.config.bash.permitir);
      if (!v.ok) return deny(`comando bloqueado: ${v.why}. Si hace falta, sugerile al humano el comando y que lo corra él.`);
      const humano = soloHumano(cmd);
      if (humano) return deny(`${humano} lo decide el programador, no tú. Pregúntaselo con tus botones (AskUserQuestion, encabezado cai:…; ver la skill cai) o pídele que lo haga en VSCode.`);
      // Un comando anterior sin verificar (se interrumpió antes del PostToolUse): se verifica ahora.
      const pendientes = await checkLeftovers(z);
      takeSnapshot(z, input.tool_use_id ?? "bash", cmd);
      return pendientes.length
        ? { systemMessage: `[cai] Se revirtieron cambios de un comando anterior que no se había verificado:\n${pendientes.map((a) => `- ${a.file}: ${a.action}`).join("\n")}` }
        : null;
    }
    return null;
  }

  // Tu respuesta en los botones de Claude Code (después de tu clic): se registra lo que decidiste.
  if (input.hook_event_name === "PostToolUse" && tool === "AskUserQuestion") {
    const hechos = registrarRespuestas(root, ti, input.tool_response);
    return hechos.length ? { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: `[cai] Registrado con la respuesta del humano:\n${hechos.map((h) => `- ${h}`).join("\n")}` } } : null;
  }

  if ((input.hook_event_name === "PostToolUse" || input.hook_event_name === "PostToolUseFailure") && tool === "Bash") {
    let actions;
    try {
      actions = await checkSnapshot(z, input.tool_use_id ?? "bash");
    } catch (e) {
      return { decision: "block", reason: `[cai] ${e instanceof Error ? e.message : String(e)}` };
    }
    if (!actions.length) return null;
    const lines = actions.map((a) => `- ${a.file}: ${a.action} (${a.why})`).join("\n");
    return {
      decision: "block",
      reason:
        `[cai] El comando modificó archivos que la IA no puede cambiar; se deshicieron los cambios ` +
        `(la versión modificada quedó en .cai/cache/cuarentena/):\n${lines}`,
    };
  }
  return null;
}
