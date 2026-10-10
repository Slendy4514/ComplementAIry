import fs from "node:fs";
import path from "node:path";
import * as vscode from "vscode";
import { correr, mostrarError, root } from "./comun";

/**
 * Iniciar ComplementAIry en un proyecto desde VSCode (sin terminal):
 * 1. `cai init` (configuración, plantillas, hooks de Claude Code, CLAUDE.md, skills).
 * 2. Si ya hay código: "conocerlo" (borradores de qué busca y tus reglas, qué código no es tuyo;
 *    las preguntas quedan en el panel → Preguntas para ti).
 * 3. 🎯 Entender el proyecto en el chat: te pregunta de a poco; cuando confirmas los objetivos, te
 *    ofrece proponer la estructura a partir de ellos.
 * "Empezar de cero" mueve .cai a .cai.viejo-<fecha> (nada se borra) e inicia de nuevo.
 */

/** ¿El proyecto ya está iniciado? (`cai init` crea config.json; una carpeta .cai con solo caché no cuenta). */
export const tieneCai = (cwd: string) => fs.existsSync(path.join(cwd, ".cai", "config.json")) || fs.existsSync(path.join(cwd, ".aicode", "config.json"));

const NO_PREGUNTAR = "cai.noOfrecerIniciar";
const IGNORAR = "**/{node_modules,dist,build,out,.git,.cai,.aicode,coverage,.venv,venv,__pycache__}/**";

/** ¿Ya hay código en el proyecto? (para ofrecer "conocerlo" antes de entender los objetivos). */
async function tieneCodigo(cwd: string): Promise<boolean> {
  const fs2 = await vscode.workspace.findFiles(new vscode.RelativePattern(cwd, "**/*.{js,jsx,ts,tsx,mjs,cjs,py,go,rs,java,kt,rb,php,cs,swift,dart,lua,vue,svelte}"), IGNORAR, 3);
  return fs2.length > 0;
}

async function iniciar(ctx: vscode.ExtensionContext): Promise<void> {
  const cwd = root(vscode.window.activeTextEditor?.document);
  if (!cwd) return void vscode.window.showWarningMessage("Abre la carpeta del proyecto primero.");
  if (tieneCai(cwd)) {
    const op = await vscode.window.showInformationMessage("Este proyecto ya usa ComplementAIry.", "Empezar de cero", "Entender el proyecto");
    if (op === "Empezar de cero") return void vscode.commands.executeCommand("cai.reiniciar");
    if (op === "Entender el proyecto") return void vscode.commands.executeCommand("cai.chat.entender", { empezar: true });
    return;
  }
  try {
    const salida = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "ComplementAIry: iniciando el proyecto…" }, () => correr(["init", cwd], cwd));
    void ctx.workspaceState.update(NO_PREGUNTAR, undefined);
    vscode.window.setStatusBarMessage(`ComplementAIry: ${salida.trim().split("\n").filter(Boolean).length} cambio(s) de inicio ✓`, 6000);
  } catch (e) {
    return mostrarError(e);
  }
  void vscode.commands.executeCommand("cai.panel.refrescar");
  // Proyecto con código: conocerlo primero (lo que ya hay), luego entender lo que buscas.
  if (await tieneCodigo(cwd)) {
    const op = await vscode.window.showInformationMessage(
      "Tu proyecto ya tiene código. ¿Lo conozco primero? Escribo borradores de qué busca y de tus reglas, y detecto qué código no es tuyo (las preguntas te quedan en el panel).",
      "Conocerlo",
      "Saltar",
    );
    if (op === "Conocerlo")
      try {
        const r = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "ComplementAIry: conociendo el proyecto…", cancellable: true }, (_p, t) => correr(["conocer", "--sin-preguntas"], cwd, { cancelar: t }));
        const ver = await vscode.window.showInformationMessage(`Listo: ${r.trim().split("\n").slice(-1)[0] ?? ""}`, "Ver proyecto.md");
        if (ver) await vscode.window.showTextDocument(vscode.Uri.file(path.join(cwd, ".cai", "proyecto.md")), { preview: false });
        void vscode.commands.executeCommand("cai.panel.refrescar");
      } catch (e) {
        mostrarError(e);
      }
  }
  const sigue = await vscode.window.showInformationMessage("Ahora entendamos qué buscas: te pregunto de a poco en el chat (con opciones) y lo confirmas tú.", "🎯 Empezar", "Más tarde");
  if (sigue === "🎯 Empezar") await vscode.commands.executeCommand("cai.chat.entender", { empezar: true });
}

async function reiniciar(ctx: vscode.ExtensionContext): Promise<void> {
  const cwd = root(vscode.window.activeTextEditor?.document);
  if (!cwd) return;
  const dir = fs.existsSync(path.join(cwd, ".cai")) ? ".cai" : fs.existsSync(path.join(cwd, ".aicode")) ? ".aicode" : "";
  if (!dir) return iniciar(ctx);
  const destino = `${dir}.viejo-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`;
  const ok = await vscode.window.showWarningMessage(
    `¿Empezar de cero en este proyecto? Muevo ${dir}/ a ${destino}/ (notas, tareas, decisiones, objetivos, chats y configuración quedan ahí; bórrala cuando no la necesites) e inicio de nuevo. Tu código no se toca.`,
    { modal: true },
    "Empezar de cero",
  );
  if (ok !== "Empezar de cero") return;
  try {
    fs.renameSync(path.join(cwd, dir), path.join(cwd, destino));
  } catch (e) {
    return mostrarError(e);
  }
  await iniciar(ctx);
}

/** Al abrir un proyecto sin ComplementAIry: lo ofrece una vez (o nunca más en ese proyecto). */
async function ofrecer(ctx: vscode.ExtensionContext): Promise<void> {
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!cwd || tieneCai(cwd) || ctx.workspaceState.get(NO_PREGUNTAR)) return;
  const op = await vscode.window.showInformationMessage("Este proyecto todavía no usa ComplementAIry. ¿Lo inicio? (tú programas; la IA te acompaña)", "Iniciar", "Ahora no", "No en este proyecto");
  if (op === "Iniciar") await iniciar(ctx);
  else if (op === "No en este proyecto") await ctx.workspaceState.update(NO_PREGUNTAR, true);
}

export function registrarInicio(ctx: vscode.ExtensionContext): void {
  ctx.subscriptions.push(
    vscode.commands.registerCommand("cai.iniciar", () => iniciar(ctx).catch(mostrarError)),
    vscode.commands.registerCommand("cai.reiniciar", () => reiniciar(ctx).catch(mostrarError)),
  );
  setTimeout(() => void ofrecer(ctx).catch(() => undefined), 2500);
}
