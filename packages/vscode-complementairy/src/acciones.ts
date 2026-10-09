import * as vscode from "vscode";
import { correr, guardar, mostrarError, root, vista, type Nota } from "./comun";
import { BOTONES, type NotasView } from "./notasView";
import { funcionesDe } from "./notaView";

/**
 * Lo que se hace con un clic sobre el código: insertar el snippet de una nota DONDE VA (dentro de
 * la función, después de la línea indicada), preguntar sobre la selección o pedir ayuda para una
 * función. La IA nunca inserta: el snippet entra solo por tu clic, con huecos para completar con Tab.
 */

const vistaPrevia = vscode.window.createTextEditorDecorationType({
  after: { color: new vscode.ThemeColor("editorCodeLens.foreground"), fontStyle: "italic", margin: "0 0 0 1em" },
  backgroundColor: new vscode.ThemeColor("editor.wordHighlightBackground"),
  isWholeLine: true,
});

/**
 * Línea (0-based) después de la cual va el snippet: la validada por la CLI dentro de la función
 * (`linea`, si su texto sigue igual), o la de `despues` más cercana al ancla; `undefined` si no tiene lugar.
 */
async function lineaDestino(doc: vscode.TextDocument, n: Nota, s: Nota["snippets"][number]): Promise<number | undefined> {
  if (s.lugar === "sin ubicar") return undefined;
  const t = s.despues.trim();
  if (s.linea && s.linea <= doc.lineCount && doc.lineAt(s.linea - 1).text.trim() === t) return s.linea - 1;
  // Si el código se movió: se busca esa línea, pero SOLO dentro de la función de la nota.
  const ancla = Math.min(Math.max(0, n.ancla.linea - 1), doc.lineCount - 1);
  const fn = (await funcionesDe(doc)).filter((f) => f.range.start.line <= ancla && ancla <= f.range.end.line).sort((a, b) => a.range.end.line - a.range.start.line - (b.range.end.line - b.range.start.line))[0];
  const hasta = fn ? fn.range.end.line : ancla;
  if (t)
    for (let k = ancla; k <= Math.min(hasta, doc.lineCount - 1); k++)
      if (doc.lineAt(k).text.trim() === t) return k;
  return undefined;
}

/** Resalta (o limpia, con i = null) la línea donde iría un snippet: al pasar el mouse por su botón. */
export async function resaltarDestino(doc: vscode.TextDocument, n: Nota | undefined, i: number | null): Promise<void> {
  const ed = vscode.window.visibleTextEditors.find((e) => e.document === doc);
  if (!ed) return;
  const s = n && i !== null ? n.snippets[i] : undefined;
  const d = n && s ? await lineaDestino(doc, n, s) : undefined;
  ed.setDecorations(vistaPrevia, d === undefined ? [] : [{ range: new vscode.Range(d, 0, d, 0), renderOptions: { after: { contentText: `⤵ aquí iría ${s!.llamada.split(/\s/)[0]}` } } }]);
  if (d !== undefined) ed.revealRange(new vscode.Range(d, 0, d, 0), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

/**
 * Insertar un snippet de una nota, en dos pasos: primero se ve DÓNDE iría (vista previa en gris) y
 * eliges "Aquí", "En el cursor" o "Cancelar". La IA nunca inserta: solo tu clic. Queda registrado en
 * la nota qué insertaste y dónde (para saber qué vino de un snippet).
 */
export async function insertarSnippet(doc: vscode.TextDocument, n: Nota, i: number): Promise<void> {
  const cwd = root(doc);
  const s = n.snippets[i];
  if (!cwd || !s) return;
  try {
    const { cuerpo } = JSON.parse(await correr(["snippet", "cuerpo", doc.uri.fsPath, s.llamada], cwd)) as { cuerpo: string };
    const ed = await vscode.window.showTextDocument(doc, { preview: false });
    const cursor = ed.selection.active.line;
    const destino = await lineaDestino(doc, n, s);
    const nombre = s.llamada.split(/\s/)[0]!;
    type Op = vscode.QuickPickItem & { linea?: number };
    const ops: Op[] = [];
    if (destino !== undefined) {
      ed.setDecorations(vistaPrevia, [{ range: new vscode.Range(destino, 0, destino, 0), renderOptions: { after: { contentText: `⤵ aquí iría ${nombre}: ${cuerpo.split("\n")[0]!.replace(/\$\{\d+:([^}]*)\}/g, "$1").replace(/\$\d/g, "").slice(0, 60)}…` } } }]);
      ed.revealRange(new vscode.Range(destino, 0, destino, 0), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
      ops.push({ label: `$(arrow-down) Aquí (después de la línea ${destino + 1})`, description: doc.lineAt(destino).text.trim().slice(0, 60), linea: destino });
    }
    ops.push({ label: `$(location) En el cursor (después de la línea ${cursor + 1})`, description: destino === undefined ? "no tiene un lugar claro dentro de la función" : "", linea: cursor });
    ops.push({ label: "$(close) Cancelar" });
    const op = await vscode.window.showQuickPick(ops, { placeHolder: `¿Dónde insertar ${nombre}?` });
    ed.setDecorations(vistaPrevia, []);
    if (op?.linea === undefined) return;
    const linea = doc.lineAt(op.linea);
    // Si la línea abre un bloque (`{`, `:`, `=>`), el snippet va un nivel más adentro.
    const abre = /(\{|:|=>|\()\s*$/.test(linea.text.replace(/\/\/.*$|#.*$/, "").trimEnd());
    const unidad = ed.options.insertSpaces ? " ".repeat(Number(ed.options.tabSize) || 2) : "\t";
    const extra = abre ? unidad : "";
    const texto = "\n" + cuerpo.split("\n").map((l) => extra + l).join("\n");
    // VSCode agrega a cada línea la sangría de la línea de destino: queda alineado con el código.
    await ed.insertSnippet(new vscode.SnippetString(texto), linea.range.end);
    vscode.window.setStatusBarMessage(`ComplementAIry: snippet ${nombre} insertado (Tab para pasar de un hueco al otro)`, 6000);
    // Procedencia: queda en la nota qué insertaste y dónde.
    void correr(["notas", "anotar", doc.uri.fsPath, n.id, "--texto", `⤵ Inserté el snippet \`${s.llamada}\` después de la línea ${op.linea + 1}.`], cwd, { silencioso: true }).catch(() => undefined);
  } catch (e) {
    mostrarError(e);
  }
}

export class Acciones implements vscode.CodeActionProvider {
  static readonly kinds = [vscode.CodeActionKind.QuickFix, vscode.CodeActionKind.RefactorRewrite];

  constructor(private readonly notas: NotasView) {}

  provideCodeActions(doc: vscode.TextDocument, rango: vscode.Range, ctx: vscode.CodeActionContext): vscode.CodeAction[] {
    const cwd = root(doc);
    if (!cwd || vista(cwd) !== "notas") return [];
    const out: vscode.CodeAction[] = [];
    const linea = rango.start.line;
    // Snippets de notas cercanas: "Insertar aquí".
    for (const n of this.notas.notas(doc).filter((x) => x.snippets.length && Math.abs(x.ancla.linea - 1 - linea) <= 3))
      n.snippets.forEach((s, i) => {
        const a = new vscode.CodeAction(`ComplementAIry: insertar snippet \`${s.llamada.split(/\s/)[0]}\` aquí`, vscode.CodeActionKind.QuickFix);
        a.command = { command: "cai.nota.insertar", title: a.title, arguments: [doc.uri.toString(), n.id, i] };
        out.push(a);
      });
    // Preguntar / pedir ayuda: solo si lo pides (Ctrl+. o clic en la bombilla) o hay selección, para no llenar todo de bombillas.
    if (ctx.triggerKind === vscode.CodeActionTriggerKind.Invoke || !rango.isEmpty) {
      const preguntar = new vscode.CodeAction("ComplementAIry: preguntar sobre esto…", vscode.CodeActionKind.RefactorRewrite);
      preguntar.command = { command: "cai.preguntar", title: preguntar.title };
      out.push(preguntar);
      for (const b of BOTONES.filter((x) => ["pista", "pseudo", "tests"].includes(x.pedido))) {
        const a = new vscode.CodeAction(`ComplementAIry: ${b.etiqueta} para esta parte`, vscode.CodeActionKind.RefactorRewrite);
        a.command = { command: "cai.pedirAqui", title: a.title, arguments: [doc.uri.toString(), linea + 1, b.pedido] };
        out.push(a);
      }
    }
    return out;
  }

  registrar(ctx: vscode.ExtensionContext): void {
    ctx.subscriptions.push(
      vscode.languages.registerCodeActionsProvider({ scheme: "file" }, this, { providedCodeActionKinds: Acciones.kinds }),
      // Seleccionar código → preguntar. Abre una nota en esa línea con la selección como contexto.
      vscode.commands.registerCommand("cai.preguntar", async () => {
        const ed = vscode.window.activeTextEditor;
        if (!ed) return void vscode.window.showWarningMessage("ComplementAIry: abre un archivo primero.");
        const seleccion = ed.document.getText(ed.selection).slice(0, 4000);
        const texto = await vscode.window.showInputBox({
          prompt: seleccion ? "¿Qué quieres preguntar sobre lo seleccionado?" : "¿Qué quieres preguntar sobre esta línea?",
          placeHolder: "Vacío = una pista. También: !pseudo, !piezas, !tests, !ejemplo…",
        });
        if (texto === undefined) return;
        await this.notas.pedir(ed.document, {
          linea: ed.selection.start.line + 1,
          ...(texto.trim() ? { texto: texto.trim() } : { pedido: "pista" }),
          ...(seleccion.trim() ? { seleccion } : {}),
        });
      }),
      // Ayuda sobre el ARCHIVO entero (no una función): nota arriba del archivo.
      vscode.commands.registerCommand("cai.ayudaArchivo", async (uri?: unknown) => {
        const u = typeof uri === "string" ? vscode.Uri.parse(uri) : uri instanceof vscode.Uri ? uri : undefined;
        const doc = u ? await vscode.workspace.openTextDocument(u) : vscode.window.activeTextEditor?.document;
        if (!doc) return;
        type Op = vscode.QuickPickItem & { pedido?: string; plano?: boolean; escribir?: boolean };
        const ops: Op[] = [
          { label: "$(edit) Escribir una pregunta sobre el archivo…", escribir: true },
          { label: "🗺️ Plano del archivo", description: "qué funciones debería tener y por cuál empezar (notas + tareas)", plano: true },
          ...BOTONES.filter((b) => !["plano", "tests"].includes(b.pedido)).map((b) => ({ label: b.etiqueta, description: "sobre el archivo entero", pedido: b.pedido })),
        ];
        const op = await vscode.window.showQuickPick(ops, { placeHolder: "Ayuda con este archivo" });
        if (!op) return;
        if (op.plano) return vscode.commands.executeCommand("cai.plano", doc.uri);
        if (op.escribir) {
          const texto = await vscode.window.showInputBox({ prompt: "¿Qué quieres preguntar sobre este archivo?", placeHolder: "Ej.: ¿cómo lo organizo?, ¿qué le falta?, ¿esto debería ir en otro archivo?" });
          if (texto?.trim()) await this.notas.pedir(doc, { archivoEntero: true, texto: texto.trim() });
          return;
        }
        await this.notas.pedir(doc, { archivoEntero: true, pedido: op.pedido! });
      }),
      vscode.commands.registerCommand("cai.pedirAqui", async (uri?: unknown, linea?: unknown, pedido?: unknown) => {
        // Desde CodeLens/bombilla llegan (uri en texto, línea, pedido); desde el menú contextual, un Uri.
        const u = typeof uri === "string" ? vscode.Uri.parse(uri) : uri instanceof vscode.Uri ? uri : undefined;
        const doc = u ? await vscode.workspace.openTextDocument(u) : vscode.window.activeTextEditor?.document;
        if (!doc) return;
        const l = typeof linea === "number" ? linea : (vscode.window.activeTextEditor?.selection.active.line ?? 0) + 1;
        const p = (typeof pedido === "string" ? pedido : undefined) ?? (await vscode.window.showQuickPick(BOTONES.filter((b) => b.pedido !== "plano").map((b) => ({ label: b.etiqueta, pedido: b.pedido })), { placeHolder: "¿Qué ayuda quieres para esta parte?" }))?.pedido;
        if (p) await this.notas.pedir(doc, { linea: l, pedido: p });
      }),
    );
  }
}

/** Modo comentarios desde VSCode: la revisión se aplica SOBRE EL TEXTO DEL EDITOR, no en disco. */
export async function revisarConEdiciones(ed: vscode.TextEditor, cwd: string): Promise<string> {
  const doc = ed.document;
  await guardar(doc); // la CLI revisa lo del disco; los comentarios se aplican después sobre el editor
  const r = JSON.parse(await correr(["revisar", doc.uri.fsPath, "--ediciones", "--json"], cwd)) as { ediciones?: { linea: number; texto: string; lineas: string[] }[]; bloqueantes?: number };
  const eol = doc.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
  const lineas = doc.getText().split(/\r?\n/);
  const edit = new vscode.WorkspaceEdit();
  let aplicadas = 0;
  let descartadas = 0;
  for (const e of r.ediciones ?? []) {
    // Si mientras la IA pensaba moviste o cambiaste esa línea, se busca por su texto; si no está, se descarta.
    let k = e.linea - 1;
    const t = e.texto.trim();
    if (lineas[k]?.trim() !== t) {
      k = -1;
      for (let j = 0; j < lineas.length; j++) if (lineas[j]!.trim() === t && (k < 0 || Math.abs(j - e.linea + 1) < Math.abs(k - e.linea + 1))) k = j;
    }
    if (k < 0) {
      descartadas++;
      continue;
    }
    edit.insert(doc.uri, new vscode.Position(k, 0), e.lineas.join(eol) + eol);
    aplicadas++;
  }
  if (aplicadas) await vscode.workspace.applyEdit(edit); // no se guarda: lo decides tú (o tu autoguardado)
  return `${aplicadas} comentario(s) de revisión${descartadas ? ` · ${descartadas} descartado(s) porque esa línea cambió` : ""}`;
}
